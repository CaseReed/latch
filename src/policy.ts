const CAUSE_CONFIDENCE_MIN = 0.55;
const SAME_ROOT_MIN = 0.5;
const SAME_ROOT_INFRA = 0.7;
const BLOCKS_MERGE_PRODUCT = 0.5;

export type PolicyInput = {
  cause?: string;
  cause_confidence?: number;
  same_root?: number;
  blocks_merge?: number;
  flaky_count: number;
  /** Jev's own `action` answer, used only to corroborate the product branch. */
  jev_action?: string;
  error?: string;
};

export function decideAction(input: PolicyInput): { action: string; reason: string } {
  if (input.error) {
    return { action: "needs_human", reason: input.error };
  }
  if (input.cause_confidence === undefined || input.cause_confidence < CAUSE_CONFIDENCE_MIN) {
    return { action: "needs_human", reason: "low_confidence" };
  }
  if ((input.same_root ?? 0) < SAME_ROOT_MIN) {
    return { action: "needs_human", reason: "low_same_root" };
  }
  if (input.cause === "env_cascade" && (input.same_root ?? 0) >= SAME_ROOT_INFRA) {
    return { action: "ignore_as_infra", reason: "env_cascade" };
  }
  if (input.cause === "flake" && input.flaky_count >= 1) {
    return { action: "fix_test", reason: "flake" };
  }
  if (input.cause === "locator_drift") {
    return { action: "fix_test", reason: "locator_drift" };
  }
  if (
    input.cause === "assertion_bug" &&
    ((input.blocks_merge ?? 0) >= BLOCKS_MERGE_PRODUCT || input.jev_action === "fix_product")
  ) {
    return { action: "fix_product", reason: "assertion_bug" };
  }
  return { action: "needs_human", reason: "no_rule" };
}
