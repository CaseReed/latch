/**
 * Calibration harness: how often does the merge verdict flip across repeated
 * Jev calls on the same cluster? Run from the repo root with a key:
 *
 *     npm run calibrate
 *
 * The golden/junit clusters that matter are the borderline ones: a cluster whose
 * `blocks_merge` sits near the product threshold. This reports the flip count
 * for the shipped policy and three alternatives.
 */
import { existsSync, readFileSync } from "node:fs";
import { clusterAttempts } from "../../src/cluster.ts";
import { loadGolden } from "../../src/golden.ts";
import { ingestJUnit } from "../../src/ingest/junit.ts";
import { askJev, parseJevAnswers } from "../../src/jev.ts";
import "../../src/load-env.ts";
import type { Cluster, RunMeta } from "../../src/types.ts";

const RUNS = Number(process.env.LATCH_CALIB_RUNS ?? 5);

type Spec = { name: string; run: RunMeta; cluster: Cluster };
const specs: Spec[] = [];

for (const name of ["env-cascade", "flake", "locator", "assertion"]) {
  const golden = loadGolden(name);
  specs.push({ name, run: golden.run, cluster: clusterAttempts(golden.attempts)[0]! });
}

function fromJunit(file: string, label: string, match: (cluster: Cluster) => boolean): void {
  if (!existsSync(file)) {
    console.log(`(skip ${label}: ${file} missing)`);
    return;
  }
  const { run, attempts } = ingestJUnit(readFileSync(file, "utf8"));
  const cluster = clusterAttempts(attempts).find(match);
  if (cluster) specs.push({ name: label, run, cluster });
}

fromJunit("testdata/junit/jest.xml", "jest-assert", (c) => c.apiName === "expect.toBe");
fromJunit("experiments/real-pytest/results.xml", "pytest-assert", (c) =>
  c.representative_error.includes("4100"),
);
fromJunit("experiments/click-real/results.xml", "click-assert", (c) =>
  c.representative_error.includes("False is True"),
);
fromJunit("experiments/click-real/results.xml", "click-help", (c) => c.size === 4);

type Answers = ReturnType<typeof parseJevAnswers>;
type Policy = "shipped" | "model-action" | "strong-or-model" | "confidence";

function decide(name: string, a: Answers, policy: Policy): string {
  if (a.cause_confidence === undefined || a.cause_confidence < 0.55) return "needs_human";
  if ((a.same_root ?? 0) < 0.5) return "needs_human";
  if (a.cause === "env_cascade" && (a.same_root ?? 0) >= 0.7) return "ignore_as_infra";
  if (a.cause === "flake" && name === "flake") return "fix_test";
  if (a.cause === "locator_drift") return "fix_test";
  if (a.cause === "assertion_bug") {
    if (policy === "shipped") {
      return (a.blocks_merge ?? 0) >= 0.55 || a.action === "fix_product" ? "fix_product" : "needs_human";
    }
    if (policy === "model-action") return a.action === "fix_product" ? "fix_product" : "needs_human";
    if (policy === "strong-or-model") {
      return a.action === "fix_product" || (a.blocks_merge ?? 0) >= 0.6 ? "fix_product" : "needs_human";
    }
    return (a.cause_confidence ?? 0) >= 0.8 ? "fix_product" : "needs_human";
  }
  return "needs_human";
}

const flips: Record<Policy, number> = { shipped: 0, "model-action": 0, "strong-or-model": 0, confidence: 0 };

for (const spec of specs) {
  const state = {
    run: spec.run,
    cluster: {
      size: spec.cluster.size,
      failed_count: spec.cluster.failed_count,
      flaky_count: spec.cluster.flaky_count,
      signature: spec.cluster.signature,
      apiName: spec.cluster.apiName,
      representative_error: spec.cluster.representative_error,
      sample_titles: spec.cluster.sample_titles,
      sample_locations: spec.cluster.sample_locations,
    },
  };
  const rows: Answers[] = [];
  for (let i = 0; i < RUNS; i += 1) rows.push(parseJevAnswers((await askJev(state)).answers));

  console.log(
    `\n# ${spec.name}  blocks: ${rows.map((a) => a.blocks_merge?.toFixed(2)).join(" ")}   jev_action: ${rows.map((a) => a.action).join(" ")}`,
  );
  for (const policy of Object.keys(flips) as Policy[]) {
    const decided = rows.map((a) => decide(spec.name, a, policy));
    const distinct = new Set(decided).size;
    if (distinct > 1) flips[policy] += 1;
    console.log(`  ${policy.padEnd(16)} ${decided.join(",")}  ${distinct > 1 ? "FLIPS" : "stable"}`);
  }
}

console.log(`\nclusters that flip, out of ${specs.length}:`);
for (const [policy, count] of Object.entries(flips)) console.log(`  ${policy.padEnd(16)} ${count}`);
