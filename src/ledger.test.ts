import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appendRun,
  buildRecord,
  DEFAULT_STORE,
  emptyHistory,
  historyLabel,
  historyStats,
  isSuppressed,
  judgmentCache,
  labelsFor,
  loadHistory,
  MAX_JUDGMENTS,
  MAX_RUNS,
  persistRun,
  presentRun,
  saveHistory,
  splitSuppressed,
  storePath,
  suppress,
  unsuppress,
  withJudgments,
  type CachedJudgment,
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

test("storePath honours LATCH_STORE, including an empty value that disables it", () => {
  const saved = process.env.LATCH_STORE;
  try {
    process.env.LATCH_STORE = "/tmp/latch-store.json";
    assert.equal(storePath(), "/tmp/latch-store.json");
    process.env.LATCH_STORE = "";
    assert.equal(storePath(), "");
    delete process.env.LATCH_STORE;
    assert.equal(storePath(), DEFAULT_STORE);
  } finally {
    if (saved === undefined) delete process.env.LATCH_STORE;
    else process.env.LATCH_STORE = saved;
  }
});

test("save then load round-trips the history", () => {
  const path = join(mkdtempSync(join(tmpdir(), "latch-store-")), "store.json");
  const history = appendRun(emptyHistory(), run("2026-09-01T00:00:00.000Z", [["a|x", 2, 0]]));
  saveHistory(history, path);
  assert.deepEqual(loadHistory(path), history);
});

test("appendRun keeps only the most recent runs", () => {
  let history = emptyHistory();
  for (let i = 0; i < MAX_RUNS + 20; i += 1) {
    history = appendRun(history, run(`run-${i}`, [["a|x", 1, 0]]));
  }
  assert.equal(history.runs.length, MAX_RUNS);
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
    judgments: {},
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
    judgments: {},
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

test("presentRun is a no-op without history and splits plus annotates with it", () => {
  const clusters = [cluster({ signature: "a|1" }), cluster({ signature: "b|2" })];
  const disabled = presentRun(clusters, undefined);
  assert.equal(disabled.annotations, undefined);
  assert.deepEqual(disabled.active, clusters);
  assert.deepEqual(disabled.suppressed, []);

  const history = suppress(appendRun(emptyHistory(), run("at", [["a|1", 1, 0]])), "b|*");
  const presented = presentRun(clusters, history);
  assert.deepEqual(presented.active.map((c) => c.signature), ["a|1"]);
  assert.deepEqual(presented.suppressed.map((c) => c.signature), ["b|2"]);
  assert.equal(presented.annotations?.get("a|1"), "[seen x1]");
  assert.equal(presented.annotations?.get("b|2"), "[new]");
});

test("persistRun writes the run, and a falsy store writes nothing", () => {
  const path = join(mkdtempSync(join(tmpdir(), "latch-persist-")), "store.json");
  persistRun(path, undefined, [cluster()], 3);
  const history = loadHistory(path);
  assert.equal(history.runs.length, 1);
  assert.equal(history.runs[0]?.total_failed, 3);
  assert.doesNotThrow(() => persistRun("", undefined, [cluster()], 1));
});

test("judgmentCache and withJudgments round-trip and cap the store", () => {
  const history = { ...emptyHistory(), judgments: { "a|1": { cause: "flake" } } };
  assert.equal(judgmentCache(history).get("a|1")?.cause, "flake");

  const big = new Map<string, CachedJudgment>();
  for (let i = 0; i < MAX_JUDGMENTS + 10; i += 1) big.set(`s|${i}`, { cause: "flake" });
  const merged = withJudgments(emptyHistory(), big);
  assert.equal(Object.keys(merged.judgments).length, MAX_JUDGMENTS);
  assert.ok(merged.judgments[`s|${MAX_JUDGMENTS + 9}`]);
});

test("saveHistory writes atomically and leaves no temp file", () => {
  const dir = mkdtempSync(join(tmpdir(), "latch-atomic-"));
  const path = join(dir, "store.json");
  saveHistory(emptyHistory(), path);
  assert.deepEqual(readdirSync(dir), ["store.json"]);
  saveHistory({ ...emptyHistory(), suppressed: ["a|*"] }, path);
  assert.equal(loadHistory(path).suppressed[0], "a|*");
});

test("persistRun stores the judgment cache next to the run", () => {
  const path = join(mkdtempSync(join(tmpdir(), "latch-pj-")), "store.json");
  const cache = new Map<string, CachedJudgment>([["a|1", { cause: "flake", model: "m" }]]);
  persistRun(path, emptyHistory(), [cluster()], 1, cache);
  const history = loadHistory(path);
  assert.equal(history.judgments["a|1"]?.cause, "flake");
  assert.equal(history.runs.length, 1);
});

test("loadHistory sanitizes judgments and defaults a missing map", () => {
  const dir = mkdtempSync(join(tmpdir(), "latch-judg-"));
  const path = join(dir, "store.json");
  writeFileSync(
    path,
    JSON.stringify({ version: 1, runs: [], judgments: { "a|1": { cause: "flake" }, bad: 3 } }),
  );
  assert.deepEqual(loadHistory(path).judgments, { "a|1": { cause: "flake" } });

  saveHistory(emptyHistory(), path);
  const raw = JSON.parse(readFileSync(path, "utf8")) as { judgments?: unknown };
  delete raw.judgments;
  writeFileSync(path, JSON.stringify(raw));
  assert.deepEqual(loadHistory(path).judgments, {});
});

test("a legacy store without suppressions loads with an empty list", () => {
  const path = join(mkdtempSync(join(tmpdir(), "latch-legacy-")), "store.json");
  saveHistory({ version: 1, runs: [], suppressed: [], judgments: {} }, path);
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

test("loadHistory drops malformed cluster entries so stats stay finite", () => {
  const path = join(mkdtempSync(join(tmpdir(), "latch-badclusters-")), "store.json");
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      runs: [
        {
          at: "2026-09-01T00:00:00.000Z",
          total_failed: 3,
          clusters: [1, null, { signature: "a|x", size: 1, failed_count: 1, flaky_count: 0, action: "needs_human" }],
        },
      ],
    }),
  );
  const history = loadHistory(path);
  assert.equal(history.runs[0]?.clusters.length, 1);
  const stats = historyStats(history);
  assert.equal(stats.get("a|x")?.failed_total, 1);
  assert.ok(Number.isFinite(stats.get("a|x")?.flaky_total));
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
