import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { maybeCommentOnPullRequest, maybeWriteGitHubSummary } from "./github.ts";

function withGitHubEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = {
    token: process.env.GITHUB_TOKEN,
    repo: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF,
  };
  process.env.GITHUB_TOKEN = "token";
  process.env.GITHUB_REPOSITORY = "owner/repo";
  process.env.GITHUB_REF = "refs/pull/7/merge";
  return fn().finally(() => {
    for (const [key, value] of [
      ["GITHUB_TOKEN", saved.token],
      ["GITHUB_REPOSITORY", saved.repo],
      ["GITHUB_REF", saved.ref],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function mockFetch(comments: unknown[]): { calls: Array<{ url: string; method: string }>; restore: () => void } {
  const calls: Array<{ url: string; method: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: { method?: string }) => {
    const target = String(url);
    calls.push({ url: target, method: init?.method ?? "GET" });
    const body = target.includes("per_page=100") ? comments : {};
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("maybeCommentOnPullRequest updates an existing latch comment instead of duplicating", async () => {
  const { calls, restore } = mockFetch([{ id: 42, body: "<!-- latch-report -->\nold" }]);
  try {
    await withGitHubEnv(() => maybeCommentOnPullRequest("# Latch\n"));
  } finally {
    restore();
  }
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /issues\/7\/comments\?per_page=100/);
  assert.equal(calls[0]!.method, "GET");
  assert.equal(calls[1]!.method, "PATCH");
  assert.match(calls[1]!.url, /comments\/42$/);
});

test("maybeCommentOnPullRequest creates a comment when none exists", async () => {
  const { calls, restore } = mockFetch([{ id: 1, body: "unrelated" }]);
  try {
    await withGitHubEnv(() => maybeCommentOnPullRequest("# Latch\n"));
  } finally {
    restore();
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.method, "POST");
  assert.match(calls[1]!.url, /issues\/7\/comments$/);
});

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
