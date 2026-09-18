import assert from "node:assert/strict";
import { test } from "node:test";
import { clusterAttempts } from "./cluster.ts";
import { loadGolden } from "./golden.ts";
import "./load-env.ts";
import { hasApiKey } from "./load-env.ts";
import { decideAction } from "./policy.ts";
import { scoreClusters } from "./score-run.ts";
import { formatScoredTerminal } from "./summarize.ts";

const skip = !hasApiKey();

test("live: Jev labels env_cascade, flake, locator_drift, assertion_bug", { skip }, async () => {
  const cases = [
    { name: "env-cascade", size: 70, cause: "env_cascade", action: "ignore_as_infra" },
    { name: "flake", size: 8, cause: "flake", action: "fix_test" },
    { name: "locator", size: 9, cause: "locator_drift", action: "fix_test" },
    { name: "assertion", size: 5, cause: "assertion_bug", action: "fix_product" },
  ] as const;

  for (const item of cases) {
    const fixture = loadGolden(item.name);
    const clusters = clusterAttempts(fixture.attempts);
    const scored = await scoreClusters(clusters, fixture.run, 8);
    console.log(`\n# ${item.name}`);
    console.log(formatScoredTerminal(scored, fixture.attempts.length));
    const top = scored[0];
    assert.ok(top, item.name);
    assert.equal(top.size, item.size, item.name);
    assert.equal(top.scored, true, item.name);
    assert.equal(top.cause, item.cause, `${item.name} cause`);
    const expected = decideAction({
      cause: top.cause,
      cause_confidence: top.cause_confidence,
      same_root: top.same_root,
      blocks_merge: top.blocks_merge,
      flaky_count: top.flaky_count,
      jev_action: top.jev_action,
    });
    assert.equal(top.action, expected.action, `${item.name} policy`);
    if ("action" in item) assert.equal(top.action, item.action, `${item.name} action`);
  }
});
