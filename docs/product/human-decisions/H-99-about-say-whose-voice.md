# H-99: What does /about say, and in whose voice?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**What does `/about` say, and in whose voice?** The 2026-10-06 rewrite opened the page on the Lonergans and wrote everything else as speech (H-89's Over a Beer): the founder in the first person singular, his employers as the page's credibility, the two-person team counted, a "What's the catch" concessions band, and every heading the owner's question repeated back without a mark ("Why did you build this", "Who am I dealing with").

## Minimum outcome to record

Which section stays, what the rest says, and whether the page may speak in generalities rather than confirmed biography. **Decided 2026-10-07 (Aaron Buxbaum, in the project thread):** "I really really don't like the copy on About. Let's redo it entirely. The only part I do like is the first section; in there just change 'I built DiveDay' to 'we built DiveDay', and remove the 'Why did you build this' text. … Don't get overly truthful, just make a compelling case. Don't talk about the specific people, use generalities about people in a company."

## Unblocks / follow-up

The hero keeps the Lonergan story within its limits, its tie to the product in the plural, and no heading over it (the eyebrow is the h1). Every band under it speaks as the company in plain statements: who builds it, in generalities true of them; the four standards every screen is held to; how a shop gets set up and who answers; the demo. No individual named, no CV, no concessions band. The biography rule and the voice move in [marketing.md](../marketing.md) and [design/brand.md](../../design/brand.md) ("The about page"); `src/app/about/copy.test.ts` and `e2e/marketing.spec.ts` hold the new pins.

Part of the [human decision log](README.md#decision-register).
