# AGENTS.md

Guidance for AI agents (and humans) working in this repository. Keep it short
and true: if you change a command, a path or a claim, update this file in the
same change.

## What this is

Latch is a **read-only merge-gate triage** for a red test run. It clusters the
failures, asks TypeSafe Jev for the cause, and a code policy returns one
verdict: `Gate: PASS` (infra noise) or `Gate: BLOCK` (a real failure). See
`README.md`.

The product wedge is **infra / noise triage**, not general cause grouping: a
logic regression whose tests fail with different messages fragments into many
clusters (measured in `experiments/click-real`). Never claim otherwise.

## Invariants — do not break

1. **Read-only.** Never modify tests, drive a browser, or auto-fix.
2. **Code owns the decision.** Jev supplies judgment; `src/policy.ts` decides
   the action. Jev's own `action` only corroborates the product branch.
3. **The reporter never fails Playwright.** `onEnd` catches everything. A
   non-zero exit comes only from the CLI's `--gate`, never the reporter.
4. **No silent ignore.** `ignore_as_infra` requires an explicit infra
   fingerprint (`isInfraError` in `src/policy.ts`); any other `env_cascade`
   falls back to `needs_human`.
5. **Redact once, at clustering.** `src/cluster.ts` redacts the representative
   error, the sample titles and the signature. Everything downstream (terminal,
   `traces/`, PR comment, Jev state) is then safe. Do not add a second path.
6. **Thresholds are calibrated.** `blocks_merge` sits in a noise band; see
   `npm run calibrate`. Do not move a threshold without re-measuring.

## Commands

| Command | What it does | Key? |
|---|---|---|
| `npm install` | dependencies | no |
| `npm run demo` | offline merge-gate demo (PASS then BLOCK) | no |
| `npm run test:unit` | unit suite, no network | no |
| `npm run test:e2e` | real Playwright, intentional failures | no |
| `npm run test:stability` | signature drift over repeated runs | no |
| `npm run test:live` | Jev on the goldens | yes |
| `npm run calibrate` | verdict flip rate on borderline clusters | yes |
| `npm run print:clusters` | cluster the env-cascade golden | no |
| `npm run latch -- <file> [--gate] [--html <path>]` | cluster/label a JUnit XML or golden JSON | no\* |
| `npx tsc --noEmit` | typecheck | no |

\* Without a key, clusters print as `needs_human` / `no_key`; cached judgments
still answer.

Before claiming anything is done, run `npx tsc --noEmit` and
`npm run test:unit`; add `npm run test:e2e` for reporter or ingestion changes.

## Layout

- `src/reporter.ts` — Playwright reporter entry (`playwright.config.ts` wires it)
- `src/playwright-attempt.ts` — `TestCase` / `TestResult` → `FailedAttempt`
- `src/attempt.ts` — signature + `apiName` normalization
- `src/cluster.ts` — group by signature; the single redaction point
- `src/score-run.ts` — plan cached / fresh / skip, call Jev, apply the policy
- `src/jev.ts`, `src/questions.ts` — TypeSafe `systemOne`
- `src/policy.ts` — the decision table + infra fingerprint
- `src/ledger.ts` — history, suppression, judgment cache, atomic store
- `src/summarize.ts` — terminal, markdown and the `Gate:` line
- `src/github.ts` — step summary + idempotent, time-bounded PR comment
- `src/cli.ts` — `latch <file>` plus `suppress` / `unsuppress` / `suppressions`
- `src/ingest/junit.ts` — validated JUnit XML ingestion
- `src/golden.ts` — validated run loader (XML or `{ run, attempts }`)

Tests are colocated: `src/*.test.ts` and `src/ingest/*.test.ts`.

## Conventions and gotchas

- ESM + TypeScript, `strict`, `allowImportingTsExtensions`: **import with the
  `.ts` extension** (`./cluster.ts`, not `./cluster`). Node **≥ 20**.
- Tests use `node:test` through `tsx --test`. Run one file with
  `npx tsx --test src/attempt.test.ts`.
- **`test:unit` is an explicit file list in `package.json`.** When you add a
  test file, add it there. Do **not** switch to a glob: `src/**/*.test.ts` also
  matches `reporter.live.test.ts`, which is a network test and must stay out of
  the offline suite.
- `reporter.live.test.ts` and `calibrate` need `TYPESAFE_API_KEY`; without it
  the live test skips and `calibrate` fails.
- `.env` holds the key and is gitignored. **Never commit it.** `.env.example`
  lists the optional vars (`LATCH_MODEL`, `LATCH_STORE`, pricing overrides).
- Generated and gitignored: `traces/`, `.latch/`, `test-results/`,
  `experiments/*/results.xml`.
- The reporter writes `traces/latch-report.json`, `traces/latch.md` and
  `traces/latch-report.html`; the ledger stores `.latch/store.json`. The only
  secret ever needed is `TYPESAFE_API_KEY`.
- `tests/*.spec.ts` are Playwright specs that **fail on purpose** (used by
  `test:e2e` to prove the reporter). Never "fix" them.
- `experiments/real-pytest` and `experiments/click-real` need a Python venv
  with pytest and clone/run real projects; `experiments/demo` and
  `experiments/calibration` are TypeScript.
- CI (`.github/workflows/ci.yml`) runs typecheck, unit, e2e, demo and stability
  on every push, with no secret.

## Reference numbers

- `MAX_JEV_CLUSTERS = 8` fresh calls per run; cached clusters are free.
- `MAX_RUNS = 100` stored runs, `MAX_JUDGMENTS = 500`.
- Policy thresholds: confidence `0.55`, `same_root` `0.5`, infra `0.7`,
  `blocks_merge` `0.55`.
- `README.md` is the landing page and must stay honest; `docs/positioning.md`
  and `docs/validation-plan.md` hold the product decision.
