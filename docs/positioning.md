# Latch — positioning (v1)

## The one-liner

Latch tells you whether a red test run is **infra noise you can ignore** or a **real failure that blocks the merge**.

## The problem

- E2E suites go red for reasons that have nothing to do with the code: a down service, DNS, a network timeout.
- Developers learn to ignore red, or spend 20–40 minutes triaging before merging.
- Existing tooling (Datadog CI Visibility, BuildPulse, Trunk, Merge queues) is heavy, enterprise-priced, and gives dashboards, not a blunt decision.

## The wedge

A read-only reporter whose last line is a verdict: `Gate: PASS` or `Gate: BLOCK`. No agent, no test rewrite, no new platform. It answers one question and stops.

## Who it is for (the first ten customers)

- Teams of ~5–50 engineers.
- Running Playwright (or Jest / pytest) on CI.
- On GitHub Actions.
- Whose suite is red several times a week for infra or flake reasons.

Not enterprises (procurement kills a seed-stage sale), not solo devs (no budget).

## Why us / defensibility

- **Read-only** builds trust: it never touches the tests.
- **Code owns the decision**; the model is a replaceable judge. Cheap, no model lock-in.
- The **signature → history ledger** (seen, flake %, suppression) compounds per repository.

Honest assessment: defensibility at the *feature* level is weak. The moat, if there is one, is per-repo history, the trust of a blunt verdict, and the workflow that consumes it.

## Business model (hypothesis, to be tested)

- **Open-source CLI + reporter**: free, for adoption.
- **Hosted GitHub App**: history, suppression, flake budget, team dashboard, SSO — the paid tier.
- Price per repo or per seat; test willingness to pay before building any of it.

## What would kill it

1. Customers do not actually care enough (they tolerate red).
2. The verdict is not trusted — a false `PASS` on a real bug is catastrophic.
3. One of Datadog / Playwright / GitHub ships the wedge for free.

## Biggest risk today

**No customers.** Everything above is a hypothesis. The next dollar of effort should buy evidence, not code.
