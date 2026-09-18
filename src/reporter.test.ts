import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { emptyHistory, loadHistory, saveHistory, suppress } from "./ledger.ts";

process.env.TYPESAFE_API_KEY = "";
const defaultStore = join(mkdtempSync(join(tmpdir(), "latch-report-")), "store.json");
process.env.LATCH_STORE = defaultStore;

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

async function captureLogs(fn: (logs: string[]) => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const consoleMock = console as { log: (...args: unknown[]) => void };
  const original = consoleMock.log;
  consoleMock.log = (...args: unknown[]) => {
    logs.push(args.join(" "));
  };
  try {
    await fn(logs);
  } finally {
    consoleMock.log = original;
  }
  return logs;
}

async function newReporter(retries: number) {
  const { default: LatchReporter } = await import("./reporter.ts");
  const reporter = new LatchReporter();
  reporter.onBegin(
    { workers: 1, projects: [{ retries }] } as unknown as FullConfig,
    { allTests: () => [] } as unknown as Suite,
  );
  return reporter;
}

test("reporter marks a passed-on-retry attempt flaky and writes the cluster report", async () => {
  const logs = await captureLogs(async (captured) => {
    const reporter = await newReporter(1);
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
    const firstRun = captured.join("\n");
    assert.match(firstRun, /Latch: 2 failed → 2 causes/);
    assert.match(firstRun, /action=needs_human \(no_key\)/);

    // A second run reads the store written by the first and marks the clusters known.
    captured.length = 0;
    await reporter.onEnd({ duration: 124 } as unknown as FullResult);
  });

  // Assertions on the first run's report JSON are read after capture so console is restored.
  const report = JSON.parse(readFileSync("traces/latch-report.json", "utf8")) as {
    failed: number;
    clusters: Array<{ signature: string; failed_count: number; flaky_count: number }>;
  };
  assert.equal(report.failed, 2);
  assert.equal(report.clusters.length, 2);
  const flakyCluster = report.clusters.find((c) => c.signature.startsWith("locator.waitFor"));
  assert.ok(flakyCluster);
  assert.equal(flakyCluster.flaky_count, 1);
  assert.equal(flakyCluster.failed_count, 0);
  assert.equal(report.clusters.find((c) => c.signature.startsWith("page.goto"))?.failed_count, 1);
  assert.match(logs.join("\n"), /\[seen x1\]/);
});

test("reporter hides suppressed clusters but still records them in history", async () => {
  const store = join(mkdtempSync(join(tmpdir(), "latch-sup-")), "store.json");
  saveHistory(suppress(emptyHistory(), "page.goto|*"), store);
  process.env.LATCH_STORE = store;
  try {
    const logs = await captureLogs(async () => {
      const reporter = await newReporter(0);
      reporter.onTestEnd(
        testCase("a", "loads dashboard"),
        result("failed", "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/"),
      );
      reporter.onTestEnd(
        testCase("b", "saves draft"),
        result("failed", "TimeoutError: locator.waitFor: Timeout 5000ms exceeded."),
      );
      await reporter.onEnd({ duration: 123 } as unknown as FullResult);
    });

    const output = logs.join("\n");
    assert.match(output, /Latch: 2 failed → 1 cause \(1 suppressed\)/);
    assert.doesNotMatch(output, /net::ERR_CONNECTION_REFUSED/);
    assert.equal(loadHistory(store).runs[0]?.clusters.length, 2);
  } finally {
    process.env.LATCH_STORE = defaultStore;
  }
});
