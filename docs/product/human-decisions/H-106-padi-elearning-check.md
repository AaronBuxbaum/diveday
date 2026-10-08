# H-106: May the extension read a student's PADI eLearning and mark their course materials done?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**May the DiveDay browser extension look a course student up on the PADI Pros' Site, in the staffer's own signed-in browser, and tick the student's course materials done when PADI shows the eLearning finished?** The materials tick ([20261008-course-learning-materials](../../architecture/decisions/20261008-course-learning-materials.md)) is a staffer's word today. PADI shows eLearning progress only to the shop's own signed-in Pros.

## Minimum outcome to record

Whether to build it before anyone has seen the real PADI page, and whether a finished course ticks the materials without a second tap.

## Outcome

**Decided 2026-10-08 (Aaron Buxbaum, in the project thread):** "Let's do the PADI one! We can test it later, so do your best guess." Built as the eLearning section of [20261008-cert-check-extension](../../architecture/decisions/20261008-cert-check-extension.md): the extension searches the PADI Pros' Site by the student's email, the server reads the page, and a record with the student's name and email, this course, and a finished status ticks the materials, with Undo. It ticks without a second tap, as H-105's card match does. Closes #2259 once tested.

## Unblocks / follow-up

The PADI page address, its search box and its wording are a best guess: nobody has seen the real page. A staffer signed in to the PADI Pros' Site must try it once (`extension/README.md`) and the guesses in `extension/agencies.js` and `src/lib/elearning-check.ts` corrected to what it shows. Until then a wrong guess answers "Couldn't read PADI's page" and writes nothing.

Part of the [human decision log](README.md#decision-register).
