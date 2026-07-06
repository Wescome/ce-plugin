#!/usr/bin/env node
// Real assertion test for the governance hooks. Runs in an isolated temp repo.
// Exits non-zero on any failure. No mocks of the core logic.
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { resolveSpecification, latestSpecification } from "../lib/governance/core.mjs"

const HOOKS = import.meta.dirname
const repo = mkdtempSync(join(tmpdir(), "gov-test-"))
let fails = 0
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); fails++ } else console.log("ok:", m) }
const gov = () => { try { return readdirSync(join(repo, "docs", ".governance")) } catch { return [] } }
const run = (script, payload) => {
  try {
    execFileSync("node", [join(HOOKS, script)], { input: JSON.stringify(payload), cwd: repo, stdio: ["pipe","ignore","ignore"] })
    return 0
  } catch (e) { return e.status ?? 1 }
}

// 1. ideation write -> CandidateSet + ElucidationArtifact with typed rejections
mkdirSync(join(repo, "docs", "ideation"), { recursive: true })
const ide = join(repo, "docs", "ideation", "x.md")
writeFileSync(ide, "## Ranked Ideas\n### 1. Keep\n## Rejection Summary\n| # | Idea | Reason Rejected |\n|---|---|---|\n| 1 | Bad | not grounded |\n")
run("emit-governance.mjs", { tool_input: { file_path: ide } })
ok(gov().some(f => f.startsWith("CandidateSet-")), "ideation -> CandidateSet node")
const elu = gov().find(f => f.startsWith("ElucidationArtifact-"))
ok(!!elu, "ideation -> ElucidationArtifact node")
ok(JSON.parse(readFileSync(join(repo,"docs",".governance",elu))).content.rejected[0].reason === "not-grounded", "rejection typed to enum")

// 2. successor lineage on rewrite
mkdirSync(join(repo, "docs", "plans"), { recursive: true })
const plan = join(repo, "docs", "plans", "p.md")
writeFileSync(plan, "v1"); run("emit-governance.mjs", { tool_input: { file_path: plan } })
writeFileSync(plan, "v2"); run("emit-governance.mjs", { tool_input: { file_path: plan } })
const specs = gov().filter(f => f.startsWith("Specification-")).map(f => JSON.parse(readFileSync(join(repo,"docs",".governance",f))))
ok(specs.length === 2, "two Specification nodes")
ok(specs.some(s => s.lineage), "rewrite produced a LINEAGE successor")

// 3. review P0 -> refuted Verdict; ship gate blocks; resolve -> allowed
const findings = join(repo, "findings.json")
writeFileSync(findings, JSON.stringify({ findings: [{ title: "X", severity: "P0", file: "a.ts", line: 1 }] }))
run("emit-governance.mjs", { tool_input: { file_path: findings } })
ok(gov().some(f => f.startsWith("Verdict-")), "P0 finding -> refuted Verdict node")
ok(run("strict-gate.mjs", { tool_input: { command: "git commit -m x" } }) === 2, "ship gate BLOCKS on refuted verdict (exit 2)")
ok(run("strict-gate.mjs", { tool_input: { command: "npm test" } }) === 0, "non-ship command not gated")
const vf = join(repo, "docs", ".governance", gov().find(f => f.startsWith("Verdict-")))
const vn = JSON.parse(readFileSync(vf)); vn.content.resolved = true; writeFileSync(vf, JSON.stringify(vn))
ok(run("strict-gate.mjs", { tool_input: { command: "git commit -m x" } }) === 0, "ship allowed after verdict resolved")

