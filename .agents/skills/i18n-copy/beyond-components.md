# i18n copy: copy outside components, and what is exempt

Part of the **i18n-copy** skill ([SKILL.md](SKILL.md)). Read it when a sentence comes from `src/lib` or `src/db`, an email, a metadata field or an error, or when you think a string is exempt.

## Copy that is not in a component

**A domain layer must return codes, not sentences.** `src/lib` and `src/db` state facts; `src/app`
and `src/components` choose words. An English string returned from a query is copy the JSX scanner
never sees — it reaches a page through a variable reference (`{blocker.message}`), not a string
literal — and `pnpm check:domain-strings` is what catches it instead
(`node scripts/check-domain-strings.mjs --report src/lib` to see what it sees, same workflow as
`check-copy.mjs`). A data module whose *job* is feeding words to pages doesn't get codes — it gets
message-bundle **keys** (`DiverMessageKey`-typed, the `src/lib/marketing.ts` pattern) and a place
in the script's `proseFreeFiles` list, which fails on any prose literal outright rather than
ratcheting. This was a real, previously-silent gap — see ADR
[20260731-domain-layer-copy-leaks](../../../docs/architecture/decisions/20260731-domain-layer-copy-leaks.md)
for the fourteen files it found on first run.

```ts
// src/db/staffing.ts
export type StaffingGapCode = "no_crew" | "course_needs_instructor" | "no_shift_coverage";
```

```tsx
// the page
<li>{t(GAP_KEYS[gap])}</li>
```

When the same code renders on both a staff and a diver surface, each caller gets its **own**
`Record<Code, MessageKey>` against its own bundle — the domain function never imports from
`src/i18n` or picks a bundle itself (see `src/i18n/readiness-labels.ts`'s
`CERTIFICATION_LEVEL_KEYS` vs `DIVER_CERTIFICATION_LEVEL_KEYS` for the worked example). A param
that needs interpolation and is itself a word, not a raw number (a certification-level name, an
agency name), gets resolved through its own key-map *before* being interpolated into the parent
template — never a raw code passed into `t()`.

`check-domain-strings.mjs` only flags object-literal properties named `message`, `label`, `text`,
`reason`, or `summary` holding a string-literal sentence — the same narrow discipline
`check-copy.mjs` uses for its `.ts` label-map scan. It will not catch every shape (a template
literal with `${}` interpolation reads as code and is skipped on purpose, to avoid false-positiving
on ordinary expressions), so a `_LABELS`-suffixed const or a new `.message` field is still on you in
review even when the scanner stays quiet. Content data that a shop or DiveDay authors directly as
data — course template `summary`/`overview` text, seeded course-path descriptions, migration-guide
marketing prose — is not this bug class; it's exempt the same way the waiver body is, with a stated
reason.

## Genuinely exempt

Each needs a stated reason; the check requires the text after the colon.

- `{/* i18n-exempt: reason */}` — that line and the next.
- `// i18n-exempt-file: reason` — the whole file.

Legitimate cases: a scanner false positive, a brand name, a code sample. Also exempt by
convention and needing no marker:

- **Static `metadata.title`** — Next resolves it before locale negotiation can run.
- **The waiver body and medical questionnaire** — legally reviewed wording; translating it is a
  sign-off decision (H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit in [human-decisions/](../../../docs/product/human-decisions/README.md)),
  not an engineering one.

Not exempt: marketing pages under `src/app`/`src/components`. They go through `diver.json` like
everything else on those routes. Also not exempt: **data modules that feed the UI.**
`src/lib/marketing.ts`, `src/lib/migration-guides.ts`, and `src/lib/demo-roles.ts` are
key registries — they hold `DiverMessageKey` values and structure (slugs, ordering, URLs,
the price figure), and the words live in the bundles under `marketing.price/export/capabilities/
featurePages/guides.*`. These files are listed in `check-domain-strings.mjs`'s `proseFreeFiles`
and hard-fail on any prose literal without an `// i18n-exempt: reason` marker (reserved for
genuine non-language: proper names, cited document titles, currency figures). When a new data
module starts feeding words to a page, add it to `proseFreeFiles` in the same change.

**Adding any user-visible sentence means adding it to every locale's bundle at once** — there is
no English-first workflow; a key present in one locale and missing in another fails
`pnpm check:locale`.
