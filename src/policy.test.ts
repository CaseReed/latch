import assert from "node:assert/strict";
import { test } from "node:test";
import { decideAction, isBlocking, isInfraError, type PolicyInput } from "./policy.ts";

function base(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    flaky_count: 0,
    cause_confidence: 0.9,
    same_root: 0.9,
    blocks_merge: 0.5,
    ...overrides,
  };
}

test("API error needs a human", () => {
  assert.deepEqual(decideAction(base({ error: "no_key" })), {
    action: "needs_human",
    reason: "no_key",
  });
});

test("low cause confidence needs a human", () => {
  assert.deepEqual(decideAction(base({ cause: "env_cascade", cause_confidence: 0.4 })), {
    action: "needs_human",
    reason: "low_confidence",
  });
});

test("env_cascade with same_root and an infra fingerprint is ignore_as_infra", () => {
  assert.deepEqual(
    decideAction(
      base({
        cause: "env_cascade",
        same_root: 0.96,
        representative_error:
          "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/",
      }),
    ),
    { action: "ignore_as_infra", reason: "env_cascade" },
  );
});

test("env_cascade without an infra fingerprint needs a human, never a silent ignore", () => {
  assert.deepEqual(
    decideAction(
      base({
        cause: "env_cascade",
        same_root: 0.96,
        representative_error: "FileNotFoundError: [Errno 2] No such file or directory",
      }),
    ),
    { action: "needs_human", reason: "env_cascade_unconfirmed" },
  );
});

test("isBlocking only clears confirmed infra noise", () => {
  assert.equal(isBlocking("ignore_as_infra"), false);
  assert.equal(isBlocking("fix_product"), true);
  assert.equal(isBlocking("fix_test"), true);
  assert.equal(isBlocking("needs_human"), true);
});

test("isInfraError recognizes network outages but not local failures", () => {
  assert.equal(
    isInfraError("Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/"),
    true,
  );
  assert.equal(isInfraError("connect ECONNREFUSED 127.0.0.1:5432"), true);
  assert.equal(
    isInfraError("urllib.error.URLError: <urlopen error [Errno 61] Connection refused>"),
    true,
  );
  assert.equal(isInfraError("getaddrinfo ENOTFOUND api.example.com"), true);
  assert.equal(isInfraError("socket hang up"), true);
  assert.equal(isInfraError("FileNotFoundError: [Errno 2] No such file or directory"), false);
  assert.equal(isInfraError("KeyError: 'error_rate'"), false);
  assert.equal(isInfraError("assert 4100 == 4200"), false);
  assert.equal(isInfraError(""), false);
});

test("flake with a flaky attempt is fix_test", () => {
  assert.deepEqual(
    decideAction(base({ cause: "flake", flaky_count: 1 })),
    { action: "fix_test", reason: "flake" },
  );
});

test("locator_drift is fix_test", () => {
  assert.deepEqual(
    decideAction(base({ cause: "locator_drift" })),
    { action: "fix_test", reason: "locator_drift" },
  );
});

test("assertion_bug that blocks merge is fix_product", () => {
  assert.deepEqual(
    decideAction(base({ cause: "assertion_bug", blocks_merge: 0.8 })),
    { action: "fix_product", reason: "assertion_bug" },
  );
});

test("assertion_bug at the calibrated threshold is fix_product", () => {
  assert.deepEqual(
    decideAction(base({ cause: "assertion_bug", blocks_merge: 0.55 })),
    { action: "fix_product", reason: "assertion_bug" },
  );
});

test("assertion_bug inside the model's noise band needs a human unless Jev confirms", () => {
  assert.deepEqual(
    decideAction(base({ cause: "assertion_bug", blocks_merge: 0.52 })),
    { action: "needs_human", reason: "no_rule" },
  );
  assert.deepEqual(
    decideAction(base({ cause: "assertion_bug", blocks_merge: 0.52, jev_action: "fix_product" })),
    { action: "fix_product", reason: "assertion_bug" },
  );
});

test("assertion_bug below threshold but Jev says fix_product is fix_product", () => {
  assert.deepEqual(
    decideAction(base({ cause: "assertion_bug", blocks_merge: 0.4, jev_action: "fix_product" })),
    { action: "fix_product", reason: "assertion_bug" },
  );
});

test("low same_root needs a human even for an otherwise clear cause", () => {
  assert.deepEqual(decideAction(base({ cause: "locator_drift", same_root: 0.4 })), {
    action: "needs_human",
    reason: "low_same_root",
  });
});

test("flake without a passing retry needs a human", () => {
  assert.deepEqual(decideAction(base({ cause: "flake", flaky_count: 0 })), {
    action: "needs_human",
    reason: "no_rule",
  });
});

test("assertion_bug with low blocks_merge needs a human", () => {
  assert.deepEqual(
    decideAction(base({ cause: "assertion_bug", blocks_merge: 0.4 })),
    { action: "needs_human", reason: "no_rule" },
  );
});

test("unmatched cause needs a human", () => {
  assert.deepEqual(decideAction(base({ cause: "timeout_app" })), {
    action: "needs_human",
    reason: "no_rule",
  });
});
