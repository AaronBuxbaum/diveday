# Provider contract

The policy lives in AGENTS.md, path-scoped rules and the canonical `.agents/skills/` tree.
Claude exposes those skills through directory symlinks. Edit the canonical source; never copy a
body into a provider directory. `skills-lock.json` distinguishes local source from upstream
provenance. The agent guard checks real paths, frontmatter and referenced files in both trees.

## Start and resume

Run `pnpm agent:bootstrap --provider codex`, `claude`, or `other`. This read-only, offline command
reports branch, immutable HEAD, dirty paths, Node pin, dependency presence and durable task state.
It does not install dependencies, fetch, change branches or execute the next command. Investigate
a changed HEAD before trusting previous evidence. Process liveness is a hint: PID reuse means a
live PID is not proof of ownership; inspect the command before stopping anything.

| Capability | Claude repository adapter | Codex and other hosts |
| --- | --- | --- |
| Startup / resume context | SessionStart configured; execution depends on host | Explicit bootstrap command |
| Scoped rules | Host can load matching paths | Read rules returned by task packet |
| Format touched files | Configured lifecycle hook | Explicit Biome command on owned files |
| Shell refusals / failure hints | Configured hooks | Repository checks remain mandatory |
| Push verification | Same repository gate | Same repository gate |
| Handoff | Same task-state schema | Same task-state schema |

Configuration is not observed execution. The bootstrap intentionally reports hooks as unverified;
it cannot inspect global host configuration. Repository checks and CI enforce correctness across
providers. Host convenience adapters must never create unique product policy.

## Retrieve a bounded packet

`pnpm task:context <area>` gives invariants and focused tests. Broad design, architecture, glossary
and roadmap documents are optional references: search relevant headings, not whole documents.
`pnpm task:context --path src/db/bookings.ts` selects the most specific matching areas, required
rules and sibling contract tests. An unknown path points to the route map rather than inventing
a contract. The packet caps candidate test files and preserves all selected invariants.
`pnpm task:context --recipe <slug>` selects a concrete UI recipe. UI work still needs the actual
route, capture ID and changed state; a generic recipe is not visual proof.

## Durable handoffs and decisions

Run `pnpm task:state` for the current state or a template. Fill a JSON file and save it with
`pnpm task:state <file>`. Validation requires immutable base/head SHAs, owner, owned paths,
accepted decisions with exact text and provenance, check outcomes, visual evidence, owned
processes, pending reviews/CI, blockers and the next executable command. Both commits must exist
locally. Store no secrets or personal/medical data. Keep `.agent-out/task-state/<branch>.json` with the
checkout and attach it when responsibility moves to another machine; ignored local state is not
shared automatically. Human product decisions remain in `docs/product/human-decisions/`.

Each visual evidence entry should name its capture, route, viewport, state, head SHA and artifact.
Each check should name command, result and head SHA. Empty arrays mean there is no evidence yet,
not that a check passed. Before compaction or handoff save the latest accepted decisions and next
step; on resume reconcile HEAD and process ownership before continuing.

## Measurement limits

The context guard is a repository startup estimate, with separate Claude and canonical provider
profiles. It excludes host prompts, tool schemas, memory and installed plugins. Record observed
input, cached input and output separately using task metrics; unknown values remain unknown.
Compare first-green time, corrections and cost per landed task across similar task classes.

The first successful state save records a `started` metric at observation time, deduplicated by
task identity. Set optional `provider` and `taskClass` fields for cohort attribution; otherwise
they remain unknown. A later save does not invent an earlier start or duplicate the observation.
Successful push verification records `verified` when state exists. Import downloaded CI evidence
with `pnpm task:metrics --import-ci <ci-result.json>`; run/attempt identities prevent duplicate
observations. Start and verified events contain no inferred token usage. If metric storage fails,
the state remains saved and the command reports the missing observation; a later save retries.