// 4. ExecutionTrace (X1): real git repo, code change at Stop -> trace linked to spec
const grepo = mkdtempSync(join(tmpdir(), "gov-git-"))
const sh = (c) => execFileSync("bash", ["-c", c], { cwd: grepo, stdio: ["ignore","ignore","ignore"] })
sh("git init -q && git config user.email t@t && git config user.name t && echo base > app.js && git add -A && git commit -qm base")
mkdirSync(join(grepo, "docs", "plans"), { recursive: true })
writeFileSync(join(grepo, "docs", "plans", "p.md"), "# Plan\nA\n")
execFileSync("node", [join(HOOKS, "emit-governance.mjs")], { input: JSON.stringify({ tool_input: { file_path: join(grepo,"docs","plans","p.md") } }), cwd: grepo, stdio: ["pipe","ignore","ignore"] })
const ggov = () => { try { return readdirSync(join(grepo, "docs", ".governance")) } catch { return [] } }
const specId = ggov().filter(f=>f.startsWith("Specification-"))[0].replace(".json","").replace("-",":")
sh("echo change1 >> app.js")
execFileSync("node", [join(HOOKS, "emit-trace.mjs")], { cwd: grepo, stdio: ["ignore","ignore","ignore"] })
let traces = ggov().filter(f => f.startsWith("ExecutionTrace-"))
ok(traces.length === 1, "code change at Stop -> ExecutionTrace node")
const tnode = JSON.parse(readFileSync(join(grepo,"docs",".governance",traces[0])))
ok(tnode.content.governedBy === specId, "ExecutionTrace linked to active Specification")
ok(!tnode.content.files.some(f => f.startsWith("docs/.governance")), "trace excludes its own governance store")
ok(tnode.content.files.includes("app.js"), "trace lists changed file (porcelain parse correct)")
execFileSync("node", [join(HOOKS, "emit-trace.mjs")], { cwd: grepo, stdio: ["ignore","ignore","ignore"] })
ok(ggov().filter(f => f.startsWith("ExecutionTrace-")).length === 1, "no diff change -> idempotent (no new trace)")
sh("echo change2 >> app.js")
execFileSync("node", [join(HOOKS, "emit-trace.mjs")], { cwd: grepo, stdio: ["ignore","ignore","ignore"] })
traces = ggov().filter(f => f.startsWith("ExecutionTrace-")).map(f => JSON.parse(readFileSync(join(grepo,"docs",".governance",f))))
ok(traces.length === 2 && traces.some(t => t.lineage), "changed diff -> successor trace with LINEAGE")
rmSync(grepo, { recursive: true, force: true })

// 5. X2 — bug-track solution doc -> Learning + Hypothesis + Amendment; knowledge -> Learning only
const emit = (p) => execFileSync("node", [join(HOOKS, "emit-governance.mjs")], { input: JSON.stringify({ tool_input: { file_path: p } }), cwd: repo, stdio: ["pipe","ignore","ignore"] })
const w = (rp, txt) => { const fp = join(repo, rp); mkdirSync(join(fp, ".."), { recursive: true }); writeFileSync(fp, txt); return fp }
const govt = (pre) => gov().filter(f => f.startsWith(pre))
emit(w("docs/solutions/bug.md", "---\nproblem_type: runtime_error\n---\n## Problem\nNull deref\n## Solution\nGuard the null\n## Why This Works\nThe value can be undefined before init\n"))
ok(govt("Learning-").length === 1, "X2: solution doc -> Learning")
ok(govt("Hypothesis-").length === 1, "X2: bug-track -> Hypothesis (root cause)")
ok(govt("Amendment-").length === 1, "X2: bug-track -> Amendment (fix)")
emit(w("docs/solutions/note.md", "---\nproblem_type: best_practice\n---\n## Problem\nuse X\n## Solution\ndo Y\n"))
ok(govt("Learning-").length === 2 && govt("Hypothesis-").length === 1, "X2: knowledge-track -> Learning only (no Hypothesis)")

// 6. X3 — experiment-log -> CandidateSet; result.yaml regression -> refuted Verdict
emit(w(".context/compound-engineering/ce-optimize/s/experiment-log.yaml", "baseline: 0.5\nhypothesis_backlog:\n  - try A\n  - try B\n"))
ok(govt("CandidateSet-").map(f => JSON.parse(readFileSync(join(repo,"docs",".governance",f)))).some(n => n.content.kind === "experiment-log"), "X3: experiment-log -> CandidateSet")
emit(w(".context/compound-engineering/ce-optimize/s/wt1/result.yaml", "name: A\nregressed: true\nmetric: 0.4\n"))
const vRefuted = govt("Verdict-").map(f => JSON.parse(readFileSync(join(repo,"docs",".governance",f)))).find(n => n.content.kind === "experiment-result")
ok(vRefuted && vRefuted.content.verdict === "refuted" && vRefuted.content.resolved === false, "X3: regressed result.yaml -> refuted Verdict (blocks ship)")

