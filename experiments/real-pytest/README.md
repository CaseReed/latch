# Real pytest failure corpus

A reproducible way to point Latch at **genuine** JUnit XML rather than hand-written
fixtures. The tests import real libraries (stdlib `urllib`, `socket`, `json`,
`sqlite3`) and fail for real reasons, so pytest emits real exception types,
messages and tracebacks.

```bash
python3 -m venv /tmp/latch-venv
/tmp/latch-venv/bin/pip install pytest
/tmp/latch-venv/bin/pytest experiments/real-pytest --junitxml=experiments/real-pytest/results.xml -q
npm run latch -- experiments/real-pytest/results.xml --store /tmp/latch-real.json
```

`results.xml` is generated and gitignored.

## What this is and is not

- **Is**: real framework output. It exercises the JUnit ingestor and clustering on
  the exact XML a real pytest run produces.
- **Is not**: a real red CI run. GitHub job logs and artifacts are auth-gated
  (`GET .../actions/jobs/:id/logs` returns 403 without admin rights), so the
  failure *distribution* is chosen here. The long-tail compression of a real
  repository remains unmeasured.

## What it found (2026-09-19)

Real pytest 9 output broke three assumptions the hand-written fixtures hid:

1. pytest 9 emits **no `type` attribute** on `<failure>` → `apiName` was `unknown`.
2. The `<failure>` **traceback embeds the test name**; appending it after a short
   `message` split one cause into one cluster per test (3 identical timeouts →
   3 clusters). Preferring `message` fixed it.
3. Numeric character references (`&#10;`) were **not decoded**, polluting messages.

After the fixes: 24 failures → 12 clusters offline; live Jev labelled the 8
connection-refused as `env_cascade`/`ignore_as_infra` and the assertions as
`fix_product`. One real mislabel was observed: a `FileNotFoundError: No such file`
was judged `env_cascade`/`ignore_as_infra`, which a merge gate should not ignore.
