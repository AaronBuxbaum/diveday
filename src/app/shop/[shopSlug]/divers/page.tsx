import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { PersonFieldTrio } from "@/components/seat-diver/PersonFieldTrio";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { FieldActions } from "@/components/ui/form";
import { canPersonDeleteDiver } from "@/db/authz";
import { getDb } from "@/db/client";
import { createDiver, isDiverFilter, listDiverSummaries, restoreDiver } from "@/db/divers";
import { canPersonImportShopData } from "@/db/import";
import { getShopById } from "@/db/shops";
import { CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { revalidateAndRedirect } from "@/lib/navigation";
import type { CertificationLevel } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";
import { type NoticeTone, noticeFromParam, noticeUrl, shopPath } from "@/lib/staff-notices";
import { DiverList } from "./_components/DiverList";

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

const diverSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.email().max(320)]),
  phone: z.string().trim().max(40),
});

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
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, deleted, q, page, filter: filterParam } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
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
  const [canDelete, canImport] = await Promise.all([
    canPersonDeleteDiver(db, shop.id, session.user.personId),
    canPersonImportShopData(db, shop.id, session.user.personId),
  ]);
  const requested = isDiverFilter(filterParam) ? filterParam : "all";
  const filter = requested === "removed" && !canDelete ? "all" : requested;
  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range, so a search that narrows the roster never strands the reader on a
  // page the new result set does not have.
  const diverPage = await listDiverSummaries(db, shop.id, {
    query,
    page: Number.parseInt(page ?? "", 10),
    filter,
    // "Diving today" is the shop's own calendar day, not the server's.
    timeZone: shop.timezone,
  });
  /** The roster's URL with the search and view kept and only `page` swapped. */
  const pageHref = (target: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (filter !== "all") search.set("filter", filter);
    if (target > 1) search.set("page", String(target));
    const roster = shopPath(shopSlug, "divers");
    return search.size ? `${roster}?${search}` : roster;
  };

  async function addDiverAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = diverSchema.safeParse(Object.fromEntries(formData));
    const roster = shopPath(staff.user.shopSlug, "divers");
    if (!parsed.success) redirect(noticeUrl(roster, "invalid"));
    const diver = await createDiver(await getDb(), {
      shopId: staff.user.shopId,
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      phone: parsed.data.phone,
    });
    revalidateAndRedirect(
      roster,
      diver
        ? // `?edit=1` opens the diver record's details form on arrival. This
          // form asks for three fields; date of birth, dive insurance, and the
          // emergency contact the manifest prints are all one collapsed
          // disclosure away, and the front desk had to know to go looking for
          // it while the diver is still standing there.
          `${shopPath(staff.user.shopSlug, "divers", diver.id)}?edit=1`
        : noticeUrl(roster, "duplicate"),
    );
  }

  async function restoreDiverAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const db = await getDb();
    // Restoring is the inverse of the owner/manager-only deletion, so it takes
    // the same gate (H-14, ADR 20260724-role-authorization).
    const roster = shopPath(staff.user.shopSlug, "divers");
    if (!(await canPersonDeleteDiver(db, staff.user.shopId, staff.user.personId))) {
      revalidateAndRedirect(roster, noticeUrl(roster, "not-authorized"));
    }
    const personId = String(formData.get("personId") ?? "");
    const restored = personId && (await restoreDiver(db, staff.user.shopId, personId));
    revalidateAndRedirect(roster, noticeUrl(roster, restored ? "restored" : "restore-refused"));
  }

  /**
   * The shop's one level vocabulary, resolved once and handed to the roster as
   * plain strings: it names a diver's level with the same words the diver
   * record and a trip's requirements do. Every word still comes from the one
   * `CERTIFICATION_LEVEL_KEYS` map (src/i18n/readiness-labels.ts) — never a
   * second mapping here — and the `Record<CertificationLevel, string>` type
   * makes a new rung of the ladder a compile error rather than a blank cell.
   */
  const certificationLevels: Record<CertificationLevel, string> = {
    open_water: t(CERTIFICATION_LEVEL_KEYS.open_water),
    advanced_open_water: t(CERTIFICATION_LEVEL_KEYS.advanced_open_water),
    rescue: t(CERTIFICATION_LEVEL_KEYS.rescue),
    divemaster: t(CERTIFICATION_LEVEL_KEYS.divemaster),
    instructor: t(CERTIFICATION_LEVEL_KEYS.instructor),
  };

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
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
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

      {/* The id is the door the roster's empty state opens: with nobody on
          file, "add one here" used to be prose pointing at a collapsed
          disclosure two sections up, which is not a way forward. `scroll-mt`
          keeps the summary clear of the sticky header once it is scrolled to.

          At rest this is a button-shaped summary, nothing more. It used to be
          a full-width bordered card — the largest object on the screen — for
          the roster's *rare* path: the front desk arrives here to find a
          person, not to mint one (design principle 8, "collapse the rare
          path"). The card chrome now belongs to the open state only, where a
          form actually stands in it. */}
      <details id="add-diver" className="group/add mt-8 scroll-mt-24">
        <summary
          className={buttonClass({
            variant: "secondary",
            className: "list-none [&::-webkit-details-marker]:hidden",
          })}
        >
          {t("divers.page.addDiverSummary")}{" "}
          <span
            aria-hidden="true"
            className="text-lg font-normal transition-transform duration-200 group-open/add:rotate-45"
          >
            +
          </span>
        </summary>
        <div className="mt-3 rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <p className="text-sm text-muted">{t("divers.page.addDiverBody")}</p>
          {/* The same name/email/phone trio every seat-a-diver door wears
            (src/components/seat-diver/). This one mints a person without a
            departure, so nothing here is required but the name — and its own
            validator takes a longer address and phone than a seating does, so
            it passes those caps rather than inheriting the tighter ones. */}
          <PersonFieldTrio
            className="mt-4"
            as="form"
            action={addDiverAction}
            email="optional"
            nameLabel={t("divers.page.fullNameLabel")}
            emailLabel={t("divers.page.emailLabel")}
            phoneLabel={t("divers.page.phoneLabel")}
            optionalHint={t("divers.page.optionalHint")}
            emailMaxLength={320}
            phoneMaxLength={40}
          >
            <FieldActions>
              <SubmitButton
                pendingLabel={t("divers.page.adding")}
                className={buttonClass({ size: "lg" })}
              >
                {t("divers.page.addDiver")}
              </SubmitButton>
            </FieldActions>
          </PersonFieldTrio>
        </div>
      </details>

      <DiverList
        page={diverPage}
        shopSlug={shopSlug}
        query={query}
        filter={filter}
        importHref={canImport ? `/shop/${shopSlug}/settings/import` : null}
        restoreAction={canDelete ? restoreDiverAction : null}
        pager={
          <Pager
            page={diverPage.page}
            pageCount={diverPage.pageCount}
            href={pageHref}
            total={t("divers.list.pagination.total", { count: diverPage.total })}
            t={t}
            className="mt-4"
          />
        }
        copy={{
          viewAllDivers: t("divers.list.viewAllDivers"),
          viewDivingToday: t("divers.list.viewDivingToday"),
          viewNeedsAttention: t("divers.list.viewNeedsAttention"),
          viewMissingContact: t("divers.list.viewMissingContact"),
          viewRemoved: t("divers.list.viewRemoved"),
          viewsAriaLabel: t("divers.list.viewsAriaLabel"),
          removedNote: t("divers.list.removedNote"),
          restore: t("divers.list.restore"),
          restoring: t("divers.list.restoring"),
          restoreDiverLabel: t.raw("divers.list.restoreDiverLabel"),
          peopleHeading: t("divers.list.peopleHeading"),
          // The badge's digit is announced with the noun the count belongs to,
          // and with whether it is a match count or the whole roster.
          peopleCountLabel: query
            ? t("divers.page.matchingCount", { count: diverPage.total })
            : t("divers.page.onFileCount", { count: diverPage.total }),
          searchHintText: t("divers.list.searchHintText"),
          searchDiversLabel: t("divers.list.searchDiversLabel"),
          searchPlaceholder: t("divers.list.searchPlaceholder"),
          noDiversMatchView: t("divers.list.noDiversMatchView"),
          noDiversOnFile: t("divers.list.noDiversOnFile"),
          tryDifferentSearch: t("divers.list.tryDifferentSearch"),
          addOneHere: t("divers.list.addOneHere"),
          emptyAddAction: t("divers.list.emptyAddAction"),
          emptyShowAll: t("divers.list.emptyShowAll"),
          emptyImportBody: t("divers.list.emptyImportBody"),
          emptyImportAction: t("divers.list.emptyImportAction"),
          noContactDetails: t("divers.list.noContactDetails"),
          certificationLevels,
          noCertificationLevel: t("divers.list.noCertificationLevel"),
          pendingReviewText: t.raw("divers.list.pendingReviewText"),
          toConfirmText: t.raw("divers.list.toConfirmText"),
          tableHeaderPerson: t("divers.list.tableHeaderPerson"),
          tableHeaderLevel: t("divers.list.tableHeaderLevel"),
        }}
      />
    </main>
  );
}
