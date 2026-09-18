import assert from "node:assert/strict";
import { test } from "node:test";
import { clusterAttempts } from "./cluster.ts";
import { loadGolden } from "./golden.ts";
import { formatTerminal } from "./summarize.ts";

test("env-cascade golden: 73 failed → 4 causes, 70 connection-refused in bucket 0", () => {
  const data = loadGolden("env-cascade");
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

test("flake golden: one cluster with flaky retries", () => {
  const data = loadGolden("flake");
  const clusters = clusterAttempts(data.attempts);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.size, 8);
  assert.equal(clusters[0]?.flaky_count, 5);
  assert.equal(clusters[0]?.failed_count, 3);
  assert.equal(clusters[0]?.apiName, "locator.waitFor");
});

test("locator golden: one strict-mode cluster", () => {
  const data = loadGolden("locator");
  const clusters = clusterAttempts(data.attempts);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.size, 9);
  assert.equal(clusters[0]?.apiName, "locator.click");
  assert.match(clusters[0]?.representative_error ?? "", /strict mode/);
});

test("assertion golden: one expect.toHaveText cluster", () => {
  const data = loadGolden("assertion");
  const clusters = clusterAttempts(data.attempts);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.size, 5);
  assert.equal(clusters[0]?.apiName, "expect.toHaveText");
  assert.match(clusters[0]?.representative_error ?? "", /Invoice total/);
});

test("zero attempts is zero clusters", () => {
  assert.deepEqual(clusterAttempts([]), []);
  assert.equal(formatTerminal([], 0), "Latch: 0 failures");
});

test("secrets in error text are redacted before they reach any report", () => {
  const clusters = clusterAttempts([
    {
      title: "login",
      location: "tests/login.spec.ts:1",
      status: "failed",
      apiName: "page.goto",
      errorMessage:
        "page.goto failed: Authorization: Bearer abc123def456 token=sk_abc123456",
    },
  ]);
  const error = clusters[0]?.representative_error ?? "";
  assert.doesNotMatch(error, /abc123def456/);
  assert.doesNotMatch(error, /sk_abc123456/);
  assert.match(error, /Bearer <redacted>/);
  assert.match(error, /<redacted-key>/);
});
