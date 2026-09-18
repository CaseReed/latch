import { choice, noul, score } from "@typesafe-ai/sdk";
import type { ClusterState } from "./types.ts";

export function buildQuestions(_state: ClusterState) {
  return {
    cause: choice(
      "What is the single most likely root cause of this failure cluster?",
      {
        env_cascade: {
          what: "Shared environment or infra: server down, connection refused, missing env, DNS, proxy, CI service not up.",
          not_for:
            "A unique locator, assertion, or timeout that would still fail if the environment were healthy.",
          examples: [
            "70 tests fail page.goto with net::ERR_CONNECTION_REFUSED at the same localhost:port",
            "ECONNREFUSED / ENOTFOUND / 502 from a shared backend",
          ],
        },
        flake: {
          what: "Intermittent: retries later pass, race, animation, network jitter.",
          not_for: "Every attempt fails the same way with no pass.",
          examples: [
            "Failed then passed on retry (Playwright flaky)",
            "Timeout only under load",
          ],
        },
        locator_drift: {
          what: "Selector no longer matches the live DOM (copy, role, test id, layout).",
          not_for: "The app is down or the assertion logic itself is wrong.",
          examples: [
            "strict mode violation, locator resolved to 0 elements",
            "getByRole name no longer matches the button label",
          ],
        },
        assertion_bug: {
          what: "The test expectation is wrong or stale versus correct product behavior.",
          not_for: "Infra down or a missing locator.",
          examples: [
            "toHaveText expected old copy after a product change",
            "asserted the wrong URL after a valid redirect",
          ],
        },
        timeout_app: {
          what: "The app or page is up but too slow: spinner never clears, request hangs.",
          not_for: "Connection refused or a wrong locator.",
          examples: [
            "Timeout waiting for network idle while the server responds 200 slowly",
            "Element stays hidden because a product API never returns",
          ],
        },
        unknown: {
          what: "Cannot tell from this cluster snapshot.",
          not_for: "Any case that clearly matches another option.",
          examples: ["Ambiguous mixed errors", "Truncated message with no API name"],
        },
      },
    ),
    same_root: noul(
      "Do all samples in this cluster share one root cause (not coincidental similar messages)?",
    ),
    blocks_merge: noul(
      "Should this cluster block merging a PR? Infra-only outages are often a loud headline but not a product defect.",
    ),
    action: choice("What should a human do with this cluster?", {
      ignore_as_infra: {
        what: "Do not treat as a product or test bug; fix or wait on environment.",
        not_for: "A real locator, assertion, or product timeout.",
        examples: ["Whole suite connection-refused to localhost"],
      },
      fix_test: {
        what: "Change the spec, locator, wait, or retry policy.",
        not_for: "The product is wrong or the environment is down.",
        examples: ["Flaky wait", "Stale getByRole"],
      },
      fix_product: {
        what: "The application under test is wrong.",
        not_for: "Infra or a bad assertion against correct UI.",
        examples: ["Regression in copy or flow the test correctly asserts"],
      },
      needs_human: {
        what: "Not enough signal; a person must look.",
        not_for: "A clear env, flake, locator, or assertion case.",
        examples: ["Conflicting samples", "Unknown cause"],
      },
    }),
    severity: score("How severe is this cluster for the report headline?", [
      "Noise: infra already known, or no merge impact.",
      "Worth a look: a person should triage this cluster.",
      "Urgent: likely a product defect or a suite-wide break.",
    ]),
  };
}
