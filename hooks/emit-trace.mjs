#!/usr/bin/env node
// Stop — emit an ExecutionTrace from the worktree diff when an executor skill has
// changed code. Deterministic: fires at turn end regardless of agent cooperation.
// Idempotent (no diff change → no new node). Non-blocking.
import { captureWorktree, emitExecutionTrace, resolveRoot } from "../lib/governance/core.mjs"

const root = resolveRoot()

const cap = captureWorktree(root)
if (!cap) process.exit(0)
const res = emitExecutionTrace(root, cap)
process.stderr.write(
  `[governance] ${res.written ? "emitted" : "exists"} ${res.id}` +
  `${res.lineage ? ` (successor of ${res.lineage})` : ""} [${cap.files.length} file(s)]\n`)
process.exit(0)
