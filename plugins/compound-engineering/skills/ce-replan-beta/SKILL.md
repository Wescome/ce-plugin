---
name: ce-replan-beta
description: "[BETA] Replan from an existing PR after new learnings have emerged. Re-grounds at the brainstorm tier — re-walks the user story and re-questions original requirements rather than patching the existing plan in place. Produces a fresh plan doc naming what to discard, what to cherry-pick from the existing PR, and the revised approach. Original PR is preserved as a superseded artifact; no Git execution. Use when a PR's approach has been outgrown by review back-and-forth, code reading, or a new brainstorm. Invoke with /ce-replan-beta [PR number, or blank for current branch's PR]."
disable-model-invocation: true
argument-hint: "[PR number, or blank for current branch's PR]"
---

# Replan from an Existing PR (Beta)

`ce-brainstorm` defines **WHAT** to build. `ce-plan` defines **HOW** to build it. `ce-work` executes. `ce-replan-beta` is for the moment when an existing PR's approach has been outgrown by new learnings — review back-and-forth, code reading, a new brainstorm, or a "this could be much simpler" realization — and the original plan is grounded in assumptions that no longer hold.

This skill produces a fresh plan doc. It does **not** execute Git operations. The original PR and original plan remain untouched on disk and on GitHub; the new plan supersedes them by reference. The user starts a fresh branch from `main` themselves.

The core move is **re-grounding at the brainstorm tier**, not patching the existing plan in place. Treat the original plan and PR as evidence to interrogate, not as authoritative framing to inherit.

## Input Argument

<input> #$ARGUMENTS </input>

| Argument | Mode |
|----------|------|
| Blank | **Auto-detect** — target the current branch's PR |
| PR number (e.g., `1234`) | **Explicit** — target the named PR |

**If no PR can be found** (blank argument and no PR for current branch, or explicit PR number does not exist or is inaccessible), do not write a plan. Explain the constraint and route the user to `ce-plan` for fresh planning or `ce-brainstorm` if the work is upstream of planning.

## Phases

The full workflow is split across three phase blocks. Phase content is wired in this file; reference material loads on demand.

- **Phase 0 — Mode detection** establishes which PR is being replanned.
- **Phase 1 — Discovery** runs the three scripts under `scripts/` to gather PR metadata, review threads, and the original plan doc.
- **Phase 2 — Re-grounding** loads `references/regrounding-workflow.md` and re-derives the user story from artifacts.
- **Phase 3 — Synthesis checkpoint** surfaces the re-derivation for user confirmation (or routes Inferred bets to `## Assumptions` in pipeline mode).
- **Phase 4 — Write plan doc** uses `references/doc-template.md` to compose the output and writes to `docs/plans/`.
- **Phase 5 — Handoff** offers `ce-work` start, Proof open, or stop.

The detailed phase instructions are written below in the section headers `## Phase 0` through `## Phase 5`. Read them in order on each invocation.

> **Note:** This is a beta skill. The invocation contract, doc shape, and discovery heuristics may change before promotion to a stable `ce-replan`. See `docs/solutions/skill-design/beta-skills-framework.md` for the framework.
