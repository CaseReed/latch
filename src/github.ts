import { appendFileSync, readFileSync } from "node:fs";

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function maybeWriteGitHubSummary(markdown: string): void {
  try {
    const path = process.env.GITHUB_STEP_SUMMARY;
    if (!path) return;
    appendFileSync(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  } catch (error) {
    console.error(`[latch] GitHub step summary failed: ${errMsg(error)}`);
  }
}

function pullRequestNumber(): string | undefined {
  const fromRef = process.env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//)?.[1];
  if (fromRef) return fromRef;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
      pull_request?: { number?: number };
      number?: number;
    };
    const n = event.pull_request?.number ?? event.number;
    return n !== undefined ? String(n) : undefined;
  } catch {
    return undefined;
  }
}

const COMMENT_MARKER = "<!-- latch-report -->";

export async function maybeCommentOnPullRequest(markdown: string): Promise<void> {
  try {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    const pr = pullRequestNumber();
    if (!token || !repo || !pr) return;

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };
    const base = `https://api.github.com/repos/${repo}/issues/${pr}/comments`;
    const body = `${COMMENT_MARKER}\n${markdown}`.slice(0, 60_000);

    const listRes = await fetch(`${base}?per_page=100`, { headers });
    if (!listRes.ok) {
      console.error(`[latch] GitHub comment list failed: ${listRes.status}`);
      return;
    }
    const comments = (await listRes.json()) as Array<{ id: number; body?: string }>;
    const existing = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));

    const writeRes = existing
      ? await fetch(`${base}/${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ body }) })
      : await fetch(base, { method: "POST", headers, body: JSON.stringify({ body }) });
    if (!writeRes.ok) {
      console.error(`[latch] GitHub comment failed: ${writeRes.status}`);
    }
  } catch (error) {
    console.error(`[latch] GitHub comment failed: ${errMsg(error)}`);
  }
}