// 7. X4 — pulse report -> ExecutionTrace(pulse) with window
emit(w("docs/pulse-reports/2026-06-28_12-00.md", "# Pulse\nusage up\n"))
const pulse = govt("ExecutionTrace-").map(f => JSON.parse(readFileSync(join(repo,"docs",".governance",f)))).find(n => n.content.kind === "pulse")
ok(pulse && pulse.content.window === "2026-06-28_12-00", "X4: pulse report -> ExecutionTrace(pulse) with window")

// 8. X5 — riffrec feedback -> Divergence
emit(w("docs/brainstorms/riffrec-feedback/r.md", "# Feedback\nUser reports the export button does nothing\n"))
ok(govt("Divergence-").length === 1, "X5: riffrec feedback -> Divergence node")

// 9. U1 — path-keyed Specification resolver: plan-path lookup overrides newest-inference
const u1PlanA = join(repo, "docs", "plans", "u1-a.md")
const u1PlanB = join(repo, "docs", "plans", "u1-b.md")
writeFileSync(u1PlanA, "u1 plan A"); run("emit-governance.mjs", { tool_input: { file_path: u1PlanA } })
writeFileSync(u1PlanB, "u1 plan B"); run("emit-governance.mjs", { tool_input: { file_path: u1PlanB } })
const u1Idx = JSON.parse(readFileSync(join(repo, "docs", ".governance", ".by-source.json"), "utf8"))
const u1SpecA = u1Idx["docs/plans/u1-a.md"]
const u1SpecB = u1Idx["docs/plans/u1-b.md"]
ok(u1SpecA && u1SpecB && u1SpecA !== u1SpecB, "U1 setup: two distinct governed plans indexed by path")
ok(latestSpecification(repo).governedBy === u1SpecB, "U1 setup: latestSpecification() picks the newest (B) — a naive lookup would pick the wrong plan")
ok(resolveSpecification(repo, "docs/plans/u1-a.md").governedBy === u1SpecA, "U1: path-keyed resolver returns A's own spec, not the newest (B)")
ok(resolveSpecification(repo, "docs/plans/does-not-exist.md").governedBy === u1SpecB, "U1: ungoverned path falls back to latestSpecification()")
const emptyRepo = mkdtempSync(join(tmpdir(), "gov-empty-"))
ok(resolveSpecification(emptyRepo, "docs/plans/x.md").governedBy === null, "U1: no .by-source.json at all falls back gracefully (no crash)")
rmSync(emptyRepo, { recursive: true, force: true })

// 10. U2 — ExecutionTrace sourceKey is parameterized by branch, not one hardcoded constant
const brepo = mkdtempSync(join(tmpdir(), "gov-branch-"))
const bsh = (c) => execFileSync("bash", ["-c", c], { cwd: brepo, stdio: ["ignore","ignore","ignore"] })
bsh("git init -q -b main && git config user.email t@t && git config user.name t && echo base > app.js && git add -A && git commit -qm base")
mkdirSync(join(brepo, "docs", "plans"), { recursive: true })
writeFileSync(join(brepo, "docs", "plans", "p.md"), "# Plan\nA\n")
execFileSync("node", [join(HOOKS, "emit-governance.mjs")], { input: JSON.stringify({ tool_input: { file_path: join(brepo,"docs","plans","p.md") } }), cwd: brepo, stdio: ["pipe","ignore","ignore"] })
const bgov = () => { try { return readdirSync(join(brepo, "docs", ".governance")) } catch { return [] } }
bsh("git checkout -qb worktree-a && echo a >> app.js")
execFileSync("node", [join(HOOKS, "emit-trace.mjs")], { cwd: brepo, stdio: ["ignore","ignore","ignore"] })
bsh("git checkout main -q && git checkout -qb worktree-b && echo b >> app.js")
execFileSync("node", [join(HOOKS, "emit-trace.mjs")], { cwd: brepo, stdio: ["ignore","ignore","ignore"] })
const bidx = JSON.parse(readFileSync(join(brepo, "docs", ".governance", ".by-source.json"), "utf8"))
ok(bidx["#worktree:worktree-a"] && bidx["#worktree:worktree-b"] && bidx["#worktree:worktree-a"] !== bidx["#worktree:worktree-b"],
  "U2: two branches -> two distinct #worktree:<branch> keys, no collision")
