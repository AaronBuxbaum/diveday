# 20260806-one-data-out-surface — Getting your data out is one surface, not two

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

DiveDay shipped two settings routes for one promise:

- `/shop/[shopSlug]/settings/export` — the "leave anytime" download
  ([20260722-full-shop-export](20260722-full-shop-export.md)): a row-count manifest of the bundle
  and one button, ~109 lines.
- `/shop/[shopSlug]/settings/backup` — the weekly delivery to storage the shop owns
  ([20260804-shop-owned-backup-export](20260804-shop-owned-backup-export.md)): destination form,
  test delivery, disconnect, and a paginated delivery history, ~394 lines.

They are not neighbours that happen to sit near each other. They are the same thing twice:

- **The same bundle.** `src/features/backup-export/run-backup.ts` imports `loadShopExportBundleInput`
  from `@/db/export`. A backup is literally the export bundle, built by the export loader, on a
  schedule, to a bucket. The surface's own copy already said so out loud —
  `backup.how.weekly` reads *"It's the same bundle as the Data export download."*
- **The same gate.** Both pages call `canPersonExportShopData(db, shopId, personId)`, checked
  against the database rather than the JWT, and bounce to Today with a notice on refusal. There is
  no person who may do one and not the other, and there never could be: both hand over the whole
  roster's medical evidence.
- **The same moment.** A shop opens either one asking one question — *how do I get my data out, and
  keep getting it?* — and the honest answer needs both halves. Reading the download manifest tells
  you what a backup contains; the backup history tells you whether the download you would otherwise
  have to remember to click is already happening.

[20260804-day-closeout](20260804-day-closeout.md) states the bar a route has to clear to exist: a
**different question**, its **own mutation**, and its **own moment**. Backups clears exactly one of
the three, and only barely — its mutations configure the delivery of the other page's artifact.

The cost was the ordinary one. Two page shells and two loading skeletons to keep in step; a shop
that configures a backup with no idea what is in it, and a shop that downloads a ZIP every month
never learning it could stop; two adjacent sub-nav tabs and two adjacent hub cards that a reader
has to open in turn to answer one question. The settings sub-nav — derived from the one registry in
`src/app/shop/[shopSlug]/settings/settings-destinations.ts` — made the duplication visible:
**Backups** and **Data export** sat side by side in Data & integrations, one word apart.

## Decision

**One surface — `/shop/[shopSlug]/settings/export` — in two halves, and `/settings/backup` is a
308 to it.**

- The page keeps the export header and its download button, then the bundle manifest ("what you'd
  take"), then a `#backups` section carrying the whole backup half verbatim: status, test delivery,
  destination form, how-it-works, delivery history with its shared `Pager`, and disconnect.
- **The gate is checked once, in one place**, at the top of the merged page, before any of the four
  data loads. The three backup server actions
  (`settings/export/actions.ts`, moved from `settings/backup/actions.ts`) keep re-checking it
  themselves on every mutation — hiding is not a gate, and a server action is reachable without the
  page.
- **`/settings/export/download` does not move.** A capability URL need not live under its page; it
  re-runs `canPersonExportShopData` itself, so nothing about its protection depends on which page
  links it. Not moving it also means no redirect stands between a shop and its own bytes.
- **`/settings/backup` stays forever as a `permanentRedirect`**, carrying the full query string and
  landing on `#backups`. Removing a surface never removes the destination — the same rule
  [20260803-not-ready-is-a-view](20260803-not-ready-is-a-view.md) and
  [20260803-public-shop-namespace](20260803-public-shop-namespace.md) already set. The redirect route
  authorizes nothing, deliberately: its target re-runs the gate on arrival, so it can disclose
  nothing the target would not.
- **The registry loses an entry, not a group.** `settings-destinations.ts` drops `backup`; the
  sub-nav and the hub's groups both derive from it, so the tab disappears from both with one edit.
  A redirect is never registered there — the sub-nav would carry a tab no pathname can equal.
- **The settings hub keeps both doors.** "Set up backups" and "Data export" are two different
  questions a shop arrives with, so both cards stay; the backup card deep-links to
  `/settings/export#backups`.
- **No copy was re-authored.** Every string is an existing `settings.export.*` or `backup.*` key,
  moved. The page title stays *Data export*, which is what a backup is.

## Alternatives considered

- **Keep both routes, cross-link them.** The status quo plus a link. It leaves both shells, both
  skeletons, both sub-nav tabs, and the split answer in place — it treats a duplication as a
  wayfinding problem.
- **Keep `/settings/backup` as the survivor and 308 export into it.** Rejected on two counts. The
  download endpoint would then live at `/settings/export/download`, under a segment whose page is a
  redirect stub — a live capability parented by a ghost. And "backup" names the smaller half:
  export is the superset, since the backup *is* the export.
- **Rename both to a fresh `/settings/data`.** Two 308s and two sets of stale links instead of one,
  plus new copy in every locale, to gain a word. `import` also lives under Data & integrations and
  is deliberately not part of this surface (data *in* is a different question, a different gate,
  and a different failure mode), so `/settings/data` would promise more than it delivers.
- **Fold backups into the hub as an inline card.** The delivery history is a paginated list of
  evidence. Inlining it would either truncate the evidence or make the hub — already the longest
  page in the staff app — considerably longer.

## Consequences

- One route, one gate check, one skeleton, one visual capture (`settings-export`; `settings-backup`
  is retired). The page is longer, and its two halves are separated by a heading rather than a
  navigation.
- `/settings/backup` bookmarks, the backup-and-restore runbook, and `?page=` deep links into the
  delivery history keep working, permanently. `e2e/backup.spec.ts` asserts the 308 preserves the
  query.
- The backup server actions now redirect to `/settings/export?notice=…`. The notice codes, their
  tones, and the write-only secret field are unchanged; the secret still travels one way only.
- A shop that opens Settings to configure a backup now reads what is in the bundle on the way past,
  and a shop that opens it to download once sees whether the copy is already happening weekly.
- If a future half of this surface earns its own moment — a restore flow, say, which is a different
  question with a genuinely different gate — it gets a route then, on the day it clears the bar.
