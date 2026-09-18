import { signatureOf } from "./attempt.ts";
import type { Cluster, FailedAttempt } from "./types.ts";

const SAMPLE_CAP = 5;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function clusterAttempts(attempts: FailedAttempt[]): Cluster[] {
  const buckets = new Map<string, FailedAttempt[]>();
  for (const attempt of attempts) {
    const signature = signatureOf(attempt);
    const list = buckets.get(signature);
    if (list) list.push(attempt);
    else buckets.set(signature, [attempt]);
  }

  const clusters: Cluster[] = [];
  for (const [signature, items] of buckets) {
    const flaky_count = items.filter((item) => item.status === "flaky").length;
    clusters.push({
      signature,
      apiName: items[0]?.apiName ?? "unknown",
      size: items.length,
      failed_count: items.length - flaky_count,
      flaky_count,
      representative_error: (items[0]?.errorMessage ?? "").slice(0, 500),
      sample_titles: unique(items.map((item) => item.title)).slice(0, SAMPLE_CAP),
      sample_locations: unique(items.map((item) => item.location)).slice(0, SAMPLE_CAP),
    });
  }

  clusters.sort((a, b) => b.size - a.size || a.signature.localeCompare(b.signature));
  return clusters;
}
