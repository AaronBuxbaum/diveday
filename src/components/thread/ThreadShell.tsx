import type { ReactNode } from "react";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";

/**
 * The thread's column, exported so the things that must not drift from it
 * cannot: each route's `loading.tsx` (a skeleton at a different measure is a
 * sideways layout jump on every navigation into the segment) and the waiver's
 * completed state, which renders its own `<main>` around an `EarnedMoment`
 * rather than this header and still owes the diver the same gutter as the form
 * they just came from.
 */
export const THREAD_MEASURE_CLASS = "mx-auto w-full max-w-xl flex-1 px-5 py-8 sm:px-6 sm:py-12";

/**
 * **One measure for the diver's thread** (ADR 20260827-the-divers-thread,
 * decision 1) — the shell every page a *booked* diver walks is built on:
 * `/ready`, `/waivers`, `/recap` and `/claim`, the four screens that arrive as
 * a link in a text message or an email.
 *
 * What it replaced was `TokenPageHeader`, which was a header and nothing else:
 * it unified the eyebrow and the title across those four pages and left each of
 * them to spell its own column. They agreed on `max-w-xl` and disagreed about
 * everything else around it, and there was nothing holding them there — a fifth
 * page, or a restyle of one of the four, had no shared line to fall out of. The
 * container is therefore part of this component rather than a class string four
 * pages copy: the thread's measure is the decision, and a decision no file owns
 * is a decision that drifts.
 *
 * The eyebrow is **always the shop's name**, never DiveDay and never a second
 * line naming the page. `/ready` reasoned that out first — it stacked "Your
 * trip readiness" over the shop's name as two identical uppercase lines, a
 * visible bug-shaped redundancy — and `/claim` was still doing it ("Claim your
 * seat" above a heading reading "A seat on … is waiting for you"). One eyebrow,
 * one `<h1>`: the diver knows which shop they are dealing with, and the title
 * says the rest. That is why there is no `eyebrow` prop to pass words to.
 *
 * **The eyebrow is `EYEBROW_CLASS`, and that is a reversal worth naming.**
 * `TokenPageHeader` rendered it `text-muted` and left a note asking the next
 * reader not to "fix" it back — the argument being that `text-primary` is
 * reserved for things a finger can press. That argument lost app-wide before
 * this slice: every staff page's `ShopPageHeader` eyebrow is context rather
 * than an action and has been the accent-free lagoon ink all along, and
 * Clearwater's closed type ramp (20260827-clearwater-surface-language,
 * decision 3) names that one spelling as *the* eyebrow. Four bearer pages
 * keeping a private second one is the drift a closed ramp exists to end. It is
 * not the coral accent and spends none of the thread's budget.
 *
 * `meta` is a slot, not a styling knob — one quiet line under the title (a date
 * · time line, the dock call, a share row), rendered exactly as the page hands
 * it over, because the four pages' meta genuinely differs and this component
 * has no opinion about which of it leads.
 */
export function ThreadShell({
  shopName,
  title,
  meta,
  children,
}: {
  /** The eyebrow — the shop's own name, always. */
  shopName: string;
  /** The `<h1>`: the trip's title, or the state's own headline. */
  title: ReactNode;
  /** The quiet line(s) under the title, rendered as given. */
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <header>
        <p className={EYEBROW_CLASS}>{shopName}</p>
        {/* `text-balance` because the titles that wrap here are trip names
            ("Two-Tank Reef — Molasses & French"), and an even two lines reads
            better on a phone than a full line plus one orphaned word. */}
        <h1 className={`mt-2 ${SHELL_TITLE_CLASS} text-balance`}>{title}</h1>
        {meta}
      </header>
      {children}
    </main>
  );
}
