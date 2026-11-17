import { DiveProfileChart } from "@/components/DiveProfileChart";
import { groupLabelClass } from "@/components/ui/group-label";
import { StatusMark } from "@/components/ui/StatusMark";
import { SUB_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { PROFILE_MAX_METERS, PROFILE_MINUTES, SAMPLE_PROFILE } from "@/lib/dive-profile-sample";
import { AppBar, MOCK_BODY, MOCK_PRIMARY_BUTTON } from "./MarketingScreenFallbacks";

/**
 * The two screens the homepage walkthrough draws that no feature page does: the
 * staff side of Priya's card, and of her dive computer's file. Each has the
 * screen a moment before the tap (`data-tap-target` on the control) and the
 * screen after it, so the walkthrough can press the control and swap. Every
 * control is `disabled`: the homepage's steps open no door into the demo.
 */

/**
 * **Checking a card with PADI** — the diver's record, Certifications section
 * (`divers/[personId]/_components/`): the card she gave the shop when she registered, tagged as
 * her own word until someone has sighted it, and the one "Check with PADI" control. The
 * DiveDay certification check extension (`extension/`) does the lookup in the crew's own
 * browser, where the crew is signed in to PADI's Pros' Site: it opens PADI's page, types her
 * name and card number, and hands the answer back, and DiveDay marks the card certified.
 * `state="certified"` is the card a moment after the tap, with the extension's work shown line
 * by line as it lands.
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
  const lines = [
    { key: "opened", text: t("fallback.cardCheck.extOpened"), delay: 0 },
    // i18n-exempt: sample diver name and card number used only in marketing mockups
    {
      key: "found",
      text: t("fallback.cardCheck.extFound", { name: "Priya Sharma", number: "3481926" }),
      delay: 700,
    },
  ];
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
          <p className="mt-1 text-xs text-muted tabular-nums">
            {/* i18n-exempt: sample card number used only in marketing mockups */}
            {t("fallback.cardCheck.cardNumber", { number: "3481926" })}
          </p>
          {certified ? (
            <>
              <ul className="mt-3 space-y-1.5 rounded-lg bg-primary-tint px-3 py-2.5">
                <li className="text-[11px] font-semibold tracking-wide text-primary uppercase">
                  {t("fallback.cardCheck.extName")}
                </li>
                {lines.map((line) => (
                  <li
                    key={line.key}
                    data-walk-pop=""
                    style={{ animationDelay: `${line.delay}ms` }}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <StatusMark variant="success" size="md" />
                    {line.text}
                  </li>
                ))}
              </ul>
              <p
                data-walk-pop=""
                style={{ animationDelay: "1400ms" }}
                className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-success-strong"
              >
                <StatusMark variant="success" size="md" />
                {t("fallback.cardCheck.matched")}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted">{t("fallback.cardCheck.selfDeclared")}</p>
              <button
                type="button"
                disabled
                data-tap-target=""
                className={`mt-3 ${MOCK_PRIMARY_BUTTON}`}
              >
                {t("fallback.cardCheck.checkWithPadi")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
  const deepest = `${Math.round(PROFILE_MAX_METERS)} m`;
  const facts = [
    // i18n-exempt: sample dive figures used only in marketing mockups
    [t("fallback.computerDives.depth"), deepest],
    // i18n-exempt: sample dive figures used only in marketing mockups
    [t("fallback.computerDives.duration"), `${PROFILE_MINUTES} min`],
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
          <DiveProfileChart
            samples={SAMPLE_PROFILE}
            unit="m"
            className="mt-3 h-auto w-full"
            labels={{
              stop: (minutes) => t("fallback.diveProfile.stop", { minutes }),
              max: t("fallback.diveProfile.max", { depth: deepest }),
              minutes: t("fallback.diveProfile.minutes"),
            }}
          />
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
