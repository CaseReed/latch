# Real regressions: does Latch compress a real red suite?

A go/no-go measurement on a real repository, not fixtures. `measure.py` clones
`pallets/click` at a pinned commit (2058 tests, green in ~4s), injects three
independent regressions, and counts how many tests each breaks — that count is
the ground truth.

```bash
python3 -m venv /tmp/latch-venv
/tmp/latch-venv/bin/pip install pytest
/tmp/latch-venv/bin/python experiments/click-real/measure.py
npm run latch -- experiments/click-real/results.xml --store /tmp/latch-click.json
```

`results.xml` is generated and gitignored.

## Ground truth (2026-09-19)

| Regression | Tests broken |
|---|---|
| `IntRange`/`FloatRange` boundaries inverted | 10 |
| `measure_table` drops the running `max` | 3 |
| a flag with an explicit value is not rejected | 0 (untested) |
| **all three** | **13 failures, 2 real causes** |

## What Latch reported

```
Latch: 13 failed → 10 causes
```

Ten clusters for two causes. Every cluster was labelled `assertion_bug` →
`fix_product` by Jev — **the judgment is right; the grouping is wrong.** The
boundary regression alone fragments into ~7 clusters because each test emits a
different assertion message (`assert 0 == 1`, `DID NOT RAISE BadParameter`,
`5 is not in the range x>=5`, …).

## Why the infra demo looked so good

`70 × net::ERR_CONNECTION_REFUSED` collapse because the message is *identical*.
A logic regression produces heterogeneous messages, and the signature — apiName
plus the first 80 characters of the message — cannot see they share a cause.

Grouping by the deepest library frame would fix it in principle, but pytest's
default JUnit output carries **no file frames**, so that is not a cheap fix.
The signals JUnit does expose (`classname`, `message`) are not enough.

## Conclusion

The compression claim holds for **infra cascades**, not for logic regressions.
The product's defensible wedge is CI noise triage ("is this red build an outage
I can ignore, or a real failure?"), not general cause grouping.

One data point, one repository, induced regressions. It argues against the broad
grouping claim, not against the infra-triage use case.
