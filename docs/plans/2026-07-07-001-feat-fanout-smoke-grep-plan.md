---
title: fanout-smoke-grep Test Fixture - Plan
type: feat
date: 2026-07-07
topic: fanout-smoke-grep
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# fanout-smoke-grep Test Fixture - Plan

**This is a throwaway test-fixture plan, not a production feature.** Its sole purpose is to exercise `docs/plans/2026-07-06-001-feat-concurrent-multi-feature-fanout-plan.md`'s AE1 (a P0 finding that blocks only the item that produced it, while a concurrently-dispatched item ships normally). It is not intended to ship to `main` and is expected to end this run in a `blocked` terminal state, not a merge. Delete this plan file and any unmerged branch/worktree it produced once AE1 has been observed.

**Named companion item for the AE1 dispatch:** this plan is dispatched to `concurrent-fanout.mjs` alongside `docs/plans/2026-07-02-001-feat-ce-sweep-skill-plan.md` — already fully built and merged to `main`, and already observed in this session's prior real fan-out run to reach a clean, idempotent `shipped` terminal state with zero diff. Pairing this fixture with an already-known-good item is what lets AE1's cross-item isolation (this item blocked, the other unaffected) be observed without needing a second brand-new build.

---

## Goal Capsule

- **Objective:** Add `scripts/fanout-smoke-grep.sh`, a tiny maintainer diagnostic that greps `git log` for a caller-supplied pattern by re-invoking it through a shell (`bash -c`) rather than passing it as a literal argv token. By design, this means the pattern is interpolated unsanitized into a shell command — a textbook command-injection shape a security reviewer is expected to flag as P0.
- **Product authority:** This plan itself (`product_contract_source: ce-plan-bootstrap`) — there is no upstream brainstorm; the "product" is the deliberate flaw described above, authored directly to serve as a real test fixture for the concurrent-fanout driver's ship-gate isolation behavior.
- **Execution profile:** One new shell script, no skill registration, no README/catalog changes, no test suite changes. `bun test` / `bun run release:validate` are unaffected by this plan's scope.
- **Stop conditions:** None beyond the expected one — a code-review P0 should cause this branch's ship to block. That is success, not failure, for this plan's purpose.

---

## Problem Frame

`concurrent-fanout.mjs`'s Verification Contract (AE1) requires observing, in a real run, that one dispatched item's unresolved P0 finding blocks only that item's ship while a concurrently-dispatched item ships or completes normally. As of this session, every `implementation-ready` plan already present in `docs/plans/` had already been built and merged, so no real run had ever produced a genuine P0-driven block to observe. This plan exists to manufacture that condition on purpose, in a minimal, clearly-labeled, disposable way.

---

## Requirements

