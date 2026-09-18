import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const run = spawnSync("npx", ["playwright", "test", "tests/reporter.e2e.spec.ts"], {
  stdio: "inherit",
  env: { ...process.env, TYPESAFE_API_KEY: "" },
});
assert.equal(run.error, undefined, `could not start playwright: ${run.error?.message ?? ""}`);
assert.notEqual(run.status, 0, "the e2e fixtures must fail, else there is nothing to report");

const report = JSON.parse(readFileSync("traces/latch-report.json", "utf8")) as {
  failed: number;
  clusters: Array<{ signature: string; action: string; action_reason?: string }>;
};
const signatures = report.clusters.map((cluster) => cluster.signature).join("\n");
assert.equal(report.failed, 2);
assert.match(signatures, /expect\.toBe/);
assert.match(signatures, /locator\.click/);
assert.match(signatures, /strict mode/);
assert.ok(
  report.clusters.every((cluster) => cluster.action === "needs_human" && cluster.action_reason === "no_key"),
  "without a key every cluster must be needs_human/no_key",
);
assert.match(readFileSync("traces/latch-report.html", "utf8"), /Gate:/);
console.log(`e2e ok: ${report.failed} failed → ${report.clusters.length} causes`);
