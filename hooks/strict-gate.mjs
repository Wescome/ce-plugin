#!/usr/bin/env node
// PreToolUse(Bash) — fail-closed ship gate (H3 / I-1). Blocks ship verbs while an
// unresolved `refuted` Verdict node exists. The agent CANNOT ship past it: exit 2
// is a hard block in Claude Code's hook protocol, independent of agent cooperation.
import { readFileSync } from "node:fs"
import { openRefutedVerdicts, resolveRoot } from "../lib/governance/core.mjs"

const root = resolveRoot()

let payload = {}
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}") } catch {}
const cmd = (payload.tool_input?.command || payload.toolInput?.command || "") + ""

const SHIP = /\bgit\s+(commit|push)\b|\bgh\s+pr\s+create\b/
if (!SHIP.test(cmd)) process.exit(0)

const open = openRefutedVerdicts(root)
if (open.length === 0) process.exit(0)

process.stderr.write(
  `[governance] BLOCKED: ${open.length} unresolved refuted verdict(s): ${open.join(", ")}. ` +
  `Resolve (mark content.resolved=true on the Verdict node) before shipping.\n`)
process.exit(2) // hard block
