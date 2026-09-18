import type { TestCase, TestResult, TestStep } from "@playwright/test/reporter";
import { cleanErrorMessage, deriveApiName } from "./attempt.ts";
import type { FailedAttempt } from "./types.ts";

function walkSteps(steps: TestStep[]): TestStep[] {
  const out: TestStep[] = [];
  for (const step of steps) {
    out.push(step);
    if (step.steps?.length) out.push(...walkSteps(step.steps));
  }
  return out;
}

export function toFailedAttempt(
  test: TestCase,
  result: TestResult,
  flaky: boolean,
): FailedAttempt {
  const errorMessage = cleanErrorMessage(
    result.error?.message ?? result.errors[0]?.message ?? "",
  );
  const failedSteps = walkSteps(result.steps ?? []).filter((step) => step.error);
  const preferred = failedSteps.filter(
    (step) => step.category === "pw:api" || step.category === "expect",
  );
  const stepTitles = (preferred.length ? preferred : failedSteps).map((step) => step.title);
  const loc = test.location;
  return {
    testId: test.id,
    title: test.title,
    location: loc ? `${loc.file}:${loc.line}` : test.title,
    status: flaky ? "flaky" : result.status === "timedOut" ? "timedOut" : "failed",
    apiName: deriveApiName(errorMessage, stepTitles),
    errorMessage,
  };
}
