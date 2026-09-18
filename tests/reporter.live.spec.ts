import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { clusterAttempts } from "../src/cluster.ts";
import { hasApiKey } from "../src/load-env.ts";
import { scoreClusters } from "../src/score-run.ts";
import { formatScoredTerminal } from "../src/summarize.ts";
import type { FailedAttempt, RunMeta } from "../src/types.ts";

test("live: Jev scores env-cascade clusters", async () => {
  test.setTimeout(180_000);
  test.skip(!hasApiKey(), "TYPESAFE_API_KEY unset");
  const fixture = JSON.parse(readFileSync("testdata/runs/env-cascade.json", "utf8")) as {
    run: RunMeta;
    attempts: FailedAttempt[];
  };
  const clusters = clusterAttempts(fixture.attempts);
  expect(clusters).toHaveLength(4);
  expect(clusters[0]?.size).toBe(70);
  const scored = await scoreClusters(clusters, fixture.run, 8);
  console.log(formatScoredTerminal(scored, fixture.attempts.length));
  expect(scored).toHaveLength(4);
  expect(scored.every((cluster) => cluster.scored)).toBe(true);
  expect(scored[0]?.action).toBeTruthy();
});
