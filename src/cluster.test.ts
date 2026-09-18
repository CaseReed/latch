import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { clusterAttempts } from "./cluster.ts";
import { formatTerminal } from "./summarize.ts";
import type { FailedAttempt } from "./types.ts";

const GOLDEN = "testdata/runs/env-cascade.json";

test("env-cascade golden: 73 failed → 4 causes, 70 connection-refused in bucket 0", () => {
  const data = JSON.parse(readFileSync(GOLDEN, "utf8")) as { attempts: FailedAttempt[] };
  assert.equal(data.attempts.length, 73);
  const clusters = clusterAttempts(data.attempts);
  const report = formatTerminal(clusters, data.attempts.length);
  console.log(report);
  assert.equal(clusters.length, 4);
  assert.equal(clusters[0]?.size, 70);
  assert.equal(clusters[0]?.apiName, "page.goto");
  assert.match(clusters[0]?.signature ?? "", /localhost:8080/);
  assert.match(report, /Latch: 73 failed → 4 causes/);
  assert.match(report, /n=70/);
  const sizes = clusters.map((c) => c.size).sort((a, b) => b - a);
  assert.deepEqual(sizes, [70, 1, 1, 1]);
});

test("zero attempts is zero clusters", () => {
  assert.deepEqual(clusterAttempts([]), []);
  assert.equal(formatTerminal([], 0), "Latch: 0 failures");
});
