import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { InsetGroup } from "@/components/ui/ledger";
import { type InboxRow, pagedInboxMessages } from "@/db/inbound-messages";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { InboxMessageRow } from "./_components/InboxMessageRow";

export const instant = true;

export const metadata: Metadata = {
  title: "Messages — DiveDay",
};

/**
 * The two outcomes this page can be handed back. Both acts on a row are
 * silent when they work — the row moves into the group below, or leaves the
 * page — so the only thing left to say is that the row was already gone.
 */
const NOTICE_KEYS: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "message-not-found": { tone: "danger", key: "inbox.notFound" },
};

/**
 * **One shop inbox: everything divers wrote back, on any channel** (ADR
 * 20260907-two-way-inbox).
 *
 * It is a worklist, not a feed. `pagedInboxMessages` returns the unanswered
 * first and the newest first inside each half, and this page draws the seam as
 * two groups — so "has anybody answered this?" is asked as "which group is it
 * in?", the same grammar the reviews queue reads in.
 *
 * **Answering is not here.** The shop writes back from the diver's record,
 * where the whole conversation is, so a row's job is to say who wrote, on what
 * channel, and enough of what they said to decide whether to open it. The two
 * acts that stay (mark answered, delete) are the ones that are not answering.
 *
 * Ungated, unlike the date requests beside it in "Run the shop": these are
 * overwhelmingly divers already on the roster, whose contact details every
 * staff role can already read on the record this page links to, and the
 * message most worth reading at seven in the morning is read by whoever is at
 * the dock. The reasoning is at the registry entry in
 * `src/lib/staff-destinations.ts`.
 */
export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string; notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { page, notice } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range, so a bookmarked page past the end lands on the last real one.
  const messages = await pagedInboxMessages(db, shop.id, {
    page: Number.parseInt(page ?? "", 10),
  });
  const waiting = messages.rows.filter((row: InboxRow) => row.message.answeredAt === null);
  const answered = messages.rows.filter((row: InboxRow) => row.message.answeredAt !== null);
  const banner = noticeFromParam(notice, NOTICE_KEYS);
  const base = shopPath(shopSlug, "inbox");
  const pageHref = (target: number) => (target > 1 ? `${base}?page=${target}` : base);

  const rows = (group: InboxRow[]) =>
    group.map((row) => (
      <InboxMessageRow
        key={row.message.id}
        row={row}
        shopSlug={shopSlug}
        locale={locale}
        timezone={shop.timezone}
        t={t}
      />
    ));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.inbox)} title={t("inbox.title")} />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}

      {messages.total === 0 ? (
        <EmptyState title={t("inbox.emptyHeading")} body={t("inbox.emptyDetail")} />
      ) : (
        <div className="space-y-10">
          {waiting.length > 0 ? (
            <InsetGroup as="h2" bodyAs="ul" label={t("inbox.group.waiting")}>
              {rows(waiting)}
            </InsetGroup>
          ) : null}
          {answered.length > 0 ? (
            <InsetGroup as="h2" bodyAs="ul" label={t("inbox.group.answered")}>
              {rows(answered)}
            </InsetGroup>
          ) : null}
        </div>
      )}

      <Pager
        page={messages.page}
        pageCount={messages.pageCount}
        href={pageHref}
        total={t("inbox.pagination.total", { count: messages.total })}
        t={t}
        className="mt-6"
      />
    </main>
  );
}
