import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ScoredCluster } from "./types.ts";

export type RunClusterRecord = {
  signature: string;
  size: number;
  failed_count: number;
  flaky_count: number;
  action: string;
  cause?: string;
};

export type RunRecord = {
  at: string;
  label?: string;
  total_failed: number;
  clusters: RunClusterRecord[];
};

export type ClusterStats = {
  /** Number of stored runs in which this signature appeared. */
  seen: number;
  /** Number of those runs where at least one attempt was flaky. */
  flaky_runs: number;
  first_seen: string;
  last_seen: string;
  flaky_total: number;
  failed_total: number;
};

/** A Jev judgment keyed by signature, reused across runs to avoid re-paying. */
export type CachedJudgment = {
  cause?: string;
  cause_confidence?: number;
  same_root?: number;
  blocks_merge?: number;
  jev_action?: string;
  severity?: number;
  model?: string;
};

export type History = {
  version: 1;
  runs: RunRecord[];
  /** Signature patterns marked as known noise; `*` is a wildcard. */
  suppressed: string[];
  /** Last Jev answer per signature. */
  judgments: Record<string, CachedJudgment>;
};

export const DEFAULT_STORE = ".latch/store.json";
export const MAX_RUNS = 100;
export const MAX_JUDGMENTS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function storePath(): string {
  return process.env.LATCH_STORE ?? DEFAULT_STORE;
}

export function emptyHistory(): History {
  return { version: 1, runs: [], suppressed: [], judgments: {} };
}

function usableRun(run: unknown): run is RunRecord {
  return isRecord(run) && Array.isArray((run as { clusters?: unknown }).clusters);
}

function usableCluster(cluster: unknown): cluster is RunClusterRecord {
  return isRecord(cluster) && typeof cluster.signature === "string";
}

/** Read the store; a missing or unreadable file is treated as no history. */
export function loadHistory(path: string): History {
  if (!path || !existsSync(path)) return emptyHistory();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<History>;
    const judgments: Record<string, CachedJudgment> = {};
    if (isRecord(parsed.judgments)) {
      for (const [signature, value] of Object.entries(parsed.judgments)) {
        if (isRecord(value)) judgments[signature] = value as CachedJudgment;
      }
    }
    return {
      version: 1,
      runs: Array.isArray(parsed.runs)
        ? parsed.runs
            .filter(usableRun)
            .map((run) => ({ ...run, clusters: run.clusters.filter(usableCluster) }))
        : [],
      suppressed: Array.isArray(parsed.suppressed)
        ? parsed.suppressed.filter((entry): entry is string => typeof entry === "string")
        : [],
      judgments,
    };
  } catch {
    return emptyHistory();
  }
}

/** Write the store atomically so a concurrent or interrupted save cannot corrupt it. */
export function saveHistory(history: History, path: string): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const body = `${JSON.stringify(history, null, 2)}\n`;
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, body);
  renameSync(temp, path);
}

/** Per-signature aggregates across the runs kept in the store. */
export function historyStats(history: History): Map<string, ClusterStats> {
  const stats = new Map<string, ClusterStats>();
  for (const run of history.runs) {
    for (const cluster of run.clusters) {
      const current = stats.get(cluster.signature);
      if (current) {
        current.seen += 1;
        current.last_seen = run.at;
        if (cluster.flaky_count > 0) current.flaky_runs += 1;
        current.flaky_total += cluster.flaky_count;
        current.failed_total += cluster.failed_count;
      } else {
        stats.set(cluster.signature, {
          seen: 1,
          flaky_runs: cluster.flaky_count > 0 ? 1 : 0,
          first_seen: run.at,
          last_seen: run.at,
          flaky_total: cluster.flaky_count,
          failed_total: cluster.failed_count,
        });
      }
    }
  }
  return stats;
}

export function buildRecord(
  clusters: ScoredCluster[],
  totalFailed: number,
  at: string = new Date().toISOString(),
  label?: string,
): RunRecord {
  return {
    at,
    ...(label ? { label } : {}),
    total_failed: totalFailed,
    clusters: clusters.map((cluster) => ({
      signature: cluster.signature,
      size: cluster.size,
      failed_count: cluster.failed_count,
      flaky_count: cluster.flaky_count,
      action: cluster.action,
      cause: cluster.cause,
    })),
  };
}

/** Append a run, keeping the store bounded to the most recent runs. */
export function appendRun(history: History, record: RunRecord): History {
  return { ...history, runs: [...history.runs, record].slice(-MAX_RUNS) };
}

/** A short label for a cluster: `[new]` or `[seen xN, flake P%]`. */
export function historyLabel(stats?: ClusterStats): string {
  if (!stats) return "[new]";
  const parts = [`seen x${stats.seen}`];
  if (stats.flaky_runs > 0) {
    parts.push(`flake ${Math.round((stats.flaky_runs / stats.seen) * 100)}%`);
  }
  return `[${parts.join(", ")}]`;
}

/** Build one label per current cluster from prior history. */
export function labelsFor(clusters: ScoredCluster[], history: History): Map<string, string> {
  const stats = historyStats(history);
  return new Map(
    clusters.map((cluster) => [cluster.signature, historyLabel(stats.get(cluster.signature))]),
  );
}

function matchPattern(signature: string, pattern: string): boolean {
  if (!pattern.includes("*")) return signature === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(signature);
}

export function isSuppressed(history: History, signature: string): boolean {
  return history.suppressed.some((pattern) => matchPattern(signature, pattern));
}

export function suppress(history: History, pattern: string): History {
  if (history.suppressed.includes(pattern)) return history;
  return { ...history, suppressed: [...history.suppressed, pattern].sort() };
}

export function unsuppress(history: History, pattern: string): History {
  return { ...history, suppressed: history.suppressed.filter((entry) => entry !== pattern) };
}

/** Split current clusters into the ones to report and the ones suppressed as known noise. */
export function splitSuppressed<T extends { signature: string }>(
  clusters: T[],
  history: History,
): { active: T[]; suppressed: T[] } {
  const active: T[] = [];
  const suppressed: T[] = [];
  for (const cluster of clusters) {
    (isSuppressed(history, cluster.signature) ? suppressed : active).push(cluster);
  }
  return { active, suppressed };
}

/**
 * Everything a report needs from the ledger: history labels and the
 * suppression split. `history` is undefined when the ledger is disabled.
 */
export function presentRun(
  clusters: ScoredCluster[],
  history: History | undefined,
): {
  annotations?: Map<string, string>;
  active: ScoredCluster[];
  suppressed: ScoredCluster[];
} {
  if (!history) return { active: clusters, suppressed: [] };
  return { annotations: labelsFor(clusters, history), ...splitSuppressed(clusters, history) };
}

/** Append this run to the store; a falsy store path disables persistence. */
export function persistRun(
  store: string,
  history: History | undefined,
  clusters: ScoredCluster[],
  totalFailed: number,
  cache?: Map<string, CachedJudgment>,
): void {
  if (!store) return;
  const base = history ?? emptyHistory();
  const merged = cache ? withJudgments(base, cache) : base;
  saveHistory(appendRun(merged, buildRecord(clusters, totalFailed)), store);
}

export function judgmentCache(history: History): Map<string, CachedJudgment> {
  return new Map(Object.entries(history.judgments));
}

/** Merge a cache back into history, keeping the most recent MAX_JUDGMENTS entries. */
export function withJudgments(history: History, cache: Map<string, CachedJudgment>): History {
  return {
    ...history,
    judgments: Object.fromEntries([...cache.entries()].slice(-MAX_JUDGMENTS)),
  };
}
