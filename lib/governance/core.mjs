// Executable governance core — zero-build, node-only. The hooks import THIS.
// lib/governance/*.ts is the typed mirror for Factory-ingest; this file is what runs.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync } from "node:fs"
import { join, resolve, relative, isAbsolute, basename } from "node:path"
import { execSync } from "node:child_process"

export const REJECTION_REASONS = [
  "too-vague","not-grounded","unjustified-no-basis","basis-refuted","below-threshold",
  "subject-replacement","scope-overrun","duplicate-of-stronger","too-expensive","coverage-gap-unrecovered",
]

const sortDeep = (v) => Array.isArray(v) ? v.map(sortDeep)
  : (v && typeof v === "object")
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])])) : v
export const canonicalize = (v) => JSON.stringify(sortDeep(v))
export const governanceNodeId = (type, content) =>
  `${type}:${createHash("sha256").update(type).update("\0").update(canonicalize(content)).digest("hex").slice(0,32)}`

const GOV = (root) => join(root, "docs", ".governance")
const INDEX = (root) => join(GOV(root), ".by-source.json")

const BUG_TRACK = new Set([
  "build_error","test_failure","runtime_error","performance_issue","database_issue",
  "security_issue","ui_bug","integration_issue","logic_error",
])

/** repo-relative path -> { type, kind } descriptor, or null if not a governed artifact. */
export function classifyPath(repoRel) {
  const p = repoRel.replace(/\\/g, "/")
  const base = p.split("/").pop()
  if (p === "STRATEGY.md" || p.endsWith("/STRATEGY.md")) return { type: "Specification" }
  if (p.includes("docs/plans/")) return { type: "Specification" }
  if (p.includes("docs/ideation/")) return { type: "CandidateSet", ideation: true }
  if (p.includes("docs/brainstorms/riffrec-feedback/")) return { type: "Divergence", riffrec: true } // X5
  if (p.includes("docs/solutions/")) return { type: "Learning", solution: true }                     // X2 hook
  if (p.includes("docs/pulse-reports/")) return { type: "ExecutionTrace", kind: "pulse" }             // X4
  if (base === "experiment-log.yaml" && p.includes("ce-optimize")) return { type: "CandidateSet", optimize: true } // X3
  if (base === "result.yaml" && p.includes("ce-optimize")) return { type: "Verdict", optimizeResult: true }        // X3
  return null
}

