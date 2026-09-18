import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { signatureOf } from "../attempt.ts";
import { clusterAttempts } from "../cluster.ts";
import { ingestJUnit } from "./junit.ts";

function load(name: string) {
  return ingestJUnit(readFileSync(`testdata/junit/${name}`, "utf8"));
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

test("a failure without a message attribute falls back to its text", () => {
  const { attempts } = ingestJUnit(
    '<testsuite name="x" tests="1"><testcase name="a"><failure>Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/</failure></testcase></testsuite>',
  );
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.apiName, "page.goto");
  assert.match(attempts[0]?.errorMessage ?? "", /ERR_CONNECTION_REFUSED/);
});

test("numeric character references are decoded", () => {
  const { attempts } = ingestJUnit(
    '<testsuite name="x" tests="1"><testcase name="a"><failure message="assert 1 == 2&#10; + where 1 = f()">trace</failure></testcase></testsuite>',
  );
  assert.equal(attempts[0]?.errorMessage, "assert 1 == 2\n + where 1 = f()");
  assert.doesNotMatch(attempts[0]?.errorMessage ?? "", /&#10;/);
});

test("a short message is preferred over the traceback, so the test name cannot leak", () => {
  const xml = (name: string) =>
    `<testsuite name="x" tests="1"><testcase name="${name}"><failure message="TimeoutError: timed out">def ${name}(): ...</failure></testcase></testsuite>`;
  const a = ingestJUnit(xml("test_a")).attempts[0]!;
  const b = ingestJUnit(xml("test_b")).attempts[0]!;
  assert.equal(a.errorMessage, "TimeoutError: timed out");
  assert.equal(a.apiName, "TimeoutError");
  assert.equal(signatureOf(a), signatureOf(b));
});

test("the exception name is read from the message when pytest emits no type", () => {
  const cases: Array<[string, string]> = [
    ["urllib.error.URLError: <urlopen error [Errno 61] Connection refused>", "URLError"],
    ["json.decoder.JSONDecodeError: Expecting value: line 1 column 13", "JSONDecodeError"],
    ["KeyError: 'error_rate'", "KeyError"],
    ["ZeroDivisionError: division by zero", "ZeroDivisionError"],
  ];
  for (const [message, expected] of cases) {
    const { attempts } = ingestJUnit(
      `<testsuite name="x" tests="1"><testcase name="a"><failure message="${escapeAttr(message)}">tb</failure></testcase></testsuite>`,
    );
    assert.equal(attempts[0]?.apiName, expected, message);
  }
});
