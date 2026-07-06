// Typed mirror of the node-identity contract for Factory ingest.
// The executable source of truth is lib/governance/core.mjs; this file gives the
// Factory a typed surface to deserialize the JSON nodes the hooks emit.
import { createHash } from "node:crypto"

export type GovernanceNodeType =
  | "Specification"
  | "AtomDirective"
  | "ExecutionTrace"
  | "Learning"
  | "ElucidationArtifact"
  | "Hypothesis"
  | "Amendment"
  | "Verdict"
  | "Divergence"        // X5: user-reported divergence observations
  | "CandidateSet"      // added per SPEC-FF-PRESPEC-CANDIDATE-001

export type EdgeType =
  | "DEPENDS_ON"
  | "LINEAGE"
  | "RESOLVES"
  | "MONITORS"
  | "SOURCED_FROM"
  | "PRODUCED_BY"
  | "SELECTS_FROM"
  | "PRODUCED_AT"
  | "RECORDS_REJECTED"

const sortDeep = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortDeep)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, sortDeep((v as any)[k])]))
      : v

export const canonicalize = (v: unknown): string => JSON.stringify(sortDeep(v))

/** Content-addressed identity: sha256(type ‖ canonical(content)), first 32 hex. */
export function governanceNodeId(type: GovernanceNodeType | "blob", content: unknown): string {
  const h = createHash("sha256").update(type).update("\0").update(canonicalize(content)).digest("hex")
  return `${type}:${h.slice(0, 32)}`
}

export interface GovernanceNode<T = unknown> {
  id: string
  type: GovernanceNodeType
  lineage?: string
  sourceKey?: string
  createdAt: string
  content: T
}
