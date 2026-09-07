import type { Metadata } from "next";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { LedgerGroup } from "@/components/ui/ledger";
import { canPersonAnswerShopInbox } from "@/db/authz";
import { pagedInboxMessages } from "@/db/inbound-messages";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { shopPath } from "@/lib/staff-notices";
import { InboxRow } from "./_components/InboxRow";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx` is what stands in while the
// request-scoped reads stream, exactly as on every other staff list. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Inbox — DiveDay",
};

/**
 * **What divers wrote back** (ADR 20260907-two-way-inbox).
 *
 * A worklist, not a feed (ADR 20260827-people-not-lists): the messages nobody
 * has answered lead, newest first, and the answered ones follow under their
 * own label. The split is the *state*, so no row carries a word for it, and
 * the ordering is `pagedInboxMessages`' — this page adds no rule of its own.
 *
 * **Answering happens on the diver's record**, which is where the rest of the
 * conversation is and where the shop can see who it is talking to. So every
 * row that has a record behind it is a door to it, and the page carries no
 * composer.
 */
export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { shopSlug } = await params;
  const { page } = await searchParams;
  // Checked against the database rather than the JWT, so a demoted manager
  // loses the inbox on their next request. The nav already hides the
  // destination from everyone else (ADR
  // 20260724-role-gated-surfaces-hide-not-explain); this is for a bookmark, a
  // deep link, or a role that changed under someone.
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonAnswerShopInbox,
    refusal: { notice: "inbox-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it
  // into range, so a bookmarked page past the end lands on the last real one.
  const messages = await pagedInboxMessages(db, shop.id, {
    page: Number.parseInt(page ?? "", 10),
  });
  const waiting = messages.rows.filter((row) => row.message.answeredAt === null);
  const answered = messages.rows.filter((row) => row.message.answeredAt !== null);
  const base = shopPath(shopSlug, "inbox");
  const pageHref = (target: number) => (target > 1 ? `${base}?page=${target}` : base);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.inbox)} title={t("inbox.title")} />

      {messages.total === 0 ? (
        <EmptyState title={t("inbox.emptyHeading")} body={t("inbox.emptyDetail")} />
      ) : (
        <div className="space-y-10">
          {waiting.length > 0 ? (
            // The count rides in the group label because it is a fact the
            // whole group shares, and the rows beneath say only who wrote and
            // what about (design/principles.md #9). It counts this page rather
            // than the shop: the pager below says how many messages there are.
            <LedgerGroup as="h2" label={t("inbox.group.waiting", { count: waiting.length })}>
              <ul>
                {waiting.map((row) => (
                  <InboxRow
                    key={row.message.id}
                    row={row}
                    shopSlug={shopSlug}
                    locale={locale}
                    timezone={shop.timezone}
                    t={t}
                  />
                ))}
              </ul>
            </LedgerGroup>
          ) : null}

          {answered.length > 0 ? (
            <LedgerGroup as="h2" label={t("inbox.group.answered")}>
              <ul>
                {answered.map((row) => (
                  <InboxRow
                    key={row.message.id}
                    row={row}
                    shopSlug={shopSlug}
                    locale={locale}
                    timezone={shop.timezone}
                    t={t}
                  />
                ))}
              </ul>
            </LedgerGroup>
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
