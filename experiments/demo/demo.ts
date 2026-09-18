/**
 * Offline demo of the merge gate: no API key, no network.
 *
 * Two seeded scenarios show the decision a CI would act on:
 *   1. an infra outage  -> Gate: PASS  (exit 0)
 *   2. a real regression -> Gate: BLOCK (exit 1)
 *
 * The Jev judgments are pre-seeded so the demo is deterministic and free. With a
 * key, Latch would call Jev instead of reading the cache.
 *
 *     npm run demo
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clusterAttempts } from "../../src/cluster.ts";
import { ingestJUnit } from "../../src/ingest/junit.ts";
import type { CachedJudgment } from "../../src/ledger.ts";
import type { FailedAttempt, RunMeta } from "../../src/types.ts";

const INFRA = "testdata/junit/infra.xml";
const REGRESSION = "testdata/runs/assertion.json";

function xmlSignature(file: string): string {
  return clusterAttempts(ingestJUnit(readFileSync(file, "utf8")).attempts)[0]!.signature;
}

function jsonSignature(file: string): string {
  const data = JSON.parse(readFileSync(file, "utf8")) as { run: RunMeta; attempts: FailedAttempt[] };
  return clusterAttempts(data.attempts)[0]!.signature;
}

function runGate(file: string, store: string): { output: string; code: number } {
  const result = spawnSync("npx", ["tsx", "src/cli.ts", file, "--store", store, "--gate"], {
    encoding: "utf8",
    env: { ...process.env, TYPESAFE_API_KEY: "" },
  });
  return { output: `${result.stdout ?? ""}`.trim(), code: result.status ?? 1 };
}

const dir = mkdtempSync(join(tmpdir(), "latch-demo-"));
try {
  const store = join(dir, "store.json");
  const judgments: Record<string, CachedJudgment> = {
    [xmlSignature(INFRA)]: {
      cause: "env_cascade",
      cause_confidence: 1,
      same_root: 0.9,
      blocks_merge: 0.4,
      jev_action: "ignore_as_infra",
      model: "demo",
    },
    [jsonSignature(REGRESSION)]: {
      cause: "assertion_bug",
      cause_confidence: 1,
      same_root: 0.8,
      blocks_merge: 0.6,
      jev_action: "fix_product",
      model: "demo",
    },
  };
  writeFileSync(store, JSON.stringify({ version: 1, runs: [], suppressed: [], judgments }));

  console.log("Latch demo — offline, no API key, no network.");
  console.log("Judgments are pre-seeded for determinism; with a key, Latch calls Jev.\n");

  const infra = runGate(INFRA, store);
  console.log("=== 1) an infra outage (8 identical connection errors) ===");
  console.log(infra.output);
  console.log(`→ exit ${infra.code} · PASS: nothing to fix, merge.\n`);

  const regression = runGate(REGRESSION, store);
  console.log("=== 2) a real regression (5 failing assertions) ===");
  console.log(regression.output);
  console.log(`→ exit ${regression.code} · BLOCK: a human must look.\n`);

  if (infra.code !== 0 || regression.code !== 1) {
    console.error(`demo failed: infra exit ${infra.code} (want 0), regression exit ${regression.code} (want 1)`);
    process.exitCode = 1;
  } else {
    console.log("Demo OK.");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
