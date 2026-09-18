import assert from "node:assert/strict";
import { test } from "node:test";
import { loadGolden, loadRunFile, parseGolden } from "./golden.ts";

const attempt = {
  title: "t",
  location: "l",
  status: "failed",
  apiName: "x",
  errorMessage: "e",
};

test("parseGolden accepts a valid run and defaults the meta", () => {
  const run = parseGolden(JSON.stringify({ attempts: [attempt] }), "x");
  assert.equal(run.attempts.length, 1);
  assert.deepEqual(run.run, { workers: 1, retries_config: 0 });
});

test("parseGolden rejects a missing or malformed attempt list", () => {
  assert.throws(() => parseGolden("{}", "x"), /expected a golden JSON/);
  assert.throws(
    () => parseGolden(JSON.stringify({ attempts: [{ title: "t" }] }), "x"),
    /expected a golden JSON/,
  );
});

test("loadGolden reads a committed fixture", () => {
  assert.equal(loadGolden("env-cascade").attempts.length, 73);
});

test("loadRunFile reads JUnit XML as well as golden JSON", () => {
  assert.equal(loadRunFile("testdata/junit/jest.xml").attempts.length, 5);
  assert.equal(loadRunFile("testdata/runs/assertion.json").attempts.length, 5);
});
