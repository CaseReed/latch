import { TypeSafeClient } from "@typesafe-ai/sdk";
import { askJev, parseJevAnswers } from "./jev.ts";
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

async function scoreOne(
  client: TypeSafeClient,
  cluster: Cluster,
  run: RunMeta,
): Promise<ScoredCluster> {
  try {
    const jev = await askJev(toState(cluster, run), client);
    const parsed = parseJevAnswers(jev.answers);
    const { action, reason } = decideAction({
      cause: parsed.cause,
      cause_confidence: parsed.cause_confidence,
      same_root: parsed.same_root,
      blocks_merge: parsed.blocks_merge,
      flaky_count: cluster.flaky_count,
      jev_action: parsed.action,
    });
    return {
      ...cluster,
      scored: true,
      cause: parsed.cause,
      cause_confidence: parsed.cause_confidence,
      same_root: parsed.same_root,
      blocks_merge: parsed.blocks_merge,
      jev_action: parsed.action,
      severity: parsed.severity,
      action,
      action_reason: reason,
      model: jev.model,
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
): Promise<ScoredCluster[]> {
  if (clusters.length === 0) return [];
  if (!hasApiKey()) {
    return clusters.map((cluster) => unscored(cluster, "no_key"));
  }

  const client = new TypeSafeClient();
  const head = clusters.slice(0, maxJev);
  const scored = await mapLimit(head, MAX_JEV_CONCURRENCY, (cluster) =>
    scoreOne(client, cluster, run),
  );
  const tail = clusters.slice(maxJev).map((cluster) => unscored(cluster, "unscored"));
  return [...scored, ...tail];
}
