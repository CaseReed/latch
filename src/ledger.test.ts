import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendRun,
  buildRecord,
  emptyHistory,
  historyLabel,
  historyStats,
  isSuppressed,
  labelsFor,
  loadHistory,
  saveHistory,
  splitSuppressed,
  suppress,
  unsuppress,
  type RunRecord,
} from "./ledger.ts";
import type { ScoredCluster } from "./types.ts";

function cluster(overrides: Partial<ScoredCluster> = {}): ScoredCluster {
  return {
    signature: "page.goto|Error: refused",
    apiName: "page.goto",
    size: 4,
    failed_count: 3,
    flaky_count: 1,
    representative_error: "Error: refused",
    sample_titles: ["a"],
    sample_locations: ["a.spec.ts:1"],
    scored: false,
    action: "needs_human",
    ...overrides,
  };
}

function run(at: string, signatures: Array<[string, number, number]>): RunRecord {
  return {
    at,
    total_failed: signatures.reduce((total, [, failed]) => total + failed, 0),
    clusters: signatures.map(([signature, failed_count, flaky_count]) => ({
      signature,
      size: failed_count + flaky_count,
      failed_count,
      flaky_count,
      action: "needs_human",
    })),
  };
}

test("a missing store reads as empty history", () => {
  assert.deepEqual(loadHistory(join(tmpdir(), "latch-does-not-exist.json")), emptyHistory());
});

test("save then load round-trips the history", () => {
  const path = join(mkdtempSync(join(tmpdir(), "latch-store-")), "store.json");
  const history = appendRun(emptyHistory(), run("2026-09-01T00:00:00.000Z", [["a|x", 2, 0]]));
  saveHistory(history, path);
  assert.deepEqual(loadHistory(path), history);
});

test("appendRun keeps only the most recent runs", () => {
  let history = emptyHistory();
  for (let i = 0; i < 120; i += 1) history = appendRun(history, run(`run-${i}`, [["a|x", 1, 0]]));
  assert.equal(history.runs.length, 100);
  assert.equal(history.runs[0]?.at, "run-20");
});

test("historyStats aggregates seen, failed and flaky totals per signature", () => {
  const history = {
    version: 1 as const,
    runs: [
      run("2026-09-01T00:00:00.000Z", [["a|x", 2, 0]]),
      run("2026-09-02T00:00:00.000Z", [
        ["a|x", 1, 1],
        ["b|y", 3, 0],
      ]),
    ],
    suppressed: [],
  };
  const stats = historyStats(history);
  assert.deepEqual(stats.get("a|x"), {
    seen: 2,
    flaky_runs: 1,
    first_seen: "2026-09-01T00:00:00.000Z",
    last_seen: "2026-09-02T00:00:00.000Z",
    flaky_total: 1,
    failed_total: 3,
  });
  assert.equal(stats.get("b|y")?.seen, 1);
});

test("historyLabel marks unseen clusters new and reports the flake rate", () => {
  assert.equal(historyLabel(undefined), "[new]");
  const stats = historyStats({
    version: 1,
    runs: [
      run("2026-09-01T00:00:00.000Z", [["a|x", 1, 0]]),
      run("2026-09-02T00:00:00.000Z", [["a|x", 1, 2]]),
    ],
    suppressed: [],
  });
  assert.equal(historyLabel(stats.get("a|x")), "[seen x2, flake 50%]");
});

test("isSuppressed matches exactly and with a wildcard", () => {
  const history = suppress(suppress(emptyHistory(), "page.goto|exact"), "locator.click|*");
  assert.equal(isSuppressed(history, "page.goto|exact"), true);
  assert.equal(isSuppressed(history, "page.goto|other"), false);
  assert.equal(isSuppressed(history, "locator.click|anything at all"), true);
  assert.equal(isSuppressed(history, "locator.fill|x"), false);
});

test("suppress dedupes and sorts, unsuppress removes", () => {
  const history = suppress(suppress(suppress(emptyHistory(), "b|x"), "a|x"), "b|x");
  assert.deepEqual(history.suppressed, ["a|x", "b|x"]);
  assert.deepEqual(unsuppress(history, "a|x").suppressed, ["b|x"]);
});

test("splitSuppressed separates known noise from reported clusters", () => {
  const history = suppress(emptyHistory(), "noise|*");
  const { active, suppressed } = splitSuppressed(
    [cluster({ signature: "noise|a" }), cluster({ signature: "real|b" })],
    history,
  );
  assert.deepEqual(active.map((c) => c.signature), ["real|b"]);
  assert.deepEqual(suppressed.map((c) => c.signature), ["noise|a"]);
});

test("a legacy store without suppressions loads with an empty list", () => {
  const path = join(mkdtempSync(join(tmpdir(), "latch-legacy-")), "store.json");
  saveHistory({ version: 1, runs: [], suppressed: [] }, path);
  const raw = JSON.parse(readFileSync(path, "utf8")) as { suppressed?: string[] };
  delete raw.suppressed;
  writeFileSync(path, JSON.stringify(raw));
  assert.deepEqual(loadHistory(path).suppressed, []);
});

test("loadHistory drops unusable runs and treats corrupt JSON as no history", () => {
  const dir = mkdtempSync(join(tmpdir(), "latch-corrupt-"));
  const malformed = join(dir, "malformed.json");
  writeFileSync(
    malformed,
    JSON.stringify({ version: 1, runs: [run("at", [["a|x", 1, 0]]), { at: "x" }, null, 7] }),
  );
  assert.equal(loadHistory(malformed).runs.length, 1);

  const corrupt = join(dir, "corrupt.json");
  writeFileSync(corrupt, "{ not json");
  assert.deepEqual(loadHistory(corrupt), emptyHistory());
});

test("buildRecord captures the scored clusters and labelsFor maps signatures", () => {
  const record = buildRecord([cluster({ cause: "env_cascade" })], 4, "at", "ci-7");
  assert.equal(record.label, "ci-7");
  assert.equal(record.total_failed, 4);
  assert.equal(record.clusters[0]?.cause, "env_cascade");

  const history = appendRun(emptyHistory(), run("2026-09-01T00:00:00.000Z", [["page.goto|Error: refused", 1, 0]]));
  const labels = labelsFor([cluster()], history);
  assert.equal(labels.get("page.goto|Error: refused"), "[seen x1]");
  assert.equal(labelsFor([cluster({ signature: "other|z" })], history).get("other|z"), "[new]");
});
