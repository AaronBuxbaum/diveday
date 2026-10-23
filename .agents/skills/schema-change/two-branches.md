# Schema change: two branches, two migrations

Part of the **schema-change** skill ([SKILL.md](SKILL.md)). Read it when your branch and another both add a migration, after merging `main` or a stack layer that carries one, or when `drizzle-kit check` or `pnpm check:migrations` reports two heads.

## Two branches, two migrations

`drizzle/` is a **DAG, not a list.** Each migration folder carries a `snapshot.json` naming its
parents in `prevIds` (drizzle-kit 1.0 dropped `journal.json`, which is why nothing conflicts in git
any more). A branch cut from main today generates a migration whose `prevIds` point at whatever
main's head was *then* — so two sessions that each add a migration and each merge cleanly leave the
graph with **two open heads**.

`drizzle-kit check` compares every pair of open heads by the footprints their snapshots record.
Two heads that write different objects — even two new columns on `shops` — are fine and stay quiet.
Two heads that write the same object — one column added twice, or altered both ways — are refused, and the same walk runs inside
`drizzle-kit migrate`, i.e. **inside the production build**. On 2026-08-22 that is exactly how it
was found: `main` deployed, died at 11:58 printing a tree diagram, and the offending change was
already merged.

**The fix is never to rewrite either migration.** They are both correct; they just never met.

```
pnpm db:merge
```

That writes one migration folder whose SQL is empty and whose snapshot names every open head as a
parent, closing the diamond — drizzle compares open heads only, and this leaves one. drizzle-kit
1.0.0-rc.5 refuses `generate --ignore-conflicts`, and its `--fix-conflicts` deletes migrations
production already ran, so the script writes the folder itself. Commit it alongside whatever provoked it. `drizzle/20260822212616_merge-migration-heads`
is the worked example, and its SQL comment explains itself to whoever opens it next.

`pnpm db:merge` then **probes with a plain `generate`**, and that is not decoration. A merge
folder once kept one head's state whole when the two heads **shared a parent**, and the next
`pnpm db:generate` re-emitted the lost column as a fresh `ADD COLUMN` against a database that
already had it (issue #852). A version-9 merge snapshot carries no state — drizzle rebuilds it from
the parents — so the probe must find nothing to write; if it finds SQL, the script prints it and
fails, and either your schema has pending changes or the rebuild lost a head.

Two things to hold on to:

- **Read the diagram before running it.** If two branches genuinely add the *same* column, a merge
  folder silences the check and the second `ADD COLUMN` still fails against a real server. The
  `real-postgres` CI job catches that; the resolution there is to regenerate one migration on top of
  the other, not to merge.
- **A merge folder is not a substitute for rebasing.** If you are still on your branch and main has
  moved, rebase and regenerate — that produces a single head with no extra folder at all. `pnpm
  db:merge` is for the case where both migrations are already on main.
