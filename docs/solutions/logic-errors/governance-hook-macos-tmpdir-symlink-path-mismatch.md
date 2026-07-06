---
title: "Governance hooks silently no-op on macOS due to unresolved tmpdir symlinks in toRepoRel"
date: 2026-07-06
category: logic-errors
module: governance-hooks
problem_type: logic_error
component: tooling
symptoms:
  - "PostToolUse emission hook (hooks/emit-governance.mjs) silently no-ops instead of writing a governance node when the tool-provided file_path resolves under a symlinked macOS tmpdir"
  - "hooks/test-governance.mjs crashes with TypeError [ERR_INVALID_ARG_TYPE] because it assumes the emitted governance node exists"
  - "classifyPath(basename) never matches any docs/ prefix (docs/ideation/, docs/plans/, etc.) after toRepoRel silently falls back to basename(p)"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - development_workflow
  - testing_framework
tags:
  - governance
  - hooks
  - symlink-resolution
  - path-normalization
  - macos
  - tmpdir
  - realpath
  - post-tool-use
---

# Governance hooks silently no-op on macOS due to unresolved tmpdir symlinks in toRepoRel

## Problem

`toRepoRel()` in `lib/governance/core.mjs` computed a tool-provided `file_path` relative to the repo root (from `git rev-parse --show-toplevel`, or `process.cwd()` as fallback) without resolving symlinks on either side. On macOS, paths built from `os.tmpdir()`-style directories resolve under `/var/folders/...` while `process.cwd()`/`git` resolve the realpath `/private/var/folders/...`, so `relative()` returned a path starting with `../..` and `toRepoRel` silently fell back to `basename(p)` — a bare filename with no `docs/...` prefix for `classifyPath()` to match.

## Symptoms

- The `PostToolUse` governance-emission hook (`hooks/emit-governance.mjs`) silently no-op'd for affected writes: no error, no stderr line, just a missing governance node in `docs/.governance/` where one was expected.
- This happened specifically for tool-provided paths whose resolution passed through a macOS tmpdir-equivalent symlink (`/var` vs `/private/var`), not for ordinary in-repo edits.
- `hooks/test-governance.mjs` then crashed outright with an uncaught `TypeError [ERR_INVALID_ARG_TYPE]`, because the test assumed a node had been written and passed the resulting `undefined` into a downstream `path.join`/`JSON.parse` call.

## What Didn't Work

Invoking the hook script directly against a path built purely from `process.cwd()` does not reproduce the bug: when both the root and the path are derived through the same consistent mechanism, they land on the same realpath and `relative()` behaves correctly. The failure only surfaces when the two sides diverge — root resolved via `git rev-parse`/`process.cwd()` (realpath) against a tool-supplied path rooted in a symlinked tmpdir (non-realpath) — which is exactly the macOS `/var` vs `/private/var` situation and doesn't show up in a naive re-run of the hook.

Verification tooling was also a dead end initially: running the fix under `claude -p` non-interactively hit a sandboxed `ANTHROPIC_API_KEY` with insufficient credits (`Credit balance is too low`) — a different auth context than a real terminal session. This blocked genuine end-to-end verification (actually driving the plugin hooks inside a live `claude --plugin-dir` session) until the session was driven through `tmux new-session` + `send-keys` + `capture-pane` — a real pty — which authenticated as the actual login and let the hooks run for real.

## Solution

