import { Copyable } from "@/components/Copyable";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field } from "@/components/ui/form";
import type { WebsiteSetup } from "@/db/website-setup";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { SetupLine, SetupLineKind } from "@/lib/assists/website-setup";
import { deskTimeOn } from "@/lib/desk-hours";
import { formatDateTimeTz, formatMoneyCents, formatTime } from "@/lib/format";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import {
  acceptSetupLineAction,
  dismissSetupLineAction,
  readWebsiteSetupAction,
} from "./setup-actions";

const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "setup-read": { tone: "success", key: "assistsFront.setup.notices.read" },
  "setup-nothing-found": { tone: "warning", key: "assistsFront.setup.notices.nothing" },
  "setup-bad-site": { tone: "danger", key: "assistsFront.setup.notices.badSite" },
  "setup-dark": { tone: "warning", key: "assistsFront.setup.notices.dark" },
  "setup-saved": { tone: "success", key: "assistsFront.setup.notices.saved" },
  "setup-gone": { tone: "warning", key: "assistsFront.setup.notices.gone" },
};

const KIND_KEYS: Record<SetupLineKind, StaffMessageKey> = {
  tagline: "assistsFront.setup.kind.tagline",
  description: "assistsFront.setup.kind.description",
  phone: "assistsFront.setup.kind.phone",
  deskHours: "assistsFront.setup.kind.deskHours",
  coursePrice: "assistsFront.setup.kind.coursePrice",
  departure: "assistsFront.setup.kind.departure",
  policy: "assistsFront.setup.kind.policy",
};

type Shop = { slug: string; timezone: string; currency: string };

/** A clock time ("08:00", or minutes past midnight) as the reader writes times. */
function clock(minute: number, ctx: { now: Date; locale: string; shop: Shop }): string {
  return formatTime(deskTimeOn(minute, ctx.now, ctx.shop.timezone), ctx.locale, ctx.shop.timezone);
}

