import { XMLParser, XMLValidator } from "fast-xml-parser";
import { deriveApiName } from "../attempt.ts";
import type { FailedAttempt, RunMeta } from "../types.ts";

export type IngestedRun = {
  run: RunMeta;
  attempts: FailedAttempt[];
};

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  isArray: (name) => name === "testsuite" || name === "testcase",
});

function asRecord(value: unknown): Node {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Node) : {};
}

const NUMERIC_ENTITY = /&#(x?)([0-9a-fA-F]+);/g;

/** fast-xml-parser decodes named entities but leaves numeric character references. */
function decodeNumericEntities(text: string): string {
  return text.replace(NUMERIC_ENTITY, (whole, hex: string, code: string) => {
    const value = Number.parseInt(code, hex ? 16 : 10);
    if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return whole;
    try {
      return String.fromCodePoint(value);
    } catch {
      return whole;
    }
  });
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(node: Node, name: string): string | undefined {
  const value = node[`@_${name}`];
  if (typeof value === "string") return decodeNumericEntities(value);
  if (typeof value === "number") return String(value);
  return undefined;
}

function numberAttr(node: Node, name: string): number | undefined {
  const raw = attr(node, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return decodeNumericEntities(value);
  if (typeof value === "number") return String(value);
  const text = asRecord(value)["#text"];
  return typeof text === "string" ? decodeNumericEntities(text) : "";
}

/** Keep the class name of a JUnit `type`, dropping module paths. */
function normalizeType(type: string): string {
  return type.split(/[./\\]/).filter(Boolean).pop() ?? type;
}

/**
 * When the framework gives no `type` and the message matches no known API, read
 * the exception name from the message itself (pytest 9 emits no `type`).
 */
function apiNameFromMessage(message: string): string | undefined {
  const head = message.trim();
  if (/^assert\b/.test(head)) return "AssertionError";
  const named = head.match(/^([A-Za-z_][\w.]*(?:Error|Exception|Warning|Failure))\b/);
  if (named) return normalizeType(named[1]!);
  const dotted = head.match(/^([A-Za-z_]\w*\.[A-Za-z_][\w.]*)\s*:/);
  return dotted ? normalizeType(dotted[1]!) : undefined;
}

function apiNameOf(message: string, type?: string): string {
  const derived = deriveApiName(message);
  if (derived !== "unknown") return derived;
  if (type) return normalizeType(type);
  return apiNameFromMessage(message) ?? "unknown";
}

function failureElement(node: Node): unknown | undefined {
  const found = asArray(node.failure)[0] ?? asArray(node.error)[0];
  return found === undefined ? undefined : found;
}

/**
 * Prefer the framework's `message` over the raw traceback: the traceback embeds
 * the test name and the source line, which would leak into the signature and
 * split one cause into one cluster per test.
 */
function messageOf(element: unknown): string {
  const message = attr(asRecord(element), "message");
  const text = textOf(element);
  return (message ?? text).trim();
}

function locationOf(node: Node, name: string): string {
  const file = attr(node, "file");
  if (file) {
    const line = attr(node, "line");
    return line ? `${file}:${line}` : file;
  }
  const classname = attr(node, "classname");
  return classname ? `${classname}:${name}` : name;
}

/**
 * Turn a JUnit XML report into the same shape Playwright failures produce, so
 * the framework-agnostic core (clustering + policy) can run unchanged.
 */
export function ingestJUnit(xml: string): IngestedRun {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new Error(`invalid JUnit XML: ${valid.err.msg} (line ${valid.err.line})`);
  }

  const parsed = asRecord(parser.parse(xml));
  const containers = parsed.testsuites !== undefined ? asArray(parsed.testsuites) : [parsed];

  const attempts: FailedAttempt[] = [];
  let suiteTests = 0;
  let hasSuiteTests = false;
  let containerTests: number | undefined;
  let durationS = 0;

  for (const container of containers) {
    const containerNode = asRecord(container);
    const declared = numberAttr(containerNode, "tests");
    if (declared !== undefined) containerTests = (containerTests ?? 0) + declared;

    for (const suite of asArray(containerNode.testsuite)) {
      const suiteNode = asRecord(suite);
      const tests = numberAttr(suiteNode, "tests");
      if (tests !== undefined) {
        suiteTests += tests;
        hasSuiteTests = true;
      }
      durationS += numberAttr(suiteNode, "time") ?? 0;

      for (const rawCase of asArray(suiteNode.testcase)) {
        const testcase = asRecord(rawCase);
        const element = failureElement(testcase);
        if (element === undefined) continue;

        const name = attr(testcase, "name") ?? "(unnamed)";
        const classname = attr(testcase, "classname");
        const message = messageOf(element) || `failure in ${name}`;
        attempts.push({
          title: classname ? `${classname} ${name}` : name,
          location: locationOf(testcase, name),
          status: "failed",
          apiName: apiNameOf(message, attr(asRecord(element), "type")),
          errorMessage: message,
        });
      }
    }
  }

  const run: RunMeta = {
    workers: 1,
    retries_config: 0,
    test_count: hasSuiteTests ? suiteTests : containerTests,
    duration_ms: durationS > 0 ? Math.round(durationS * 1000) : undefined,
  };
  return { run, attempts };
}
