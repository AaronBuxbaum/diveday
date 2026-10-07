# H-90: How many colour schemes does a check look at?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**How many colour schemes does a check look at?** Agent guidance told every session to look at changed UI "light + dark" — the hard rule in `AGENTS.md`, the surfaces rule, the verification doc and half a dozen skills — and `scripts/screenshot.mjs` shot both schemes on every run, doubling every look and the renders a dev server has to survive.

## Minimum outcome to record

One rule for every check an agent runs.

## Unblocks / follow-up

**Decided 2026-09-25 (Aaron Buxbaum, in session):** "whenever you do checks, you only need to check one of light or dark, unless you are explicitly doing color-related work! This is true in general." Every agent check is light only; dark is opened only when the work is itself about colour. `scripts/screenshot.mjs` defaults to light (`--both` for colour work, `--dark` alone), and the guidance says so where it said "light + dark" ([agents/verifying.md](../../agents/verifying.md) carries the why). CI's visual matrix is unchanged and still captures both schemes: it is the net for a dark regression nobody opened.

Part of the [human decision log](README.md#decision-register).
