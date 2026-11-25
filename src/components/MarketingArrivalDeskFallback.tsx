import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { groupLabelClass } from "@/components/ui/group-label";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusMark, StatusMarkColumn } from "@/components/ui/StatusMark";
import { FIGURE_LARGE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { AppBar, MOCK_BODY, MOCK_SECONDARY_BUTTON } from "./MarketingScreenFallbacks";

/** A fix-list group's band: its label over the sunken strip (`GuestFixList.tsx`). */
export const ROSTER_BAND =
  "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-surface-sunken/50 px-4 py-1.5";

/** The roster row's disclosure, at the row's end (`RosterSection.tsx`). */
export function RowCaret() {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center text-muted"
    >
      <DisclosureCaret direction="down" />
    </span>
  );
}

/**
 * **The arrival desk** — a trip's Check-in phase inside the arrivals window
 * (`src/app/shop/[shopSlug]/trips/[id]/_arrivals/arrival-desk.tsx`): "7 of 9
 * here" over the desk's bar (`CounterInstrument.tsx`), then the fix list's
 * groups (`_components/RosterSection.tsx`, `GuestFixList.tsx`). Can't board
 * yet: a held seat, whose identity check (`src/components/IdentityCheck.tsx`)
 * asks whether the booking is the same person, and which has no Check in tap.
 * To come: a guest with the bordered Check in button (`ArrivalTap.tsx`). Here: one of the
 * seven, its tap turned to "Checked in". Left out: the opened guest's "Not
 * here" sheet (`NoShowConfirm`), the other six who are here, and Add a guest.
 *
 * `state="ready"` is Priya at the counter with her Check in tap. `state="checkedIn"`
 * is a moment later: her tap turned to "Checked in", her row in that band, the count
 * one higher, and no To come group, because the list draws a group only when someone
 * is in it.
 *
 * @mirrors src/app/shop/[shopSlug]/trips/[id]/_arrivals/arrival-desk.tsx
 * @mirrors src/app/shop/[shopSlug]/trips/[id]/_arrivals/CounterInstrument.tsx
 * @mirrors src/app/shop/[shopSlug]/trips/[id]/_arrivals/ArrivalTap.tsx
 * @mirrors src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx
 * @mirrors src/app/shop/[shopSlug]/trips/[id]/_components/GuestFixList.tsx
 * @mirrors src/components/IdentityCheck.tsx
 */
export function ArrivalDeskFallback({
  locale,
  state = "ready",
  held = "identity",
}: {
  locale: DiverLocale;
  state?: "ready" | "checkedIn";
  /**
   * Why the one seat can't board: `identity` is the held seat asking whether the booking is the
   * same person (the check-in page); `card` is a certification nobody has verified yet (the
   * homepage walkthrough, where the card has its own slide).
   */
  held?: "identity" | "card";
}) {
  const t = diverTranslator(locale);
  const checkedIn = state === "checkedIn";
  const here = checkedIn ? 8 : 7;
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.arrivalDesk.label")} />
      <div className={MOCK_BODY}>
        <p className="text-sm text-muted tabular-nums">
          {t.rich("fallback.arrivalDesk.hereOf", {
            here,
            expected: 9,
            figure: (chunks) => (
              <span className={`${FIGURE_LARGE_CLASS} text-foreground`}>{chunks}</span>
            ),
          })}
        </p>
        <ProgressBar
          aria-hidden="true"
          className="mt-2 h-[5px]"
          segments={[
            { key: "here", fraction: here / 9, className: "bg-success/70" },
            { key: "blocked", fraction: 1 / 9, className: "bg-danger/60" },
          ]}
        />
        <div className="mt-4 overflow-hidden rounded-inset border border-border bg-surface">
          <div className={ROSTER_BAND}>
            <p className={groupLabelClass()}>
              {t("fallback.arrivalDesk.stillToClear", { count: 1 })}
            </p>
          </div>
          <div className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              {/* i18n-exempt: sample diver name used only in marketing mockups */}
              <p className="min-w-0 flex-1 text-sm font-semibold">Diego Alvarez</p>
              <RowCaret />
            </div>
            <p className="flex items-baseline gap-2 text-xs text-danger">
              <StatusMarkColumn variant="danger" />
              <span>
                {held === "card"
                  ? t("fallback.arrivalDesk.cardReason")
                  : t("fallback.arrivalDesk.heldReason", {
                      // i18n-exempt: sample diver names used only in marketing mockups
                      bookedAs: "Mateo Rossi",
                      // i18n-exempt: sample diver names used only in marketing mockups
                      name: "Diego Alvarez",
                    })}
              </span>
            </p>
            {held === "card" ? null : (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled className={`px-3 ${MOCK_SECONDARY_BUTTON}`}>
                  {t("fallback.arrivalDesk.samePerson")}
                </button>
                <button type="button" disabled className={`px-3 ${MOCK_SECONDARY_BUTTON}`}>
                  {t("fallback.arrivalDesk.differentPerson")}
                </button>
              </div>
            )}
          </div>
          {checkedIn ? null : (
            <>
              <div className={ROSTER_BAND}>
                <p className={groupLabelClass()}>{t("fallback.arrivalDesk.ready", { count: 1 })}</p>
              </div>
              <div className="flex items-center gap-2 px-4 py-1.5">
                {/* i18n-exempt: sample diver name used only in marketing mockups */}
                <p className="min-w-0 flex-1 text-sm font-semibold">Priya Sharma</p>
                <button
                  type="button"
                  disabled
                  data-tap-target=""
                  className={`px-3 whitespace-nowrap ${MOCK_SECONDARY_BUTTON}`}
                >
                  {t("fallback.arrivalDesk.checkIn")}
                </button>
                <RowCaret />
              </div>
            </>
          )}
          <div className={ROSTER_BAND}>
            <p className={groupLabelClass()}>
              {t("fallback.arrivalDesk.checkedInGroup", { count: here })}
            </p>
          </div>
          {checkedIn ? (
            <div className="flex items-center gap-2 px-4 py-1.5">
              {/* i18n-exempt: sample diver name used only in marketing mockups */}
              <p className="min-w-0 flex-1 text-sm font-semibold">Priya Sharma</p>
              <button
                type="button"
                disabled
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold whitespace-nowrap text-success"
              >
                <StatusMark variant="success" size="md" />
                {t("fallback.arrivalDesk.checkedIn")}
              </button>
              <RowCaret />
            </div>
          ) : null}
          <div className="flex items-center gap-2 px-4 py-1.5">
            {/* i18n-exempt: sample diver name used only in marketing mockups */}
            <p className="min-w-0 flex-1 text-sm font-semibold">Tom Okafor</p>
            <button
              type="button"
              disabled
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold whitespace-nowrap text-success"
            >
              <StatusMark variant="success" size="md" />
              {t("fallback.arrivalDesk.checkedIn")}
            </button>
            <RowCaret />
          </div>
        </div>
      </div>
    </div>
  );
}
