# demo-preview

This module owns a demo shop built ahead of time for one prospect, and the record of what happened to the link that opens it (ADR 20261116-demo-previews). It publishes its contract through `index.ts`.

## Owns

- `rules.ts`: what a preview may be dressed in, how long its link lasts, and whether a row is still open.
- `store.ts`: building a preview, finding one by its link, and recording a fetch, an open and real activity.

## Does not own

The demo shop itself (`src/db/seed/index.ts`), the demo reaper (`src/db/seed/demo-lifecycle.ts`), sign-in (`src/app/actions/demo.ts`), and the page (`src/app/(token)/preview/[token]`).

## Invariants

A fetch is never an open and an open is never activity: a mail scanner fetches, a browser opens, and only input inside the shop is a person. A preview whose shop the reaper has taken reads as ended.
