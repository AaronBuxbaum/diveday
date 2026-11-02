---
paths:
  - "infra/**"
  - "config/**"
  - ".env.example"
  - "scripts/render-env-example.mjs"
  - "scripts/aws-*.mjs"
---

# Rules for `infra/` and configuration

Loaded when the CDK stack, the env registry or a deploy script is read. The longer form of each
rule, with its incidents: [docs/agents/repo-checks.md](../../docs/agents/repo-checks.md#the-infra-rules).

- **Environment variables — adding one, or asking who supplies one**: one registry,
  `config/env-registry.mjs`: per key, who produces it (`stack` / `derived` / `manual`), where it
  goes, and what its absence costs. Add a variable there and nowhere else (ADR
  20260812-env-provenance-registry). **A value this repository already knows is not
  configuration**: it is compiled in behind `src/lib/configured.ts`, its variable only an override
  (deploying it once corrupted it, issue #517). `.env.example` is generated
  (`node scripts/render-env-example.mjs --write`); `.env.manual` is the only file a human edits
  (`pnpm env:manual`), and a stack-produced key in it is refused. `pnpm check:env` reports unset
  manual values, and fails under `VERCEL_ENV=production` on an unset `requiredInProduction` row.
- **AWS credentials, and what deploying still leaves for a human**: one Secrets Manager secret
  holding a filled-in `.env.example` (§16 of `infra/lib/infra-stack.ts`), and one registry of manual
  steps (§17, `infra/lib/manual-actions.ts`) rendered to the stack outputs and
  [docs/engineering/manual-actions.md](../../docs/engineering/manual-actions.md). Add a step to the
  registry, never to a runbook; regenerate with `pnpm test infra -u`
  ([infrastructure-runbook.md](../../docs/engineering/infrastructure-runbook.md)).
- **Logs, metrics, alarms, dashboards**: one registry, `infra/lib/observability.ts` (§13); add a
  signal there, never a graph at a call site. An `$.event` code (`src/lib/log.ts`) and a vital's
  `field` are contracts a test reads out of `src/`. All browser telemetry mounts through
  `src/app/observability-client.tsx`, so the capability-URL redaction cannot be bypassed
  ([cloudwatch-observability-runbook.md](../../docs/engineering/cloudwatch-observability-runbook.md)).
- **ASCII only** in everything a deploy carries out of the repo — all of `infra/`,
  `config/env-registry.mjs`, `scripts/render-env-example.mjs` and `.env.example`
  (`scripts/check-infra-ascii.mjs`).
- **Node majors** are three constants in `scripts/check-node-version.mjs` (`NODE_MAJOR`,
  `NODE_FLOOR`, `LAMBDA_NODE_MAJOR`); change them there first. The Lambda major is deliberately
  separate from the toolchain major.
- **Delivery pipelines**: SMS receipts are §10 of the stack with
  [sms-delivery-receipts-runbook.md](../../docs/engineering/sms-delivery-receipts-runbook.md);
  email in [ses-email-runbook.md](../../docs/engineering/ses-email-runbook.md); WhatsApp in
  [whatsapp-cloud-api-runbook.md](../../docs/engineering/whatsapp-cloud-api-runbook.md). Mail *to*
  DiveDay is hosted mailboxes, not code.
- **Every AWS, Vercel and `gh` call is bounded** through `scripts/subprocess.mjs`; a synthesized
  stack is the only place a credential can leak into an output, so `infra/**/*.test.ts` is in the
  `pnpm check` gate. Nothing here logs a command's environment, stdin or output.
- A new AWS service, vendor or runtime dependency is an ADR (the **adr** skill); vendor swaps are
  rows in [docs/architecture/aws-migration-dossier.md](../../docs/architecture/aws-migration-dossier.md)
  awaiting H-20260907-far-diveday-migrate-onto.
