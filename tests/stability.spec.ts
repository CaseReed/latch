import { expect, test } from "@playwright/test";

// Stability fixtures: these tests are meant to FAIL, and some of them fail with
// messages that legitimately vary between runs (timestamps, ids, ports, timeouts).
// `npm run test:stability` runs this file several times and measures whether the
// Latch signature for each logical failure stays the same. Do not "fix" them.

test("stable: strict-mode locator", async ({ page }) => {
  await page.setContent(
    '<button data-testid="submit">Save</button><button data-testid="submit">Save draft</button>',
  );
  await page.getByTestId("submit").click();
});

test("stable: fixed connection refused", async ({ page }) => {
  await page.goto("http://127.0.0.1:9/");
});

test("stable: fixed timeout", async ({ page }) => {
  await page.waitForSelector("#missing", { timeout: 100 });
});

test("stable: constant application error", () => {
  throw new Error("database unavailable: pool exhausted");
});

test("volatile: app error with a request id", () => {
  throw new Error(`upstream 500 for request ${Math.random().toString(36).slice(2)}`);
});

test("volatile: timeout duration varies", async ({ page }) => {
  await page.waitForSelector("#missing", { timeout: 50 + Math.floor(Math.random() * 200) });
});

test("volatile: connection refused on a random port", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${5000 + Math.floor(Math.random() * 500)}/`);
});

test("volatile: asserted token varies", () => {
  expect(`token-${Math.random().toString(36).slice(2)}`).toBe("token-x");
});
