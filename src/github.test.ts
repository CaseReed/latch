import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { maybeWriteGitHubSummary } from "./github.ts";

test("maybeWriteGitHubSummary appends when GITHUB_STEP_SUMMARY is set", () => {
  const dir = mkdtempSync(join(tmpdir(), "latch-gh-"));
  const path = join(dir, "summary.md");
  const previous = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = path;
  try {
    maybeWriteGitHubSummary("# Latch\n");
    maybeWriteGitHubSummary("second");
    const body = readFileSync(path, "utf8");
    assert.match(body, /# Latch/);
    assert.match(body, /second/);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = previous;
  }
});

test("maybeWriteGitHubSummary is a no-op without GITHUB_STEP_SUMMARY", () => {
  const previous = process.env.GITHUB_STEP_SUMMARY;
  delete process.env.GITHUB_STEP_SUMMARY;
  try {
    maybeWriteGitHubSummary("# Latch\n");
  } finally {
    if (previous !== undefined) process.env.GITHUB_STEP_SUMMARY = previous;
  }
});
