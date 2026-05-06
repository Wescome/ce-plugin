# Replan Output Template

Loaded by `ce-replan-beta`'s Phase 4b. The skill writes the new plan to `docs/plans/` using the filename and frontmatter conventions documented here. The original plan and PR are **never** edited.

## Always-from-`main` rule (load-bearing)

Plan units must be written for the **`main` baseline**, not the existing PR's branch. Specifically:

- `Files:` references treat `main` as the starting point. Any file that exists only on the original PR's branch (and not on `main`) must be named in `## Cherry-Pick Guidance` — the unit that depends on it either creates the file fresh or cherry-picks it from the original PR.
- `Approach:` paragraphs do not assume any code, IDs, helpers, or designs from the original PR are already in place. If a unit reuses something from the PR, the reuse is named explicitly: *"Reuses `path/to/file.tsx` from PR #N commit `<sha>` — see Cherry-Pick Guidance."*
- Plan units' `Test scenarios:` are written for the from-`main` baseline. They do not reference test setup that exists only on the PR's branch.

The cora session (`10b929fb-c03f-4daf-b675-32c00ac44b43`, PR #2382) failed this rule and forced ce-work to ask the user about branch base. Adhering to the rule here prevents the same failure mode.

## Filename pattern

```
docs/plans/YYYY-MM-DD-NNN-replan-<topic>-beta-plan.md
```

- `YYYY-MM-DD` — today's date.
- `NNN` — three-digit sequence number for the day, starting at `001`. Check existing files for today's date to determine the next number.
- `replan-` prefix marks this as replan output (parallel to `feat-`, `fix-`, `refactor-`).
- `<topic>` — kebab-cased short label derived from the new approach (3-5 words).
- `-beta-plan.md` suffix is mandated by the beta-skills framework so output never collides with stable `ce-plan` output.

Example: `docs/plans/2026-05-06-002-replan-ce-replan-beta-beta-plan.md`

## Frontmatter contract

```
---
title: "<short replan title>"
type: replan
status: active
date: YYYY-MM-DD
origin: <repo-relative path to the forked brainstorm — or to the original brainstorm when Phase 2a was skipped>
supersedes: <repo-relative path to the original plan>
original_pr: <PR number or URL>
---
```

- `type: replan` distinguishes the doc from regular `feat`/`fix`/`refactor` plans for downstream tooling.
- `origin:` is the **forked brainstorm** when the re-brainstorm phase ran, or the original brainstorm when it was skipped (no upstream brainstorm existed). The `find-original-brainstorm.sh` script's output feeds this field for the skipped case.
- `supersedes:` and `original_pr:` carry the lineage so the chain of revolutions stays walkable.

## Section order

```markdown
---
title: "<short replan title>"
type: replan
status: active
date: YYYY-MM-DD
origin: docs/brainstorms/...
supersedes: docs/plans/...
original_pr: <N>
---

# <Replan Title>

## Summary

[1-3 line forward-looking gloss of the new approach. Names what the replan does, not what the original PR was doing.]

---

## Re-Grounded Problem Frame

[Backward-looking. Re-derived from PR discussion + new learnings. Names the moment of pain that motivated the replan, what the user thought before, and what changed in their understanding.]

---

## Requirements

[Cite R-IDs from `origin:` (the forked brainstorm or original brainstorm). NO per-requirement [unchanged]/[revised]/[discarded] annotation block — that lives in the forked brainstorm at the requirements scope.]

- R1, R2, R4, R7 (active R-IDs from `origin:`).

**Origin actors:** A1 (..., from origin)
**Origin flows:** F1 (..., from origin)
**Origin acceptance examples:** AE1, AE3, AE4 (from origin)

---

## Discarded Approaches

[2-4 named approaches from the original PR that the replan abandons. Each entry names the approach, the specific learning that ruled it out, and where its artifacts (commits, files, designs) are addressed downstream — typically in Cherry-Pick Guidance for what survives, or simply marked obsolete for what doesn't.]

- **<Approach name>**: <What it was, in 1-2 sentences.> **Why discarded**: <The specific learning — review thread, code reading, brainstorm finding — that made this approach wrong.>

---

## Cherry-Pick Guidance

[Concrete list of files, commits, designs, IDs, or migrations from the original PR worth preserving. **The canonical place to name code that exists only on the original PR's branch — units below that reference these items must do so by linking back here, never by assuming the items are already on `main`.**]

| Item | Type | Source | Why preserve |
|------|------|--------|--------------|
| `path/to/file.tsx` | UI component | PR #N commit `<sha>` | Visual/functional layer is independent of the storage choice. |
| Migration `2026XXXXXXXXXX_create_thing.rb` | Schema | PR #N commit `<sha>` | Already shipped to staging; safe to keep. |
| Issue tracker IDs `CE-1234`, `CE-1235` | Tracking | PR description | Reuse so the replan inherits the existing trail. |

---

## Supersedes

- **Original PR:** #<N> (<title>) — left open and untouched on GitHub. The user decides whether to close the original as superseded, force-push the replan over it, or land the original first.
- **Original plan:** <repo-relative path>
- **Original brainstorm:** <repo-relative path, when applicable>
- **Diff from original**: [2-3 sentences describing what is changing in approach. Not a summary of the new plan — a contrast with the old.]

---

## New Learnings

[Inventory of what changed in understanding since the original plan was written. Each entry names the source so future readers can verify.]

- **<Learning, in plain language>** — Source: <PR thread URL, commit SHA, brainstorm path, or "current session conversation">

---

## Scope Boundaries

[Carry forward original scope where still relevant; mark new exclusions tied to discarded approaches.]

- <Excluded item>
- <Newly excluded item, tied to a discarded approach>

### Deferred to Follow-Up Work

- <Plan-local follow-up work split into a separate PR>

---

## Context & Research

### Relevant Code and Patterns

- <Existing files to follow>

### Institutional Learnings

- <Relevant `docs/solutions/` insight>

### External References

- <Used only when external research was warranted>

---

## Key Technical Decisions

- <Decision>: <Rationale; reference the original plan's decision when this overrides it>

---

## Implementation Units

[Standard `ce-plan` format. Each unit gets a stable U-ID. When a unit reuses code from the original PR, name it in the unit's `Approach:` field and link back to Cherry-Pick Guidance.]

- U1. **<Name>**

**Goal:** <What this unit accomplishes>

**Requirements:** <R-IDs from `origin:`, e.g., R1, R4>

**Dependencies:** <None / U-IDs / external prerequisite>

**Files:**
- Create: `path/to/new_file`
- Modify: `path/to/existing_file`
- Test: `path/to/test_file`

**Approach:**
- <Key decision>
- <Cherry-pick reference: "Reuses `path/...` from original PR commit `<sha>` — see Cherry-Pick Guidance.">

**Patterns to follow:**
- <Existing file or convention>

**Test scenarios:**
- <Scenario>

**Verification:**
- <Outcome that should hold when this unit is complete>

---

## Suggested Branch Name

`replan/<topic-slug>` — start the new branch from `main`:

```
git checkout main
git pull
git checkout -b replan/<topic-slug>
```

The user runs the above; this skill performs no Git operations.

---

## Sources & References

- **Origin (forked brainstorm or original brainstorm):** <repo-relative path>
- **Original PR:** #<N> <title> — <URL>
- **Original plan:** <repo-relative path>
- **Re-grounding context:** <PR threads, brainstorm paths, conversation references that drove the replan>
```

## Discipline checks

Before writing the plan to disk, verify:

- Every plan unit's `Files:` and `Approach:` references treat `main` as baseline. Code on the original PR's branch is named in Cherry-Pick Guidance — never silently assumed.
- Discarded Approaches each name a specific learning, not generic "wasn't quite right" rationale.
- Cherry-Pick rows specify what to preserve and why — not just "keep the UI work."
- Original PR, original plan, and original brainstorm are referenced but not edited.
- Suggested branch name does not match the original PR's branch.
- All file paths are repo-relative, never absolute.
- Filename uses the `replan-<topic>-beta-plan.md` shape.
- R-ID references point to the doc named in `origin:` (forked brainstorm or original); they resolve cleanly.

## Non-goals for this template

- Per-requirement annotation. That lives in the forked brainstorm; the plan only references R-IDs.
- Carrying forward implementation units from the original plan verbatim. Units are derived fresh from the (forked) brainstorm; if a v1 unit's work is still right, it's still re-stated as a unit here, not "carried forward."
- Documenting the verb-level decision to replan. The skill's user has decided; the plan is the artifact, not the justification.
