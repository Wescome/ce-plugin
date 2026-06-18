import { readFileSync } from "fs"
import path from "path"
import { describe, expect, test } from "bun:test"

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const planSections = readRepoFile(
  "plugins/compound-engineering/skills/ce-plan/references/plan-sections.md",
)
const brainstormSections = readRepoFile(
  "plugins/compound-engineering/skills/ce-brainstorm/references/brainstorm-sections.md",
)
const planSkill = readRepoFile("plugins/compound-engineering/skills/ce-plan/SKILL.md")
const brainstormSkill = readRepoFile("plugins/compound-engineering/skills/ce-brainstorm/SKILL.md")
const brainstormHandoff = readRepoFile(
  "plugins/compound-engineering/skills/ce-brainstorm/references/handoff.md",
)
const universalBrainstorming = readRepoFile(
  "plugins/compound-engineering/skills/ce-brainstorm/references/universal-brainstorming.md",
)
const ceWork = readRepoFile("plugins/compound-engineering/skills/ce-work/SKILL.md")
const ceWorkBeta = readRepoFile("plugins/compound-engineering/skills/ce-work-beta/SKILL.md")
const lfg = readRepoFile("plugins/compound-engineering/skills/lfg/SKILL.md")
const docReview = readRepoFile("plugins/compound-engineering/skills/ce-doc-review/SKILL.md")
const docReviewTemplate = readRepoFile(
  "plugins/compound-engineering/skills/ce-doc-review/references/subagent-template.md",
)
const codeReview = readRepoFile("plugins/compound-engineering/skills/ce-code-review/SKILL.md")
const proof = readRepoFile("plugins/compound-engineering/skills/ce-proof/SKILL.md")
const ideate = readRepoFile("plugins/compound-engineering/skills/ce-ideate/references/post-ideation-workflow.md")
const agents = readRepoFile("AGENTS.md")

