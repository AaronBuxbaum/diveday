# Story backlog

Open, partial, and review-blocked work carried forward from
[../archive/ux-personas-20260730-findings.md](../archive/ux-personas-20260730-findings.md) (the
2026-07-30 UX persona review). Each entry cross-references the persona or lens it serves in
[../personas.md](../personas.md) and links back to its original task number for full context (file
references, review notes, rationale) in the archive.

**Rules for this doc.** Entries are tickets, not essays — state what's left, not what already
shipped. When a ticket is picked up, either close it out here (delete the entry) or, if it only
partially resolves, update the "left to do" line rather than leaving stale text. New open items
found while evaluating work against `personas.md` belong here too, not back in the archive.

---

## Priya (persona 3) — enforce course minimum age for public bookings

**Origin:** archive task 23. **Status:** partial — the safe subset shipped (a self-declared
attestation checkbox on the booking form, `minimumAge` rendered on course trip pages); the actual
gate is still open.

**Left to do:** `course_min_age` is still not enforced for public actors in `src/db/bookings.ts`.
Making it a hard gate means persisting a submitted birth date, which reopens the H-22 probing
vector the attestation checkbox was chosen specifically to avoid — this needs its own
`docs/product/human-decisions.md` entry (a policy call, not just an engineering change) before any
implementation, and the persisted-birthdate path needs a `security-reviewer` pass alongside
`dive-domain-expert` given its interaction with `findOrCreatePerson`'s email-match reuse (H-13).
