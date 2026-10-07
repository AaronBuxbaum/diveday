# H-76: Which drysuit sizes does the diver's own form offer, and should it be asking…

- **Status:** Ready
- **Human owner:** Product owner + dive operations lead

## Decision or approval needed

**Which drysuit sizes does the diver's own form offer, and should it be asking for a size at all?** Issue 1414 gave `rental_fit_profiles` a `drysuit_size` column on its own scale — the manufacturer grid a rental wall is racked from, where a girth letter carries a second axis the wetsuit has none of, the cut — never the wetsuit's plain XS-XXL. The column is `text` and the staff field on the diver record is free text, so staff can record anything; the open call is only the fixed list the **diver-facing** select offers at `src/app/s/[shopSlug]/trips/[id]/_components/RentalFitForm.tsx`. A `dive-domain-expert` pass on 2026-09-12 revised the provisional list to `XS, S, M, MT, L, LT, XL, XLT, XXL` and left two questions it could not answer for itself. **The revision:** `XS` goes back on — every major maker publishes it, a cold-water fleet stocks it because a large share of drysuit divers are small-framed, and the wetsuit select one field above starts there, so keeping XXL and dropping XS told a 155cm diver the shop has nothing for her. `MS` and `ML` come off — they shipped as in-between *girths* while `MT` beside them was a *height*, and manufacturer charts gloss `MS` as medium short and `ML` as medium large, so the second letter meant two things in one list and a staffer packing on `MS` could hand a short diver a suit cut for a tall one. Every code is now a girth letter with at most a `T` after it; `MS`, `ML`, `LS` and `MLT` are real sizes a shop that stocks one records staff-side, where the field is free text. **The two open questions:** **(a)** the list carries the tall cut and not the short one, which is backwards for who actually fails to get a stock fit — short-torso divers are not rare, and they are the ones a stock grid fails. **(b)** A diver does not know their drysuit size, and it does not transfer between brands: even a diver who owns one knows only their own suit's brand code. A select of nine letters harvests a confident-looking wrong answer and prints it on a packing list as though it were a measurement. What every manufacturer's chart is indexed on, and what every shop asks on the phone, is **height, weight and shoe size**.

## Minimum outcome to record

Three answers, each standing alone: **(a)** the grid the diver's select offers, or a confirmation of the revised one; **(b)** whether the short cuts (`MS`, `LS`, `XLS`) join the tall ones; **(c)** whether the diver's form stops asking for a letter and asks height, weight and shoe size instead, leaving the letter to the counter.

## Unblocks / follow-up

(a) and (b) are one array in that file and the test that pins it — an edit to one line. (c) is not: new columns on `rental_fit_profiles`, a new question on both the diver's form and the staff record, and a packing list printing a measurement rather than a size, so it is a slice rather than an edit. The packing list, the completeness rule and the CSV export read the stored text and are unaffected by any answer that keeps a letter. "Not sure, help me fit it" stays the first option under every answer: it leaves the fit incomplete on purpose, so the hands-on fitting path picks the diver up.

Part of the [human decision log](README.md#decision-register).
