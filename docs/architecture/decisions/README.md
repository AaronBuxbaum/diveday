# Architecture Decision Records

One record per significant, hard-to-reverse choice: frameworks, storage, auth, new runtime
dependencies, data-model spines, external services. Not for reversible detail such as component
naming or routine file moves.

Use the `adr` skill (`.claude/skills/adr/`) or copy [0000-template.md](0000-template.md).

## IDs and parallel work

Historical ADRs retain their `NNNN-slug.md` filenames and `NNNN` headings. New ADRs use a
collision-resistant `YYYYMMDD-short-slug.md` filename and the same complete id in the heading,
for example `20260718-waiver-signature-storage.md`.

Do not allocate the next integer and do not reserve an id in a branch-local ledger. Use the branch
or feature slug so independently-created ADRs normally land in different files. The repository
check validates filename/heading alignment, metadata, statuses, required sections, duplicate ids,
the word cap, code quotes and the index below.

Statuses: **Proposed**, **Accepted**, **Deprecated**, or **Superseded by <id>**. Never silently edit
an accepted ADR's decision; write a new record that supersedes it.

## Quoting code

A fenced block whose first line is `// <path>:<line>` (or `<line>-<line>`) quotes that file from that
line on, and `pnpm check:adrs` fails when a line differs after trimming, naming the line actually
there. A bare `` `path:line` `` citation is not checked, so quote the lines a reader must trust.

## Length

An ADR dated after 2026-10-10 holds at most 500 words, HTML comments not counted: the decision and
the reasons a reviewer needs. The incident narrative, the measurements and the rejected drafts go in
the PR, an issue or `docs/`, linked from Context. `pnpm check:adrs` enforces it; older records are
left as they are.

## Index

There is no stored table: a table every new ADR appended a row to was the file two stacked layers
always conflicted on. `node scripts/adr-index.mjs` prints one row per record (the id, which is the
file name without `.md`, and the first five words of its title; a struck-through title names the
record that superseded it). To find one, grep this directory for the id or a word of the decision.
