# waivers

Waivers and the medical questionnaire: the requirement, the party's queue, signing, the
guardian's copy, and the signed record.

## Owns

- `waivers-page.ts`, `signed-waiver-page.ts`, `party-waiver-queue.ts`, `requirement-form.ts`,
  `waiver-guardian-copy.ts`, `waiver-draft.ts` (a prompt module).

## Does not own

The waiver records and their integrity (`src/db/waivers.ts`, `src/lib/waiver-integrity.ts`), the
readiness gate that reads them (`src/lib/readiness.ts`), and erasure (`records`).

## Invariants

- A signed record is immutable; a correction is a new version.
- A medical answer that triggers referral fails closed.
- Submission is idempotent and authorized.
- A prompt module never reads medical answers or the medical alert (`pnpm check:assist-prompts`).
- Safety- and security-sensitive: a `dive-domain-expert` and a `security-reviewer` run.
