import type { Metadata } from "next";
import { createDiverFromSearchAction } from "@/app/actions/divers";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { UndoToast } from "@/components/UndoToast";
import { canPersonDeleteDiver, loadActiveStaffRoles } from "@/db/authz";
import { getDb } from "@/db/client";
import { listDiverMergeDuplicateIds } from "@/db/diver-merge";
import { isDiverFilter, listDiverSummaries, restoreDiver } from "@/db/divers";
import { rosterFacts } from "@/db/roster-facts";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { canDeleteDiver, canImportShopData, canMergeDiver } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { formatShortDate, formatTime } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import type { AboardBlockerKind } from "@/lib/readiness";
import { rosterLetter, rosterRowFact } from "@/lib/roster-rows";
import { requireShopSurface, requireStaffSession } from "@/lib/session";
import { type NoticeTone, noticeFromParam, noticeUrl, shopPath } from "@/lib/staff-notices";
import { DiverList, type RosterBadge, type RosterRow } from "./_components/DiverList";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Divers — DiveDay" };

/**
 * One entry per notice, carrying its own tone and message key — the shape the
 * diver record's own banner already uses. This was a seven-deep ternary with a
 * separate hand-maintained `noticeIsError` disjunction beside it: adding a
 * refusal to one and not the other rendered a failure in success green, and
 * both lists had to be read end-to-end to answer "what can this page say?".
 */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  duplicate: { tone: "danger", key: "divers.page.noticeDuplicate" },
  deleted: { tone: "success", key: "divers.page.noticeDeleted" },
  restored: { tone: "success", key: "divers.page.noticeRestored" },
  // `restoreDiver` refused: an active diver has since claimed this one's email
  // (CR-008), or the record was erased and has no way back. Distinct from
  // `invalid`, which is about the add-a-diver form's three fields.
  "restore-refused": { tone: "danger", key: "divers.page.noticeRestoreRefused" },
  erased: { tone: "success", key: "divers.page.noticeErased" },
  // The erasure landed locally and deleted what it could at Stripe, but
  // something there is still owed — a failed customer delete, or the invoice
  // snapshot only a data-deletion request clears. Saying plain "erased" here
  // would overstate what happened (ADR 20260803-processor-erasure-obligations).
  "erased-processor-owed": { tone: "success", key: "divers.page.noticeErasedProcessorOwed" },
  "not-authorized": { tone: "danger", key: "divers.page.noticeNotAuthorized" },
  invalid: { tone: "danger", key: "divers.page.noticeInvalid" },
};

