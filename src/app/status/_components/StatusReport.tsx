import { SkeletonLineBars } from "@/components/ShopPageHeader";
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

/*
 * The component list, spelled once for the report and its fallback (K-402,
 * K-403). The card is a shell (`padding="none"`) and the list carries the
 * card's side padding, so the divider is inset to the words; each row pads
 * itself `py-3.5` on both sides, a 52px row with its words in the middle. It
 * was `py-3 first:pt-0 last:pb-0` inside the card's `p-4 sm:p-5`, so each end
 * row's outer half was the card's padding and its inner half the row's, and
 * "The app" sat 4px low in its band while "The database" sat 4px high in its.
 * Not `LedgerRow`: its own `border-t … last:border-b` would double the card's
 * top and bottom hairlines.
 */
const LIST_CLASS = "divide-y divide-border px-4 sm:px-5";
const ROW_CLASS = "flex items-center justify-between gap-4 py-3.5";
const LIST_CARD = { padding: "none", className: "mt-10" } as const;

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

        <SectionCard {...LIST_CARD}>
          <ul className={LIST_CLASS}>
            {components.map((component) => {
              const up = component.state === "up";
              return (
                <li key={component.id} className={ROW_CLASS}>
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
 *
 * The report's own card, list and rows, and every bar a line box — `h-lh` in
 * the type of the words it stands for — so nothing moves when the verdict
 * lands. The bars used to be 16px for 20px lines, which put the card 8px high,
 * `h-5` rows `gap-7` apart in a padded card, and one 16px bar for a contact
 * line of two lines, three on a phone (K-403).
 */
export function StatusReportFallback() {
  const bar = "rounded bg-surface-sunken";
  return (
    <main className="flex-1 animate-pulse">
      <div className="mx-auto w-full max-w-3xl px-6 py-16 lg:py-24">
        <div className={`h-lh text-sm w-32 ${bar}`} />
        <div className={`mt-4 h-lh ${BANNER_TITLE_CLASS} w-3/4 ${bar}`} />
        <div className={`mt-3 h-lh text-sm w-56 ${bar}`} />
        <div className={sectionCardClass(LIST_CARD)}>
          <div className={LIST_CLASS}>
            {[0, 1].map((row) => (
              <div key={row} className={ROW_CLASS}>
                <div className={`h-lh text-base w-40 ${bar}`} />
                <div className={`h-lh text-sm w-28 ${bar}`} />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-8">
          <SkeletonLineBars lines={{ base: 3, sm: 2 }} height="h-lh text-sm" width="w-full" />
        </div>
      </div>
    </main>
  );
}
