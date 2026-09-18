import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isBlocking } from "./policy.ts";
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

export function formatScoredTerminal(
  scored: ScoredCluster[],
  failed: number,
  annotations?: Map<string, string>,
  suppressed = 0,
): string {
  if (failed === 0 && scored.length === 0 && suppressed === 0) return "Latch: 0 failures";
  const causes = `${scored.length} cause${scored.length === 1 ? "" : "s"}`;
  const hidden = suppressed > 0 ? ` (${suppressed} suppressed)` : "";
  const lines = [`Latch: ${failed} failed → ${causes}${hidden}`];
  for (const [i, cluster] of scored.entries()) {
    const cause = cluster.cause ?? "unscored";
    const conf =
      cluster.cause_confidence !== undefined
        ? ` conf=${cluster.cause_confidence.toFixed(2)}`
        : "";
    const noul =
      cluster.same_root !== undefined ? ` same_root=${cluster.same_root.toFixed(2)}` : "";
    const blocks =
      cluster.blocks_merge !== undefined ? ` blocks=${cluster.blocks_merge.toFixed(2)}` : "";
    const reason = cluster.action_reason ? ` (${cluster.action_reason})` : "";
    const cached = cluster.cached ? " [cached]" : "";
    const history = annotations?.get(cluster.signature);
    lines.push(
      `P${i} ${cause} n=${cluster.size}${conf}${noul}${blocks}  action=${cluster.action}${reason}${cached}${history ? `  ${history}` : ""}`,
    );
    const head = cluster.representative_error.replace(/\s+/g, " ").slice(0, 72);
    lines.push(`     ${head}`);
  }
  const blocking = scored.filter((cluster) => isBlocking(cluster.action)).length;
  lines.push(
    blocking === 0
      ? "Gate: PASS (no blocking cluster)"
      : `Gate: BLOCK — ${blocking} cluster${blocking === 1 ? "" : "s"} to look at`,
  );
  return lines.join("\n");
}

export function formatMarkdown(
  scored: ScoredCluster[],
  failed: number,
  meta: RunMeta,
  annotations?: Map<string, string>,
  suppressed = 0,
): string {
  const causes = `${scored.length} cause${scored.length === 1 ? "" : "s"}`;
  const hidden = suppressed > 0 ? ` (${suppressed} suppressed)` : "";
  const lines = [
    `# Latch`,
    ``,
    `${failed} failed → ${causes}${hidden} · workers=${meta.workers} retries=${meta.retries_config}`,
    ``,
  ];
  const blocking = scored.filter((cluster) => isBlocking(cluster.action)).length;
  if (scored.length > 0) {
    lines.push(
      blocking === 0
        ? `**Gate: PASS** — nothing blocking.`
        : `**Gate: BLOCK** — ${blocking} cluster${blocking === 1 ? "" : "s"} to look at.`,
    );
    lines.push("");
  }
  if (scored.length === 0) {
    lines.push("No failure clusters.");
    return lines.join("\n");
  }
  for (const [i, cluster] of scored.entries()) {
    lines.push(`## P${i} ${cluster.cause ?? "unscored"} (n=${cluster.size})`);
    lines.push("");
    lines.push(`- action: \`${cluster.action}\`${cluster.action_reason ? ` (${cluster.action_reason})` : ""}`);
    if (cluster.cached) {
      lines.push(`- cached: true`);
    }
    const history = annotations?.get(cluster.signature);
    if (history) {
      lines.push(`- history: ${history}`);
    }
    if (cluster.cause_confidence !== undefined) {
      lines.push(`- cause confidence: ${cluster.cause_confidence.toFixed(2)}`);
    }
    if (cluster.same_root !== undefined) {
      lines.push(`- same_root: ${cluster.same_root.toFixed(2)}`);
    }
    if (cluster.blocks_merge !== undefined) {
      lines.push(`- blocks_merge: ${cluster.blocks_merge.toFixed(2)}`);
    }
    if (cluster.jev_action !== undefined) {
      lines.push(`- Jev action: \`${cluster.jev_action}\``);
    }
    lines.push(`- signature: \`${cluster.signature}\``);
    lines.push(`- sample: ${cluster.sample_titles.slice(0, 3).join("; ") || "—"}`);
    lines.push("");
    lines.push("```");
    lines.push(cluster.representative_error.slice(0, 400));
    lines.push("```");
    lines.push("");
  }

  const answered = scored.filter((cluster) => cluster.scored);
  const fresh = answered.filter((cluster) => !cluster.cached);
  if (answered.length > 0) {
    const usage = fresh.reduce(
      (total, cluster) => ({
        input: total.input + (cluster.usage?.input_tokens ?? 0),
        output: total.output + (cluster.usage?.output_tokens ?? 0),
      }),
      { input: 0, output: 0 },
    );
    const latency = fresh.reduce((total, cluster) => total + (cluster.latency_ms ?? 0), 0);
    const cost = fresh.reduce((total, cluster) => total + (cluster.cost_estimate_usd ?? 0), 0);
    const models = [...new Set(answered.map((cluster) => cluster.model).filter(Boolean))];
    const cached = answered.length - fresh.length;
    lines.push(
      `Jev: ${fresh.length} call${fresh.length === 1 ? "" : "s"}${cached > 0 ? ` · ${cached} cached` : ""}${models.length > 0 ? ` · ${models.join(", ")}` : ""}`,
    );
    lines.push(
      `tokens in/out: ${usage.input}/${usage.output} · latency: ${latency}ms · est. cost: $${cost.toFixed(4)}`,
    );
    lines.push("Estimate only; override with `LATCH_INPUT_USD_PER_MTOK` / `LATCH_OUTPUT_USD_PER_MTOK`.");
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

