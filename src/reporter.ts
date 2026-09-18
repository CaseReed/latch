import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import "./load-env.ts";
import { clusterAttempts } from "./cluster.ts";
import { maybeCommentOnPullRequest, maybeWriteGitHubSummary } from "./github.ts";
import {
  appendRun,
  buildRecord,
  labelsFor,
  loadHistory,
  saveHistory,
  splitSuppressed,
  storePath,
} from "./ledger.ts";
import { toFailedAttempt } from "./playwright-attempt.ts";
import { scoreClusters } from "./score-run.ts";
import {
  formatMarkdown,
  formatScoredTerminal,
  writeReports,
} from "./summarize.ts";
import type { FailedAttempt, RunMeta } from "./types.ts";

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default class LatchReporter implements Reporter {
  private attempts: FailedAttempt[] = [];
  private meta: RunMeta = { workers: 1, retries_config: 0 };

  printsToStdio(): boolean {
    return true;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    try {
      const retries = Math.max(0, ...config.projects.map((project) => project.retries ?? 0));
      this.meta = {
        workers: config.workers,
        retries_config: retries,
        test_count: suite.allTests().length,
      };
    } catch (error) {
      console.error(`[latch] onBegin: ${errMsg(error)}`);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    try {
      if (result.status === "failed" || result.status === "timedOut") {
        this.attempts.push(toFailedAttempt(test, result, test.outcome() === "flaky"));
      }
      if (test.outcome() === "flaky") {
        for (const attempt of this.attempts) {
          if (attempt.testId === test.id) attempt.status = "flaky";
        }
      }
    } catch (error) {
      console.error(`[latch] onTestEnd: ${errMsg(error)}`);
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    try {
      this.meta.duration_ms = result.duration;
      const clusters = clusterAttempts(this.attempts);
      const store = storePath();
      const history = loadHistory(store);
      const scored = await scoreClusters(clusters, this.meta);
      const annotations = store ? labelsFor(scored, history) : undefined;
      const { active, suppressed } = splitSuppressed(scored, history);
      const text = formatScoredTerminal(active, this.attempts.length, annotations, suppressed.length);
      console.log(text);
      const markdown = formatMarkdown(
        active,
        this.attempts.length,
        this.meta,
        annotations,
        suppressed.length,
      );
      writeReports(
        "traces",
        {
          run: this.meta,
          failed: this.attempts.length,
          clusters: scored,
          suppressed: suppressed.map((cluster) => cluster.signature),
        },
        markdown,
      );
      saveHistory(appendRun(history, buildRecord(scored, this.attempts.length)), store);
      maybeWriteGitHubSummary(markdown);
      await maybeCommentOnPullRequest(markdown);
    } catch (error) {
      console.error(`[latch] onEnd: ${errMsg(error)}`);
    }
  }
}
