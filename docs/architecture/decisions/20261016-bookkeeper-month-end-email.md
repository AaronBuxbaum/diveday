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
- **The inbox confirms before anything goes.** A new or changed address gets a confirm link
  that carries no files, valid for a week; until it is used, the pass sends nothing
  (`shops.bookkeeper_confirmed_at`, security review B1, on the shore contact's model, H-118).
  The link is single-purpose and stored as a hash on the shop row, beside the address it can
  confirm: any change of address clears both, so a link can never confirm an address it was not
  sent to. Saving an unconfirmed address again sends the link again, rate-limited per shop and
  per recipient as the shore contact's is. The confirm page is `/confirm-contact/[token]`, shared
  with the front desk's and the shore contact's links.
- **Every owner hears about it.** Setting, changing or removing the address writes an activity
  line and emails every owner who can sign in, and so does every month's send ("Month-end files
  for September 2026 sent to …"), so an address nobody meant to keep shows up in an owner's inbox
  (security review B1, F1). Reports shows who set the address and when.
- **The address lasts only as long as its setter's authority.** Before each send the pass checks
  that whoever set the address still passes `canPersonExportShopData`. If not, nothing is sent,
  and Reports says so until an owner or manager saves the address again (security review F1).
- **The email says how it arrived.** It names the shop and tells the reader to ask the shop to
  remove the address. The reader has no account to unsubscribe from.
- **The address is personal data.** Erasing a diver whose address it is clears it with its
  confirmation and its link. The shop export leaves all of them out, so restoring a backup never
  starts the send again.
- **What leaves.** The orders CSV, the crew sheet and the month report: each diver's full name,
  departure, what they paid and what was refunded; each crew member's name, hours and tips. The
  orders CSV's "Line" column is order-line text staff type, so whatever staff wrote there leaves
  too (security review N4). No medical answers, diver emails or phone numbers are in any of them.

## Alternatives considered

- **A token table for the confirm link**, as the shore contact has. The bookkeeper has one link
  at a time and no stop link, so three columns on the shop row do the same job, and every change
  of address clears them in the same statement.
- **Email a link instead of the files.** The link would be a bearer token to the shop's money,
  live for days, in a mailbox DiveDay does not control.
- **Several addresses.** One bookkeeper needs only one.

## Consequences

- A typo in the address sends nothing: the stranger gets one confirm link with no files, and
  ignoring it sends nothing more. A stranger who clicks it anyway starts the send, and then every
  owner gets the address in an email on that send and every send after it.
- An address a departed manager set stops by itself, and Reports asks an owner to vouch for it.
- A send the provider accepted but answered with an error is given back and tried again the next
  day, so the bookkeeper may get a month twice (security review N1). A duplicate to the right
  inbox is the cheaper failure.
- A bounced or suppressed bookkeeper address still reads as sent; nothing tells the owner yet
  (security review N2, filed as a follow-up).
