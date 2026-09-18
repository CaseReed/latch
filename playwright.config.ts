import { defineConfig } from "@playwright/test";
import "./src/load-env.ts";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["./src/reporter.ts"]],
  use: {
    headless: true,
  },
});
