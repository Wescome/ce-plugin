export const meta = {
  name: 'concurrent-fanout',
  description: 'Dispatch N ready plans concurrently via lfg, each in its own worktree',
  phases: [
    { title: 'Fan-out dispatch', detail: 'lfg <plan-path> per item, isolation: worktree, then ce-compound on ship' },
  ],
}

// R4: v1 targets a small, explicit caller-supplied list — no auto-discovery of what's
// "ready" in docs/plans/. Items may be a docs/plans/ path or a Specification id; this
// script has no filesystem access at all (confirmed empirically — see the plan's U4
// spike), so it cannot resolve an id to a path itself. That resolution, and every other
// piece of real work, is delegated into the dispatched agent's own prompt below — this
// script does dispatch, argument construction, and result collection only (R3).
const items = args
if (!Array.isArray(items) || items.length === 0) {
  throw new Error(
    'concurrent-fanout requires args: an array of docs/plans/ paths (or Specification ids) to dispatch, ' +
    'e.g. Workflow({ name: "concurrent-fanout", args: ["docs/plans/a.md", "docs/plans/b.md"] })'
  )
}

phase('Fan-out dispatch')
log(`Dispatching ${items.length} item(s) concurrently via lfg, each in its own worktree`)

const ITEM_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['shipped', 'blocked', 'errored'] },
    planPath: { type: 'string' },
    summary: { type: 'string' },
    prUrl: { type: ['string', 'null'] },
    branch: { type: ['string', 'null'] },
  },
  required: ['status', 'planPath', 'summary'],
}

const dispatches = items.map((item) => () => agent(
  `You are one worker in a concurrent multi-feature fan-out. You were given this identifier: ${item}\n\n` +
  `Step 1 — Resolve the plan path. If "${item}" is a path to an existing file, that IS the plan path — use it ` +
  `directly. Otherwise (e.g. a bare "Specification:<hash>" id, not a path), read docs/.governance/.by-source.json ` +
  `and find the entry whose value equals "${item}"; the corresponding key (a repo-relative path) is the plan path. ` +
  `If neither resolves, stop now and report status "errored" with an explanatory summary — do not proceed.\n\n` +
  `Step 2 — Before anything else, write a file at the root of your current working tree named ".ce-fanout-plan" ` +
  `containing exactly one line: the resolved plan path (no quotes, no extra whitespace). This lets the governance ` +
  `hooks in this worktree attribute their trace to the right plan, since the driver dispatching you has no ` +
  `filesystem access to write this marker itself.\n\n` +
  `Step 3 — Invoke the "lfg" skill (resolve its exact name against your available-skills list first, per lfg's own ` +
  `convention for referencing other skills) with the resolved plan path as its argument. Follow lfg's own ` +
  `instructions exactly as written, in order — do not skip, reorder, or reinterpret any step. lfg owns the entire ` +
  `plan-to-CI-watch pipeline for this item end to end (implementation, simplification, review, browser test, ` +
  `shipping, and CI watch-and-repair); your job is only to dispatch it faithfully and relay what it reports.\n\n` +
  `Step 4 — Once lfg reaches a terminal state (it outputs <promise>DONE</promise>, stops blocked on an unresolved ` +
  `issue, or errors), determine the outcome:\n` +
  `  - "shipped": lfg completed its pipeline (CI-confirmed-green, or CI failures durably recorded in the PR body ` +
  `after lfg's own bounded repair loop was exhausted — either way lfg reported a terminal, not-hung state with a PR).\n` +
  `  - "blocked": lfg stopped because of an unresolved refuted Verdict, a non-software task, a non-implementation-` +
  `ready plan, or any other explicit stop condition it reported — not a hang.\n` +
  `  - "errored": something failed outside lfg's own contract (e.g. a tool error, an exception, lfg itself could ` +
  `not be invoked).\n\n` +
  `Step 5 — If and only if the outcome is "shipped", invoke the "ce-compound" skill to capture any durable ` +
  `learning from this item's work. If ce-compound finds nothing worth capturing, that is a valid outcome — do not ` +
  `force a learning that isn't there. Do not invoke ce-compound for "blocked" or "errored" outcomes.\n\n` +
  `Step 6 — Report back via the required structured output: status, the resolved planPath, a summary paragraph ` +
  `describing exactly what lfg (and ce-compound, if invoked) reported — including the PR URL if one was opened and ` +
  `the branch you ended up on. Relay lfg's own terminal report faithfully; do not substitute your own judgment ` +
  `about whether the outcome is acceptable.`,
  { label: `fanout:${item}`, phase: 'Fan-out dispatch', isolation: 'worktree', schema: ITEM_RESULT_SCHEMA }
))

const results = (await parallel(dispatches)).filter(Boolean)

const shipped = results.filter(r => r.status === 'shipped')
const blocked = results.filter(r => r.status === 'blocked')
const errored = results.filter(r => r.status === 'errored')
log(`${shipped.length}/${items.length} shipped, ${blocked.length} blocked, ${errored.length} errored`)

return { results, shipped, blocked, errored }
