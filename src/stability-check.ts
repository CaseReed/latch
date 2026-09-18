import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RUNS = Number(process.env.LATCH_STABILITY_RUNS ?? 5);

// Ports are part of a service's identity (5432 is not 6379), so a failure that
// embeds an ephemeral port is expected to drift. It is the documented boundary
// of the signature heuristic, not a bug to silence.
const KNOWN_DRIFT = new Set(["volatile: connection refused on a random port"]);

const signatures = new Map<string, Set<string>>();

for (let run = 0; run < RUNS; run += 1) {
  const result = spawnSync("npx", ["playwright", "test", "tests/stability.spec.ts"], {
    stdio: "ignore",
    env: { ...process.env, LATCH_STORE: "", TYPESAFE_API_KEY: "" },
  });
  if (result.error || result.status === null) {
    console.error(
      `could not run the stability fixtures: ${result.error?.message ?? "no exit status"}`,
    );
    process.exitCode = 1;
    break;
  }
  if (result.status === 0) {
    console.error("stability fixtures passed; they must fail to be measured");
    process.exitCode = 1;
    break;
  }
  const report = JSON.parse(readFileSync("traces/latch-report.json", "utf8")) as {
    clusters: Array<{ signature: string; sample_titles: string[] }>;
  };
  for (const cluster of report.clusters) {
    for (const title of cluster.sample_titles) {
      const set = signatures.get(title) ?? new Set<string>();
      set.add(cluster.signature);
      signatures.set(title, set);
    }
  }
}

let stable = 0;
const drifted: string[] = [];
for (const [title, set] of [...signatures].sort()) {
  const isStable = set.size === 1;
  if (isStable) stable += 1;
  else if (!KNOWN_DRIFT.has(title)) drifted.push(title);
  console.log(`${isStable ? "STABLE" : "DRIFT "} ${String(set.size).padStart(2)}  ${title}`);
}
console.log(`\n${stable}/${signatures.size} fixtures stable over ${RUNS} runs`);

if (drifted.length > 0) {
  console.error(`unexpected signature drift: ${drifted.join(", ")}`);
  process.exitCode = 1;
}
