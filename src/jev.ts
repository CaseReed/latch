import { TypeSafeClient } from "@typesafe-ai/sdk";
import { buildQuestions } from "./questions.ts";
import type { ClusterState } from "./types.ts";

export type JevCall = {
  answers: Record<string, unknown>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
  cost_estimate_usd: number;
};

const DEFAULT_MODEL = "jev-latest";
const DEFAULT_INPUT_USD_PER_MTOK = 0.3;
const DEFAULT_OUTPUT_USD_PER_MTOK = 2.5;

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function jevModel(): string {
  return process.env.LATCH_MODEL?.trim() || DEFAULT_MODEL;
}

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  const input = envNumber("LATCH_INPUT_USD_PER_MTOK", DEFAULT_INPUT_USD_PER_MTOK);
  const output = envNumber("LATCH_OUTPUT_USD_PER_MTOK", DEFAULT_OUTPUT_USD_PER_MTOK);
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function noulValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  const rec = asRecord(value);
  if (typeof rec.noul === "number") return rec.noul;
  return undefined;
}

function choiceId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const rec = asRecord(value);
  if (typeof rec.choice === "string") return rec.choice;
  return undefined;
}

function scoreValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  const rec = asRecord(value);
  if (typeof rec.score === "number") return rec.score;
  return undefined;
}

function choiceConfidence(value: unknown): number | undefined {
  const rec = asRecord(value);
  if (typeof rec.confidence === "number") return rec.confidence;
  return undefined;
}

export function parseJevAnswers(raw: unknown): {
  cause?: string;
  cause_confidence?: number;
  same_root?: number;
  blocks_merge?: number;
  action?: string;
  severity?: number;
} {
  const answers = asRecord(raw);
  return {
    cause: choiceId(answers.cause),
    cause_confidence: choiceConfidence(answers.cause),
    same_root: noulValue(answers.same_root),
    blocks_merge: noulValue(answers.blocks_merge),
    action: choiceId(answers.action),
    severity: scoreValue(answers.severity),
  };
}

export async function askJev(
  state: ClusterState,
  client: TypeSafeClient = new TypeSafeClient(),
): Promise<JevCall> {
  const started = Date.now();
  const result = await client.systemOne({
    state,
    model: jevModel(),
    questions: buildQuestions(state),
  });
  const usage = result.usage ?? { input_tokens: 0, output_tokens: 0 };
  return {
    answers: asRecord(result.answers),
    model: result.model || jevModel(),
    usage,
    latency_ms: Date.now() - started,
    cost_estimate_usd: estimateCostUsd(usage.input_tokens, usage.output_tokens),
  };
}
