import { readFileSync } from "node:fs";
import { clusterAttempts } from "./cluster.ts";
import { formatTerminal } from "./summarize.ts";
import type { FailedAttempt } from "./types.ts";

const path = process.argv[2] ?? "testdata/runs/env-cascade.json";
const data = JSON.parse(readFileSync(path, "utf8")) as { attempts: FailedAttempt[] };
const clusters = clusterAttempts(data.attempts);
console.log(formatTerminal(clusters, data.attempts.length));
