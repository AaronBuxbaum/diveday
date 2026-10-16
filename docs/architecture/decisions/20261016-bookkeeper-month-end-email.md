# 20261016-bookkeeper-month-end-email — The month's files may be emailed to one address outside the shop

- **Status:** Accepted (2026-10-16)
- **Date:** 2026-10-16

## Context

Fifth-loop item 35. At the end of a month an owner downloads three CSVs from three places: the
report, the orders and the crew sheet. Then they email them to whoever keeps the books. Every
other DiveDay email goes to a diver, to staff, or to a shore contact who confirmed a link. This
one sends diver names, crew names and money every month to someone outside the shop's staff, with
nobody pressing Send.

## Decision

- **One download.** "Download month-end files" on the month's report gives one zip of the three
  files. The separate downloads use the same builders, so the zip and the separate files always
  match. The zip needs an owner or manager (`canPersonExportShopData`, live roles) and the export
  step-up.
- **One address, set behind the same gate.** An owner or manager sets `shops.bookkeeper_email`
  on Reports, after the export step-up. A database check stores the address only together with
  who set it and when (`shops_bookkeeper_email_provenance`). Emptying the field turns the email
  off. A new address starts with the *next* month, so saving one never sends anything at once.
- **Sent once, on the 2nd.** A cron runs on the 2nd and 3rd (`9 13 2,3 * *`) and sends the
  previous month, counted in the shop's zone. Each send first claims the month in one statement
  (`bookkeeper_sent_month`), and only while the address is unchanged. If the send fails, the
  claim is released. Demo shops are never sent.
- **The files are never stored.** The notification kind cannot be queued. A failed send is
  retried by the next pass, which rebuilds the files; the send queue would have kept a copy.
  Logs name the shop and the month, never the address or the files.
- **The email says how it arrived.** It names the shop and tells the reader to ask the shop to
  remove the address. The reader has no account to unsubscribe from.
- **The address is personal data.** Erasing a diver whose address it is clears it. The shop
  export leaves it out, so restoring a backup never starts the send again.

## Alternatives considered

- **Confirm the inbox first**, as the shore contact does (H-118). This catches a typo, but needs
  a token table and a page for someone with no account. Left as a follow-up.
- **Email a link instead of the files.** The link would be a bearer token to the shop's money,
  live for days, in a mailbox DiveDay does not control.
- **Several addresses.** One bookkeeper needs only one.

## Consequences

A typo in the address sends one month to a stranger before anyone notices. Three things keep it
to one month: the step-up, the next-month start, and the email's own line telling the reader to
ask the shop to remove the address. Add inbox confirmation if a shop reports one.
