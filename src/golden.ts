import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { ingestJUnit } from "./ingest/junit.ts";
import type { FailedAttempt, RunMeta } from "./types.ts";

export type GoldenRun = {
  run: RunMeta;
  attempts: FailedAttempt[];
};

const REQUIRED_FIELDS = ["title", "location", "apiName", "errorMessage", "status"] as const;

function isAttempt(value: unknown): value is FailedAttempt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return REQUIRED_FIELDS.every((field) => typeof record[field] === "string");
}

/** Parse a saved `{ run, attempts }` run, validating what came from the file. */
export function parseGolden(raw: string, label: string): GoldenRun {
  const data = JSON.parse(raw) as { run?: RunMeta; attempts?: unknown };
  if (!Array.isArray(data.attempts) || !data.attempts.every(isAttempt)) {
    throw new Error(`${label}: expected a golden JSON with { run, attempts }`);
  }
  return { run: data.run ?? { workers: 1, retries_config: 0 }, attempts: data.attempts };
}

/** Load a run from a JUnit XML report or a golden JSON file. */
export function loadRunFile(path: string): GoldenRun {
  const raw = readFileSync(path, "utf8");
  return extname(path).toLowerCase() === ".xml" ? ingestJUnit(raw) : parseGolden(raw, path);
}

export function loadGolden(name: string): GoldenRun {
  const path = `testdata/runs/${name}.json`;
  return parseGolden(readFileSync(path, "utf8"), path);
}
