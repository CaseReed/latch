import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { clusterAttempts } from "../cluster.ts";
import { ingestJUnit } from "./junit.ts";

function load(name: string) {
  return ingestJUnit(readFileSync(`testdata/junit/${name}`, "utf8"));
}

test("jest JUnit: stable message collapses infra failures, expect failures get an api name", () => {
  const { run, attempts } = load("jest.xml");
  assert.equal(attempts.length, 5);
  assert.equal(run.test_count, 6);
  assert.equal(run.duration_ms, 4210);

  const clusters = clusterAttempts(attempts);
  assert.equal(clusters.length, 2);
  const infra = clusters.find((cluster) => cluster.representative_error.includes("ECONNREFUSED"));
  assert.equal(infra?.size, 4);
  const assertion = clusters.find((cluster) => cluster.apiName === "expect.toBe");
  assert.equal(assertion?.size, 1);
});

test("pytest JUnit: the failure type is the api name when the message has no known pattern", () => {
  const clusters = clusterAttempts(load("pytest.xml").attempts);
  assert.equal(clusters.length, 2);
  const assertion = clusters.find((cluster) => cluster.apiName === "AssertionError");
  assert.equal(assertion?.size, 2);
  const refused = clusters.find((cluster) => cluster.apiName === "ConnectionRefusedError");
  assert.equal(refused?.size, 1);
});

test("go JUnit: without a stable message the same timeout does not collapse (known limit)", () => {
  const clusters = clusterAttempts(load("go.xml").attempts);
  assert.equal(clusters.length, 3);
  assert.ok(clusters.every((cluster) => cluster.size === 1));
  assert.ok(clusters.every((cluster) => cluster.apiName === "unknown"));
});

test("invalid XML is rejected rather than silently mis-parsed", () => {
  assert.throws(() => ingestJUnit("<testsuites><testsuite></testsuites>"), /invalid JUnit XML/);
});

test("a root-level testsuite is ingested too", () => {
  const { attempts } = ingestJUnit(
    '<testsuite name="x" tests="1"><testcase name="a"><failure type="Error" message="boom"/></testcase></testsuite>',
  );
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.apiName, "Error");
});
