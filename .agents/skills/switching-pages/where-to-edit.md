# Switching pages: where to edit

Part of the **switching-pages** skill ([SKILL.md](SKILL.md)). Read it before the first edit to a switching guide, to find the file that owns each part of it.

## Where to edit

| Change | File |
| --- | --- |
| Guide content (steps, scope notes, `coexist` block, `sources`) | `src/lib/migration-guides.ts` — one `MigrationGuide` entry per incumbent |
| The shared guide composition (hero, move rail, scope/import phases, CTAs, sources) | `src/app/switching/_components/guide.tsx` |
| Which phases a guide renders, and its own prose sections | `src/app/switching/[competitor]/page.tsx`, `src/app/switching/spreadsheet/page.tsx` |
| Words every guide shares (the rail, the scope table, the importer walkthrough, the CTAs) | `switching.common.*` in the diver bundles |
| Hub page (the guide index) | `src/app/switching/page.tsx` |
| Import scope table (never paraphrase it) | `IMPORT_HONESTY_TABLE` in `src/lib/import.ts` |

A guide is a **live page only** — registering a `MigrationGuide` entry publishes it immediately,
there is no draft/planned state. Only add one once its incumbent's export path is actually
verified.
