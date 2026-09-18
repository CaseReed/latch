const CAUSE_CONFIDENCE_MIN = 0.55;
const SAME_ROOT_MIN = 0.5;
const SAME_ROOT_INFRA = 0.7;
const BLOCKS_MERGE_PRODUCT = 0.5;

// An explicit infra fingerprint. A false "ignore" hides a real bug, so only
// these messages may silence a cluster; anything else falls back to a human.
const INFRA_PATTERNS: RegExp[] = [
  /\bE(?:CONNREFUSED|CONNRESET|TIMEDOUT|NOTFOUND|AI_AGAIN|NETUNREACH|HOSTUNREACH|PIPE)\b/,
  /\bERR_CONNECTION_(?:REFUSED|RESET|TIMED_OUT|CLOSED|ABORTED)\b/,
  /\bERR_(?:NAME_NOT_RESOLVED|PROXY_CONNECTION_FAILED|NETWORK_CHANGED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED)\b/,
  /\bConnection refused\b/i,
  /\bConnection reset by peer\b/i,
  /\bNo route to host\b/i,
  /\bNetwork is unreachable\b/i,
  /\bTemporary failure in name resolution\b/i,
  /\bName or service not known\b/i,
  /\bgetaddrinfo\b/,
  /\bsocket hang up\b/i,
  /\bBad Gateway\b/i,
  /\bService Unavailable\b/i,
  /\bGateway Timeout\b/i,
];

export function isInfraError(message: string): boolean {
  return INFRA_PATTERNS.some((pattern) => pattern.test(message));
}

export type PolicyInput = {
  cause?: string;
  cause_confidence?: number;
  same_root?: number;
  blocks_merge?: number;
  flaky_count: number;
  /** Jev's own `action` answer, used only to corroborate the product branch. */
  jev_action?: string;
  /** The clustered error text, required to confirm an infra outage. */
  representative_error?: string;
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
    if (isInfraError(input.representative_error ?? "")) {
      return { action: "ignore_as_infra", reason: "env_cascade" };
    }
    return { action: "needs_human", reason: "env_cascade_unconfirmed" };
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
