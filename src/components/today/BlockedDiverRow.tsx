import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { WaiverSendControl } from "@/components/today/WaiverSendControl";
import { buttonClass } from "@/components/ui/button";
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
 * The reasons read the same everywhere too — a danger bullet against muted text,
 * the by-departure view's shape. The counter used to render its reasons in solid
 * danger text; the tone still carries (the bullet is danger, under a danger
 * `Blocked` badge), and one list cannot say the same fact in two colours.
 *
 * The *layout* is the one thing parameterised, because the hosts genuinely
 * differ: the by-departure view lays the fix **beside** the diver in a dense
 * list of rows, and the counter lays it **below** a card that also carries
 * badges, a trip link, and a check-in button.
 */
export function BlockedDiverRow({
  identity,
  blockers,
  fix,
  shopSlug,
  surface,
  waiverCopy,
  meta,
  extra,
  layout,
  t,
}: {
  /**
   * The host's own name/heading block — a diver link, or a whole card header.
   * The `beside` layout needs it (it owns the left column); a `below` host that
   * renders its header itself, above this row, leaves it out.
   */
  identity?: ReactNode;
  blockers: readonly ReadinessBlocker[];
  /** `null` when nothing maps to an action; the reasons still show. */
  fix: BlockerFix | null;
  shopSlug: string;
  /** Which surface the waiver send is attributed to (analytics + revalidation). */
  surface: SendProps["surface"];
  /** The send control's words, composed by the host (`waiverSendCopy(t)`). */
  waiverCopy: SendProps["copy"];
  /** Extra lines under the reasons — the "also blocked on" annotation. */
  meta?: ReactNode;
  /** Anything after the fix — the counter's paper-waiver fallback. */
  extra?: ReactNode;
  /** `beside`: fix in a right-hand column. `below`: fix under the reasons. */
  layout: "beside" | "below";
  t: StaffTranslator;
}) {
  const reasons = (
    <>
      <ul
        className={`flex flex-col gap-1 text-muted ${
          // Below a card header the list needs a rule to sit under; beside the
          // diver's name it is simply the next line.
          layout === "below" ? "mt-4 border-t border-border pt-3 text-sm" : "mt-1.5 text-base"
        }`}
      >
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
      {meta}
    </>
  );

  const action = fix ? (
    fix.sendsWaiver ? (
      <WaiverSendControl
        shopSlug={shopSlug}
        surface={surface}
        bookingIds={[fix.bookingId]}
        label={fix.label}
        // The control's default alignment is the Today queue's right-hand
        // column (`sm:text-right`). Laid out below the reasons it is the same
        // bottom-of-card action as the `Link` alternative, so it has to start
        // on the same left edge — otherwise one diver's fix button sits left
        // and the next one's floats right in the same list.
        {...(layout === "below"
          ? {
              className: buttonClass({ variant: "secondary", size: "sm" }),
              wrapperClassName: "",
            }
          : {})}
        copy={waiverCopy}
      />
    ) : (
      <Link
        href={fix.href}
        className={
          layout === "below"
            ? buttonClass({ variant: "secondary", size: "sm" })
            : buttonClass({ variant: "secondary", className: "shrink-0" })
        }
      >
        {fix.label}
      </Link>
    )
  ) : null;

  if (layout === "beside") {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="min-w-0">
          {identity}
          {reasons}
        </div>
        {action}
        {extra}
      </div>
    );
  }

  return (
    <>
      {identity}
      {reasons}
      {action ? <div className="mt-3">{action}</div> : null}
      {extra}
    </>
  );
}
