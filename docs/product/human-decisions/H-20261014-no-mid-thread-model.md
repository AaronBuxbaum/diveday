# H-20261014-no-mid-thread-model: Never switch a live thread's model?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Never switch a live thread's model; start a fresh thread instead?** Two threads switched model mid-life and lost their prompt cache, so the next call re-read the whole context at full price (the 2026-10-14 best-practice comparison, row 12; prompt-loop sheet 2026-10-14, call 4).

## Minimum outcome to record

Yes or no.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the token thread, "Do all recommended actions"):** yes. [working-rules.md](../../agents/working-rules.md)'s Parallel work section says it: a different model is a fresh thread, handed a state note.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
