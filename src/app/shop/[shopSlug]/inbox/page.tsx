import type { Metadata } from "next";
import { after } from "next/server";
import { EmptyState } from "@/components/EmptyState";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { LedgerGroup } from "@/components/ui/ledger";
import { assistsAvailable } from "@/db/assists";
import { pagedInboxMessages } from "@/db/inbound-messages";
import { awaitsTriage, triageInboundMessagesSafely } from "@/db/inbox-assists";
import { inboxSeats } from "@/db/inbox-seats";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatTimeZoneShort } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { StaffSectionTabs } from "../_components/StaffSectionTabs";
import { InboxRow } from "./_components/InboxRow";
import {
  deleteInboxMessageAction,
  markInboxSenderLateAction,
  setInboxMessageDoneAction,
} from "./actions";
import { requestFromMessageAction } from "./assist-actions";

/**
 * `?notice=` codes this page redirects back to itself with. Read through
 * `noticeFromParam`, never a bare `NOTICES[notice]` — the param is
 * attacker-supplied (src/lib/staff-notices.ts).
 *
 * A delete has two outcomes: the row went, or it was not there to go. `gone`
 * covers a second click on a row a colleague already deleted, an id belonging
 * to another shop, and an id that is not an id at all — all of which name no
 * row, and all of which leave the staffer in the same place. Marking a sender
 * running late has two more: the seat took it (or already had it), or the seat
 * closed between the read and the tap.
 */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  deleted: { tone: "success", key: "inbox.notices.deleted" },
  gone: { tone: "warning", key: "inbox.notices.gone" },
  "late-marked": { tone: "success", key: "inbox.notices.lateMarked" },
  "late-closed": { tone: "warning", key: "inbox.notices.lateClosed" },
  // The notes for Claude's reply drafts, at the foot of the page.
  // "Make a request" read nothing a request could hold (the `request` assist).
  "request-nothing": { tone: "warning", key: "assistsFront.inbox.requestNothing" },
};

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
  searchParams: Promise<{ page?: string; notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { page, notice } = await searchParams;
  // No gate of its own since 2026-09-10 (issues #1505/#1518): every live staff
  // role may read this and answer it. `requireShopSurface` is still the whole
  // check — `requireStaffSession` re-reads the account's live roles on every
  // request and sends a disabled, deleted or fully demoted staffer to
  // `/sign-in?session=ended`, and the tenant assert follows it — so a stale
  // 30-day token buys nobody the shop's messages.
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  // A non-numeric or missing `?page=` reads as page 1; the query clamps it
  // into range, so a bookmarked page past the end lands on the last real one.
  const [messages, assists] = await Promise.all([
    pagedInboxMessages(db, shop.id, { page: Number.parseInt(page ?? "", 10) }),
    assistsAvailable(db, shop.id),
  ]);
  // One clock for the read and the stamps: "Today, 7:00 AM" and the seat it
  // links to are the same today (fourth review, item 45).
  const now = nowDate();
  // The departures each message could be about (UX review 2026-10-13, item 19;
  // fourth review, item 32): the late-window seats, or the seats they held when
  // they wrote.
  const seats = await inboxSeats(
    db,
    shop.id,
    messages.rows.map((row) => row.message),
    now,
  );
  // While the shop's assists are on, a message Claude read as urgent leads its
  // group; the rest keep `pagedInboxMessages`' order (the sort is stable).
  const waiting = messages.rows
    .filter((row) => row.message.answeredAt === null)
    .sort((a, b) =>
      assists
        ? Number(b.message.assistUrgent === true) - Number(a.message.assistUrgent === true)
        : 0,
    );
  // Waiting messages nobody has read for intent and language yet, read after
  // the response so the inbox never waits on Claude; the next view shows them.
  if (assists) {
    // Only the messages triage would read: one it skips is never stamped, and
    // would hold a per-view slot on every view.
    const unread = waiting.flatMap((row) => (awaitsTriage(row.message) ? [row.message.id] : []));
    if (unread.length > 0) after(() => triageInboundMessagesSafely(db, shop.id, unread));
  }
  const requestAction = assists ? requestFromMessageAction : undefined;
  const answered = messages.rows.filter((row) => row.message.answeredAt !== null);
  const banner = noticeFromParam(notice, NOTICES);
  const base = shopPath(shopSlug, "inbox");
  const pageHref = (target: number) => (target > 1 ? `${base}?page=${target}` : base);
  // The rows' times are bare; the list names its zone once, on its first group
  // (visual review A15: a date names its zone once per list).
  const timesIn = t("inbox.timesIn", { zone: formatTimeZoneShort(locale, shop.timezone, now) });

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader title={t("shared.shopSections.inbox")} />
      <StaffSectionTabs
        section="inbox"
        current="inbox"
        roles={session.user.roles}
        shop={shop}
        t={t}
      />

      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}

      {messages.total === 0 ? (
        <EmptyState title={t("inbox.emptyHeading")} body={t("inbox.emptyDetail")} />
      ) : (
        <div className="space-y-10">
          {waiting.length > 0 ? (
            // The count rides in the group label because it is a fact the
            // whole group shares, and the rows beneath say only who wrote and
            // what about (design/principles.md #9). It counts this page rather
            // than the shop: the pager below says how many messages there are.
            <LedgerGroup
              as="h2"
              label={t("inbox.group.waiting", { count: waiting.length })}
              meta={timesIn}
            >
              <ul>
                {waiting.map((row) => (
                  <InboxRow
                    key={row.message.id}
                    row={row}
                    shopSlug={shopSlug}
                    locale={locale}
                    timezone={shop.timezone}
                    now={now}
                    t={t}
                    deleteAction={deleteInboxMessageAction}
                    doneAction={setInboxMessageDoneAction}
                    seats={seats.get(row.message.id) ?? []}
                    lateAction={markInboxSenderLateAction}
                    requestAction={requestAction}
                  />
                ))}
              </ul>
            </LedgerGroup>
          ) : null}

          {answered.length > 0 ? (
            <LedgerGroup
              as="h2"
              label={t("inbox.group.answered")}
              meta={waiting.length > 0 ? undefined : timesIn}
            >
              <ul>
                {answered.map((row) => (
                  <InboxRow
                    key={row.message.id}
                    row={row}
                    shopSlug={shopSlug}
                    locale={locale}
                    timezone={shop.timezone}
                    now={now}
                    t={t}
                    deleteAction={deleteInboxMessageAction}
                    doneAction={setInboxMessageDoneAction}
                    seats={seats.get(row.message.id) ?? []}
                    lateAction={markInboxSenderLateAction}
                    requestAction={requestAction}
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
        words={staffPagerWords(t)}
      />
    </main>
  );
}
