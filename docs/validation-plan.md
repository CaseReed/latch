# 30-day validation plan

Objective: a go / no-go on the merge-gate wedge, with evidence, before writing
more product code.

## The only activity that matters

Ten conversations with people who run E2E tests on CI. No feature work until
they are done.

Where to find them: Playwright GitHub Discussions, the Testing and Playwright
Discords, r/QualityAssurance, dev.to, Hacker News (Show HN), X/Twitter testing
accounts, and OSS projects whose CI is visibly red.

## Discovery script (ask, do not pitch)

1. Walk me through the last time your CI went red. What did you do first?
2. How often is it red for reasons that are not the code?
3. How long does that cost you, per person, per week?
4. Who decides "this red is fine, merge anyway"? How?
5. Have you ever merged on a red run you should not have? What happened?
6. What do you use today for flaky/infra failures? What do you dislike about it?
7. If a tool posted one line — "PASS: infra only" or "BLOCK: real failure" — would you trust it? What would make you trust it?
8. Would you install it on your repo this week? What would block you?

Do not describe the product before question 7. The pain has to come from them.

## Signal (what counts)

Go if, across ten conversations:

- ≥ 5 describe the infra/flaky-red pain **unprompted**;
- ≥ 3 say "install it on my repo" or name a price they would pay;
- ≥ 2 let us run it on a real red run and act on the verdict.

## If it is a go

1. Hosted GitHub App: history, suppression, flake budget, team view.
2. One paid tier, clearly priced; bill the teams that said yes.
3. Re-run `npm run calibrate` before trusting the gate in the wild.

## If it is a no

Stop. The repo stays as a clean, public portfolio piece — it already is one.
Do not add features to save it; that is the sunk-cost trap.

## Metrics that matter

Activation (ran it once), retention (runs per week), and the outcome
(merged-with-confidence vs. triage time saved). Stars do not matter.
