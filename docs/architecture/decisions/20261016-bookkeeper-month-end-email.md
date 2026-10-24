# 20261016-bookkeeper-month-end-email — The month's files may be emailed to one address outside the shop

- **Status:** Accepted (2026-10-16)
- **Date:** 2026-10-16

## Context

Fifth-loop item 35: send the month's report, orders and crew sheet to the shop's bookkeeper,
someone outside its staff, every month with nobody pressing Send.

## Decision

- **One download.** A zip of the three files, behind `canPersonExportShopData` (live roles) and
  the export step-up.
- **One address, behind the same gate**, set on Reports and stored with who set it and when.
- **The inbox confirms first** (security review B1, the shore contact's model, H-118). A new or
  changed address gets a week-long link with no files; nothing is sent until it is used, and
  the first files are the next 2nd's. Any change of address clears the confirmation.
- **Owners hear everything** (B1, F1). Each set, change, confirmation, removal and send emails
  every owner (or, with no owner login, the other managers or the confirmed contact address);
  each staff change is an activity line.
- **Only while its setter could still set it** (F1). The pass re-checks the setter and claims
  only for that setter. Someone else saving the address is `vouched`: logged and emailed, since
  it restarts held files.
- **The bookkeeper can stop it.** Each email carries a stop link, also its one-click
  `List-Unsubscribe`, minted with the month's claim. It clears the address, logs with no actor
  and tells the owners.
- **Sent once, on the 2nd.** A cron on the 2nd and 3rd claims the month in one statement and
  releases it on failure. Demo shops are never sent.
- **The files are never stored.** The kind cannot be queued. Logs name the shop and month only.
- **The address is personal data.** Erasing a diver whose address it is clears it and tells the
  owners, without the address; the shop export leaves it out.
- **What leaves.** Each diver's name, departure, payments and refunds; each crew member's name,
  hours and tips; and the orders CSV's free-text "Line" column (security review N4). No medical
  answers, diver emails or phone numbers.

## Alternatives considered

- **A token table for the links**, as the shore contact has. One live link of each kind at a
  time, so columns on the shop row do the job.
- **Email a link instead of the files.** A bearer token to the shop's money, live for days, in a
  mailbox DiveDay does not control.

## Consequences

- A stranger who confirms a typo starts the send, and every owner is told the address on each.
- A departed manager's address stops by itself until someone else vouches for it.
- Only the newest email's stop link works.
- A send accepted but answered with an error is retried, so a month can arrive twice (N1).
- A bounced address is told once to each owner, without a month, and warned on the field until
  saved again or a send is delivered (N2, #2798). The pass keeps sending.
