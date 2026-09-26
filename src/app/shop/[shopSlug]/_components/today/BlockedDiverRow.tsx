import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { BlockerFix } from "@/lib/blockers";
import type { ReadinessBlocker } from "@/lib/readiness";

/**
 * The send control's own prop types, read off the component rather than
 * imported from `@/app/actions/waiver-send-types`: `src/components` may not
 * import from `src/app` (`pnpm check:architecture`), and the host pages — which
 * live in `src/app` — are where the copy object is built anyway.
 */
type SendProps = ComponentProps<typeof WaiverSendControl>;

/**
 * One blocked diver, wherever a staffer meets them: **why they cannot board**
 * and **the one tap that fixes it**.
 *
 * The rule underneath was already shared — `blockerFixFor` (src/lib/blockers.ts)
 * resolves every surface's fix through the same `BLOCKER_ACTIONS` map — but the
 * markup was written three times, and it drifted where it mattered most: the
 * check-in counter, the one surface with the diver physically standing in front
 * of the staffer, truncated the reason list at three and summarised the rest as
 * "and N more". The by-departure view showed all of them. Same person, same
 * evidence, two different answers to "what is wrong?".
 *
 * This component shows **every** blocker, everywhere. A readiness list is short
 * by construction (it is what one diver still owes), and the surface where a
 * truncation costs the most is precisely the counter: a staffer cannot ask
 * "what else?" of a page that hid it.
 *
 * The reasons read the same everywhere too — a danger bullet against muted text.
 * The counter used to render its reasons in solid danger text; the tone still
 * carries (the bullet is danger, under a danger `Blocked` badge), and one list
 * cannot say the same fact in two colours.
 *
 * The fix sits **below** the reasons, in a card whose header — the diver, the
 * badges, a trip link, the check-in button — the host draws itself. It had a
 * second layout, the fix **beside** the diver in the by-departure view's dense
 * row list; that view went with the two-view Today queue, and its layout with
 * it.
 */
type BlockedDiverRowProps = {
  blockers: readonly ReadinessBlocker[];
  /** `null` when nothing maps to an action; the reasons still show. */
  fix: BlockerFix | null;
  /** Which surface the waiver send is attributed to (analytics + revalidation). */
  surface: SendProps["surface"];
  /** The send control's words, composed by the host (`waiverSendCopy(t)`). */
  waiverCopy: SendProps["copy"];
  t: StaffTranslator;
  /** Anything after the fix — the counter's paper-waiver fallback. */
  extra?: ReactNode;
  /**
   * Put the reasons behind a native disclosure instead of leaving them
   * open. **Only the counter passes this**, and only because of who is
   * standing there: `/shop/[shopSlug]/check-in` calls itself Counter mode —
   * the screen on the front desk that divers queue at — so a diver's
   * outstanding payment and missing certifications were legible to whoever
   * was next in line (issue #716).
   *
   * This is **not** the truncation the docblock above argues against.
   * Nothing is dropped and no count is summarised away: every reason is
   * still here, the summary says how many there are, and one tap opens all
   * of them. What changed is that the shoulder behind the staffer has to
   * wait for that tap.
   */
  collapseReasons?: { summary: string };
};

export function BlockedDiverRow({
  blockers,
  fix,
  surface,
  waiverCopy,
  extra,
  collapseReasons,
  t,
}: BlockedDiverRowProps) {
  const reasons = (
    // `text-base`, never `text-sm`: "why this diver cannot board" is the most
    // critical sentence on the surface, and design/principles.md #2 puts
    // critical text at 16px or more. The counter rendered it at 14px, which
    // was the stakes exactly inverted — the smallest type in the app on the
    // one screen where a staffer reads it with a diver waiting. Below the
    // card's header the list sits under a rule of its own.
    <ul className="mt-4 flex flex-col gap-1 border-t border-border pt-3 text-base text-muted">
      {blockers.map((blocker) => (
        <li key={blocker.code} className="flex gap-2">
          {/* Decorative: the reason is the sentence, and a screen reader
              announcing "bullet" before each one is noise. */}
          <span aria-hidden="true" className="text-danger">
            •
          </span>
          <span>{readinessBlockerText(t, blocker)}</span>
        </li>
      ))}
    </ul>
  );

  const action = fix ? (
    fix.sendsWaiver ? (
      <WaiverSendControl
        surface={surface}
        bookingIds={[fix.bookingId]}
        label={fix.label}
        // The control's default alignment is the Today queue's right-hand
        // column (`sm:text-right`). Laid out below the reasons it is the same
        // bottom-of-card action as the `Link` alternative, so it has to start
        // on the same left edge — otherwise one diver's fix button sits left
        // and the next one's floats right in the same list.
        className={buttonClass({ variant: "secondary", size: "sm" })}
        wrapperClassName=""
        copy={waiverCopy}
      />
    ) : (
      <Link href={fix.href} className={buttonClass({ variant: "secondary", size: "sm" })}>
        {fix.label}
      </Link>
    )
  ) : null;

  return (
    <>
      {collapseReasons ? (
        // Native `<details>`: keyboard and screen-reader behaviour for free, the
        // same disclosure grammar the crew line on the departure card uses. The
        // summary carries the count, so a staffer knows there are four reasons
        // before deciding to open them — and the danger-toned `Blocked` badge
        // the host drew above this is untouched and still loud.
        <details className="group/reasons mt-3">
          <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-base font-medium text-danger-strong transition-colors select-none [&::-webkit-details-marker]:hidden hover:bg-surface-sunken">
            <DisclosureCaret className="group-open/reasons:rotate-90" />
            {collapseReasons.summary}
          </summary>
          {reasons}
        </details>
      ) : (
        reasons
      )}
      {action ? <div className="mt-3">{action}</div> : null}
      {extra}
    </>
  );
}
