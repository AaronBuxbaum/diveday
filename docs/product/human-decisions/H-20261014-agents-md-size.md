# H-20261014-agents-md-size: Shrink AGENTS.md to about 2.5k tokens?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Shrink AGENTS.md to about 2.5k tokens?** It is about 4.7k today and loads on every model call of every session, so every call pays for it (the 2026-10-14 best-practice comparison, row 8; prompt-loop sheet 2026-10-14, call 1).

## Minimum outcome to record

Yes or no.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the token thread, "Do all recommended actions", taking the sheet's recommended yes):** yes. AGENTS.md is cut to about 2.5k tokens; the detail moves to the path-scoped rules and `docs/agents/`, which load only when needed.

## Unblocks / follow-up

Built as layer 2 of the token stack (`claude/token-waste-v8mc3p-slim`), together with the skill-size budget (each `SKILL.md` under about 6k characters).

Part of the [human decision log](README.md#decision-register).
