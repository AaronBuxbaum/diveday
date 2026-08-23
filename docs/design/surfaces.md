# Surfaces

One entry per significant surface, carrying the five answers from
[the holistic pass](principles.md#the-holistic-pass-run-it-before-any-checklist) and nothing else.

The pass has always required its answers "in writing" and never said where, so exactly one surface in
this repo had ever recorded them (issue #825). Everywhere else the thinking evaporated when the
session that did it ended, and the next reviewer started from a screenshot.

## What belongs here

An entry when a surface is **significant** — the same judgment that decides whether something needs
an ADR. A page a shop lives in, a flow a diver is walked through, a marketing page carrying an
argument. Not a document per route, and not a required artifact on every pull request.

An entry is five sentences. If it is longer, it is drifting into the kind of description the code
already carries.

## Two things to copy from the one instance that worked

The shop home is the only surface whose one idea was written down before this file existed, and it
worked for two reasons worth generalising:

- **State it next to the code when it constrains the code.** `RoleOrientationCard`'s doc comment
  defers to the page's one idea *by name* — "the page's one idea is the queue, and a tinted
  orientation box above it…". That is more useful to whoever edits that component than any document.
- **Pin it with a test where it is load-bearing.** `RoleOrientationCard.test.tsx` fails if the
  orientation box out-ranks the queue. A one-idea statement a test enforces cannot rot.

So an entry here is the index; the constraint lives beside the code it constrains.

## Entries

### The shop home — `/shop/[shopSlug]`

- **One idea:** the work. What needs this shop today, ranked, with the day's boats above it
  (ADR 20260720-today-work-queue).
- **The question it arrives with:** "what needs me before the first boat?" — answered on screen, in
  the queue's first band, without a click.
- **Controls that dissolved:** the queue's rows *are* their own controls — each row's own link goes
  to the thing it is about. The view switch is the one standing control.
- **Remove first:** nothing currently; the orientation card is already conditional on first-run and
  the good-news lines already render nothing when untrue (see
  [settled-questions.md](settled-questions.md)).
- **Composition:** not the default card stack — a departure board above a ranked queue, because the
  day's boats and the day's work are two different readings and the first is the shorter list.

Enforced beside the code: `RoleOrientationCard.tsx` defers to it by name, and
`RoleOrientationCard.test.tsx` fails if the orientation box out-ranks the queue.

### The diver record — `/shop/[shopSlug]/divers/[personId]`

**Unanswered, and known to be.** Its honest answer to "what is this surface's one idea?" is
"everything about this person", which is a container rather than an idea — which is what issue #780
is about. Left here deliberately: an entry that says "we do not know yet" is worth more than no entry,
because it stops the next reviewer concluding the question was never asked.
