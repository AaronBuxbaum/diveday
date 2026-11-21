# after-the-dive

What happens once the boat is home: the diver's recap and dive record, logbook export and
connections, reviews and their replies, crew thanks and tips.

## Owns

- The recap: `recap/`, `recap-after-state.ts`, `recap-line.ts`, `dive-record.ts`,
  `dive-participation.ts`.
- Logbooks: `computer-dives/`, `dive-log-export.ts`, `logbook-connections/`.
- Reviews: `reviews/`, `reviews-page.ts`, `review-flags.ts`, `review-replies.ts`, `review-themes.ts`.
- Thanks and tips: `crew-thanks.ts`, `crew-thanks-choice.ts`, `crew-tips.ts`.

## Does not own

The roll call and head counts (`boarding`), the recap link's token (`src/lib/recap-links.ts`), the
bearer-token check each page makes before it calls in here, and the words (the diver bundle).

## Invariants

- A review comes only from a diver's own recap link, for a booking that dived; a bare rating
  publishes now, words wait for staff, and added words go back to moderation; the average never
  counts a held review or rounds up.
- `recap-after-state.ts` is the one assembler (`buildAfterStateProps`) for `/ready/[token]` once
  the day is done and `/recap/[token]`; it composes reads, it does not own them.
- A dive participation note says one diver dived, sat out, or is unknown for one dive. `unknown`
  is never "did not dive", a note is never inferred from a roll-call mark, and nothing here
  writes the roll call, the head count, readiness, a medical hold or fly-safe.
- `logbook-connections/` holds partner OAuth credentials and never reaches a client bundle.
