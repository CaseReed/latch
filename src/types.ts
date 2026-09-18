export type AttemptStatus = "failed" | "timedOut" | "flaky";

export type FailedAttempt = {
  testId?: string;
  title: string;
  location: string;
  status: AttemptStatus;
  apiName: string;
  errorMessage: string;
};

export type Cluster = {
  signature: string;
  apiName: string;
  size: number;
  failed_count: number;
  flaky_count: number;
  representative_error: string;
  sample_titles: string[];
  sample_locations: string[];
};

export type RunMeta = {
  workers: number;
  retries_config: number;
  duration_ms?: number;
  test_count?: number;
};

export type ClusterState = {
  run: RunMeta;
  cluster: Cluster;
};

export type ScoredCluster = Cluster & {
  scored: boolean;
  /** True when the Jev judgment was reused from the ledger instead of a fresh call. */
  cached?: boolean;
  cause?: string;
  cause_confidence?: number;
  same_root?: number;
  blocks_merge?: number;
  /** Jev's own `action` answer, kept for transparency; code policy owns `action`. */
  jev_action?: string;
  action: string;
  action_reason?: string;
  severity?: number;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
  latency_ms?: number;
  cost_estimate_usd?: number;
};
