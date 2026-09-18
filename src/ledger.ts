import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export type History = {
  version: 1;
  runs: RunRecord[];
  /** Signature patterns marked as known noise; `*` is a wildcard. */
  suppressed: string[];
};

export const DEFAULT_STORE = ".latch/store.json";
export const MAX_RUNS = 100;

export function storePath(): string {
  return process.env.LATCH_STORE ?? DEFAULT_STORE;
}

export function emptyHistory(): History {
  return { version: 1, runs: [], suppressed: [] };
}

function usableRun(run: unknown): run is RunRecord {
  return Boolean(run) && typeof run === "object" && Array.isArray((run as RunRecord).clusters);
}

/** Read the store; a missing or unreadable file is treated as no history. */
export function loadHistory(path: string): History {
  if (!path || !existsSync(path)) return emptyHistory();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<History>;
    return {
      version: 1,
      runs: Array.isArray(parsed.runs) ? parsed.runs.filter(usableRun) : [],
      suppressed: Array.isArray(parsed.suppressed)
        ? parsed.suppressed.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  } catch {
    return emptyHistory();
  }
}

export function saveHistory(history: History, path: string): void {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(history, null, 2)}\n`);
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
