import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveApiName, normalizeErrorHead, signatureOf } from "./attempt.ts";

test("deriveApiName from page.goto message", () => {
  assert.equal(
    deriveApiName("Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/"),
    "page.goto",
  );
});

test("deriveApiName from expect(locator).toBeVisible", () => {
  assert.equal(deriveApiName("Error: expect(locator).toBeVisible() failed"), "expect.toBeVisible");
});

test("deriveApiName falls back to step titles then unknown", () => {
  assert.equal(deriveApiName("boom", ["page.click(\"button\")"]), "page.click");
  assert.equal(deriveApiName("something unexplained"), "unknown");
});

test("normalizeErrorHead keeps host:port and strips uuids and long hex", () => {
  const head = normalizeErrorHead(
    "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/ id=550e8400-e29b-41d4-a716-446655440000 hash=deadbeefcafebabe",
  );
  assert.match(head, /localhost:8080/);
  assert.doesNotMatch(head, /550e8400/);
  assert.doesNotMatch(head, /deadbeefcafebabe/);
  assert.match(head, /<id>/);
});

test("signature is apiName plus normalized head, not the test title", () => {
  const a = signatureOf({
    apiName: "page.goto",
    errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/",
  });
  const b = signatureOf({
    apiName: "page.goto",
    errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/",
  });
  assert.equal(a, b);
  assert.equal(a.startsWith("page.goto|"), true);
  assert.doesNotMatch(a, /login/i);
});
