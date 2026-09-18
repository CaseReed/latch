# Latch

Jev judges the failed RUN. Playwright already executed. Code clusters and reports.

**Latch does not modify your tests.** Read-only reporter: cluster first, then one TypeSafe Jev `systemOne` per cluster (max 8, 3 in flight). No remap, no click, no wrapper `test()`. Code owns the final `action`; Jev's own `action` answer only corroborates the product branch.

## Install

```ts
reporter: [["list"], ["./src/reporter.ts"]]
```

Key in `.env` as `TYPESAFE_API_KEY` only. Missing key still prints clusters (`needs_human` / `no_key`) and never fails Playwright.

Optional overrides: `LATCH_MODEL` (default `jev-latest`), `LATCH_INPUT_USD_PER_MTOK`, `LATCH_OUTPUT_USD_PER_MTOK` (cost estimate only; defaults 0.3 / 2.5).

## What you should see

```
Latch: 73 failed → 4 causes
P0 env_cascade n=70 conf=1.00 same_root=0.91 blocks=0.48  action=ignore_as_infra (env_cascade)
     Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/
P1 timeout_app n=1 conf=0.90 same_root=0.78 blocks=0.45  action=needs_human (no_rule)
P2 assertion_bug n=1 conf=1.00 same_root=0.75 blocks=0.48  action=fix_product (assertion_bug)
P3 expect.toBeVisible n=1 conf=0.47  action=needs_human (low_confidence)
```

70 connection-refused at the same `localhost:8080` are **one** infra cluster, not 70 traces. Green run: `Latch: 0 failures` (no Jev).

Also: `traces/latch-report.json`, `traces/latch.md` (with a Jev calls / tokens / latency / estimated-cost footer). `GITHUB_STEP_SUMMARY` and the PR comment are optional; the comment is updated in place (marker `<!-- latch-report -->`), never duplicated.

## Proof

```bash
npm run test:unit          # 30 tests, goldens + hooks, no network
npm run print:clusters     # 73 failed → 4 causes, n=70
npm run test:e2e           # real Playwright, intentional failures, no key needed
npm run test:live          # Jev on goldens; skips without a key
```

`test:e2e` runs real Playwright specs that are meant to fail and asserts `traces/latch-report.json`; it blanks the key so it stays offline. Live is **node:test**, not a Playwright spec, so a golden “73 failed” is never mixed with a `Latch: 0 failures`.

## Any runner (JUnit XML)

```bash
npm run latch -- testdata/junit/jest.xml   # or any .xml / golden .json
```

The same core (clustering + policy) runs on any JUnit report, no Playwright needed:

- `apiName`: Playwright patterns first, else the JUnit `failure`/`error` `type` (`AssertionError`, `ConnectionRefusedError`, …), else `unknown`.
- `errorMessage`: the stable `message` attribute when present, else the raw text. XML is validated before parsing.

Measured on `testdata/junit/` (live Jev):

- **jest**: 5 failed → 2 causes. 4× `ECONNREFUSED 127.0.0.1:5432` → `ignore_as_infra`; the `expect` mismatch → `fix_product`.
- **pytest**: 3 failed → 2 causes. `assert 4100 == 4200` ×2 → `fix_product`; `ConnectionRefusedError` → `ignore_as_infra`.
- **go**: 3 failed → 3 causes, no collapse — the only signal embeds the test name.

The limit is the point: clustering generalizes when the runner exposes a stable `message`/`type`, and falls back to one-cluster-per-test when the raw output is all you have. `go.xml` is the canary.

## Failure ledger (history across runs)

Every run — reporter or CLI — appends its clusters to a local store (`.latch/store.json`, override with `LATCH_STORE`, set it empty to disable). The next run labels each cluster in the terminal and in the markdown:

```
P0 env_cascade n=4 conf=1.00 same_root=0.83 blocks=0.52  action=ignore_as_infra (env_cascade)  [seen x2]
P1 assertion_bug n=1 conf=0.98 same_root=0.60 blocks=0.51  action=fix_product (assertion_bug)  [new]
```

```bash
npm run latch -- testdata/runs/env-cascade.json --store /tmp/latch-store.json
# first run: [new] ... second run: [seen x1]
```

A recurring infra cluster now reads differently from a fresh product failure — the raw material for a flake budget or a trusted merge gate. The store keeps the last 100 runs; in CI it must be cached or committed to persist.

## Policy (code)

1. No key / API error → `needs_human`
2. `cause.confidence < 0.55` → `needs_human`
3. `same_root < 0.5` → `needs_human` (`low_same_root`)
4. `env_cascade` and `same_root >= 0.7` → `ignore_as_infra`
5. `flake` and `flaky_count >= 1` → `fix_test`
6. `locator_drift` → `fix_test`
7. `assertion_bug` and (`blocks_merge >= 0.5` or Jev `action = fix_product`) → `fix_product`
8. else → `needs_human`

Thresholds are calibrated against observed Jev output (`blocks_merge` sits ~0.45–0.60, so the old 0.6 gate never fired and `fix_product` was unreachable).

## Limits

- Signature = `apiName` + first 80 chars of the normalized error (ANSI/UUID/long-hex/pixel-diff stripped). Errors that only differ past char 80 collapse into one cluster.
- The Jev state is redacted (Bearer / `sk-` `ts_` shaped keys / `password|token|secret|api_key=` assignments) before it leaves the machine. Signatures are still computed on the raw message. Test data is otherwise sent to TypeSafe as-is.
- At most 8 Jev calls; remaining clusters are `unscored`.

## Out of scope

Wrapper `test()`, recover / remap / click, Browser Use, a second LLM, npm package until a real repo’s PR summary is worth posting.
