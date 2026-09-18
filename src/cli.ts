import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { clusterAttempts } from "./cluster.ts";
import { loadRunFile } from "./golden.ts";
import {
  judgmentCache,
  loadHistory,
  persistRun,
  presentRun,
  saveHistory,
  storePath,
  suppress,
  unsuppress,
} from "./ledger.ts";
import "./load-env.ts";
import { isBlocking } from "./policy.ts";
import { MAX_JEV_CLUSTERS, scoreClusters } from "./score-run.ts";
import { formatScoredTerminal, renderHtml } from "./summarize.ts";

const USAGE = [
  "usage:",
  "  latch <junit.xml | golden.json> [--store <path>] [--gate] [--html <path>]",
  "  latch suppress <signature> [--store <path>]        mark a cluster as known noise (* wildcard)",
  "  latch unsuppress <signature> [--store <path>]      remove a suppression",
  "  latch suppressions [--store <path>]                list suppressions",
  "",
  "  --gate  exits non-zero when a non-infra cluster would block a merge.",
  "  --html  writes a self-contained HTML report to <path>.",
].join("\n");

function parseArgs(argv: string[]): { tokens: string[]; store: string; gate: boolean; html?: string } {
  const tokens: string[] = [];
  let store = storePath();
  let gate = false;
  let html: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--store") {
      store = argv[i + 1] ?? store;
      i += 1;
    } else if (arg === "--html") {
      html = argv[i + 1] ?? html;
      i += 1;
    } else if (arg === "--gate") {
      gate = true;
    } else if (!arg.startsWith("--")) {
      tokens.push(arg);
    }
  }
  return { tokens, store, gate, html };
}

async function analyze(path: string, store: string, gate: boolean, html?: string): Promise<void> {
  const { run, attempts } = loadRunFile(path);
  const clusters = clusterAttempts(attempts);
  const history = store ? loadHistory(store) : undefined;
  const cache = history ? judgmentCache(history) : undefined;
  const scored = await scoreClusters(clusters, run, MAX_JEV_CLUSTERS, cache);
  const { annotations, active, suppressed } = presentRun(scored, history);
  console.log(formatScoredTerminal(active, attempts.length, annotations, suppressed.length));
  if (html) {
    mkdirSync(dirname(html), { recursive: true });
    writeFileSync(html, renderHtml(active, attempts.length, run, annotations, suppressed.length));
  }
  persistRun(store, history, scored, attempts.length, cache);

  const blocking = active.filter((cluster) => isBlocking(cluster.action)).length;
  if (gate && blocking > 0) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const { tokens, store, gate, html } = parseArgs(process.argv.slice(2));
  const [command, argument] = tokens;

  if (!command || command === "help") {
    console.error(USAGE);
    process.exitCode = command ? 0 : 2;
    return;
  }

  if (command === "suppress" || command === "unsuppress") {
    if (!argument) throw new Error(`latch ${command}: missing <signature>`);
    if (!store) throw new Error(`latch ${command}: no store configured (LATCH_STORE is empty)`);
    const history = loadHistory(store);
    saveHistory(command === "suppress" ? suppress(history, argument) : unsuppress(history, argument), store);
    console.log(`${command === "suppress" ? "suppressed" : "unsuppressed"}: ${argument}`);
    return;
  }

  if (command === "suppressions") {
    const { suppressed } = loadHistory(store);
    console.log(suppressed.length ? suppressed.join("\n") : "no suppressions");
    return;
  }

  await analyze(command, store, gate, html);
}

try {
  await main();
} catch (error) {
  console.error(`latch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
