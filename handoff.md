# Session Handoff — 2026-07-06

## Where things stand

U1, U2, U3, and U5 of the concurrent multi-feature fan-out plan (`docs/plans/2026-07-06-001-feat-concurrent-multi-feature-fanout-plan.md`) are built, tested, code-reviewed, and shipped via PR. Branch: `feat/concurrent-fanout-driver`, currently checked out, working tree clean. **PR: https://github.com/Wescome/ce-plugin/pull/1** (open, not yet merged).

**Repo footgun worth remembering:** `origin` is `Wescome/ce-plugin` (this fork); `upstream` is `EveryInc/compound-engineering-plugin`. `gh pr create` with no `--repo` flag silently defaults to the **upstream parent**, not the fork — it failed once this session with a confusing "no commits between" error before I caught it and re-ran with `--repo Wescome/ce-plugin` explicitly. Always pass `--repo Wescome/ce-plugin` on any `gh pr`/`gh issue` command in this repo.

## What's in PR #1

- **U1/U2** (`lib/governance/core.mjs`): `resolveSpecification(root, planRelPath, preloadedIdx)` resolves a plan's Specification via `.by-source.json`'s path-keyed index before falling back to the old repo-wide newest-inference (`latestSpecification`). `emitExecutionTrace`'s `sourceKey` is now `#worktree:<branch>` instead of a hardcoded constant, so concurrent worktrees don't collide.
- **U3** (`hooks/emit-trace.mjs`): reads a new `.ce-fanout-plan` marker file (gitignored) at the worktree root when present, passing its contents through to `resolveSpecification`. Absent marker → unchanged prior behavior.
- **U5** (`.claude/workflows/concurrent-fanout.mjs`, new): the actual driver. Takes `args` (an array of plan paths or Specification ids), rejects literal duplicates, caps at 20 items, and dispatches `lfg <resolved-plan-path>` per item concurrently via `parallel()`, each with `isolation: "worktree"`. Each dispatched agent self-registers the `.ce-fanout-plan` marker as its first action (the driver itself has zero filesystem access — confirmed empirically), then runs `lfg` end to end, then `ce-compound mode:headless` on a shipped outcome. Returns a structured `{status, planPath, summary, prUrl, branch}` per item.
- Governance test suite: `node hooks/test-governance.mjs` — 23 → 33 real assertions, all passing. `bun test`'s pre-existing baseline (673 pass / 37 fail from an unrelated missing `js-yaml` dep) is unchanged.
- Full `ce-code-review` (9 personas + a cross-model Codex adversarial pass) ran against the branch. Fixed: a P0 (`ce-compound` was invoked with no mode token — would hang on a blocking question with no human present in an unattended worktree; now `mode:headless`), a P1 corroborated by two reviewers (dispatch thunks had no per-item `.catch()`, so a thrown/rejected `agent()` call wasn't reconciled into a structured `errored` result — fixed), a P1 **empirically reproduced live** (a literal-duplicate item in `args` causes two worktrees to independently mint different Specification ids under the same `.by-source.json` key — a real `add/add` merge conflict, not the "pure key additions" the plan's original Key Decision assumed — fixed via duplicate rejection), plus smaller P2/P3s (marker-read error handling, a test gap, a maintainability duplication). Everything *not* fixed is written down with reasoning in the plan doc's **Scope Boundaries** section (search for "Known v1 limitations surfaced by `ce-code-review`") — don't re-litigate those, they're deliberate, not overlooked.

## The one open thread — needs a fresh session

The plan's own Verification Contract requires **AE5: a real two-item concurrent run, full pipeline** — this has **not been run yet**. It's the last unchecked box in the plan's Definition of Done.

**Why it needs a fresh session, not this one:** the `concurrent-fanout.mjs` driver depends entirely on dispatching `/lfg` via `agent()`. Earlier this session, after empirically confirming (and fixing) that this session's *installed plugin cache* was stale relative to the `lfg` fix, a same-session re-test of `agent()` dispatching `/lfg` **still failed** with the same `disable-model-invocation` error — because Claude Code loads plugin/skill definitions into memory once at session start, and that stale snapshot propagates into `Workflow`-dispatched sub-agents too, not just the top-level session. Only a genuinely new session loads the corrected state.

**First thing next session should do:**
1. Decide whether to test against the still-open PR branch or wait for merge. `.claude/workflows/<name>` resolves relative to the current checkout, so either `git checkout feat/concurrent-fanout-driver` first, or merge PR #1 to `main` first and stay on `main` — either works, merging first is cleaner if the PR is ready.
2. Pick two real target plans. Already-`implementation-ready`, unbuilt candidates found this session (still true unless something changed):
   - `docs/plans/2026-06-28-001-feat-ce-pov-skill-plan.md`
   - `docs/plans/2026-07-02-001-feat-ce-sweep-skill-plan.md`
   - `docs/plans/2026-07-02-002-feat-ce-explain-skill-plan.md`
   - `docs/plans/2026-06-29-001-feat-shared-repo-grounding-cache-plan.md`
   - `docs/plans/2026-06-18-001-refactor-unified-plan-doc-artifact-plan.md`
3. Invoke: `Workflow({ name: "concurrent-fanout", args: ["<plan-path-1>", "<plan-path-2>"] })`.
4. **This is a real, consequential run** — two real worktrees, two full `lfg` pipelines (implementation, review, browser test, real `git push`, real PR creation, CI-watch-and-repair), not a dry run. That's expected and already authorized (the user chose this path explicitly), but worth being deliberate about timing/attention since it opens real PRs autonomously.
5. Watch for exactly what the Verification Contract asks: AE1 (one item's block doesn't stop the other), AE3 (a pre-existing unresolved refuted Verdict blocks a new worktree, accepted v1 blast radius), AE5 (both items reach a terminal state — shipped or explicitly blocked — never a hang).
6. Once confirmed, update the plan doc's Verification Contract row and Definition of Done checkbox for the "Fan-out smoke test" item, and decide whether `docs/dogfood-reports`-style output or just the driver's own returned summary is sufficient record.

## Uncommitted state right now

None — working tree is clean, everything is committed and pushed to the `feat/concurrent-fanout-driver` branch, PR #1 is open.

## Standing operating notes (already in memory, not repeating in full)

Full detail lives in `/Users/wes/.claude/projects/-Users-wes-Developer-ce-plugin/memory/` — `MEMORY.md` is the index. Headlines: never hand-roll what a `ce-*` skill already does; never self-grade, dispatch an independent agent or verify directly; check `rm -f` globs before running them; verify external-doc (docx/brief) claims against actual source before trusting them; when a design workaround exists only because of a limitation in a skill this fork owns, fix the skill at the source rather than routing around it.
