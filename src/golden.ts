import { readFileSync } from "node:fs";
import type { FailedAttempt, RunMeta } from "./types.ts";

export type GoldenRun = {
  run: RunMeta;
  attempts: FailedAttempt[];
};

export function loadGolden(name: string): GoldenRun {
  return JSON.parse(readFileSync(`testdata/runs/${name}.json`, "utf8")) as GoldenRun;
}