function minuteOf(time: string | undefined): number | null {
  const match = time?.match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** What accepting the line would write, in the reader's words. */
function lineValue(
  line: SetupLine,
  t: StaffTranslator,
  ctx: { now: Date; locale: string; shop: Shop; courseNames: Map<string, string> },
): string {
  const price = (cents: number) => formatMoneyCents(cents, ctx.shop.currency, ctx.locale);
  switch (line.kind) {
    case "deskHours":
      return line.opensMinute !== undefined && line.closesMinute !== undefined
        ? t("assistsFront.setup.deskHoursValue", {
            opens: clock(line.opensMinute, ctx),
            closes: clock(line.closesMinute, ctx),
          })
        : line.text;
    case "coursePrice":
      return line.priceCents !== undefined
        ? t("assistsFront.setup.coursePriceValue", {
            course: (line.courseId && ctx.courseNames.get(line.courseId)) || line.text,
            price: price(line.priceCents),
          })
        : line.text;
    case "departure": {
      const minute = minuteOf(line.startTime);
      const time = minute === null ? (line.startTime ?? "") : clock(minute, ctx);
      return line.priceCents !== undefined
        ? t("assistsFront.setup.departurePriceValue", {
            title: line.text,
            time,
            price: price(line.priceCents),
          })
        : t("assistsFront.setup.departureValue", { title: line.text, time });
    }
    default:
      return line.text;
  }
}

/**
 * **Import's "Website" tab** (ADR 20261018-claude-assists; the `setup`
 * assist): paste the shop's own site, and Claude's reading comes back as
 * lines, each beside the sentence on the site it came from, so a price is
 * never shown without its source. A line is written only when the owner
 * accepts it, through a writer as narrow as the line; a departure goes to the
 * board's own Add a departure, and a policy is there to copy. Rendered only
 * while the shop's assists are on, for a person who may change its settings.
 */
export function WebsiteSetupPanel({
  t,
  notice,
  setup,
  shop,
  locale,
  now,
  courseNames,
}: {
  t: StaffTranslator;
  notice?: string;
  setup: WebsiteSetup | null;
  shop: Shop;
  locale: string;
  now: Date;
  courseNames: Map<string, string>;
}) {
  const banner = noticeFromParam(notice, NOTICES);
  const ctx = { now, locale, shop, courseNames };
  const read = readWebsiteSetupAction.bind(null, shop.slug);
  const accept = acceptSetupLineAction.bind(null, shop.slug);
  const dismiss = dismissSetupLineAction.bind(null, shop.slug);

  return (
    <>
      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}
      <SectionCard
        padding="lg"
        title={t("assistsFront.setup.heading")}
        description={t("assistsFront.setup.intro")}
      >
        <form action={read} className="flex flex-wrap items-end gap-3">
          <Field label={t("assistsFront.setup.siteLabel")} className="min-w-64 flex-1">
            <input
              type="url"
              name="site"
              required
              maxLength={500}
              inputMode="url"
              autoComplete="url"
              defaultValue={setup ? `https://${setup.host}/` : undefined}
              className={controlClass}
            />
          </Field>
          <SubmitButton
            pendingLabel={t("assistsFront.setup.reading")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("assistsFront.setup.read")}
          </SubmitButton>
        </form>

        {setup && setup.lines.length > 0 ? (
          <div className="mt-8">
            <p className="text-sm text-muted">
              {t("assistsFront.setup.readFrom", {
                host: setup.host,
                date: formatDateTimeTz(setup.readAt, locale, shop.timezone),
              })}
            </p>
            <ul className="mt-3 space-y-2">
              {setup.lines.map((line) => {
                const kind = t(KIND_KEYS[line.kind]);
                const value = lineValue(line, t, ctx);
                return (
                  <li
                    key={line.key}
                    className="grid gap-2 rounded-inset bg-surface-sunken px-4 py-3 sm:grid-cols-[9rem_1fr_auto] sm:items-start sm:gap-4"
                  >
                    <span className="text-sm font-medium text-muted">{kind}</span>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground wrap-anywhere">{value}</p>
                      <p className="mt-1 text-sm text-muted wrap-anywhere">
                        {t("assistsFront.setup.source", { source: line.source })}
                      </p>
                    </div>
                    {line.status === "open" ? (
                      <div className="flex flex-wrap gap-2">
                        {/* A policy has nowhere here to go: its text is shown
                            like any line's, and Copy stands where Accept would. */}
                        {line.kind === "policy" ? (
                          <Copyable
                            value={line.text}
                            hint={t("assistsFront.setup.policyHint")}
                            copyLabel={t("assistsFront.setup.copy")}
                            copiedLabel={t("assistsFront.setup.copied")}
                            failedLabel={t("assistsFront.setup.copyFailed")}
                            layout="inline"
                          />
                        ) : (
                          <form action={accept}>
                            <input type="hidden" name="key" value={line.key} />
                            <SubmitButton
                              pendingLabel={t("assistsFront.setup.accept")}
                              ariaLabel={t("assistsFront.setup.acceptFor", { kind })}
                              className={buttonClass({ variant: "secondary", size: "sm" })}
                            >
                              {line.kind === "departure"
                                ? t("assistsFront.setup.addDeparture")
                                : t("assistsFront.setup.accept")}
                            </SubmitButton>
                          </form>
                        )}
                        <form action={dismiss}>
                          <input type="hidden" name="key" value={line.key} />
                          <SubmitButton
                            pendingLabel={t("assistsFront.setup.dismiss")}
                            ariaLabel={t("assistsFront.setup.dismissFor", { kind })}
                            className={buttonClass({ variant: "ghost", size: "sm" })}
                          >
                            {t("assistsFront.setup.dismiss")}
                          </SubmitButton>
                        </form>
                      </div>
                    ) : (
                      <span className="text-sm text-muted">
                        {line.status === "accepted"
                          ? t("assistsFront.setup.accepted")
                          : t("assistsFront.setup.dismissed")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </SectionCard>
    </>
  );
}
