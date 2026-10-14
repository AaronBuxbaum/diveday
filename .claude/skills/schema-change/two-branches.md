# Schema change: two branches, two migrations

Part of the **schema-change** skill ([SKILL.md](SKILL.md)). Read it when your branch and another both add a migration, after merging `main` or a stack layer that carries one, or when `drizzle-kit check` or `pnpm check:migrations` reports two heads.

## Two branches, two migrations

`drizzle/` is a **DAG, not a list.** Each migration folder carries a full `snapshot.json` naming its
parents in `prevIds` (drizzle-kit 1.0 dropped `journal.json`, which is why nothing conflicts in git
any more). A branch cut from main today generates a migration whose `prevIds` point at whatever
main's head was *then* — so two sessions that each add a migration and each merge cleanly leave the
graph with **two open heads**.

`drizzle-kit check` walks every fork point and compares the branches hanging below it. Two heads
that touch different tables are fine and stay quiet. Two heads that touch the same object — two
columns on `shops`, which this repo does most weeks — are refused, and the same walk runs inside
`drizzle-kit migrate`, i.e. **inside the production build**. On 2026-08-22 that is exactly how it
was found: `main` deployed, died at 11:58 printing a tree diagram, and the offending change was
already merged.

**The fix is never to rewrite either migration.** They are both correct; they just never met.

```
pnpm db:merge
```

That writes one migration folder whose SQL is empty and whose snapshot names every open head as a
parent, closing the diamond — a fork whose branches reach a common leaf is skipped by the walk
entirely. Commit it alongside whatever provoked it. `drizzle/20260822212616_merge-migration-heads`
is the worked example, and its SQL comment explains itself to whoever opens it next.

`pnpm db:merge` also **repairs its own snapshot**, and that is not decoration.
`drizzle-kit generate --custom` writes the merge folder's snapshot as *one head's
state whole* — losing the other's — whenever the two open heads **share a
parent**, which is the ordinary shape once a repository has merged a few times.
This repository shipped one: the merge closing `shop-units-confirmed` and
`dive-package-line-item` kept `dive_packages` and dropped
`shops.units_confirmed_at`, so the next `pnpm db:generate` re-emitted that column
as a fresh `ADD COLUMN` against a database that already had it (issue #852).

That failure is invisible where it is cheap to find — the merge folder's SQL is
empty either way, a fresh database applies the chain in order and is fine, and
every test passes. It fails against a database that already ran the original,
which is the `real-postgres` job or production. So the script now probes with a
plain `generate` afterwards, adopts that snapshot's state if anything was lost,
and says so on stdout. If it reports a repair, nothing is wrong with your change;
read the SQL it prints to see what had gone missing.

Two things to hold on to:

- **Read the diagram before running it.** If two branches genuinely add the *same* column, a merge
  folder silences the check and the second `ADD COLUMN` still fails against a real server. The
  `real-postgres` CI job catches that; the resolution there is to regenerate one migration on top of
  the other, not to merge.
- **A merge folder is not a substitute for rebasing.** If you are still on your branch and main has
  moved, rebase and regenerate — that produces a single head with no extra folder at all. `pnpm
  db:merge` is for the case where both migrations are already on main.
