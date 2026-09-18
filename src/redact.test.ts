import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSecrets } from "./redact.ts";

test("redacts bearer tokens", () => {
  const out = redactSecrets("Authorization: Bearer abc123def456ghi");
  assert.match(out, /Bearer <redacted>/);
  assert.doesNotMatch(out, /abc123def456ghi/);
});

test("redacts api-key shaped tokens", () => {
  const out = redactSecrets("TYPESAFE_API_KEY=ts_abcdef123456 failed");
  assert.doesNotMatch(out, /ts_abcdef123456/);
  assert.match(out, /<redacted-key>/);
});

test("a key-shaped token must contain a digit, so plain identifiers survive", () => {
  assert.equal(redactSecrets("ts_config is missing"), "ts_config is missing");
  assert.equal(redactSecrets("pk_customer_id"), "pk_customer_id");
});

test("redacts password and token assignments", () => {
  assert.equal(redactSecrets("password=hunter2"), "password=<redacted>");
  assert.equal(redactSecrets("token: abcdef"), "token: <redacted>");
});

test("leaves ordinary failure text intact", () => {
  const message = "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/";
  assert.equal(redactSecrets(message), message);
});
