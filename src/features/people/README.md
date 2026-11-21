# people

The divers a shop knows: their record, profile, standing, photo, and telling two records apart
or merging them.

## Owns

- The record: `divers/`, `diver-record.ts`, `diver-profile.ts`, `diver-status.ts`,
  `diver-standing.ts`, `last-dive.ts`, `next-dive.ts`, `person-photo/`.
- Pages: `divers-page.ts`, `new-diver-page.ts`, `diver-merge-page.ts`.
- Identity: `same-person.ts` (the duplicate prompt), `identity-repoint.ts`,
  `contact-email-confirmation.ts`, `self-registration.ts`, `self-registration-delivery.ts`.

## Does not own

Erasure and anonymization (`records`), certification cards (`certifications`) and staff
accounts (`accounts`).

## Invariants

- Every read and write is scoped by the shop.
- `same-person.ts` is a prompt module: it never reads medical data (`pnpm check:assist-prompts`).
