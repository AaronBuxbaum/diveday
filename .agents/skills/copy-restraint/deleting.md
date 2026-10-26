# Copy restraint: deleting a string, and sweeping a surface

Part of the **copy-restraint** skill ([SKILL.md](SKILL.md)). Read it once a sentence fails the filter and has to go, and before sweeping a whole surface.

## Deleting a string, mechanically

Copy lives in bundles ([i18n-copy](../i18n-copy/SKILL.md)), so a deletion is three edits, and all
three ship together:

1. Delete the `t("…")` call site (and any `<p>` that existed only to hold it).
2. Delete the key from `src/i18n/locales/en-US/…`.
3. Delete the same key from `src/i18n/locales/es-ES/…` — `pnpm check:locale` fails on a key that
   exists in one locale and not the other, in **either** direction.

Then `pnpm e2e:affected`, which names every spec still quoting a sentence you deleted — and, because a
deleted paragraph changes a layout, look at the surface in light ([verify](../verify/SKILL.md)).

Deleting copy usually **lowers** the `check:copy` / `check:domain-strings` counts, which is fine:
both baselines sit at zero and the checks refuse an increase, never a decrease.

## Sweeping a surface

When you open any page, read it once as a stranger before you read it as its author:

1. Read every sentence out loud in order. Cross out each one that repeats the heading, the label,
   the button, or the row above it.
2. For each survivor, name the thing the reader would get wrong without it. No answer → cut.
3. Count what is left. A staff surface with more than one explanatory sentence per section is
   still over-written.
4. Look at it. Deleting copy is a layout change: a section whose subtitle is gone may now need
   its spacing revisited, not just its paragraph removed.
