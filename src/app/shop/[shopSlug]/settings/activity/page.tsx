import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { tapTargetLinkClass } from "@/components/ui/button";
import { INSET_NOTE_BOX } from "@/components/ui/card";
import { FactLine } from "@/components/ui/FactLine";
import { canPersonViewShopActivity } from "@/db/authz";
import {
  listShopActivityPeople,
  pagedShopActivity,
  type ShopActivityLine,
} from "@/db/shop-activity";
import { SHOP_ACTIVITY_KIND_KEYS, shopActivityLineText } from "@/i18n/activity-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import {
  isShopActivityKind,
  SHOP_ACTIVITY_KINDS,
  type ShopActivityKind,
  shopActivityDay,
} from "@/lib/shop-activity";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { wallTimeToUtc } from "@/lib/zoned";
import { settingsPaneClass } from "../_components/settings-pane";
import { ActivityToolbar } from "./_components/ActivityToolbar";

// The settings segment's own skeleton paints while the log is read (ADR
// 20260804-instant-navigation); nothing above `{children}` waits.
export const instant = true;

export const metadata: Metadata = { title: "Activity — DiveDay" };

/**
 * A line's object link stands a 44px target on a 20px line, the Orders
 * page's "Open trip" idiom (K-389): the wrapper is one `text-sm` line tall,
 * so the target spills above and below without moving the line, and the
 * rows' padding and gap keep two rows' spills from crossing.
 */
const OBJECT_LINE = "inline-flex h-5 items-center";
const OBJECT_LINK = `${tapTargetLinkClass} font-medium text-primary hover:underline`;

/**
 * **The shop's activity log** (D5): who did what, to what, when — across the
 * whole team, newest first, filtered by person, by kind and by date.
 *
 * Owner and manager reading (`canViewShopActivity`), checked against the
 * database before a single line is read: `requireShopSurface`'s gate runs to
 * completion, alone, ahead of the page's own reads, the export page's order.
 * Everyone else lands on Today with the reason.
 *
 * The lines are the trails' own (`src/db/shop-activity.ts`): an erased
 * diver's lines already read `[redacted]` in the table, and every other name
 * is the people row as it reads today, so nothing here filters or redacts at
 * read time.
 */
export default async function ShopActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    personId?: string;
    kind?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonViewShopActivity,
    refusal: { notice: "activity-not-authorized" },
  });
  const query = await searchParams;
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  // Each filter is validated where it arrives, and a malformed one is simply
  // not a filter: a truncated id or a stray `?kind=` never reaches a query.
  const personId = uuidParam(query.personId) ?? undefined;
  const kind: ShopActivityKind | undefined = isShopActivityKind(query.kind)
    ? query.kind
    : undefined;
  const fromDay = shopActivityDay(query.from);
  const toDay = shopActivityDay(query.to);
  // Shop-local days: `from` is that day's first instant, `to` the next day's,
  // so the whole end day is in `[from, to)`.
  const from = fromDay ? wallTimeToUtc({ ...fromDay, hour: 0, minute: 0 }, shop.timezone) : null;
  const to = toDay
    ? wallTimeToUtc({ ...toDay, day: toDay.day + 1, hour: 0, minute: 0 }, shop.timezone)
    : null;

  const [log, staff] = await Promise.all([
    pagedShopActivity(
      db,
      shop.id,
      {
        actorPersonId: personId,
        kind,
        from: from ?? undefined,
        to: to ?? undefined,
      },
      { page: Number.parseInt(query.page ?? "", 10) },
    ),
    listShopActivityPeople(db, shop.id),
  ]);

  const filtered = Boolean(personId || kind || fromDay || toDay);
  const basePath = shopPath(shopSlug, "settings", "activity");
  const kept = new URLSearchParams();
  if (personId) kept.set("personId", personId);
  if (kind) kept.set("kind", kind);
  if (fromDay && query.from) kept.set("from", query.from);
  if (toDay && query.to) kept.set("to", query.to);
  const pageHref = (target: number) => {
    const next = new URLSearchParams(kept);
    if (target > 1) next.set("page", String(target));
    const search = next.toString();
    return search ? `${basePath}?${search}` : basePath;
  };
  const count = t("activity.log.count", { count: log.total });

  return (
    <main className={settingsPaneClass()}>
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={shopPath(shopSlug, "settings")}
        title={t("activity.log.title")}
      />
      <div className="space-y-10">
        <section className="space-y-6">
          <ActivityToolbar
            personId={personId ?? ""}
            kind={kind ?? ""}
            from={fromDay ? (query.from ?? "") : ""}
            to={toDay ? (query.to ?? "") : ""}
            people={staff.map((person) => ({ value: person.id, label: person.name }))}
            kinds={SHOP_ACTIVITY_KINDS.map((value) => ({
              value,
              label: t(SHOP_ACTIVITY_KIND_KEYS[value]),
            }))}
            clearHref={filtered ? basePath : undefined}
            copy={{
              personLabel: t("activity.log.personLabel"),
              personAll: t("activity.log.personAll"),
              kindLabel: t("activity.log.kindLabel"),
              kindAll: t("activity.log.kindAll"),
              fromLabel: t("activity.log.fromLabel"),
              toLabel: t("activity.log.toLabel"),
              clear: t("activity.log.clear"),
              count,
            }}
          />
          {log.total === 0 ? (
            <EmptyState
              title={filtered ? t("activity.log.emptyFiltered") : t("activity.log.empty")}
            />
          ) : (
            <ol className="grid gap-2" data-testid="shop-activity">
              {log.rows.map((line) => (
                <li
                  key={line.key}
                  className={`flex flex-col gap-y-0.5 ${INSET_NOTE_BOX} bg-surface-sunken`}
                >
                  <span className="min-w-0">{shopActivityLineText(t, line)}</span>
                  <span className="text-muted">
                    <FactLine
                      facts={[
                        lineObject(t, shopSlug, line),
                        {
                          value: formatDateTimeTz(line.occurredAt, locale, shop.timezone),
                          className: "tabular-nums",
                        },
                      ]}
                    />
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Pager
            page={log.page}
            pageCount={log.pageCount}
            href={pageHref}
            total={count}
            words={staffPagerWords(t)}
          />
        </section>
      </div>
    </main>
  );
}

/**
 * **What the line is about, as a link to it.** A departure by its title (a
 * deleted one by its title alone: it has no page), an order, the reviews
 * queue, or the diver record a note was written on. A line about nothing in
 * particular — the trail's oldest shapes — has no object, and the line is its
 * sentence and its time.
 */
function lineObject(t: StaffTranslator, shopSlug: string, line: ShopActivityLine) {
  const link = (href: string, label: string) => ({
    value: (
      <span className={OBJECT_LINE}>
        <Link href={href} className={OBJECT_LINK} prefetch={false}>
          {label}
        </Link>
      </span>
    ),
  });
  if (line.tripId && line.tripTitle !== null) {
    return line.tripLive
      ? link(shopPath(shopSlug, "trips", line.tripId), line.tripTitle)
      : t("activity.log.deletedDeparture", { title: line.tripTitle });
  }
  if (line.orderId)
    return link(shopPath(shopSlug, "orders", line.orderId), t("activity.log.order"));
  if (line.source === "review")
    return link(shopPath(shopSlug, "reviews"), t("activity.log.reviews"));
  if (line.subjectPersonId) {
    return link(shopPath(shopSlug, "divers", line.subjectPersonId), t("activity.log.diverRecord"));
  }
  return null;
}
