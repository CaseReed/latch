import assert from "node:assert/strict";
import { test } from "node:test";
import type { CachedJudgment } from "./ledger.ts";
import type { Cluster } from "./types.ts";

// Blank the key before score-run (and load-env) is imported so this stays offline.
process.env.TYPESAFE_API_KEY = "";
const { planScoring, scoreClusters } = await import("./score-run.ts");

function cluster(signature: string): Cluster {
  return {
    signature,
    apiName: "x",
    size: 1,
    failed_count: 1,
    flaky_count: 0,
    representative_error: "e",
    sample_titles: [],
    sample_locations: [],
  };
}

test("planScoring reuses the cache, then spends the fresh budget, then skips", () => {
  const cache = new Map<string, CachedJudgment>([["a|1", { cause: "env_cascade" }]]);
  const plan = planScoring(
    [cluster("a|1"), cluster("b|2"), cluster("c|3"), cluster("d|4")],
    cache,
    2,
  );
  assert.deepEqual(
    plan.map((item) => item.mode),
    ["cached", "fresh", "fresh", "skip"],
  );
});

test("a cached cluster is judged from the ledger with no API key", async () => {
  const cache = new Map<string, CachedJudgment>([
    [
      "a|1",
      {
        cause: "assertion_bug",
        cause_confidence: 0.9,
        same_root: 0.8,
        blocks_merge: 0.6,
        jev_action: "fix_product",
        model: "jev-latest",
      },
    ],
  ]);
  const scored = await scoreClusters(
    [cluster("a|1"), cluster("b|2")],
    { workers: 1, retries_config: 0 },
    8,
    cache,
  );
  assert.equal(scored[0]?.scored, true);
  assert.equal(scored[0]?.cached, true);
  assert.equal(scored[0]?.cause, "assertion_bug");
  assert.equal(scored[0]?.action, "fix_product");
  assert.equal(scored[1]?.scored, false);
  assert.equal(scored[1]?.action_reason, "no_key");
});
