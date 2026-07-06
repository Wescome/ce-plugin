#!/usr/bin/env node
// PostToolUse(Write|Edit) — deterministic emission. Fires whenever the agent writes
// a governed artifact, regardless of whether the agent "remembers" to. Non-blocking.
import { readFileSync } from "node:fs"
import {
  classifyPath, writeNode, parseIdeation, governanceNodeId, toRepoRel,
  parseSolutionDoc, resultVerdict, resolveRoot,
} from "../lib/governance/core.mjs"

const root = resolveRoot()

let payload = {}
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}") } catch {}
const ti = payload.tool_input || payload.toolInput || {}
const filePath = ti.file_path || ti.filePath || ti.path
if (!filePath) process.exit(0)

const rel = toRepoRel(root, filePath)
let body = ""
try { body = readFileSync(filePath, "utf8") } catch { process.exit(0) }

const emitted = []

// Review findings (content-sniffed, path-independent): a P0 finding becomes a
// `refuted` Verdict node the ship gate hard-blocks on. This is the gate's producer.
if (filePath.endsWith(".json")) {
  let j = null
  try { j = JSON.parse(body) } catch {}
  const findings = Array.isArray(j?.findings) ? j.findings
    : Array.isArray(j) ? j.flatMap(x => x?.findings || []) : null
  if (findings && findings.every(f => f && "severity" in f)) {
    for (const f of findings.filter(f => f.severity === "P0")) {
      const v = { verdict: "refuted", finding: f.title, file: f.file, line: f.line,
                  severity: "P0", resolved: false, source: rel }
      const res = writeNode(root, "Verdict", v, `${rel}#${f.file}:${f.line}`)
      emitted.push(["Verdict", res.id, res.written, res.lineage])
    }
    for (const [t, id, w] of emitted) process.stderr.write(`[governance] ${w ? "emitted" : "exists"} ${id}\n`)
    process.exit(0)
  }
}

const desc = classifyPath(rel)
if (!desc) process.exit(0)
const base = rel.split("/").pop()

if (desc.ideation) {
  const { survivors, rejected } = parseIdeation(body)
  const cs = { source: rel, options: survivors.map(t => ({ title: t })), cardinality: survivors.length + rejected.length }
  const csRes = writeNode(root, "CandidateSet", cs, rel + "#candidates")
  const elu = writeNode(root, "ElucidationArtifact", {
    source: rel, candidateSetId: csRes.id, selected: survivors[0] ?? null,
    rejected, coverageGaps: rejected.filter(r => r.reason === "coverage-gap-unrecovered"),
  }, rel + "#elucidation")
  emitted.push(["CandidateSet", csRes.id, csRes.written, csRes.lineage])
  emitted.push(["ElucidationArtifact", elu.id, elu.written, elu.lineage])

} else if (desc.solution) {                                          // X2: Learning (+ Hypothesis/Amendment on bug-track)
  const learn = writeNode(root, "Learning", { source: rel, sha: governanceNodeId("blob", body) }, rel)
  emitted.push(["Learning", learn.id, learn.written, learn.lineage])
  const sol = parseSolutionDoc(body)
  if (sol.isBug) {
    const hyp = writeNode(root, "Hypothesis",
      { source: rel, problemType: sol.problemType, rootCause: sol.rootCause, learning: learn.id }, rel + "#hypothesis")
    const amd = writeNode(root, "Amendment",
      { source: rel, fix: sol.fix, hypothesis: hyp.id, learning: learn.id }, rel + "#amendment")
    emitted.push(["Hypothesis", hyp.id, hyp.written, hyp.lineage])
    emitted.push(["Amendment", amd.id, amd.written, amd.lineage])
  }

} else if (desc.optimize) {                                          // X3: experiment-log -> CandidateSet
  const res = writeNode(root, "CandidateSet", { source: rel, kind: "experiment-log", sha: governanceNodeId("blob", body) }, rel)
  emitted.push(["CandidateSet", res.id, res.written, res.lineage])

} else if (desc.optimizeResult) {                                   // X3: result.yaml -> Verdict (regression refutes)
  const verdict = resultVerdict(body)
  const res = writeNode(root, "Verdict",
    { source: rel, verdict, resolved: verdict !== "refuted", kind: "experiment-result", sha: governanceNodeId("blob", body) }, rel)
  emitted.push(["Verdict", res.id, res.written, res.lineage])

} else if (desc.kind === "pulse") {                                 // X4: pulse report -> ExecutionTrace(pulse)
  const window = (base.match(/\d{4}-\d{2}-\d{2}[_T-][\dhmsT_-]+/) || [])[0] || null
  const res = writeNode(root, "ExecutionTrace", { source: rel, kind: "pulse", window, sha: governanceNodeId("blob", body) }, rel)
  emitted.push(["ExecutionTrace", res.id, res.written, res.lineage])

} else {                                                            // Specification, Divergence (X5 riffrec)
  const res = writeNode(root, desc.type, { source: rel, sha: governanceNodeId("blob", body) }, rel)
  emitted.push([desc.type, res.id, res.written, res.lineage])
}

for (const [t, id, w, lin] of emitted) {
  process.stderr.write(`[governance] ${w ? "emitted" : "exists"} ${id}${lin ? ` (successor of ${lin})` : ""}\n`)
}
process.exit(0)
