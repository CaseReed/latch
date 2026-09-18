import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

process.env.TYPESAFE_API_KEY = "";

function testCase(id: string, title: string): TestCase {
  return {
    id,
    title,
    location: { file: `tests/${id}.spec.ts`, line: 1, column: 1 },
    outcome: () => "unexpected",
  } as unknown as TestCase;
}

function result(status: string, errorMessage: string): TestResult {
  return {
    status,
    error: errorMessage ? { message: errorMessage } : undefined,
    errors: [],
    steps: [],
  } as unknown as TestResult;
}

test("reporter marks a passed-on-retry attempt flaky and writes the cluster report", async () => {
  const logs: string[] = [];
  const consoleMock = console as { log: (...args: unknown[]) => void };
  const original = consoleMock.log;
  consoleMock.log = (...args: unknown[]) => {
    logs.push(args.join(" "));
  };
  try {
    const { default: LatchReporter } = await import("./reporter.ts");
    const reporter = new LatchReporter();
    reporter.onBegin(
      { workers: 1, projects: [{ retries: 1 }] } as unknown as FullConfig,
      { allTests: () => [] } as unknown as Suite,
    );

    reporter.onTestEnd(
      testCase("a", "loads dashboard"),
      result("failed", "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/"),
    );
    reporter.onTestEnd(
      testCase("b", "saves draft"),
      result("failed", "TimeoutError: locator.waitFor: Timeout 5000ms exceeded."),
    );
    const flaky = testCase("b", "saves draft") as unknown as { outcome: () => string };
    flaky.outcome = () => "flaky";
    reporter.onTestEnd(flaky as unknown as TestCase, result("passed", ""));

    await reporter.onEnd({ duration: 123 } as unknown as FullResult);

    const output = logs.join("\n");
    assert.match(output, /Latch: 2 failed → 2 causes/);
    assert.match(output, /action=needs_human \(no_key\)/);

    const report = JSON.parse(readFileSync("traces/latch-report.json", "utf8")) as {
      failed: number;
      clusters: Array<{
        signature: string;
        failed_count: number;
        flaky_count: number;
      }>;
    };
    assert.equal(report.failed, 2);
    assert.equal(report.clusters.length, 2);
    const flakyCluster = report.clusters.find((c) => c.signature.startsWith("locator.waitFor"));
    assert.ok(flakyCluster);
    assert.equal(flakyCluster.flaky_count, 1);
    assert.equal(flakyCluster.failed_count, 0);
    const failedCluster = report.clusters.find((c) => c.signature.startsWith("page.goto"));
    assert.ok(failedCluster);
    assert.equal(failedCluster.failed_count, 1);
    assert.equal(failedCluster.flaky_count, 0);
  } finally {
    consoleMock.log = original;
  }
});
