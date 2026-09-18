import { TypeSafeClient } from "@typesafe-ai/sdk";
import { askJev, parseJevAnswers } from "./jev.ts";
import type { CachedJudgment } from "./ledger.ts";
import { hasApiKey } from "./load-env.ts";
import { decideAction } from "./policy.ts";
import { redactSecrets } from "./redact.ts";
import type { Cluster, ClusterState, RunMeta, ScoredCluster } from "./types.ts";

export const MAX_JEV_CLUSTERS = 8;
const MAX_JEV_CONCURRENCY = 3;

function toState(cluster: Cluster, run: RunMeta): ClusterState {
  return {
    run: {
      workers: run.workers,
      retries_config: run.retries_config,
      duration_ms: run.duration_ms,
      test_count: run.test_count,
    },
    cluster: {
      size: cluster.size,
      failed_count: cluster.failed_count,
      flaky_count: cluster.flaky_count,
      signature: cluster.signature,
      apiName: cluster.apiName,
      representative_error: redactSecrets(cluster.representative_error.slice(0, 400)),
      sample_titles: cluster.sample_titles.slice(0, 5).map(redactSecrets),
      sample_locations: cluster.sample_locations.slice(0, 5),
    },
  };
}

function unscored(cluster: Cluster, reason: string): ScoredCluster {
  return { ...cluster, scored: false, action: "needs_human", action_reason: reason };
}

/** Apply the code policy to a Jev answer, fresh or reused. */
function scored(cluster: Cluster, answers: CachedJudgment, cached: boolean): ScoredCluster {
  const { action, reason } = decideAction({
    cause: answers.cause,
    cause_confidence: answers.cause_confidence,
    same_root: answers.same_root,
    blocks_merge: answers.blocks_merge,
    flaky_count: cluster.flaky_count,
    jev_action: answers.jev_action,
  });
  return {
    ...cluster,
    scored: true,
    cached,
    cause: answers.cause,
    cause_confidence: answers.cause_confidence,
    same_root: answers.same_root,
    blocks_merge: answers.blocks_merge,
    jev_action: answers.jev_action,
    severity: answers.severity,
    action,
    action_reason: reason,
    model: answers.model,
  };
}

export type ScorePlanItem = {
  cluster: Cluster;
  mode: "cached" | "fresh" | "skip";
  cached?: CachedJudgment;
};

/**
 * Decide, per cluster, whether it is answered from the cache, sent to Jev, or
 * left out because the fresh-call budget is spent. Cached clusters are free, so
 * they do not count against the cap.
 */
export function planScoring(
  clusters: Cluster[],
  cache: Map<string, CachedJudgment> | undefined,
  maxJev: number,
): ScorePlanItem[] {
  let fresh = 0;
  return clusters.map((cluster) => {
    const cached = cache?.get(cluster.signature);
    if (cached) return { cluster, mode: "cached", cached };
    if (fresh < maxJev) {
      fresh += 1;
      return { cluster, mode: "fresh" };
    }
    return { cluster, mode: "skip" };
  });
}

async function scoreOne(
  client: TypeSafeClient,
  cluster: Cluster,
  run: RunMeta,
  cache: Map<string, CachedJudgment> | undefined,
): Promise<ScoredCluster> {
  try {
    const jev = await askJev(toState(cluster, run), client);
    const parsed = parseJevAnswers(jev.answers);
    const judgment: CachedJudgment = {
      cause: parsed.cause,
      cause_confidence: parsed.cause_confidence,
      same_root: parsed.same_root,
      blocks_merge: parsed.blocks_merge,
      jev_action: parsed.action,
      severity: parsed.severity,
      model: jev.model,
    };
    cache?.set(cluster.signature, judgment);
    return {
      ...scored(cluster, judgment, false),
      usage: jev.usage,
      latency_ms: jev.latency_ms,
      cost_estimate_usd: jev.cost_estimate_usd,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "api_error";
    return unscored(cluster, message.slice(0, 120));
  }
}

/** Run `fn` over `items` with `limit` in flight, preserving input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function scoreClusters(
  clusters: Cluster[],
  run: RunMeta,
  maxJev = MAX_JEV_CLUSTERS,
  cache?: Map<string, CachedJudgment>,
): Promise<ScoredCluster[]> {
  if (clusters.length === 0) return [];

  const keyed = hasApiKey();
  // Without a key nothing can be called, so the fresh budget is zero; cached
  // clusters are still answered from the ledger.
  const plan = planScoring(clusters, cache, keyed ? maxJev : 0);
  const client = keyed ? new TypeSafeClient() : undefined;

  return mapLimit(plan, MAX_JEV_CONCURRENCY, async (item) => {
    if (item.mode === "cached") return scored(item.cluster, item.cached!, true);
    if (item.mode === "fresh") return scoreOne(client!, item.cluster, run, cache);
    return unscored(item.cluster, keyed ? "unscored" : "no_key");
  });
}
