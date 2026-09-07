import { SectionCard, sectionCardClass } from "@/components/ui/card";
import { StatusMark, type StatusMarkVariant } from "@/components/ui/StatusMark";
import { BANNER_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { PlatformComponent, PlatformStatus } from "@/lib/platform-status";

/**
 * The mark beside the headline, and the mark on each row.
 *
 * Shape as well as colour: `StatusMark` draws a distinct outline per variant,
 * so the answer survives monochrome, a printed page and a reader who does not
 * separate red from green (ADR 20260827-the-departure-is-two-working-surfaces,
 * decision 5). The words beside it carry the meaning either way.
 */
const HEADLINE_MARK: Record<PlatformStatus, StatusMarkVariant> = {
  ok: "success",
  degraded: "warning",
  down: "danger",
};

/**
 * `-strong` for the two hues that need it, the same numbers `FormStatus` and
 * `Badge` are written against: the raw `text-success`/`text-warning` clear AA
 * on `bg-surface` and miss it on the tinted and sunken grounds this page's
 * marks sit on. `danger` needs no nudge.
 */
const TONE_CLASS: Record<PlatformStatus, string> = {
  ok: "text-success-strong",
  degraded: "text-warning-strong",
  down: "text-danger",
};

/**
 * What the status page says, with every check already made.
 *
 * A pure view: the page runs the checks and hands down codes plus one finished
 * timestamp string. That split is what lets the words be read without a
 * database and the checks be tested without a renderer.
 */
export function StatusReport({
  locale,
  status,
  components,
  checkedAt,
  supportEmail,
}: {
  locale: DiverLocale;
  status: PlatformStatus;
  components: readonly PlatformComponent[];
  /** Already formatted for the reader's locale, in a named zone. */
  checkedAt: string;
  supportEmail: string;
}) {
  const t = diverTranslator(locale);
  const s = (key: string) => t(`marketing.status.${key}` as Parameters<typeof t>[0]);

  return (
    <main className="flex-1">
      <div className="mx-auto w-full max-w-3xl px-6 py-16 lg:py-24">
        <p className="text-sm text-muted">{s("eyebrow")}</p>
        <h1 className={`mt-4 flex items-start gap-3 ${BANNER_TITLE_CLASS}`}>
          <StatusMark
            variant={HEADLINE_MARK[status]}
            size="lg"
            className={`mt-1.5 ${TONE_CLASS[status]}`}
          />
          <span>{s(`headline.${status}`)}</span>
        </h1>
        <p className="mt-3 text-sm text-muted">
          {t("marketing.status.checked", { time: checkedAt })}
        </p>

        <SectionCard className="mt-10">
          <ul className="divide-y divide-border">
            {components.map((component) => {
              const up = component.state === "up";
              return (
                <li
                  key={component.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <span className="text-base">{s(`component.${component.id}`)}</span>
                  <span
                    className={`flex items-center gap-2 text-sm ${up ? TONE_CLASS.ok : TONE_CLASS.down}`}
                  >
                    <StatusMark variant={up ? "success" : "danger"} />
                    {s(`state.${component.state}`)}
                  </span>
                </li>
              );
            })}
          </ul>
        </SectionCard>

        <p className="mt-8 text-sm text-muted">
          {t("marketing.status.contact", { email: supportEmail })}
        </p>
      </div>
    </main>
  );
}

/**
 * The shape the page holds while the checks run, and what `loading.tsx` paints.
 *
 * Bars, never a provisional verdict: a fallback that guessed "Everything is
 * running" would be the one frame of this page that could be wrong, and it is
 * the frame a shop would screenshot.
 */
export function StatusReportFallback() {
  return (
    <main className="flex-1 animate-pulse">
      <div className="mx-auto w-full max-w-3xl px-6 py-16 lg:py-24">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-4 h-9 w-3/4 rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-56 rounded bg-surface-sunken" />
        <div className={sectionCardClass({ className: "mt-10" })}>
          <div className="flex flex-col gap-7">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center justify-between gap-4">
                <div className="h-5 w-40 rounded bg-surface-sunken" />
                <div className="h-5 w-28 rounded bg-surface-sunken" />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-8 h-4 w-full rounded bg-surface-sunken" />
      </div>
    </main>
  );
}