/** Parse a ce-compound solution doc. Bug-track docs additionally yield Hypothesis + Amendment. */
export function parseSolutionDoc(md) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(md)
  const front = fm ? fm[1] : ""
  const field = (k) => (new RegExp(`^${k}:\\s*(.+)$`, "m").exec(front) || [])[1]?.trim()
  const section = (h) => {
    const re = new RegExp(`##\\s+${h}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i")
    return (re.exec(md) || [])[1]?.trim() || ""
  }
  const problemType = (field("problem_type") || "").replace(/^["']|["']$/g, "")
  return {
    problemType,
    isBug: BUG_TRACK.has(problemType),
    rootCause: section("Why This Works") || field("root_cause") || "",
    fix: section("Solution"),
    problem: section("Problem"),
  }
}

/** Best-effort outcome from a result.yaml/experiment marker (no YAML dep). */
export function resultVerdict(yamlText) {
  const t = yamlText.toLowerCase()
  if (/\bregress(ed|ion)?:\s*true\b/.test(t) || /\bstatus:\s*(fail|failed|error|regress)/.test(t)) return "refuted"
  if (/\bwinner:\s*true\b/.test(t) || /\bstatus:\s*(pass|win|improved|success)/.test(t) || /\bimproved:\s*true\b/.test(t)) return "sound"
  return "weak"
}

function loadIndex(root) {
  try { return JSON.parse(readFileSync(INDEX(root), "utf8")) } catch { return {} }
}
function saveIndex(root, idx) {
  mkdirSync(GOV(root), { recursive: true })
  writeFileSync(INDEX(root), JSON.stringify(idx, null, 2))
}

/** Append-only write. Idempotent on identical content. Successor + LINEAGE when the
 *  same source path produced a different node before. Returns {id, written, lineage}. */
export function writeNode(root, type, content, sourceKey) {
  mkdirSync(GOV(root), { recursive: true })
  const id = governanceNodeId(type, content)
  const file = join(GOV(root), `${id.replace(":", "-")}.json`)
  const idx = loadIndex(root)
  const prior = sourceKey ? idx[sourceKey] : undefined
  const lineage = prior && prior !== id ? prior : undefined
  if (existsSync(file)) {                              // identical content already a node
    if (sourceKey) { idx[sourceKey] = id; saveIndex(root, idx) }
    return { id, written: false, lineage: undefined }
  }
  const node = { id, type, lineage, sourceKey, createdAt: new Date().toISOString(), content }
  writeFileSync(file, JSON.stringify(node, null, 2))   // never overwrites (existsSync guard above)
  if (sourceKey) { idx[sourceKey] = id; saveIndex(root, idx) }
  return { id, written: true, lineage }
}

/** Best-effort map a free-text rejection reason to the closed enum; keep raw verbatim. */
export function mapReason(text) {
  const t = (text || "").toLowerCase()
  const hit = (...kw) => kw.some(k => t.includes(k))
  if (hit("refut")) return "basis-refuted"
  if (hit("no basis","unjustified","slop")) return "unjustified-no-basis"
  if (hit("vague")) return "too-vague"
  if (hit("not grounded","ungrounded","not actionable")) return "not-grounded"
  if (hit("duplicate","covered by")) return "duplicate-of-stronger"
  if (hit("expensive","cost")) return "too-expensive"
  if (hit("scope")) return "scope-overrun"
  if (hit("replace","pivot","abandon")) return "subject-replacement"
  if (hit("axis","recovery skipped","coverage")) return "coverage-gap-unrecovered"
  return "below-threshold"
}

/** Parse a markdown ideation doc into selected titles + typed rejections. */
export function parseIdeation(md) {
  const survivors = [...md.matchAll(/^###\s+\d+\.\s+(.+)$/gm)].map(m => m[1].trim())
  const rejected = []
  const sec = md.split(/##\s+Rejection Summary/i)[1]
  if (sec) {
    for (const m of sec.matchAll(/^\|\s*[^|]*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)) {
      const idea = m[1].trim(), reason = m[2].trim()
      if (/^[-\s]*$/.test(idea) || /idea/i.test(idea) && /reason/i.test(reason)) continue // skip header/sep
      rejected.push({ idea, reason: mapReason(reason), rawReason: reason })
    }
  }
  return { survivors, rejected }
}

/** Open = a refuted verdict node with no later resolving node. Used by the ship gate. */
export function openRefutedVerdicts(root) {
  const dir = GOV(root)
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir)) {
    if (!f.startsWith("Verdict-") || !f.endsWith(".json")) continue
    try {
      const n = JSON.parse(readFileSync(join(dir, f), "utf8"))
      if (n?.content?.verdict === "refuted" && !n?.content?.resolved) out.push(n.id)
    } catch {}
  }
  return out
}

// realpath both sides so /var vs /private/var (macOS symlinked tmpdir/paths)
// can't desync root and path — otherwise relative() returns "../.." and we
// silently fall back to basename, and classifyPath never matches. Fails OPEN.
const realpath = (p) => { try { return realpathSync(p) } catch { return p } }

export function toRepoRel(root, p) {
  const absRoot = realpath(isAbsolute(root) ? root : resolve(root))
  const abs = realpath(isAbsolute(p) ? p : resolve(absRoot, p))
  const rel = relative(absRoot, abs)
  return rel.startsWith("..") ? basename(p) : rel
}

/** Single source of truth for the repo root, symlinks resolved. */
export function resolveRoot(cwd = process.cwd()) {
  try {
    const top = execSync("git rev-parse --show-toplevel", { cwd, stdio: ["ignore","pipe","ignore"] }).toString().trim()
    if (top) return realpath(top)
  } catch {}
  return realpath(cwd)
}

// ── X1: ExecutionTrace capture (executor skills change code, not docs) ──────────
const git = (root, args) => {
  try { return execSync(`git ${args}`, { cwd: root, stdio: ["ignore","pipe","ignore"] }).toString() }
  catch { return null }
}

// Exclude the governance store itself from every diff/status read below. Without this,
// writing node N dirties .by-source.json, which becomes node N+1's "diff", which dirties
// it again — an infinite self-referential trace chain even when nothing else changed.
const NOT_GOV = "-- . ':!docs/.governance'"

/** Capture tracked-change diff + porcelain status. null when not a repo or no changes. */
export function captureWorktree(root) {
  const head = git(root, "rev-parse HEAD")
  const branch = git(root, "rev-parse --abbrev-ref HEAD")
  if (branch === null) return null                                    // not a git repo
  const diff = head ? (git(root, `diff HEAD ${NOT_GOV}`) ?? "") : ""  // no commits yet → no tracked diff
  const porcelain = git(root, `status --porcelain ${NOT_GOV}`) ?? ""
  if (!diff.trim() && !porcelain.trim()) return null      // nothing changed
  const stat = head ? (git(root, `diff HEAD --stat ${NOT_GOV}`) ?? "") : ""
  const files = porcelain.trim().split("\n").filter(Boolean)
    .map(l => l.slice(2).trimStart())                 // strip 2 status chars + spacing (porcelain v1)
  return { branch: branch.trim(), head: head ? head.trim() : null, diff, stat: stat.trim(), files }
}

/** Most-recent Specification node by createdAt (the spec the execution most likely realizes),
 *  plus all candidate spec ids so the link is recoverable if the heuristic is wrong. */
export function latestSpecification(root) {
  const dir = GOV(root)
  if (!existsSync(dir)) return { governedBy: null, candidates: [] }
  const specs = []
  for (const f of readdirSync(dir)) {
    if (!f.startsWith("Specification-") || !f.endsWith(".json")) continue
    try { const n = JSON.parse(readFileSync(join(dir, f), "utf8")); specs.push({ id: n.id, at: n.createdAt }) } catch {}
  }
  specs.sort((a, b) => (b.at || "").localeCompare(a.at || ""))
  return { governedBy: specs[0]?.id ?? null, candidates: specs.map(s => s.id) }
}

/** Emit an ExecutionTrace from a worktree capture. Idempotent on identical diff;
 *  a changed diff is a LINEAGE successor of the prior worktree trace. */
export function emitExecutionTrace(root, cap) {
  const { governedBy, candidates } = latestSpecification(root)
  const content = {
    branch: cap.branch, head: cap.head, files: cap.files,
    diffSha: governanceNodeId("blob", cap.diff), stat: cap.stat,
    governedBy,                       // heuristic: latest Specification
    governedByCandidates: candidates, // recoverable if the heuristic is wrong
  }
  return writeNode(root, "ExecutionTrace", content, "#worktree")
}
