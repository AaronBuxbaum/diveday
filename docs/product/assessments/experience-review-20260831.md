# Experience review — 2026-08-31

> A whole-app review through 24 product, UX, marketing, feature, and delight lenses. It is an
> assessment, not a backlog in parallel with GitHub: every action below either has its existing
> issue or is built in the accompanying branch.

## Verdict

DiveDay's sharpest advantage remains visible: one trip record follows a diver from choosing a
boat, through readiness, to the dock and home again. The review found no need for a feature
land-grab. Its recurring friction was smaller and more consequential: facts that already exist in
the product sometimes arrive after the decision that needs them, and a few actions sit outside the
ledger that gives the staff trip page its calm.

## Actions selected

| Priority | Action | Disposition |
| --- | --- | --- |
| P0 | Put the sourced monthly price in the `/product` hero, without adding another hero action. | Built in this change; closes [#1104](https://github.com/AaronBuxbaum/diveday/issues/1104). |
| P0 | Say the meeting point and address before the public trip booking form, not only after booking. | Built in this change; closes [#1109](https://github.com/AaronBuxbaum/diveday/issues/1109). |
| P0 | Make a self-declared certification label state the evidence that is actually missing. | Built in this change; closes [#1136](https://github.com/AaronBuxbaum/diveday/issues/1136). |
| P1 | Make `Add a diver` the terminal band of the roster ledger, including an empty roster. | Built in this change; closes [#1140](https://github.com/AaronBuxbaum/diveday/issues/1140). |
| P1 | Align the course-date composer with its read model before widening that funnel. | Already tracked in [#1138](https://github.com/AaronBuxbaum/diveday/issues/1138). |
| P2 | Let public reviews paginate instead of silently capping proof. | Already tracked in [#1128](https://github.com/AaronBuxbaum/diveday/issues/1128). |
| P2 | Keep the shareable post-dive artifact and evening visual proof in the delight path. | Already tracked in [#1081](https://github.com/AaronBuxbaum/diveday/issues/1081) and [#1122](https://github.com/AaronBuxbaum/diveday/issues/1122). |
| P2 | Prevent a green visual status from implying visual review has happened. | Already tracked in [#1137](https://github.com/AaronBuxbaum/diveday/issues/1137). |

The first four are deliberately one coherent slice: a prospective diver sees cost and arrival
context before committing; a staff member sees evidence honestly and adds people without leaving
the list they are working in. The remaining items were already owned, so the review creates no
duplicate issues.

## Lens readout

| Lens | Reading | Disposition |
| --- | --- | --- |
| 1. Positioning and ideal customer | The shop's shared day, rather than generic booking software, remains the durable promise. | Hold. |
| 2. Hero conversion | The home hero is controlled; `/product` lacked the answer to the obvious price question. | #1104. |
| 3. CTA and trial terms | One primary decision per marketing surface remains legible and credible. | Hold. |
| 4. Claim truthfulness | Product claims are tied to real, inspectable flows rather than invented outcomes. | Hold. |
| 5. Pricing clarity | The price had to appear where `/product` creates intent, from the existing price source. | #1104. |
| 6. Discoverability and SEO | Route-level information architecture and public page intent are coherent. | Hold. |
| 7. Schedule browsing | The public schedule gives a realistic shop and next boat without a catalog-shaped detour. | Hold. |
| 8. Public trip choice | A diver needs to know where to arrive before deciding to book. | #1109. |
| 9. Booking flow | The terminal booking form remains the right close once the trip facts are present. | Hold. |
| 10. Course/date funnel | The next expansion is correctness of the composer/read model, not another conversion control. | #1138. |
| 11. Readiness and certification trust | The card must distinguish a declared number from a card staff have actually seen. | #1136. |
| 12. Waiver and safety pacing | The step rail and one-open-step grammar keep mandatory paperwork calm without hiding it. | Hold. |
| 13. Diver thread and aftercare | The one-link thread is strong; its shareable after-dive artifact is the next proof of delight. | #1081. |
| 14. Staff day-of work | The day spine answers the first operational question without turning the page into a dashboard. | Hold. |
| 15. Counter and manifest | Count-first, wet-thumb-friendly interactions fit the context and retain safety confirmation. | Hold. |
| 16. Roster action clarity | Adding a diver belongs in the guest ledger, not in a detached second surface. | #1140. |
| 17. Hierarchy and density | Grouped ledgers prevent repeated facts and make active work rise before settled rows. | #1140. |
| 18. Accessibility, responsive, and dark modes | The intended coverage exists; browser and visual checks must still be judged in CI. | CI follow-through. |
| 19. Feedback, errors, and undo | The product generally describes consequence rather than decorating every state with reassurance. | Hold. |
| 20. Navigation and mobile dock | The phone and desktop compositions tell the truth about different available space. | Hold. |
| 21. Reviews and social proof | Reviews are evidence, not wallpaper; the existing pager issue protects that evidence at scale. | #1128. |
| 22. Portability and buyer trust | Export and plain switching guidance support the anti-lock-in promise. | Hold. |
| 23. Quality gate honesty | A visual result must not say green until someone has accounted for its diffs. | #1137. |
| 24. Delight and earned memory | Morning readiness is already concrete; the evening recap is where a shop earns voluntary sharing. | #1081, #1122. |

## What stays

Do not add a new promo surface, a second product-hero button, generic "trust" badges, or a new
empty-state card. The best parts of the current experience are calm because each surface makes one
decision easy and lets the relevant record carry the proof.
