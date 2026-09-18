import { askJev, parseJevAnswers } from "./jev.ts";
import { hasApiKey } from "./load-env.ts";
import { decideAction } from "./policy.ts";
import type { Cluster, ClusterState, RunMeta, ScoredCluster } from "./types.ts";

export const MAX_JEV_CLUSTERS = 8;

function toState(cluster: Cluster, run: RunMeta): ClusterState {
  return {
    run: {
      workers: run.workers,
      retries_config: run.retries_config,
      duration_ms: run.duration_ms,
    },
    cluster: {
      size: cluster.size,
      failed_count: cluster.failed_count,
      flaky_count: cluster.flaky_count,
      signature: cluster.signature,
      apiName: cluster.apiName,
      representative_error: cluster.representative_error.slice(0, 400),
      sample_titles: cluster.sample_titles.slice(0, 5),
      sample_locations: cluster.sample_locations.slice(0, 5),
    },
  };
}

function unscored(cluster: Cluster, reason: string): ScoredCluster {
  return { ...cluster, scored: false, action: "needs_human", action_reason: reason };
}

export async function scoreClusters(
  clusters: Cluster[],
  run: RunMeta,
  maxJev = MAX_JEV_CLUSTERS,
): Promise<ScoredCluster[]> {
  if (clusters.length === 0) return [];
  if (!hasApiKey()) {
    return clusters.map((cluster) => unscored(cluster, "no_key"));
  }

  const out: ScoredCluster[] = [];
  for (const [index, cluster] of clusters.entries()) {
    if (index >= maxJev) {
      out.push(unscored(cluster, "unscored"));
      continue;
    }
    try {
      const jev = await askJev(toState(cluster, run));
      const parsed = parseJevAnswers(jev.answers);
      const { action, reason } = decideAction({
        cause: parsed.cause,
        cause_confidence: parsed.cause_confidence,
        same_root: parsed.same_root,
        blocks_merge: parsed.blocks_merge,
        flaky_count: cluster.flaky_count,
      });
      out.push({
        ...cluster,
        scored: true,
        cause: parsed.cause,
        cause_confidence: parsed.cause_confidence,
        same_root: parsed.same_root,
        blocks_merge: parsed.blocks_merge,
        severity: parsed.severity,
        action,
        action_reason: reason,
        model: jev.model,
        usage: jev.usage,
        latency_ms: jev.latency_ms,
        cost_estimate_usd: jev.cost_estimate_usd,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "api_error";
      out.push(unscored(cluster, message.slice(0, 120)));
    }
  }
  return out;
}
