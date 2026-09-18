# Calibration: does the verdict flip on model noise?

A merge gate that changes its mind run to run is not sellable. Jev returns a
continuous `blocks_merge` score; the product threshold on it must not sit where
the model's own variance is.

```bash
npm run calibrate                     # LATCH_CALIB_RUNS=5 by default
```

It calls Jev `RUNS` times on seven clusters — the four goldens plus the
borderline ones from `testdata/junit/jest.xml`, `experiments/real-pytest` and
`experiments/click-real` — and reports how often the resulting action flips for
the shipped policy and three alternatives.

## Result (2026-09-19, 5 runs each)

| Cluster | blocks_merge across 5 runs | shipped (≥0.55) |
|---|---|---|
| env-cascade | 0.47–0.49 | stable |
| flake | 0.50–0.52 | stable |
| locator | 0.58–0.60 | stable |
| assertion | 0.53–0.57 | stable |
| jest-assert | **0.48–0.51** | stable (`needs_human`) |
| pytest-assert | 0.58–0.61 | stable |
| click-help | 0.59–0.61 | stable |

Flip count: **shipped 0/7**, model-authority 1/7, both fixed. The old 0.5
threshold flipped on `jest-assert` (0.49 ↔ 0.51); 0.55 is in the empty gap
between the ambiguous band and clear product cases. `jest-assert` resolves to
`needs_human`, which matches Jev's own lean on that cluster.

Caveat: seven clusters is a small sample. Re-run `npm run calibrate` after any
prompt or model change.