describe("unified plan artifact contract", () => {
  test("plan section contract defines unified metadata, readiness, and section ids", () => {
    expect(planSections).toContain("artifact_contract: ce-unified-plan/v1")
    expect(planSections).toContain("artifact_readiness")
    expect(planSections).toContain("product_contract_source")
    expect(planSections).toContain("requirements-only")
    expect(planSections).toContain("implementation-ready")
    expect(planSections).toContain("Do **not** use `artifact_readiness: approach-plan`")
    expect(planSections).not.toMatch(/^\s+- `approach-plan`/m)
    expect(planSections).toMatch(/active.*in_progress.*completed.*done/s)
    expect(planSections).toMatch(/no `status` field|no .*status.*field/i)

    for (const id of [
      "goal-launch-block",
      "reader-index",
      "goal-capsule",
      "product-contract",
      "product-requirements",
      "planning-contract",
      "implementation-units",
      "verification-contract",
      "definition-of-done",
    ]) {
      expect(planSections).toContain(id)
    }
  })

  test("brainstorm writes requirements-only unified plan skeletons under docs/plans", () => {
    expect(brainstormSections).toContain("docs/plans/YYYY-MM-DD-NNN-<type>-<topic>-plan")
    expect(brainstormSections).toContain("artifact_readiness: requirements-only")
    expect(brainstormSections).toContain("product_contract_source: ce-brainstorm")
    expect(brainstormSections).toContain("Goal Launch Block")
    expect(brainstormSections).toContain("routes to `ce-plan` enrichment, not execution")
    expect(brainstormSections).toContain("omits empty `Planning Contract`")

    expect(brainstormSkill).toContain("docs/plans/YYYY-MM-DD-NNN-<type>-<topic>-plan")
    expect(brainstormSkill).toContain("artifact_readiness: requirements-only")
    expect(brainstormSkill).toContain("product_contract_source: ce-brainstorm")
    expect(brainstormSkill).toContain("not `/ce-work` or `/goal` execution")
    expect(brainstormSkill).toContain("new `ce-brainstorm` outputs do not write there")
    expect(brainstormSkill).toContain("non-software route does **not** write `artifact_contract: ce-unified-plan/v1`")

    expect(universalBrainstorming).toContain("outside the software unified-plan artifact contract")
    expect(universalBrainstorming).toContain("Do not write `artifact_contract: ce-unified-plan/v1`")
    expect(universalBrainstorming).toContain("let `ce-plan` choose the universal/knowledge-work artifact shape")
  })

  test("brainstorm handoff passes the unified plan path to ce-plan", () => {
    expect(brainstormHandoff).toContain("same unified plan file")
    expect(brainstormHandoff).toContain("Pass the unified")
    expect(brainstormHandoff).toContain("Recommended next step: `ce-plan <plan artifact path>`")
    expect(brainstormHandoff).toContain("Hidden by default for requirements-only artifacts")
  })

  test("ce-plan enriches unified plans in place and preserves legacy inputs", () => {
    expect(planSkill).toContain("requirements-only unified plan")
    expect(planSkill).toContain("enriches that same artifact")
    expect(planSkill).toContain("this run enriches that same file in place")
    expect(planSkill).toContain("Search `docs/brainstorms/`")
    expect(planSkill).toContain("create a new unified plan in `docs/plans/`")
    expect(planSkill).toContain("product_contract_source: ce-plan-bootstrap")
    expect(planSkill).toContain("artifact_readiness: implementation-ready")
    expect(planSkill).toContain("Definition of Done")
    expect(planSkill).toContain("Goal Launch Block is a thin launcher")
  })

  test("ce-work and ce-work-beta are readiness-aware before execution", () => {
    expect(ceWork).toContain("classify `artifact_readiness` before reading the body")
    expect(ceWork).toContain("requirements-only` -> stop")
    expect(ceWork).toContain("Any other readiness value")
    expect(ceWork).toContain("metadata, build a heading/anchor map")
    expect(ceWork).toContain("Do not send \"read the whole plan\"")
    expect(ceWork).toContain("mode:caller-owned-tail <plan-path>")
    expect(ceWork).toContain("standalone_shipping_skipped: true")
    expect(ceWork).not.toContain("artifact_readiness: approach-plan")

    expect(ceWorkBeta).toContain("not the primary unified-plan executor")
    expect(ceWorkBeta).toContain("mirror stable")
    expect(ceWorkBeta).toContain("requirements-only")
  })

  test("lfg delegates implementation to ce-work caller-owned-tail mode", () => {
    expect(lfg).toContain("artifact_readiness: implementation-ready")
    expect(lfg).toContain("execution: code")
    expect(lfg).toContain("any unrecognized readiness value")
    expect(lfg).toContain("LFG never launches `/goal` directly")
    expect(lfg).toContain("mode:caller-owned-tail <plan-path-from-step-1>")
    expect(lfg).toContain("standalone_shipping_skipped: true")
    expect(lfg).toContain("ce-code-review` skill with `mode:agent plan:<plan-path-from-step-1>`")
    expect(lfg).not.toContain("artifact_readiness: approach-plan")
  })

  test("review and publishing skills understand unified artifacts", () => {
    expect(docReview).toContain("unified-requirements")
    expect(docReview).toContain("unified-plan")
    expect(docReview).toContain("Product Contract only")
    expect(docReview).toContain("HTML unified artifacts")
    expect(docReview).toContain("section slice")
    expect(docReview).toContain("product_contract_source: ce-brainstorm")
    expect(docReview).toContain("product_contract_source:<value>")
    expect(docReviewTemplate).toContain("product_contract_source:ce-brainstorm")
    expect(docReviewTemplate).toContain("product_contract_source:ce-plan-bootstrap")

    expect(codeReview).toContain("docs/plans/*.{md,html}")
    expect(codeReview).toContain("Product Contract` -> `### Requirements")
    expect(codeReview).toContain("readiness before checking completeness")
    expect(codeReview).toContain("must not trigger implementation-unit completeness findings")

    expect(proof).toContain("Only publish markdown")
    expect(proof).toContain("requirements-only")
  })

  test("docs and adjacent handoffs use the new convention", () => {
    expect(ideate).toContain("requirements-only unified plan under `docs/plans/`")
    expect(agents).toContain("New `ce-brainstorm` outputs are requirements-only unified plans")
    expect(agents).toContain("Historical `docs/brainstorms/*-requirements.*` files remain readable legacy inputs")
  })
})