export default async function DiversPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    notice?: string;
    deleted?: string;
    q?: string;
    page?: string;
    filter?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const { notice, deleted, q, page, filter: filterParam } = await searchParams;
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const query = q?.trim() ?? "";
  // Both gates in one round trip, and *before* the roster query, because the
  // view the query runs depends on one of them:
  //
  // - **Restore** is the inverse of the owner/manager-only removal (H-14, ADR
  //   20260724-role-authorization), so the view whose whole purpose is
  //   restoring takes the same gate — and takes it here, not just on the chip:
  //   a hand-typed `?filter=removed` must not list removed people to a
  //   deckhand either.
  // - **Import** is the same gate the import page itself enforces, so the
  //   roster's empty state only shows a door its reader may walk through (ADR
  //   20260724-role-gated-surfaces-hide-not-explain).
  //
  // Together, not in series: the page already waits on the list query, and a
  // roster read is not the place to add a second sequential hop.
  // Both permissions come from the same live staff-role read. The old route
  // asked each helper to independently load the person, account, and roles;
  // that was six sequential database round trips on a cold Vercel request,
  // making the otherwise bounded roster occasionally cross the five-second
  // runtime limit.
  const liveRoles = await loadActiveStaffRoles(db, shop.id, session.user.personId);
  const canDelete = liveRoles !== null && canDeleteDiver(liveRoles);
  const canImport = liveRoles !== null && canImportShopData(liveRoles);
  const canMerge = liveRoles !== null && canMergeDiver(liveRoles);
  const requested = isDiverFilter(filterParam) ? filterParam : "all";
  const filter = requested === "removed" && !canDelete ? "all" : requested;
  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range, so a search that narrows the roster never strands the reader on a
  // page the new result set does not have.
  const now = nowDate();
  const [diverPage, possibleDuplicateIds] = await Promise.all([
    listDiverSummaries(db, shop.id, {
      query,
      page: Number.parseInt(page ?? "", 10),
      filter,
      // "Diving today" is the shop's own calendar day, not the server's.
      timeZone: shop.timezone,
      now,
    }),
    canMerge ? listDiverMergeDuplicateIds(db, shop.id) : Promise.resolve([]),
  ]);
  // Second, because it takes the ids the first one just returned: the four
  // roster facts are all `inArray`-bounded to this page rather than read over
  // the whole roster (`rosterFacts`, src/db/roster-facts.ts).
  const duplicateIds = new Set<string>(possibleDuplicateIds);
  const facts = await rosterFacts(
    db,
    shop.id,
    diverPage.divers.map((diver) => diver.id),
    { now },
  );
  /** The roster's URL with the search and view kept and only `page` swapped. */
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (filter !== "all") search.set("filter", filter);
    if (target > 1) search.set("page", String(target));
    const roster = shopPath(shopSlug, "divers");
    return search.size ? `${roster}?${search}` : roster;
  };

  async function restoreDiverAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const activeDb = await getDb();
    // Restoring is the inverse of the owner/manager-only deletion, so it takes
    // the same gate (H-14, ADR 20260724-role-authorization).
    const roster = shopPath(staff.user.shopSlug, "divers");
    if (!(await canPersonDeleteDiver(activeDb, staff.user.shopId, staff.user.personId))) {
      revalidateAndRedirect(roster, noticeUrl(roster, "not-authorized"));
    }
    const personId = String(formData.get("personId") ?? "");
    const restored = personId && (await restoreDiver(activeDb, staff.user.shopId, personId));
    revalidateAndRedirect(roster, noticeUrl(roster, restored ? "restored" : "restore-refused"));
  }

  /** What a diver is blocked on, as a badge word — one key per kind. */
  const BLOCKED_LABELS: Record<AboardBlockerKind, StaffMessageKey> = {
    medical: "divers.list.blocked.medical",
    unknown: "divers.list.blocked.unknown",
    certification: "divers.list.blocked.certification",
    payment: "divers.list.blocked.payment",
  };

  /**
   * **The row's badges, and there are only ever three kinds** (ADR
   * 20260827-people-not-lists, decision 2: "only exceptional badges").
   *
   * Worst first, and every one of them is a thing a staffer has to do
   * something about: this diver cannot board a departure they are on, an
   * invoice against them is standing open, or two records look like one
   * person. A clear diver's row carries none — the silence is what makes the
   * three readable in a scan of a hundred names, and it is what
   * `DiverList.test.tsx` pins.
   *
   * The certification counts the row used to carry are deliberately not here.
   * A card awaiting a look is real work, but it is the *whole* content of the
   * "Needs attention" view, whose chip already says so; badging it on every
   * row of that view is the same fact at two volumes.
   */
  const badgesFor = (personId: string): RosterBadge[] => {
    const row = facts.get(personId);
    const badges: RosterBadge[] = [];
    if (row?.blocker) {
      badges.push({ tone: "danger", label: t(BLOCKED_LABELS[row.blocker]) });
    }
    if (row?.openBalance) {
      badges.push({ tone: "warning", label: t("divers.list.openBalanceLabel") });
    }
    if (duplicateIds.has(personId)) {
      badges.push({ tone: "warning", label: t("divers.list.possibleDuplicateLabel") });
    }
    return badges;
  };

  /**
   * The row's one quiet fact, worded here because this is the only layer that
   * knows both the reader's language and the shop's zone. Which fact a row
   * gets is `rosterRowFact`'s call (`src/lib/roster-rows.ts`); this only
   * spells it.
   */
  const factFor = (personId: string): string | null => {
    const row = facts.get(personId);
    if (!row) return null;
    const fact = rosterRowFact(row);
    if (!fact) return null;
    if (fact.kind === "imported") return t("divers.list.importedOnly");
    // Where the record came from, dated: "signed up at the counter" this
    // morning is the person standing there, and in March is a returning diver
    // the shop has still never seated (issue #1236).
    if (fact.kind === "selfRegistered") {
      return t("divers.list.selfRegistered", {
        date: formatShortDate(fact.at, locale, shop.timezone),
      });
    }
    if (fact.kind === "lastAboard") {
      return t("divers.list.lastAboard", {
        date: formatShortDate(fact.at, locale, shop.timezone),
      });
    }
    return t("divers.list.bookedOn", {
      date: formatShortDate(fact.at, locale, shop.timezone),
      time: formatTime(fact.at, locale, shop.timezone),
    });
  };

  const rows: RosterRow[] = diverPage.divers.map((diver) => ({
    personId: diver.id,
    fullName: diver.fullName,
    href: shopPath(shopSlug, "divers", diver.id),
    letter: rosterLetter(diver.fullName),
    badges: badgesFor(diver.id),
    fact: factFor(diver.id),
  }));

  const banner = noticeFromParam(notice, NOTICES);
  const noticeText = banner ? t(banner.key) : null;
  const noticeIsError = banner?.tone === "danger";
  /**
   * Removal is a land-then-undo action like every other reversible one in the
   * app, so it wears the app's undo affordance (`UndoToast`) rather than the
   * bespoke banner-plus-outlined-button this page grew: a success banner that
   * stayed until the next navigation, with a green-tinted secondary button
   * beside it that looked like nothing else in the product. The banner below is
   * still the fallback for a `?notice=deleted` that arrives with no id to undo
   * (a hand-typed or truncated URL), which the toast has nothing to act on.
   */
  const undoRemoval = notice === "deleted" && deleted ? deleted : null;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {/* `deleted` goes with `notice`: it carries the id the undo toast acts on,
          and a person id left sitting in the address bar after the toast has
          been read is nobody's business and nothing's input. */}
      <FlashParams params={["notice", "deleted"]} />
      <ShopPageHeader eyebrow={t("divers.page.eyebrow")} title={t("divers.page.title")} />

      {undoRemoval ? (
        <UndoToast
          message={t("divers.page.removedToast")}
          action={restoreDiverAction}
          fields={{ personId: undoRemoval }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : noticeText ? (
        <ShopNotice tone={noticeIsError ? "danger" : "success"} className="mt-6">
          <p role="status">{noticeText}</p>
        </ShopNotice>
      ) : null}

      <DiverList
        rows={rows}
        total={diverPage.total}
        shopSlug={shopSlug}
        query={query}
        filter={filter}
        importHref={canImport ? `/shop/${shopSlug}/settings/import` : null}
        canRestore={canDelete}
        quickAddAction={createDiverFromSearchAction}
        pager={
          <Pager
            page={diverPage.page}
            pageCount={diverPage.pageCount}
            href={pageHref}
            total={t("divers.list.pagination.total", { count: diverPage.total })}
            t={t}
            className="mt-8"
          />
        }
        copy={{
          addDiverLabel: t("divers.list.addDiverAction"),
          viewAllDivers: t("divers.list.viewAllDivers"),
          viewDivingToday: t("divers.list.viewDivingToday"),
          viewNeedsAttention: t("divers.list.viewNeedsAttention"),
          viewMissingContact: t("divers.list.viewMissingContact"),
          viewRemoved: t("divers.list.viewRemoved"),
          viewsAriaLabel: t("divers.list.viewsAriaLabel"),
          removedNote: t("divers.list.removedNote"),
          // How many people the list below holds, under whichever view is on —
          // and while a search is on, how many of them matched it. Quiet text
          // beside the box rather than a badge on a "People" heading: the count
          // is a fact about the list, not a status, and the heading it hung off
          // named the thing the page is already called.
          countLabel: query
            ? t("divers.page.matchingCount", { count: diverPage.total })
            : t("divers.list.pagination.total", { count: diverPage.total }),
          searchDiversLabel: t("divers.list.searchDiversLabel"),
          searchPlaceholder: t("divers.list.searchPlaceholder"),
          noDiversMatchView: t("divers.list.noDiversMatchView"),
          noDiversOnFile: t("divers.list.noDiversOnFile"),
          addOneHere: t("divers.list.addOneHere"),
          emptyShowAll: t("divers.list.emptyShowAll"),
          emptyImportBody: t("divers.list.emptyImportBody"),
          emptyImportAction: t("divers.list.emptyImportAction"),
          letterOther: t("divers.list.letterOther"),
        }}
      />
    </main>
  );
}
