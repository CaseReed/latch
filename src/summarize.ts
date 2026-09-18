import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isBlocking } from "./policy.ts";
import type { Cluster, RunMeta, ScoredCluster } from "./types.ts";

export function formatClusterLine(cluster: Cluster, index: number): string {
  return `  ${index} n=${cluster.size} ${cluster.signature}\n     ${errorHead(cluster)}`;
}

function errorHead(cluster: Cluster): string {
  return cluster.representative_error.replace(/\s+/g, " ").slice(0, 72);
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
    lines.push(`     ${errorHead(cluster)}`);
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A self-contained HTML report (inline CSS, no external asset) of one run. */
export function renderHtml(
  scored: ScoredCluster[],
  failed: number,
  meta: RunMeta,
  annotations?: Map<string, string>,
  suppressed = 0,
): string {
  const blocking = scored.filter((cluster) => isBlocking(cluster.action)).length;
  const pass = blocking === 0 && failed > 0;
  const verdict = pass
    ? `<span class="pill pass">Gate: PASS</span>`
    : failed === 0
      ? `<span class="pill pass">No failures</span>`
      : `<span class="pill block">Gate: BLOCK</span>`;
  const hidden = suppressed > 0 ? ` · ${suppressed} suppressed` : "";

  const cards = scored
    .map((cluster, index) => {
      const history = annotations?.get(cluster.signature);
      const details = [
        cluster.cause_confidence !== undefined
          ? `confidence ${cluster.cause_confidence.toFixed(2)}`
          : "",
        cluster.same_root !== undefined ? `same_root ${cluster.same_root.toFixed(2)}` : "",
        cluster.blocks_merge !== undefined ? `blocks ${cluster.blocks_merge.toFixed(2)}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<section class="card">
  <div class="row">
    <span class="p">P${index}</span>
    <span class="cause">${escapeHtml(cluster.cause ?? "unscored")}</span>
    <span class="n">n=${cluster.size}</span>
    <span class="action ${escapeHtml(cluster.action)}">${escapeHtml(cluster.action)}</span>
    ${cluster.cached ? `<span class="tag">cached</span>` : ""}
    ${history ? `<span class="tag">${escapeHtml(history)}</span>` : ""}
  </div>
  <pre>${escapeHtml(cluster.representative_error.slice(0, 400))}</pre>
  <div class="meta">${escapeHtml(details)}${details ? " · " : ""}${escapeHtml(cluster.signature)}</div>
</section>`;
    })
    .join("\n");

  const answered = scored.filter((cluster) => cluster.scored);
  const fresh = answered.filter((cluster) => !cluster.cached);
  const cost = fresh.reduce((total, cluster) => total + (cluster.cost_estimate_usd ?? 0), 0);
  const footer =
    answered.length > 0
      ? `<footer>Jev: ${fresh.length} call${fresh.length === 1 ? "" : "s"}, ${answered.length - fresh.length} cached · est. cost $${cost.toFixed(4)}</footer>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Latch — ${failed} failed</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 40px; background: #0d1117; color: #e6edf3;
         font: 15px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8b949e; margin: 0 0 24px; }
  .pill { display: inline-block; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 15px; }
  .pill.pass { background: rgba(63,185,80,.15); color: #3fb950; border: 1px solid rgba(63,185,80,.4); }
  .pill.block { background: rgba(248,81,73,.15); color: #f85149; border: 1px solid rgba(248,81,73,.4); }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 16px 18px; margin: 14px 0; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .p { color: #8b949e; font-weight: 700; }
  .cause { font-weight: 700; }
  .n { color: #8b949e; }
  .action { padding: 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 700;
            background: rgba(88,166,255,.12); color: #58a6ff; }
  .action.ignore_as_infra { background: rgba(63,185,80,.12); color: #3fb950; }
  .action.fix_product { background: rgba(248,81,73,.12); color: #f85149; }
  .tag { color: #8b949e; font-size: 13px; }
  pre { background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 12px;
        overflow-x: auto; white-space: pre-wrap; word-break: break-word; margin: 12px 0; }
  .meta { color: #8b949e; font-size: 12px; word-break: break-word; }
  footer { color: #8b949e; font-size: 13px; margin-top: 24px; }
</style>
</head>
<body>
<main>
  <h1>Latch ${verdict}</h1>
  <p class="sub">${failed} failed → ${scored.length} cause${scored.length === 1 ? "" : "s"}${escapeHtml(hidden)} · workers=${meta.workers} retries=${meta.retries_config}</p>
  ${cards || `<p class="sub">No failure clusters.</p>`}
  ${footer}
</main>
</body>
</html>
`;
}

export function writeReports(
  tracesDir: string,
  payload: unknown,
  markdown: string,
  html: string,
): { jsonPath: string; mdPath: string; htmlPath: string } {
  mkdirSync(tracesDir, { recursive: true });
  const jsonPath = join(tracesDir, "latch-report.json");
  const mdPath = join(tracesDir, "latch.md");
  const htmlPath = join(tracesDir, "latch-report.html");
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(mdPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
  writeFileSync(htmlPath, html.endsWith("\n") ? html : `${html}\n`);
  return { jsonPath, mdPath, htmlPath };
}