ok(bgov().filter(f => f.startsWith("ExecutionTrace-")).length === 2, "U2: each branch produced its own ExecutionTrace node (no overwrite)")
rmSync(brepo, { recursive: true, force: true })

// 11. U3 — .ce-fanout-plan marker file: emit-trace.mjs reads it to resolve the right
// Specification. Marker-absent behavior is unchanged (already exercised in section 4:
// no marker there, correctly falls back to latestSpecification()).
const mrepo = mkdtempSync(join(tmpdir(), "gov-marker-"))
const msh = (c) => execFileSync("bash", ["-c", c], { cwd: mrepo, stdio: ["ignore","ignore","ignore"] })
msh("git init -q -b main && git config user.email t@t && git config user.name t && echo base > app.js && git add -A && git commit -qm base")
mkdirSync(join(mrepo, "docs", "plans"), { recursive: true })
const mPlanA = join(mrepo, "docs", "plans", "m-a.md")
const mPlanB = join(mrepo, "docs", "plans", "m-b.md")
writeFileSync(mPlanA, "m plan A")
execFileSync("node", [join(HOOKS, "emit-governance.mjs")], { input: JSON.stringify({ tool_input: { file_path: mPlanA } }), cwd: mrepo, stdio: ["pipe","ignore","ignore"] })
writeFileSync(mPlanB, "m plan B")
execFileSync("node", [join(HOOKS, "emit-governance.mjs")], { input: JSON.stringify({ tool_input: { file_path: mPlanB } }), cwd: mrepo, stdio: ["pipe","ignore","ignore"] })
const mIdx = JSON.parse(readFileSync(join(mrepo, "docs", ".governance", ".by-source.json"), "utf8"))
const mSpecA = mIdx["docs/plans/m-a.md"]
const mSpecB = mIdx["docs/plans/m-b.md"]
const mgov = () => { try { return readdirSync(join(mrepo, "docs", ".governance")) } catch { return [] } }

// Happy path: marker points at plan A (not the newest, B) -> trace should link to A
writeFileSync(join(mrepo, ".ce-fanout-plan"), "docs/plans/m-a.md\n")
msh("echo change >> app.js")
execFileSync("node", [join(HOOKS, "emit-trace.mjs")], { cwd: mrepo, stdio: ["ignore","ignore","ignore"] })
const mtrace1 = mgov().filter(f => f.startsWith("ExecutionTrace-")).map(f => JSON.parse(readFileSync(join(mrepo,"docs",".governance",f))))[0]
ok(mtrace1.content.governedBy === mSpecA, "U3: marker file present -> ExecutionTrace links to the marker's plan (A), not the newest (B)")

// Edge: marker points at a path with no governed entry yet (race) -> falls back, no crash
writeFileSync(join(mrepo, ".ce-fanout-plan"), "docs/plans/not-yet-governed.md\n")
msh("echo change2 >> app.js")
const raceExit = (() => {
  try { execFileSync("node", [join(HOOKS, "emit-trace.mjs")], { cwd: mrepo, stdio: ["ignore","ignore","ignore"] }); return 0 }
  catch (e) { return e.status ?? 1 }
})()
ok(raceExit === 0, "U3: marker points at an ungoverned path (race) -> hook still exits 0, doesn't crash")
const mtraces2 = mgov().filter(f => f.startsWith("ExecutionTrace-")).map(f => JSON.parse(readFileSync(join(mrepo,"docs",".governance",f))))
const mLatestTrace = mtraces2.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0]
ok(mLatestTrace.content.governedBy === mSpecB, "U3: ungoverned marker path falls back to latestSpecification() gracefully")
rmSync(mrepo, { recursive: true, force: true })

rmSync(repo, { recursive: true, force: true })
console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS")
process.exit(fails ? 1 : 0)
