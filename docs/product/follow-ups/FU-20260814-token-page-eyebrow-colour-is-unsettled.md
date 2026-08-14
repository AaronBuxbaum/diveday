# FU-20260814-token-page-eyebrow-colour-is-unsettled — Settle whether a bearer-token page's eyebrow is primary or muted

- **Status:** Open
- **Raised:** 2026-08-14 — the TokenPageHeader adoption pass, which closed three follow-ups and found they disagreed with each other
- **Kind:** question
- **Effort:** S
- **Touches:** `src/components/TokenPageHeader.tsx`, `src/app/ready/[token]/page.tsx`, `src/app/waivers/[token]/page.tsx`, `src/app/recap/[token]/page.tsx`, `src/app/claim/[token]/page.tsx`

## What I noticed

The four diver-facing bearer-token pages now share one header component,
`src/components/TokenPageHeader.tsx` — but they do not agree on what its eyebrow looks like.

`TokenPageHeader` renders the eyebrow `text-sm font-medium tracking-widest text-primary uppercase`,
and `/waivers`, `/recap` and `/claim` wear it. `/ready` does not: it hand-rolls a **muted** single
eyebrow, with a comment above it (`src/app/ready/[token]/page.tsx`, the header block near the top
of the returned JSX) explaining the choice — the page used to stack "Your trip readiness" and the
shop's name as two identical uppercase-primary lines, which read as a rendering bug, and the
redesign's fix was to drop to one line and mute it, reserving `text-primary` for things a finger
can press.

So a diver who opens the readiness link and the recap link from the same confirmation email sees
two different eyebrow treatments, and `/ready` is the one page that cannot adopt the shared
component without silently reverting a deliberate decision.

## Why it isn't already done

It is a taste call about the meaning of `text-primary`, and no human has made it. Three separate
follow-up entries circled it from different branches and contradicted each other: the entry that
proposed building `TokenPageHeader` argued for a muted eyebrow, the entry that proposed adopting
the built component assumed `text-primary` and told adopters to preserve every rendered string
exactly. The component shipped primary; `/ready` shipped muted. Each is internally reasoned and
neither is a bug, so an agent picking one would be overturning the other's stated reasoning on its
own authority.

The adoption pass on 2026-08-14 therefore adopted `/recap` and `/claim` (both already primary, both
pixel-identical after the change), used the adoption entry's own escape hatch to leave `/ready`
alone, and filed this so the question survives the three entries it closed.

## Proposed change

Pick one and make the four pages agree.

- **If muted wins** (the `/ready` reading — `text-primary` means pressable): change the eyebrow in
  `TokenPageHeader` to `text-muted`, then adopt it on `/ready` too, which at that point also loses
  its hand-rolled header. Note `/ready` deliberately renders **one** eyebrow line, not two, so the
  component's array form is not what it needs — pass the shop name alone. Expect intended visual
  diffs on the `waiver`, `recap` and `claim` captures.
- **If primary wins:** flip `/ready`'s eyebrow to `text-primary`, adopt the component there, and
  delete the comment that argues for muted so the next reader is not told the opposite of what the
  code does. Expect an intended visual diff on the `readiness` captures.

Explicitly **not** proposed: a `tone` prop on `TokenPageHeader` so each page keeps its own answer.
That is the disagreement made permanent and API-shaped, and the whole point of the component was
that these four pages are one family.

Worth knowing before deciding: `/ready` also renders a `dockCallLine` at `font-medium` beneath the
title, which the component passes through as a child either way — it is not part of this question.

## Prompt

```text
Read src/components/TokenPageHeader.tsx (the eyebrow className), then the header block near the top
of the returned JSX in src/app/ready/[token]/page.tsx — including the comment above it, which
argues for a muted eyebrow on the grounds that text-primary should be reserved for things a finger
can press. Then look at src/app/waivers/[token]/page.tsx, src/app/recap/[token]/page.tsx and
src/app/claim/[token]/page.tsx, which all wear the component's text-primary eyebrow today.

The task: make the four bearer-token pages agree on one eyebrow colour, and adopt TokenPageHeader
on /ready so the idiom lives in one place. Which colour is a human's call and should be stated in
the PR body, not assumed — read this follow-up's "Proposed change" section for what each answer
costs. Do NOT add a tone/variant prop to TokenPageHeader to let the pages keep disagreeing.

The constraint that makes this non-obvious: /ready renders ONE eyebrow line, not two. Its redesign
deliberately deleted the second (the page used to stack a purpose line and the shop's name as two
identical uppercase-primary lines, which read as a rendering bug), so pass the shop name alone —
an older follow-up's instruction to pass [t("capability.readinessTitle"), detail.shop.name] is
stale. Keep /ready's dockCallLine meta line rendering as a child, unchanged.

Done means: one eyebrow className in one file, all four pages adopting TokenPageHeader, no comment
left in the tree arguing for the colour that lost, and the intended visual diffs named in the PR.
Run pnpm check, then E2E_WORKERS=1 pnpm e2e:run e2e/readiness.spec.ts e2e/recap.spec.ts
e2e/waivers.spec.ts --reporter=line, and a visual run filtered to the readiness/waiver/recap/claim
captures — read the PNGs and confirm every moved pixel is the colour change you chose.
Delete docs/product/follow-ups/FU-20260814-token-page-eyebrow-colour-is-unsettled.md as part of
the change.
```
