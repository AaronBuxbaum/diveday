import { groupLabelClass } from "@/components/ui/group-label";
import { StatusMark } from "@/components/ui/StatusMark";
import { SUB_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { AppBar, MOCK_BODY, MOCK_PRIMARY_BUTTON } from "./MarketingScreenFallbacks";

/**
 * The two screens the homepage walkthrough draws that no feature page does: the
 * staff side of Priya's card, and of her dive computer's file. Each has the
 * screen a moment before the tap (`data-tap-target` on the control) and the
 * screen after it, so the walkthrough can press the control and swap. Every
 * control is `disabled`: the homepage's steps open no door into the demo.
 */

/**
 * **Confirming a card** — the diver's record, Certifications section
 * (`divers/[personId]/_components/MarkCertifiedControl.tsx`): the card a diver
 * entered, tagged as their own word until someone on staff has sighted it, and
 * the one control that turns it into a certification the boarding check counts.
 * `state="certified"` is the row a tap later, signed off by the crew.
 *
 * @mirrors src/app/shop/[shopSlug]/divers/[personId]/_components/MarkCertifiedControl.tsx
 */
export function CardCheckFallback({
  locale,
  state = "pending",
}: {
  locale: DiverLocale;
  state?: "pending" | "certified";
}) {
  const t = diverTranslator(locale);
  const certified = state === "certified";
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.cardCheck.label")} />
      <div className={MOCK_BODY}>
        {/* i18n-exempt: sample diver name used only in marketing mockups */}
        <h3 className={SUB_TITLE_CLASS}>Priya Sharma</h3>
        <p className={`mt-4 ${groupLabelClass()}`}>{t("fallback.cardCheck.heading")}</p>
        <div className="mt-2 rounded-inset border border-border bg-surface p-4">
          {/* i18n-exempt: sample certification used only in marketing mockups */}
          <p className="text-sm font-semibold">PADI Advanced Open Water</p>
          {certified ? (
            <p
              data-walk-pop=""
              className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-success-strong"
            >
              <StatusMark variant="success" size="md" />
              {/* i18n-exempt: sample crew name used only in marketing mockups */}
              {t("fallback.cardCheck.certifiedBy", { name: "Keiko Tanaka" })}
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted">{t("fallback.cardCheck.selfDeclared")}</p>
              <button
                type="button"
                disabled
                data-tap-target=""
                className={`mt-3 ${MOCK_PRIMARY_BUTTON}`}
              >
                {t("fallback.cardCheck.confirm")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** A dive's depth against time, drawn as the profile line the import preview shows. */
const PROFILE = "M0 4 L14 22 L30 34 L58 36 L86 32 L104 20 L114 8 L120 4";

/**
 * **A dive computer's file, imported** — the diver's Computer dives page
 * (`divers/[personId]/computer-dives/ComputerDives.tsx`): the preview of a
 * dive read from the file (computer, depth, time, gas and the depth profile),
 * confirmed with Import selected dives, then the same dive in the diver's
 * imported history. Staff import the file into the diver's record; nothing
 * here reaches the diver's own recap.
 * `state="imported"` is the page a tap later.
 *
 * @mirrors src/app/shop/[shopSlug]/divers/[personId]/computer-dives/ComputerDives.tsx
 */
export function ComputerDivesFallback({
  locale,
  state = "preview",
}: {
  locale: DiverLocale;
  state?: "preview" | "imported";
}) {
  const t = diverTranslator(locale);
  const imported = state === "imported";
  const facts = [
    // i18n-exempt: sample dive figures used only in marketing mockups
    [t("fallback.computerDives.depth"), "18 m"],
    // i18n-exempt: sample dive figures used only in marketing mockups
    [t("fallback.computerDives.duration"), "42 min"],
    [t("fallback.computerDives.gas"), t("fallback.computerDives.air")],
  ] as const;
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.computerDives.label")} />
      <div className={MOCK_BODY}>
        <h3 className={SUB_TITLE_CLASS}>
          {t(
            imported
              ? "fallback.computerDives.historyHeading"
              : "fallback.computerDives.previewHeading",
          )}
        </h3>
        <div className="mt-3 rounded-inset border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* i18n-exempt: sample dive computer used only in marketing mockups */}
            <p className="text-sm font-semibold">Shearwater Perdix</p>
            {imported ? (
              <span
                data-walk-pop=""
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-strong"
              >
                <StatusMark variant="success" size="md" />
                {t("fallback.computerDives.imported")}
              </span>
            ) : null}
          </div>
          <svg
            aria-hidden="true"
            viewBox="0 0 120 40"
            className="mt-3 h-14 w-full"
            preserveAspectRatio="none"
            focusable="false"
          >
            <path
              d={PROFILE}
              fill="none"
              className="stroke-primary"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted">{label}</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {imported ? null : (
          <button
            type="button"
            disabled
            data-tap-target=""
            className={`mt-3 ${MOCK_PRIMARY_BUTTON}`}
          >
            {t("fallback.computerDives.import")}
          </button>
        )}
      </div>
    </div>
  );
}
