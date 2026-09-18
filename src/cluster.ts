import { signatureOf } from "./attempt.ts";
import { redactSecrets } from "./redact.ts";
import type { Cluster, FailedAttempt } from "./types.ts";

const SAMPLE_CAP = 5;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function clusterAttempts(attempts: FailedAttempt[]): Cluster[] {
  const buckets = new Map<string, FailedAttempt[]>();
  for (const attempt of attempts) {
    // The signature is written to traces/, the markdown and the PR comment, so
    // it is computed on the redacted message, like every other output.
    const signature = signatureOf({
      apiName: attempt.apiName,
      errorMessage: redactSecrets(attempt.errorMessage),
    });
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
      representative_error: redactSecrets((items[0]?.errorMessage ?? "").slice(0, 500)),
      sample_titles: unique(items.map((item) => redactSecrets(item.title))).slice(0, SAMPLE_CAP),
      sample_locations: unique(items.map((item) => item.location)).slice(0, SAMPLE_CAP),
    });
  }

  clusters.sort((a, b) => b.size - a.size || a.signature.localeCompare(b.signature));
  return clusters;
}
