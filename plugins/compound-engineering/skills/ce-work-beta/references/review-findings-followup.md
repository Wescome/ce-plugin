# Apply Code Review Findings (after `ce-code-review`)

Load this reference when Tier 2 `ce-code-review` has finished and **ce-work-beta** should apply fixes before the Residual Work Gate.

`ce-code-review` is **review-only** — it reports findings and writes artifacts; it does not mutate the checkout, commit, push, or file tickets. **The caller owns apply/fix policy.**

## Consume the completed review (do not re-run it)

This reference loads **after** review has run. In the ce-work-beta Tier 2 path, step 2a already invoked `ce-code-review`; this apply step **consumes that output** — do not start a second review, which would waste reviewer dispatches and risk overwriting the artifact the Residual Work Gate reconciles.

Reuse the review output already in hand:

- Parsed JSON (`status`, `actionable_findings`, `findings`, `artifact_path`, `run_id`) **or** the markdown Actionable Findings summary captured by the caller
- Run artifact dir: `/tmp/compound-engineering/ce-code-review/<run-id>/` (`review.json`, per-reviewer JSON for `why_it_matters`)

If `status` is `failed`, stop shipping and surface `reason`. If `degraded`, note partial reviewer coverage before applying anything.

### Fallback — invoke review only for cold callers

Only when the caller reached this file **without** already running review (no review output in hand): invoke `ce-code-review` once, then proceed to apply. Do not invoke when the caller already ran review (e.g., ce-work-beta Tier 2 step 2a).

Invoke the skill explicitly — do not treat a casual "review my changes" prompt as a substitute unless the harness routed it to `ce-code-review`.

```
ce-code-review mode:agent plan:<plan-path> base:<merge-base-or-ref>
```

- `mode:agent` — JSON output (`review.json` + primary JSON response) for programmatic parsing; same review pipeline as default.
- `plan:` — when Phase 1 used a plan file (requirements completeness).
- `base:` — when the diff base is already resolved on the current checkout; omit when reviewing a PR number/URL or standalone current branch.
- Do **not** pass deprecated `mode:autofix`.

For human / interactive shipping, invoke `ce-code-review` without `mode:agent` if markdown tables are preferred. Capture the same JSON / Actionable Findings and artifact dir listed above before applying.

## Inputs for apply

- `actionable_findings` from JSON, or the Actionable Findings section from markdown
- Full finding detail when needed: `review.json` / artifact `findings`, or `{reviewer}.json` for `why_it_matters` and `evidence`
- Stable finding `#` — reuse in commits, residual sinks, and subagent prompts

## What to apply

Apply a finding in the working tree only when **all** of the following hold:

1. **`suggested_fix` is present** — the reviewer committed to a concrete change shape.
2. **`confidence` is `100`, or `75` with cross-persona agreement noted in the report** — do not apply anchor-50 findings.
3. **The fix is mechanical** — one coherent change, no contract/permission/security posture change, no new public API shape, no behavior change that needs product sign-off. When unsure at filter time, skip and leave the finding for the Residual Work Gate.
4. **Evidence still matches the code** — verified by whoever applies the edit (usually a fix subagent at `file:line`). The orchestrator does **not** open files just to decide eligibility or dispatch.

Classify at apply time using the rules above — do not treat `autofix_class` as permission to auto-apply.

## What not to apply

- `autofix_class: manual` without a clear mechanical `suggested_fix`
- `autofix_class: advisory` — report-only
- `gated_auto` findings that change behavior, contracts, auth, or permissions
- Anything the user would need to walk through in a design conversation

## Execution — orchestrator batches, subagents apply

The orchestrator **does not investigate findings** (no pre-read of cited files to judge complexity or inline vs subagent). That would spend the context window you are trying to protect.

**Orchestrator owns:** parse review output → **eligibility filter on JSON fields only** → build batches → dispatch fix subagents → review diffs → tests → commit → Residual Work Gate.

**Fix subagents own:** read `file:line`, confirm evidence still matches, apply or skip with reason, return summary.

### Default: batched fix subagents

After eligibility filtering, **dispatch subagents for all remaining applicable findings** unless the optional inline shortcut below applies. Do not classify findings by complexity in the parent thread.

**Batching (primary rule — group by file):**

1. Sort applicable findings by severity (P0 first).
2. **Group by `file`.** All eligible findings on the same file → **one subagent** (it loads the file once and works through its `#` list in severity order).
3. **Parallel waves:** batches with **disjoint file sets** may run in parallel (same worktree / shared-directory rules as Phase 1 Step 4 in `ce-work-beta` SKILL.md).
4. **Same file, many findings:** keep one subagent per file. If the prompt would exceed a comfortable size (~8 findings), split into **serial** subagent passes on that file (first batch highest severity, then next batch after merge or after the prior agent returns).
5. **Cross-file coupling:** do not merge unrelated files into one subagent just to reduce agent count — file grouping is the default. Only co-batch multiple files when findings explicitly reference the same small edit surface (rare); when in doubt, separate by file.

**Subagent prompt (per batch):** the assigned findings only (`#`, severity, file, line, title, `suggested_fix`, `requires_verification`; add `why_it_matters` from `{reviewer}.json` in the run artifact when useful), plus:
- Work through assigned `#` in severity order; at each `file:line`, skip with a one-line reason if evidence no longer matches
- Apply the mechanical bar from § What to apply / What not to apply — skip anything that needs design judgment
- Do not re-run `ce-code-review`
- Shared-directory fallback: do not stage or commit — return which `#` were applied or skipped and which files changed

**After each wave:** orchestrator reviews diffs (scope = assigned `#` only), runs tests (`requires_verification: true` on any applied finding → at least targeted tests; multi-file → broader suite), commits (`fix(review): apply findings #…`) unless worktree-isolated subagents merge per Phase 1. Repeat until all batches complete.

### Optional inline shortcut (skip subagent spawn)

Use **only** when **all** of the following hold:

- Exactly **one** eligible finding after JSON filtering, **and**
- The orchestrator **already** has that file's relevant region in context from Phase 2 work this session (no new Read/Grep expedition)

Otherwise dispatch a subagent — even for a single finding. When unsure, dispatch.

### Summary (required)

Report: batches dispatched, `#` applied vs skipped (with reasons from subagents), artifact path, tests run.

## Handoff to Residual Work Gate

Any actionable finding not applied in this pass is **residual work** — proceed to the Residual Work Gate with an updated count. Do not re-invoke `ce-code-review` solely to re-apply the same findings unless the diff changed materially after fixes.
