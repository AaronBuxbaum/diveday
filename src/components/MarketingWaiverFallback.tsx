import type { CSSProperties } from "react";
import { StatusMark, StatusMarkColumn } from "@/components/ui/StatusMark";
import { SUB_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { AppBar, MOCK_BODY, MOCK_PRIMARY_BUTTON } from "./MarketingScreenFallbacks";
import { WalkCursor, WalkTyped } from "./WalkTyped";

/** The selected pill's radio and its label, as the medical question draws a chosen answer. */
function NoSelected({ label }: { label: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"
      >
        <span className="size-1.5 rounded-full bg-primary" />
      </span>
      {label}
    </>
  );
}

/**
 * **Signing the waiver on a diver's phone** — `src/app/(token)/waivers/[token]/page.tsx`
 * with its step rail (`WaiverStepRail.tsx`) two steps in, one release question
 * from the medical form (`MedicalQuestionnaireFields.tsx`, the questions in
 * `src/lib/medical.ts`) answered, and the typed signature over "Sign waiver".
 * The release and the medical question stay in English in every language, as
 * they do on the page (H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit), and a Spanish reader gets the page's own
 * notice saying so. Left out: the rest of the release and of the form, and
 * the guardian's line. From a 448px panel the form and the signature stand
 * side by side; the page itself is one column.
 */
export function WaiverSigningFallback({
  locale,
  state = "open",
}: {
  locale: DiverLocale;
  /**
   * `open` is the feature page's screen: the question answered and the name in the box.
   * The homepage walkthrough tells it in two pictures: `filling` (Priya taps No, types her name,
   * then taps Sign waiver, the first two playing out in the walk's first phase) and `signed` a
   * tap later.
   */
  state?: "open" | "filling" | "signed";
}) {
  const t = diverTranslator(locale);
  const signed = state === "signed";
  const filling = state === "filling";
  // i18n-exempt: sample diver name used only in marketing mockups
  const signerName = "Priya Sharma";
  const steps = [
    { label: t("fallback.waiverSigning.railRelease"), done: true },
    { label: t("fallback.waiverSigning.railMedical"), done: !filling },
    { label: t("fallback.waiverSigning.railSign"), done: signed },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.waiverSigning.label")} />
      <div className={`@container ${MOCK_BODY}`}>
        <h3 className={SUB_TITLE_CLASS}>{t("fallback.waiverSigning.title")}</h3>
        <p className="mt-1 text-sm text-muted">{t("fallback.waiverSigning.description")}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-y border-border py-2">
          <ol className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-1.5 text-xs font-medium">
                <StatusMark
                  variant={step.done ? "success" : "pending"}
                  className={step.done ? "text-success" : "text-muted"}
                />
                <span className={step.done ? undefined : "text-muted"}>{step.label}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted tabular-nums">
            {t(
              signed
                ? "fallback.waiverSigning.progressDone"
                : filling
                  ? "fallback.waiverSigning.progressOne"
                  : "fallback.waiverSigning.progress",
            )}
          </p>
        </div>
        {locale === DEFAULT_DIVER_LOCALE ? null : (
          <p className="mt-3 flex items-baseline gap-2 rounded-lg bg-warning-tint px-3 py-2 text-xs text-warning-strong">
            <StatusMarkColumn variant="warning" />
            <span>{t("fallback.waiverSigning.englishOnly")}</span>
          </p>
        )}
        <div className="mt-4 grid gap-4 @md:grid-cols-2 @md:items-start">
          <div>
            <p className="border-b border-border pb-1.5 text-xs font-medium text-muted">
              {t("fallback.waiverSigning.version", {
                // i18n-exempt: the sample shop's own release title, used only in marketing mockups
                title: "Blue Mantis Diving Release",
                version: 1,
              })}
            </p>
            {/* i18n-exempt: release wording stays English pending H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit (DEFAULT_WAIVER_BODY) */}
            <p className="mt-2 text-xs font-semibold">
              Release of Liability, Waiver of Claims, and Assumption of Risk
            </p>
            {/* i18n-exempt: release wording stays English pending H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit (DEFAULT_WAIVER_BODY) */}
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
              I understand that scuba diving, snorkeling, and boat travel carry inherent risks
            </p>
            <div className="mt-3 rounded-lg border border-border bg-surface p-3">
              {/* i18n-exempt: medical form wording stays English pending H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit (src/lib/medical.ts) */}
              <p className="text-sm font-medium">I am over 45 years of age.</p>
              <div className="mt-2 flex gap-2">
                <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs">
                  <StatusMark variant="pending" className="text-muted" />
                  {t("waiver.answerYes")}
                </span>
                {filling ? (
                  <span className="relative inline-flex">
                    <span
                      data-walk-gone=""
                      style={{ "--late-delay": "900ms" } as CSSProperties}
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs"
                    >
                      <StatusMark variant="pending" className="text-muted" />
                      {t("waiver.answerNo")}
                    </span>
                    {/* Her pointer reaches No and presses it 900 ms into the walk's first phase. */}
                    <span
                      aria-hidden="true"
                      data-walk-late=""
                      style={{ "--late-delay": "900ms" } as CSSProperties}
                      className="absolute inset-0 inline-flex items-center gap-2 rounded-lg border border-primary bg-primary-tint px-3 text-xs font-medium text-primary"
                    >
                      <NoSelected label={t("waiver.answerNo")} />
                    </span>
                    <WalkCursor at={900} />
                  </span>
                ) : (
                  <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-primary bg-primary-tint px-3 text-xs font-medium text-primary">
                    <NoSelected label={t("waiver.answerNo")} />
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-inset border border-border bg-surface p-3">
            <p className="text-sm font-semibold">{t("fallback.waiverSigning.signature")}</p>
            <p className="mt-2 text-xs font-medium text-muted">
              {t("fallback.waiverSigning.typeFullName")}
            </p>
            <div className="mt-1 flex min-h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm">
              {filling ? <WalkTyped text={signerName} delay={1700} /> : <span>{signerName}</span>}
            </div>
            <p className="mt-3 flex items-baseline gap-2 text-xs">
              {filling ? (
                <span className="relative inline-flex">
                  <span data-walk-gone="" style={{ "--late-delay": "2600ms" } as CSSProperties}>
                    <StatusMarkColumn variant="pending" className="text-muted" />
                  </span>
                  <span
                    aria-hidden="true"
                    data-walk-late=""
                    style={{ "--late-delay": "2600ms" } as CSSProperties}
                    className="absolute inset-0"
                  >
                    <StatusMarkColumn variant="checked" className="text-primary" />
                  </span>
                  {/* Her fingertip ticks the agreement 3.3 s in, after her name is typed. */}
                  <WalkCursor at={2600} />
                </span>
              ) : (
                <StatusMarkColumn variant="checked" className="text-primary" />
              )}
              <span>{t("fallback.waiverSigning.agreement")}</span>
            </p>
            {signed ? (
              <p
                data-walk-pop=""
                className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-success-tint text-sm font-semibold text-success-strong"
              >
                <StatusMark variant="success" size="md" />
                {t("fallback.waiverSigning.signedDone")}
              </p>
            ) : (
              <button
                type="button"
                disabled
                data-tap-target={state === "open" || filling ? "" : undefined}
                className={`mt-3 w-full ${MOCK_PRIMARY_BUTTON}`}
              >
                {t("fallback.waiverSigning.signButton")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
