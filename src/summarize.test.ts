import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMarkdown, formatScoredTerminal } from "./summarize.ts";
import type { ScoredCluster } from "./types.ts";

const cluster: ScoredCluster = {
  signature: "expect.toHaveText|Error",
  apiName: "expect.toHaveText",
  size: 5,
  failed_count: 5,
  flaky_count: 0,
  representative_error:
    'Error: expect(locator).toHaveText() failed Expected "Invoice total $42.00"',
  sample_titles: ["checkout summary"],
  sample_locations: ["tests/invoice.spec.ts:31"],
  scored: true,
  cause: "assertion_bug",
  cause_confidence: 1,
  same_root: 0.7,
  blocks_merge: 0.57,
  jev_action: "fix_product",
  action: "fix_product",
  action_reason: "assertion_bug",
  model: "jev-latest",
  usage: { input_tokens: 1000, output_tokens: 100 },
  latency_ms: 800,
  cost_estimate_usd: 0.00055,
};

test("scored terminal shows blocks and the action reason", () => {
  const out = formatScoredTerminal([cluster], 5);
  assert.match(out, /blocks=0\.57/);
  assert.match(out, /action=fix_product \(assertion_bug\)/);
});

test("markdown reports the Jev action and an estimate-labelled footer", () => {
  const md = formatMarkdown([cluster], 5, { workers: 1, retries_config: 0 });
  assert.match(md, /Jev action: `fix_product`/);
  assert.match(md, /Jev: 1 call/);
  assert.match(md, /est\. cost: \$0\.000/);
  assert.match(md, /LATCH_INPUT_USD_PER_MTOK/);
});

test("unscored clusters render their reason so no_key is visible", () => {
  const unscored: ScoredCluster = {
    ...cluster,
    scored: false,
    cause: undefined,
    action: "needs_human",
    action_reason: "no_key",
  };
  assert.match(formatScoredTerminal([unscored], 5), /action=needs_human \(no_key\)/);
});

test("history annotations reach the terminal and the markdown", () => {
  const annotations = new Map([[cluster.signature, "[seen x3, flake 25%]"]]);
  assert.match(formatScoredTerminal([cluster], 5, annotations), /\[seen x3, flake 25%\]/);
  assert.match(
    formatMarkdown([cluster], 5, { workers: 1, retries_config: 0 }, annotations),
    /- history: \[seen x3, flake 25%\]/,
  );
});

test("suppressed clusters are counted in the header but not listed", () => {
  assert.match(formatScoredTerminal([cluster], 5, undefined, 2), /Latch: 5 failed → 1 cause \(2 suppressed\)/);
  assert.match(
    formatMarkdown([cluster], 5, { workers: 1, retries_config: 0 }, undefined, 2),
    /\(2 suppressed\)/,
  );
});

test("a reused judgment is marked cached in the terminal and the markdown", () => {
  const cached: ScoredCluster = { ...cluster, cached: true };
  assert.match(formatScoredTerminal([cached], 5), /\[cached\]/);
  assert.match(
    formatMarkdown([cached], 5, { workers: 1, retries_config: 0 }),
    /- cached: true/,
  );
});
