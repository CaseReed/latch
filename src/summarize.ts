import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cluster, RunMeta, ScoredCluster } from "./types.ts";

export function formatClusterLine(cluster: Cluster, index: number): string {
  const head = cluster.representative_error.replace(/\s+/g, " ").slice(0, 72);
  return `  ${index} n=${cluster.size} ${cluster.signature}\n     ${head}`;
}

export function formatTerminal(clusters: Cluster[], failed: number): string {
  if (failed === 0 && clusters.length === 0) return "Latch: 0 failures";
  const lines = [
    `Latch: ${failed} failed → ${clusters.length} cause${clusters.length === 1 ? "" : "s"}`,
    ...clusters.map((cluster, i) => formatClusterLine(cluster, i)),
  ];
  return lines.join("\n");
}

export function formatScoredTerminal(scored: ScoredCluster[], failed: number): string {
  if (failed === 0 && scored.length === 0) return "Latch: 0 failures";
  const lines = [
    `Latch: ${failed} failed → ${scored.length} cause${scored.length === 1 ? "" : "s"}`,
  ];
  for (const [i, cluster] of scored.entries()) {
    const cause = cluster.cause ?? "unscored";
    const noul =
      cluster.same_root !== undefined ? ` same_root=${cluster.same_root.toFixed(2)}` : "";
    const conf =
      cluster.cause_confidence !== undefined
        ? ` conf=${cluster.cause_confidence.toFixed(2)}`
        : "";
    lines.push(
      `P${i} ${cause} n=${cluster.size}${conf}${noul}  action=${cluster.action}`,
    );
    const head = cluster.representative_error.replace(/\s+/g, " ").slice(0, 72);
    lines.push(`     ${head}`);
  }
  return lines.join("\n");
}

export function formatMarkdown(
  scored: ScoredCluster[],
  failed: number,
  meta: RunMeta,
): string {
  const lines = [
    `# Latch`,
    ``,
    `${failed} failed → ${scored.length} causes · workers=${meta.workers} retries=${meta.retries_config}`,
    ``,
  ];
  if (scored.length === 0) {
    lines.push("No failure clusters.");
    return lines.join("\n");
  }
  for (const [i, cluster] of scored.entries()) {
    lines.push(`## P${i} ${cluster.cause ?? "unscored"} (n=${cluster.size})`);
    lines.push("");
    lines.push(`- action: \`${cluster.action}\`${cluster.action_reason ? ` (${cluster.action_reason})` : ""}`);
    if (cluster.cause_confidence !== undefined) {
      lines.push(`- cause confidence: ${cluster.cause_confidence.toFixed(2)}`);
    }
    if (cluster.same_root !== undefined) {
      lines.push(`- same_root: ${cluster.same_root.toFixed(2)}`);
    }
    if (cluster.blocks_merge !== undefined) {
      lines.push(`- blocks_merge: ${cluster.blocks_merge.toFixed(2)}`);
    }
    lines.push(`- signature: \`${cluster.signature}\``);
    lines.push(`- sample: ${cluster.sample_titles.slice(0, 3).join("; ") || "—"}`);
    lines.push("");
    lines.push("```");
    lines.push(cluster.representative_error.slice(0, 400));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

export function writeReports(
  tracesDir: string,
  payload: unknown,
  markdown: string,
): { jsonPath: string; mdPath: string } {
  mkdirSync(tracesDir, { recursive: true });
  const jsonPath = join(tracesDir, "latch-report.json");
  const mdPath = join(tracesDir, "latch.md");
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(mdPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  return { jsonPath, mdPath };
}