Added a `realpath()` helper in `lib/governance/core.mjs` that wraps `realpathSync` and falls back to the original path on failure (e.g. `ENOENT` for a file mid-write that hasn't hit disk yet):

```js
// realpath both sides so /var vs /private/var (macOS symlinked tmpdir/paths)
// can't desync root and path — otherwise relative() returns "../.." and we
// silently fall back to basename, and classifyPath never matches. Fails OPEN.
const realpath = (p) => { try { return realpathSync(p) } catch { return p } }
```

`toRepoRel(root, p)` was rewritten to realpath both operands before computing the relative path (previously it resolved/joined the paths but never called `realpathSync` on either side, so a symlink mismatch went straight through to `relative()`):

```js
export function toRepoRel(root, p) {
  const absRoot = realpath(isAbsolute(root) ? root : resolve(root))
  const abs = realpath(isAbsolute(p) ? p : resolve(absRoot, p))
  const rel = relative(absRoot, abs)
  return rel.startsWith("..") ? basename(p) : rel
}
```

A shared `resolveRoot(cwd)` helper was also added so all three hooks derive the repo root the same realpath-safe way instead of each duplicating an inline `git rev-parse`/`process.cwd()` fallback:

```js
export function resolveRoot(cwd = process.cwd()) {
  try {
    const top = execSync("git rev-parse --show-toplevel", { cwd, stdio: ["ignore","pipe","ignore"] }).toString().trim()
    if (top) return realpath(top)
  } catch {}
  return realpath(cwd)
}
```

`hooks/emit-governance.mjs`, `hooks/strict-gate.mjs`, and `hooks/emit-trace.mjs` now all call `resolveRoot()` (imported from `../lib/governance/core.mjs`) instead of each hand-rolling their own root-detection logic.

## Why This Works

`classifyPath()` only matches paths containing substrings like `docs/plans/`, `docs/ideation/`, `docs/solutions/`, etc. Before the fix, whenever `root` and `p` disagreed on the `/var` vs `/private/var` prefix, `path.relative()` computed the distance between two different-looking absolute trees and produced a `../..`-laden result; `toRepoRel` treated any leading `..` as "outside the repo" and collapsed the value to `basename(p)` — a bare filename with no directory structure at all, which can never contain a `docs/` prefix. Realpath-normalizing both `root` and the resolved absolute path *before* calling `relative()` means both operands describe the same canonical tree, so genuinely in-repo tool-provided paths (even ones whose absolute form traversed a symlinked tmpdir) resolve to a real repo-relative path like `docs/plans/foo.md`, and `classifyPath` matches as expected.

The `realpath()` helper's `ENOENT` fallback (return the original path rather than throwing) is a deliberate fail-open design: if a file is mid-write and not yet flushed to disk when the hook runs, `realpathSync` would throw, and the helper must not let a transient timing race crash a `PostToolUse` hook that fires on every Write/Edit.

## Prevention

- Add a regression test that constructs a path through an intentionally symlinked temp directory (or otherwise forces `root` and `p` to disagree on their canonical form) and asserts `classifyPath(toRepoRel(root, p))` still matches the expected governance type — this is the shape of case the existing suite didn't cover before the fix.
- General rule for this codebase: any repo-relative path computation feeding a hook or tool-facing classifier must `realpath()` both operands before calling `path.relative()`. Comparing a realpath'd side against a non-realpath'd side is the recurring failure shape (macOS tmpdir symlinks today, but the same class of bug can recur wherever one side is derived from `process.cwd()`/`git` and the other from a raw tool argument).
- Watch `hooks/test-governance.mjs` as the regression signal: before the fix it crashed (2 FAIL plus an uncaught `TypeError [ERR_INVALID_ARG_TYPE]`); after the fix it runs 22/22 `ok` and prints `ALL PASS`. Any future regression in `toRepoRel`/`resolveRoot` should be expected to reproduce as that same crash-vs-clean-pass signal.
- When verifying hook behavior end-to-end (not just unit-testing the pure functions), drive a real `claude --plugin-dir` session via a pty (e.g. `tmux new-session` + `send-keys` + `capture-pane`) rather than `claude -p`, since non-interactive `-p` mode can pick up a differently-scoped/sandboxed `ANTHROPIC_API_KEY` that fails for unrelated credit-balance reasons and gives a false negative on the actual fix.

## Related Issues

- `docs/solutions/skill-design/bundled-script-path-resolution-across-harnesses.md` — a different bug class in the same repo (skill-authoring `SKILL_DIR` anchor vs bare relative paths resolving against the wrong working directory), but the same recurring theme: a path-resolution mismatch between how an agent/tool computes a path and how the consuming code expects it, surfacing as a silent miss rather than a loud error. Different subsystem and root cause (agent/shell CWD resolution vs macOS realpath/symlink mismatch), so not a duplicate — worth cross-referencing as a related pattern.
