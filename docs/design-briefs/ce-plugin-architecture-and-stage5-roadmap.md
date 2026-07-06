---
title: "ce-plugin: architecture, the four-step loop, and a path to Stage 5"
date: 2026-07-06
status: draft
---

# ce-plugin: How It Works, the Four-Step Loop, and a Path to Stage 5

This brief documents three things as of this fork (`Wescome/ce-plugin`, `main` @ `76e4e0d4`): how the plugin is actually built and distributed, how its skills implement the compound-engineering four-step loop, and — grounded in what was verified by reading the actual skill files, not assumed — what it would take to reach "Stage 5" cloud/parallel execution as defined in [Every's Compound Engineering guide](https://every.to/guides/compound-engineering).

## 1. How ce-plugin works

**Packaging.** `compound-engineering` is a Claude Code plugin: a `.claude-plugin/plugin.json` manifest plus component directories at the plugin root (`skills/`, `hooks/`). It is distributed via a marketplace catalog (`.claude-plugin/marketplace.json`, `source: "./"`), so `claude plugin marketplace add <owner>/<repo>` + `claude plugin install compound-engineering@<marketplace-name>` is what actually enables it — persistently, in `~/.claude/settings.json`'s `enabledPlugins`, and copied into a local, self-contained cache (`~/.claude/plugins/cache/.../<version>/`) that keeps working even if the source repo later disappears.

**Component inventory** (verified via `claude plugin details`): **29 skills** (all `ce-*` or `lfg`, no bare `code-review`/`simplify` — those are a separate, unrelated built-in Claude Code capability), **0 agents**, **3 hooks** (`PostToolUse`, `PreToolUse`, `Stop`), **0 MCP/LSP servers**.

**Skills vs. hooks — the one architectural distinction that matters.** Skills are model-judged: the agent chooses whether to invoke `ce-compound` or not. Hooks are harness-enforced: they fire automatically on a lifecycle event regardless of what the model wants. This fork's addition uses that distinction deliberately —

**The governance layer (this fork's addition — `hooks/`, `lib/governance/`).** A `PostToolUse(Write|Edit)` hook (`emit-governance.mjs`) classifies written files by path (`docs/plans/` → `Specification`, `docs/solutions/` → `Learning` (+`Hypothesis`/`Amendment` on the bug track), `docs/ideation/` → `CandidateSet` + `ElucidationArtifact`, a P0 review finding → a `refuted` `Verdict`, etc.) and writes append-only, content-addressed JSON nodes to `docs/.governance/`. A `Stop` hook (`emit-trace.mjs`) captures the turn's git diff as an `ExecutionTrace`, linked to the most recent `Specification`. A `PreToolUse(Bash)` hook (`strict-gate.mjs`) hard-blocks (`exit 2`) `git commit`/`push`/`gh pr create` while any `Verdict` node is `refuted` and unresolved — a real ship gate, not a suggestion, because it's a hook rather than a skill instruction an agent could forget or rationalize past.

This was proven live, not just unit-tested: a real `claude --plugin-dir` session (driven through a pty via `tmux`, to get genuine authentication rather than a sandboxed API key) wrote a file under `docs/plans/`, producing a `Specification-*.json` node, and a real `/ce-compound` run documenting the governance system's own symlink bug (`docs/solutions/logic-errors/governance-hook-macos-tmpdir-symlink-path-mismatch.md`) drove the hook to emit real `Learning`/`Hypothesis`/`Amendment` nodes and two `CONCEPTS.md` entries — the system governing its own construction as its first real output.

## 2. Governance layer, in full (per `BRIEF-FF-CE-GOVERNANCE-FORK-001`, corrected against the code)

The paragraph above is the shape; this section is the design brief for the governance layer (v1.0, "Verified on-device (macOS)"). Its node/lineage format happens to match a separate personal project (FunctionFactory), but this fork is an independent artifact in its own right, not a disposable or dependent scaffold for that project. The docx brief itself is stale in a couple of places — corrected below against `lib/governance/node-id.ts`, the actual source of truth, rather than repeated as given.

**Thesis.** A purely additive layer that makes the vendored plugin's durable outputs enter an append-only, content-addressed lineage format automatically — enforced by deterministic hooks that fire regardless of agent cooperation, not by prompt instructions a skill may skip.

**Why this exists (SE-Onto diagnosis).** CE was diagnosed as a *Knowing-State Prosthesis* that satisfies externalization and continuous-maintenance but treats retrieval as advisory and leaves review non-blocking — fudging retrieval-enforcement and failing fail-closed coupling. It also breaks append-only, content-addressed lineage: learnings mutate in place and identity is a dated filename, not a content hash. The governance layer targets exactly those two gaps and nothing else — it is scoped to the fork's own additions (hooks, executable core, node model); CE's skills are untouched, no `SKILL.md` was edited, the `src/` converter is untouched, MIT is retained, nothing pruned.

**Node types & identity model.** The docx claims nine node types; the code (`lib/governance/node-id.ts`, the `GovernanceNodeType` union — verified by reading the file, not assumed) actually defines **ten**: `Specification`, `AtomDirective`, `ExecutionTrace`, `Learning`, `ElucidationArtifact`, `Hypothesis`, `Amendment`, `Verdict`, `Divergence`, `CandidateSet`. `AtomDirective` doesn't appear in the docx's list at all — the brief is stale against its own implementation. Identity is `sha256(type ‖ canonical(content))`, first 32 hex — same content ⇒ same id ⇒ idempotent. Nodes are never overwritten; a re-write of the same source is a successor node carrying a `LINEAGE` edge to its predecessor. Store: `docs/.governance/<Type>-<hash>.json` plus a `.by-source.json` index resolving successor chains.

**Enforcement mechanism.** Three command hooks fire at tool-lifecycle events, independent of whether the agent "remembers" to record anything:

| Hook | Trigger | Effect |
|---|---|---|
| `emit-governance.mjs` | `PostToolUse` (Write\|Edit) | Content-hashes the written artifact and emits an append-only node |
| `strict-gate.mjs` | `PreToolUse` (Bash) | Exit 2 (hard block) on ship verbs while an unresolved `refuted` Verdict exists |
| `emit-trace.mjs` | `Stop` (turn end) | Emits an `ExecutionTrace` from the git diff, linked to the active Specification |

**Coverage model** (path/verb/content classification):

| Written surface / action | Emits |
|---|---|
| `docs/plans/`, `STRATEGY.md` | `Specification` (+ `LINEAGE` successor on rewrite) |
| `docs/ideation/` | `CandidateSet` + `ElucidationArtifact` (rejections typed to a closed enum) |
| `docs/solutions/` | `Learning`; bug-track docs also emit `Hypothesis` + `Amendment` |
| `docs/pulse-reports/` | `ExecutionTrace` (kind: pulse) with window provenance |
| `docs/brainstorms/riffrec-feedback/` | `Divergence` |
| `experiment-log.yaml` / `result.yaml` | `CandidateSet` / `Verdict` (regression ⇒ refuted ⇒ blocks ship) |
| Review findings JSON (content-sniffed) | `refuted` Verdict per P0 finding |
| Ship verbs: `git commit`/`push`, `gh pr create` | Gated by the refuted-Verdict check |

Coverage is by surface, not skill enumeration — any new skill writing a governed path or running a ship verb is covered automatically. At vendoring (pkg v3.15.0) the plugin exposed 26 user-invoked skills; 22 have a governed surface, and 4 (`promote`, `proof`, `setup`, `worktree`) produce no durable governed output.

**Named invariants.**

- **INV-1 Structural enforcement.** Governance is emitted by hooks (code), never by instructions in a skill body.
- **INV-2 Content-addressed identity.** Every node id is a hash of its type and canonicalized content.
- **INV-3 Append-only lineage.** Nodes are immutable; change is a successor plus a `LINEAGE` edge, never mutation in place.
- **INV-4 Fail-closed ship boundary.** An unresolved refuted Verdict hard-blocks commit/push/PR (exit 2).
- **INV-5 Additive-only.** No `SKILL.md` is edited and no CE behavior is altered.
- **INV-6 Symlink-normalized paths.** Repo root and file path are realpath-resolved on both sides before computing the repo-relative path.

**The symlink bug — a fail-open that mattered.** Root cause: `os.tmpdir()` returns `/var/folders/…` while `process.cwd()` resolves to `/private/var/…`; without `realpath`, `relative()` produced a `../`-prefixed path, `toRepoRel` fell back to basename, and `classifyPath` returned `null` — the emission hook silently no-op'd. A hook that quietly emits nothing is the worst failure mode for this system: it fails open. The fix (`realpathSync` on both sides) restores fail-closed behavior and is now INV-6.

**Forced placement — why hooks, not the alternatives:**

| Alternative | Why foreclosed |
|---|---|
| Prose in `SKILL.md` ("emit a node") | Advisory and skippable — the exact retrieval-as-advisory failure diagnosed in CE |
| Modify CE's `src/` converter | Install-time, not run-time; couples the fork to upstream internals that churn heavily, guaranteeing merge pain on every update |
| Command hooks (chosen) | Deterministic at the tool lifecycle, zero-build, additive; survive upstream updates because they touch no CE file |

**Verification status** (stated at honest granularity — proven vs. heuristic vs. asserted-but-not-yet-live):

| Check | Result |
|---|---|
| Smoke gate (`node hooks/test-governance.mjs`) | 22/22 assertions, all pass, exit 0 |
| Live harness (macOS, real login via pty) | Write → Specification node; Stop → ExecutionTrace node, on disk |
| Dogfood via `/ce-compound` on the symlink bug | Learning + Hypothesis + Amendment + ExecutionTrace emitted automatically |
| `governedBy` link | Heuristic (latest Specification); candidates recorded; **not** a guarantee |
| X3 optimize / X4 pulse / X5 riffrec branches | Covered by the assertion suite; **not yet exercised in a live session** |

## 3. The four-step loop

The guide's core loop — **Plan → Work → Review → Compound**, with the stated philosophy *"each unit of engineering work should make subsequent units of work easier — not harder"* and an 80/20 time split (Plan+Review vs. Work+Compound) — maps directly onto this repo's skill names:

| Stage | Skills | What it does |
|---|---|---|
| **Plan** | `ce-brainstorm`, `ce-ideate`, `ce-pov`, `ce-plan`, `ce-strategy` | Turn an idea into a blueprint — requirements, options considered and rejected, a technical approach — before any code is written. |
| **Work** | `ce-work`, `ce-worktree`, `ce-debug` | Execute the plan with agent assistance, isolated in a git worktree so parallel work and the primary checkout never collide. |
| **Review** | `ce-code-review`, `ce-doc-review`, `ce-dogfood`, `ce-proof` | Catch issues before merge. `ce-code-review` spawns up to 9+ parallel reviewer-persona subagents (security, reliability, adversarial, etc. — verified in its `SKILL.md`); `ce-dogfood` is a full autonomous browser-QA loop: map flows → build a test matrix → drive a real browser → fix small breakages with a regression test and a commit → escalate anything large or ambiguous to a human. |
| **Compound** | `ce-compound`, `ce-compound-refresh` | Document the solved problem into `docs/solutions/` (and durable domain vocabulary into `CONCEPTS.md`), so the next occurrence is a five-minute lookup instead of a research project. With this fork's governance hooks installed, every `ce-compound` write also now emits real governance nodes as a side effect — the Compound step doing double duty. |

## 4. Where ce-plugin sits on the adoption ladder

The guide's own summary calls this "five adoption stages," but the actual content defines **six, Stage 0 through Stage 5** (Stage 0 = no AI at all, a baseline, not one of "the five"). Checked directly against this plugin's skill files rather than assumed:

- **Stage 3 (plan-first, PR-only review) — supported.** `ce-plan` → `ce-work` → `ce-code-review` → `ce-commit-push-pr` is exactly this: collaborative planning, unsupervised implementation, human review at the PR level rather than line-by-line.
- **Stage 4 (idea → PR, single machine) — supported, and `ce-dogfood` is the cleanest example.** Its Phase 5 Fix Loop independently investigates root cause, applies the fix, **adds a regression test**, commits, and re-verifies, escalating to a human only for large/ambiguous changes or things it can't drive headlessly (OAuth, email, payments). That is Stage 4's definition almost verbatim: developer involvement reduces to ideation, review, and merge.
- **Stage 5 (cloud, simultaneous multi-feature, direct-from-anywhere, proactive proposals) — not supported. Verified, not inferred:**
  - `grep -rl "Workflow(" skills/` → **zero matches.** No skill in this plugin invokes the orchestration `Workflow` tool.
  - `ce-worktree` gives real parallelism, but strictly local — one machine, `.worktrees/<branch>` directories, one branch checked out at a time.
  - `ce-code-review`'s multi-agent dispatch is real (up to 9+ concurrent subagents) but **local to the session** — not cloud infrastructure, and grepping its `SKILL.md` for "ultra"/"cloud" returns nothing.
  - The actual cloud-review `ultra` capability exists, but it's a **separate, unrelated** Claude Code feature (the bare `code-review` skill, not `ce-code-review`) that this plugin's own quick-review path simply forwards to rather than owning.

## 5. Mechanisms available to reach Stage 5

None of the following is wired into any `ce-*` skill today — this is available machinery, not a rediscovered capability. Four gaps, four corresponding primitives:

| Stage 5 requirement | Primitive | How it closes the gap |
|---|---|---|
| **Cloud infrastructure** | `Agent({isolation: "remote"})` | Runs an agent in a remote cloud environment instead of the local sandbox — the literal cloud-execution primitive. |
| **Simultaneous multi-feature development** | `pipeline(items, ...)` / `parallel(thunks)` with `isolation: "worktree"` per item | Fans out over a **list**, concurrently (up to `min(16, cores-2)` at once). Tonight's `ce-compound` run already demonstrated the shape at small scale — its Phase 1 dispatched `Context Analyzer`, `Solution Extractor`, and `Related Docs Finder` as three parallel background subagents. Pointing that same pattern at a list of **features/branches** instead of review angles — each item isolated in its own worktree — mechanically generalizes `ce-worktree`'s one-at-a-time model to N-at-once. |
| **Direct multiple agents from anywhere** | `CronCreate` / `ScheduleWakeup` / `RemoteTrigger` | Scheduled or externally-triggered unattended runs — not tied to a developer having a terminal open. |
| **Proactive improvement proposals** | Documented `Workflow` quality patterns: **completeness critic**, **loop-until-dry**, **judge panel** | These let an agent generate its *own* next round of work (e.g., "what's missing?" feeding the next iteration) instead of only executing a single human-issued instruction — the actual difference between Stage 4 ("does what I asked") and Stage 5 ("decides what's worth doing next"). |

**The honest gap is integration, not invention.** Every primitive above already exists and was demonstrably used in this session (`Agent`/fork dispatch, `Monitor` for background-task tracking, a live `tmux`-driven Claude Code session). `ce-compound`'s Phase 1 already hand-rolls a parallel-dispatch pattern in prose inside its `SKILL.md` — it just does it as a single skill's internal research phase, not as a `Workflow`-orchestrated, cloud-executed, multi-feature fan-out. Closing the gap means a new skill (or an evolution of `ce-worktree`/`ce-dogfood`) that calls `Workflow` directly, targets `isolation: "remote"` for at least some legs, and is triggerable via `CronCreate`/`RemoteTrigger` rather than only by a developer typing a command.