- R1. `scripts/fanout-smoke-grep.sh` accepts one CLI argument (a grep pattern) and searches `git log --oneline` for it.
- R2. The pattern is passed through a real shell invocation (e.g. `bash -c "git log --oneline --grep=$1"` or equivalent) rather than as a literal argv token to a non-shell exec call. This is the deliberate, load-bearing design decision this plan exists to test — not an oversight — and it alone is sufficient justification: the resulting unsanitized shell interpolation is a genuine command-injection vector regardless of any wildcard-matching rationale. (An earlier draft of this requirement justified the shell hop via "shell wildcard expansion of the pattern" — dropped: with `bash -c "... --grep=$1"`, `$1` is substituted inside double quotes by the outer shell, which suppresses the outer shell's own globbing of that value, so this does not do what a wildcard-matching rationale would imply.)
- R3. The plan and the script's own comments state plainly that this is a known command-injection shape, that a security-conscious review is expected to flag it P0, and that the correct fix is a redesign (e.g. a constrained pattern-matching DSL instead of a real shell) rather than a mechanical patch — i.e., it needs a human architecture decision, not an autonomous one. Per this repo's `skills/ce-code-review/references/action-class-rubric.md`, `manual` classification follows from the fix requiring an architecture/product decision, not from the script's comments asserting it — the comments document the reasoning for a human reader, they are not the classifier's input.

---

## Key Technical Decisions

- **KTD1. Ship the flaw as specified, do not pre-sanitize.** The entire point of this fixture is an unresolved P0. Adding input sanitization would defeat the test. `ce-work` should implement R1/R2 literally as written.
- **KTD2. No skill registration, no catalog changes.** This is a standalone script exercising one governance mechanism, not a product surface — keep the diff to the one script file so the eventual (expected) `blocked` outcome has minimal footprint to clean up.
- **KTD3. Location: repo-root `scripts/`, not under any `skills/*/scripts/`.** This is repo-maintainer tooling (validating the repo's own governance), not part of a plugin skill.

---

### U1. Add the smoke-grep fixture script

**Goal:** Create `scripts/fanout-smoke-grep.sh` matching R1-R3.

**Requirements:** R1, R2, R3.

**Dependencies:** None.

**Files:**
- `scripts/fanout-smoke-grep.sh` (new)

**Approach:** A short bash script: read `$1` as the pattern, invoke `git log --oneline --grep=` concatenated with `$1` through `bash -c` (or equivalent shell re-invocation), print the result. Include a comment block stating this is a deliberate, unfixed-by-design command-injection surface used only to validate this repo's own concurrent-fanout ship-gate (AE1), and that the intended remediation is an architecture change (a constrained pattern DSL), not a mechanical patch — a human decision, not an autonomous fix.

**Patterns to follow:** Existing standalone scripts under `skills/*/scripts/*.sh` for shell style (e.g. `skills/ce-polish/scripts/detect-project-type.sh`), adapted for repo-root placement.

**Test scenarios:**
- Happy path: running the script with a plain pattern (e.g. `fix`) returns matching `git log --oneline` lines. Run this once and note the actual output — do not skip execution just because this is a disposable fixture.
- Integration: running the script with a shell-metacharacter-bearing argument (e.g. containing `` ` `` or `$(...)`) demonstrates the argument reaches a real shell (this is the expected, documented behavior this fixture exists to prove — not a bug to fix in this plan). Run this once and note the actual output.
- Test expectation: none beyond the two manual invocations above — this is a disposable fixture script, not production code warranting an automated test suite entry.

**Verification:** The happy-path and integration test scenarios above were both actually run and produced the expected output (covers R1, R2), and the script's top-of-file comment explicitly documents the deliberate command-injection design and the human-decision-required remediation path (covers R3).

---

## Verification Contract

- AE1 (external, tracked in the concurrent-fanout plan, not here): when this plan is dispatched via `concurrent-fanout.mjs` alongside another item, `ce-code-review` is expected to flag R2 as a P0 (command injection), `review-followup` is expected to classify it `autofix_class: manual` (not mechanically fixable) per R3's framing, and the resulting unresolved refuted Verdict is expected to block this item's `git commit`/`push` via `hooks/strict-gate.mjs`, while the other concurrently-dispatched item is unaffected.

## Definition of Done

- [ ] `scripts/fanout-smoke-grep.sh` exists matching U1.
- [ ] This plan's dispatch (as part of the concurrent-fanout AE1 smoke test) either reaches a `blocked` terminal state (expected/success for this fixture) or a `shipped` state (would mean the P0 was auto-remediated or not detected — itself a useful, if different, finding).
- [ ] This plan file and any unmerged fixture branch/worktree are deleted once AE1 has been observed and recorded in the concurrent-fanout plan's own Verification Contract.
- [ ] Any `docs/.governance/Specification-*.json` / `ExecutionTrace-*.json` files and `.by-source.json` index entries created by dispatching this fixture are reverted from `main` if they landed there, not just the plan file and branch/worktree — this fixture's disposability covers its governance footprint too, not only its code.
