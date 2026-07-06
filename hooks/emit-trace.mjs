#!/usr/bin/env node
// Stop — emit an ExecutionTrace from the worktree diff when an executor skill has
// changed code. Deterministic: fires at turn end regardless of agent cooperation.
// Idempotent (no diff change → no new node). Non-blocking.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { captureWorktree, emitExecutionTrace, resolveRoot } from "../lib/governance/core.mjs"

const root = resolveRoot()

const cap = captureWorktree(root)
if (!cap) process.exit(0)

// A fan-out-dispatched worktree self-registers which plan it's implementing by writing
// this marker (gitignored) as its first action — the driver itself has no filesystem
// access to write one from outside. Absent/unreadable -> null -> emitExecutionTrace
// falls back to its existing newest-Specification inference (fail-open, per KTD3).
let planRelPath = null
try { planRelPath = readFileSync(join(root, ".ce-fanout-plan"), "utf8").trim() || null } catch {}

const res = emitExecutionTrace(root, cap, planRelPath)
process.stderr.write(
  `[governance] ${res.written ? "emitted" : "exists"} ${res.id}` +
  `${res.lineage ? ` (successor of ${res.lineage})` : ""} [${cap.files.length} file(s)]\n`)
process.exit(0)
