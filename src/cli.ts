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
import { formatScoredTerminal } from "./summarize.ts";

const USAGE = [
  "usage:",
  "  latch <junit.xml | golden.json> [--store <path>] [--gate]   cluster and label a run",
  "  latch suppress <signature> [--store <path>]        mark a cluster as known noise (* wildcard)",
  "  latch unsuppress <signature> [--store <path>]      remove a suppression",
  "  latch suppressions [--store <path>]                list suppressions",
  "",
  "  --gate exits non-zero when a non-infra cluster would block a merge.",
].join("\n");

function parseArgs(argv: string[]): { tokens: string[]; store: string; gate: boolean } {
  const tokens: string[] = [];
  let store = storePath();
  let gate = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--store") {
      store = argv[i + 1] ?? store;
      i += 1;
    } else if (arg === "--gate") {
      gate = true;
    } else if (!arg.startsWith("--")) {
      tokens.push(arg);
    }
  }
  return { tokens, store, gate };
}

async function analyze(path: string, store: string, gate: boolean): Promise<void> {
  const { run, attempts } = loadRunFile(path);
  const clusters = clusterAttempts(attempts);
  const history = store ? loadHistory(store) : undefined;
  const cache = history ? judgmentCache(history) : undefined;
  const scored = await scoreClusters(clusters, run, MAX_JEV_CLUSTERS, cache);
  const { annotations, active, suppressed } = presentRun(scored, history);
  console.log(formatScoredTerminal(active, attempts.length, annotations, suppressed.length));
  persistRun(store, history, scored, attempts.length, cache);

  const blocking = active.filter((cluster) => isBlocking(cluster.action)).length;
  if (gate && blocking > 0) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const { tokens, store, gate } = parseArgs(process.argv.slice(2));
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

  await analyze(command, store, gate);
}

try {
  await main();
} catch (error) {
  console.error(`latch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
