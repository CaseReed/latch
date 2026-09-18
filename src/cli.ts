import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { clusterAttempts } from "./cluster.ts";
import { ingestJUnit } from "./ingest/junit.ts";
import {
  appendRun,
  buildRecord,
  labelsFor,
  loadHistory,
  saveHistory,
  storePath,
} from "./ledger.ts";
import "./load-env.ts";
import { scoreClusters } from "./score-run.ts";
import { formatScoredTerminal } from "./summarize.ts";
import type { FailedAttempt, RunMeta } from "./types.ts";

const USAGE = "usage: latch <junit.xml | golden.json> [--store <path>]";

type GoldenLike = { run?: RunMeta; attempts?: FailedAttempt[] };

function parseArgs(argv: string[]): { path?: string; store: string } {
  let path: string | undefined;
  let store = storePath();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--store") {
      store = argv[i + 1] ?? store;
      i += 1;
    } else if (!arg.startsWith("--")) {
      path = arg;
    }
  }
  return { path, store };
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

async function main(): Promise<void> {
  const { path, store } = parseArgs(process.argv.slice(2));
  if (!path) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const { run, attempts } = readInput(path);
  const clusters = clusterAttempts(attempts);
  const history = loadHistory(store);
  const scored = await scoreClusters(clusters, run);

  console.log(formatScoredTerminal(scored, attempts.length, labelsFor(scored, history)));

  saveHistory(appendRun(history, buildRecord(scored, attempts.length)), store);
}

try {
  await main();
} catch (error) {
  console.error(`latch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
