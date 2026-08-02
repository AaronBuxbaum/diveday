# Privacy & communications — stakeholder playbook

The data DiveDay holds (medical flags, minors' records, capability URLs) and the messages it
sends (booking email, waiver links, reminder email) each have a compliance owner to satisfy before
a pilot. Status of record: [human-decisions.md](../human-decisions.md) rows **H-02**
(retention/deletion — shared with [legal.md](legal.md)), **H-04** (incident-response owner), and
**H-09** (consent, copy, sender identity, credentials).

## Why this blocks rollout

- No consent policy exists (H-09 asks for two paragraphs); sending transactional email to divers
  without recorded consent language is the kind of unforced error that outlives a pilot.
- The privacy policy shops and divers will be shown does not exist yet (part of the H-18
  contract set in [legal.md](legal.md)).

An SMS/WhatsApp channel was built alongside email and later removed entirely, unused — no shop
ever sent through it, and it never reached the point of needing A2P registration or a carrier
compliance review ([ADR](../../architecture/decisions/20260802-remove-sms-whatsapp-channel.md)).
Revisit texting only if a real user need for it reappears; at that point this playbook needs a new
section for whatever carrier registration the chosen provider requires.

## Who to talk to

| Stakeholder | About | When |
| --- | --- | --- |
| Privacy counsel (usually the same firm as [legal.md](legal.md)'s business counsel) | Privacy policy, state-law applicability, breach duties, controller/processor posture | Within the legal engagement |
| Resend | Production sender domain verification, `RESEND_FROM_EMAIL` identity | This week — self-serve, fast |

## The H-09 consent policy — draft to take to counsel

H-09 asks for two paragraphs. Proposed draft (owner + counsel edit, then record in H-09):

> DiveDay sends transactional messages only: booking confirmations, waiver requests, trip
> reminders, and freed-seat invitations tied to a booking or wait-list entry the recipient
> created. A diver's email address is collected at booking for these purposes. Reminders are a
> courtesy, never the only channel for safety-relevant information.
>
> No marketing messages are sent to divers without separate, explicit opt-in, and no diver
> contact information is shared across shops or sold. Shops own their diver relationships;
> DiveDay sends on a shop's behalf from a verified DiveDay-operated sender identity.

Sender identity: a real shop-facing address on the production domain (e.g. `bookings@…`), set as
`RESEND_FROM_EMAIL` after domain verification. Name the `CRON_SECRET` credential owner in the same
H-09 update.

## Privacy counsel — question list

- **Controller/processor posture:** shops collect diver data; DiveDay stores and processes it.
  What does the shop-facing agreement need to say (a lightweight DPA?) and what does the
  diver-facing privacy policy need to disclose?
- **State-law reach:** divers book from anywhere — which state privacy laws (and their
  sensitive-health-data provisions) can attach to medical flags for out-of-state divers, and
  what does that change at pilot scale? (DiveDay is nowhere near the big statutes' revenue
  thresholds, but health-data laws key on data type, not size — get a real answer.)
- **Minors:** what does storing a minor's medical answers and guardian consent require
  (ties to the H-01 guardian flow in [legal.md](legal.md))?
- **Breach duties:** notification obligations for medical-flag data, and what the
  incident-response runbook (H-04's still-unwritten half) must contain to meet them.
- **Retention:** counsel's H-02 numbers applied to the shipped behaviors — waiver records,
  notification logs ([ADR](../../architecture/decisions/20260720-notification-attempt-history.md)),
  offline snapshot retention ([ADR](../../architecture/decisions/20260718-offline-manifest-snapshots.md)),
  and backups.

**Prepared material:** the same data inventory built for the insurance broker
([insurance.md](insurance.md#workstream-a--divedays-own-coverage-h-19)) plus the
[capability telemetry runbook](../../engineering/capability-telemetry-runbook.md) (how bearer
URLs are kept out of analytics, and the audit/rotation story for an exposed one).

## Where outcomes land

- H-09: consent policy text, sender identity, credential owners, approved copy.
- H-02: retention/deletion policy (recorded with the legal engagement).
- H-04: the incident-response runbook gains its breach-notification section.
- Privacy policy and any DPA join the H-18 contract set ([legal.md](legal.md)).
- Any consent-language copy fix on the booking form ships as a normal change with tests.
