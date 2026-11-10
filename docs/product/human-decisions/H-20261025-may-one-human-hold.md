# H-20261025-may-one-human-hold: May one human hold a login at more than one shop?

- **Status:** Deferred
- **Human owner:** Product owner

## Current outcome — 2026-11-10

Keep one login per shop for now. Revisit tenant memberships when a real shop asks; no
multi-shop account or authorization change is approved.

Source: [owner-account decision record on #4193](https://github.com/AaronBuxbaum/diveday/issues/4193#issuecomment-6759804545).
The sections below preserve the original question and rationale, not a second unresolved worklist.

## Original question

**May one human hold a login at more than one shop?** `user_accounts.email` is globally unique and `user_accounts.person_id` is unique, `people` is shop-scoped, and the session carries exactly one `shopId` — so one human is one shop, permanently, and `inviteStaffMember` refuses a cross-shop address deliberately (issue #721). That blocks an ordinary case in this industry: a freelance divemaster, instructor or captain who works for two operators is the norm in Cozumel, Koh Tao, Sharm and Utila, and common in Florida. Their choices today are a second email address they must remember to check, or no DiveDay account — which means no manifest on their phone and no offline roll call, so the crew member most likely to need the product's stated safety differentiator is the one who cannot have it. **This is not roadmap §4 ("Multi-boat / multi-shop configuration"), which is one *owner* with two locations and which the pricing FAQ already answers honestly.** Three shapes: **(a)** leave it, with the honest refusal shipped in this change — cheapest, and bad for exactly the crew member the safety story is for; **(b)** one account with many memberships and a shop switcher; **(c)** membership only — separate `people` rows per shop (a diver's history at one shop is emphatically not another's) with one *login* reaching several. **Recommend (c) if it is ever built.**

## Minimum outcome to record

A yes or no on whether an identity may span shops, and if yes, which shape.

## Unblocks / follow-up

Nothing is blocked today. Both (b) and (c) re-plumb the thing that currently makes tenant isolation cheap here: every `session.user.shopId` read becomes "which shop is this session acting as", and one mistake there is a cross-tenant bug — so `requireShopSurface` (`src/features/session/rules.ts`), `src/lib/authz.ts`, the nav and the demo role switcher are all in the blast radius. Do not start without an answer.

Part of the [human decision log](README.md#decision-register).
