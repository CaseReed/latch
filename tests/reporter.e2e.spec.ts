import { expect, test } from "@playwright/test";

// These fixtures are meant to FAIL. `npm run test:e2e` runs them to prove the
// Latch reporter over real Playwright events. Do not "fix" them.

test("assertion failure clusters as expect.toBe", () => {
  expect(1, "invoice total").toBe(2);
});

test("strict-mode locator failure clusters as locator.click", async ({ page }) => {
  await page.setContent(
    '<button data-testid="submit">Save</button><button data-testid="submit">Save draft</button>',
  );
  await page.getByTestId("submit").click();
});
