import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { clusterAttempts } from "./cluster.ts";
import { ingestJUnit } from "./ingest/junit.ts";
import {
  labelsFor,
  loadHistory,
  saveHistory,
  splitSuppressed,
  storePath,
  suppress,
  unsuppress,
  appendRun,
  buildRecord,
} from "./ledger.ts";
import "./load-env.ts";
import { scoreClusters } from "./score-run.ts";
import { formatScoredTerminal } from "./summarize.ts";
import type { FailedAttempt, RunMeta } from "./types.ts";

const USAGE = [
  "usage:",
  "  latch <junit.xml | golden.json> [--store <path>]   cluster and label a run",
  "  latch suppress <signature> [--store <path>]        mark a cluster as known noise (* wildcard)",
  "  latch unsuppress <signature> [--store <path>]      remove a suppression",
  "  latch suppressions [--store <path>]                list suppressions",
].join("\n");

type GoldenLike = { run?: RunMeta; attempts?: FailedAttempt[] };

function parseArgs(argv: string[]): { tokens: string[]; store: string } {
  const tokens: string[] = [];
  let store = storePath();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--store") {
      store = argv[i + 1] ?? store;
      i += 1;
    } else if (!arg.startsWith("--")) {
      tokens.push(arg);
    }
  }
  return { tokens, store };
}

function readInput(path: string): { run: RunMeta; attempts: FailedAttempt[] } {
  const raw = readFileSync(path, "utf8");
  if (extname(path).toLowerCase() === ".xml") {
    return ingestJUnit(raw);
  }
  const data = JSON.parse(raw) as GoldenLike;
  if (!Array.isArray(data.attempts)) {
    throw new Error(`${path}: expected a golden JSON with { run, attempts }`);
  }
  return { run: data.run ?? { workers: 1, retries_config: 0 }, attempts: data.attempts };
}

async function analyze(path: string, store: string): Promise<void> {
  const { run, attempts } = readInput(path);
  const clusters = clusterAttempts(attempts);
  const history = loadHistory(store);
  const scored = await scoreClusters(clusters, run);
  const { active, suppressed } = splitSuppressed(scored, history);
  console.log(
    formatScoredTerminal(active, attempts.length, labelsFor(scored, history), suppressed.length),
  );
  saveHistory(appendRun(history, buildRecord(scored, attempts.length)), store);
}

async function main(): Promise<void> {
  const { tokens, store } = parseArgs(process.argv.slice(2));
  const [command, argument] = tokens;

  if (!command || command === "help") {
    console.error(USAGE);
    process.exitCode = command ? 0 : 2;
    return;
  }

  if (command === "suppress" || command === "unsuppress") {
    if (!argument) throw new Error(`latch ${command}: missing <signature>`);
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

  await analyze(command, store);
}

try {
  await main();
} catch (error) {
  console.error(`latch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
