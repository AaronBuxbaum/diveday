# 20261116-demo-previews — Build a demo shop for one prospect and learn whether they used it

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Cold emails to dive shops have produced no replies, and nothing recorded whether a shop tapped the link. Aaron asked for a demo built ahead in the prospect’s name, colours and location, opened by a link that lasts a week, with a way to know when an operator really looks and tells a mail scanner from a person.

The demo already mints a seeded shop per visitor (ADR 20260724-per-visitor-demo-shops), and a staff session already records real input. An operator is someone with database access; there is no hosted admin role (ADR 20261109-operator-browser-and-email-sign-in). How to use the feature: [preview-links.md](../../product/pilot-kit/preview-links.md).

## Decision

A **demo preview** is a minted demo shop plus one `demo_previews` row. `pnpm preview build <site>` runs where the operator's database access is, requests the prospect's public home page once, and creates the shop under the name, main colour and town it read; flags override the page. No logo is copied. Nothing is sent to the prospect: the command prints a link.

The link is `/preview/<row id>`. The random id is the capability, and the route is in the telemetry redaction list. It opens one demo shop of seeded divers for seven days. The page names the prospect and DiveDay, is not indexed, and posts to `enterPreviewAction` from the browser, which signs the visitor in as the demo's owner through the existing demo bypass. After the week, or once the reaper has deleted the shop, the page says the preview ended.

Three counts are kept apart: **requested** (any fetch of the page, which mail scanners do), **opened** (a browser ran the page and posted) and **used** (real input inside the shop, from the staff-activity touch). The founder is mailed once per preview, on the first real use, with the other counts beside it. A browser marked as the founder's own is never counted.

The row holds a business name and a public website and no person. It names its shop by id with no foreign key, so the reaper needs no change and the record outlives the shop, as `demo_entries` does. It is pruned after 400 days.

## Alternatives considered

- A hosted route behind a shared secret: rejected, because database access is the operator gate.
- Counting the open as interest: a scanner that runs scripts posts the form.
- Keeping an active preview's shop past the reaper: left to the reaper's own rule.
- Copying the prospect's logo and photographs: deferred. It needs media storage and a view on using another business's images.

## Consequences

Every staff-activity touch runs one indexed update that matches no row unless the shop is a live preview. A preview shop counts toward the minted-demo cap and can be evicted by it, in which case its link reads as ended. The name and colour read from a site are guesses, so the founder opens each preview before sending it.
