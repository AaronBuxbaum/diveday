# 20261016-bookkeeper-month-end-email — The month's files may be emailed to one address outside the shop

- **Status:** Accepted (2026-10-16)
- **Date:** 2026-10-16

## Context

Fifth-loop item 35. At month end an owner downloads the report, the orders and the crew sheet
and emails them to whoever keeps the books. This email instead sends diver names, crew names and
money every month to someone outside the shop's staff, with nobody pressing Send.

## Decision

- **One download.** "Download month-end files" gives one zip of the three files, built by the
  same builders as the separate downloads. Owner or manager (`canPersonExportShopData`, live
  roles) and the export step-up.
- **One address, behind the same gate.** `shops.bookkeeper_email` is set on Reports after the
  export step-up and stored only with who set it and when (a database check). Reports shows
  both. An empty field turns it off; a new address starts with the next month.
- **The inbox confirms first** (security review B1, the shore contact's model, H-118). A new or
  changed address gets a link with no files, valid a week; nothing is sent until it is used
  (`bookkeeper_confirmed_at`). The link's hash sits on the shop row beside the address and any
  change of address clears both. Saving again resends it, rate-limited per shop and per
  recipient. The page is `/confirm-contact/[token]`.
- **Every owner hears about it** (B1, F1). Each set, change and removal is an activity line and
  an email to every owner, and so is each send ("Month-end files for September 2026 sent to …").
- **Only while its setter could still set it** (F1). Before each send the pass re-checks the
  setter against `canPersonExportShopData`; if they fail it, nothing is sent and Reports asks an
  owner or manager to save the address again.
- **Sent once, on the 2nd.** A cron on the 2nd and 3rd claims the previous month in one
  statement while the address is unchanged and confirmed, and releases the claim on failure.
  Demo shops are never sent.
- **The files are never stored.** The kind cannot be queued; the next pass rebuilds the files.
  Logs name the shop and the month only.
- **The address is personal data.** Erasing a diver whose address it is clears it with its
  confirmation and link; the shop export leaves all of it out.
- **What leaves.** Each diver's name, departure, payments and refunds; each crew member's name,
  hours and tips; and the orders CSV's free-text "Line" column, whatever staff typed there
  (security review N4). No medical answers, diver emails or phone numbers.

## Alternatives considered

- **A token table for the link**, as the shore contact has. One link at a time and no stop link,
  so three columns on the shop row do the job.
- **Email a link instead of the files.** A bearer token to the shop's money, live for days, in a
  mailbox DiveDay does not control.
- **Several addresses.** One bookkeeper needs one.

## Consequences

- A typo sends one confirm link with no files. A stranger who confirms anyway starts the send,
  and every owner is then told the address on that send and each one after.
- An address a departed manager set stops by itself.
- A send the provider accepted but answered with an error is retried the next day, so a month
  can arrive twice (security review N1): the cheaper failure.
- A bounced or suppressed address still reads as sent; nothing tells the owner yet (N2, a
  follow-up).
