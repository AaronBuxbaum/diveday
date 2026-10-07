# H-80: May one hull carry two overlapping departures?

- **Status:** Chosen
- **Human owner:** Product owner + dive operations lead

## Decision or approval needed

**May one hull carry two overlapping departures?** `trips.boat_id` exists and nothing in the clash path compares it, so two overlapping departures on the same hull raise no warning on the Move panel, on either departure's page, or in the staffing week — a shop that moves a morning charter onto an afternoon one finds out at the dock. The crew warning that did ship is worded as an impossibility ("cannot be on both"), which is false of a legitimate arrangement: a course group and a fun-dive group sharing one charter with one captain. Filed as #1780, with #1776 and #1814 downstream of the answer.

## Minimum outcome to record

Which reading, and the crew sentence reworded to stay true under it.

## Unblocks / follow-up

**Decided 2026-09-16 (Aaron Buxbaum, ready-for-human decision deck): one hull, one departure at a time.** A boat overlap joins the move preflight and the departure page's own read, using the same half-open window predicate the crew clash uses, so a hull handed off nose to tail at the same dock is the plan rather than a defect. A shop wanting two groups on one charter models it as one departure with two groups, which is what a manifest is for. #1776 raises the clash on Today's work queue, read through `crewClashes` batched across the day rather than one query per boat — Today is the surface a shop starts its morning on and the one where the clash still has hours to be fixed. #1814 takes the narrow version: a sailed departure whose crew includes somebody standing in a clash raises one row naming them and the other boat, read from `crewClashes` rather than from roll-call events, so the subject rule is untouched; making assigned-but-never-tapped crew a roll-call subject is not taken without first measuring how many historical departures would light up. **#1680 is not settled by this row** — the Assistant Instructor rung and the lapsed-rating question are their own call and stay `ready-for-human`.

Part of the [human decision log](README.md#decision-register).
