---
paths:
  - "infra/**"
  - "config/**"
  - ".env.example"
  - "scripts/render-env-example.mjs"
  - "scripts/aws-*.mjs"
---

# Rules for `infra/` and configuration

Loaded when the CDK stack, the env registry or a deploy script is read.

- **Environment variables — adding one, or asking who supplies one**: one registry,
  `config/env-registry.mjs`: per key, who produces it (`stack` / `derived` / `manual`), which
  destinations carry it, and what being absent costs. **A value this repository already knows is
  not configuration and does not go here** — DiveDay's own origin, sender, Connect client id and
  Sentry DSN are compiled in beside the code that reads them, behind `src/lib/configured.ts`, with
  their variables surviving only as overrides; deploying a value the repo already knows is a round
  trip that can corrupt it, and once did (issue #517). Everything derives from the registry:
  `.env.example` is generated (`node scripts/render-env-example.mjs --write`), `.env.manual` is the
  only file a human edits (`pnpm env:manual`), `.env.local`/`.env.vercel`/`.env.github` are
  generated from the credentials secret plus `.env.manual`, and nothing merges: a stack-produced key
  in `.env.manual` is refused, not ignored. Add a variable there and nowhere else (ADR
  20260812-env-provenance-registry). `pnpm check:env` states the two structural facts and reports
  which manual values are unset — a report, never a failure.
- **AWS credentials, and what deploying still leaves for a human**: one Secrets Manager secret
  holding a filled-in `.env.example` (§16 of `infra/lib/infra-stack.ts`), and one registry of manual
  steps (§17, `infra/lib/manual-actions.ts`) that renders to both stack outputs and the generated
  [docs/engineering/manual-actions.md](../../docs/engineering/manual-actions.md). Add a step to the
  registry, never to a runbook; regenerate with `pnpm test infra -u`. Reasoning in
  [docs/engineering/infrastructure-runbook.md](../../docs/engineering/infrastructure-runbook.md).
- **Logs, metrics, alarms, dashboards**: what is counted and alarmed is one registry,
  `infra/lib/observability.ts`, expanded in §13 of the stack; add a signal there, never a graph at a
  call site. An `$.event` code (`src/lib/log.ts`) and a vital's `field` are contracts a test reads
  out of `src/` — renaming one silently stops a metric filter counting. All browser telemetry
  mounts through the one `src/app/observability-client.tsx` so the capability-URL redaction cannot
  be bypassed. Setup, thresholds, cost and troubleshooting in
  [docs/engineering/cloudwatch-observability-runbook.md](../../docs/engineering/cloudwatch-observability-runbook.md).
- **ASCII only** in everything a deploy carries out of the repo — all of `infra/`,
  `config/env-registry.mjs`, `scripts/render-env-example.mjs` and `.env.example`. An em dash and two
  `≤`/`≥` came back from a real deploy as `?` (`scripts/check-infra-ascii.mjs`, ADR
  20260812-diff-role-assumes-file-publishing-role).
- **Node majors** are three constants in `scripts/check-node-version.mjs` (`NODE_MAJOR`,
  `NODE_FLOOR`, `LAMBDA_NODE_MAJOR`); change them there first and the guard names every declaration
  still to follow. The Lambda major is deliberately separate from the toolchain major.
- **Delivery pipelines**: SMS receipts are §10 of the stack with
  [docs/engineering/sms-delivery-receipts-runbook.md](../../docs/engineering/sms-delivery-receipts-runbook.md);
  email in [docs/engineering/ses-email-runbook.md](../../docs/engineering/ses-email-runbook.md);
  WhatsApp in [docs/engineering/whatsapp-cloud-api-runbook.md](../../docs/engineering/whatsapp-cloud-api-runbook.md).
  Mail *to* DiveDay is hosted mailboxes, not code.
- **Every AWS, Vercel and `gh` call is bounded** through `scripts/subprocess.mjs`; a synthesized
  stack is the only place a credential can leak into an output, and `infra/**/*.test.ts` is in the
  `pnpm check` gate for that reason. Nothing here logs a command's environment, stdin or output.
- A new AWS service, vendor or runtime dependency is an ADR (the **adr** skill); vendor swaps are
  rows in [docs/architecture/aws-migration-dossier.md](../../docs/architecture/aws-migration-dossier.md)
  awaiting H-45.
