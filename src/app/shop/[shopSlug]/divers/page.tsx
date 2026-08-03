import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonDeleteDiver } from "@/db/authz";
import { getDb } from "@/db/client";
import { createDiver, isDiverFilter, listDiverSummaries, restoreDiver } from "@/db/divers";
import { canPersonImportShopData } from "@/db/import";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { DiverList } from "./_components/DiverList";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

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
    after?: string;
    filter?: string;
  }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice, deleted, q, after, filter: filterParam } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) return null;
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const query = q?.trim() ?? "";
  const filter = isDiverFilter(filterParam) ? filterParam : "all";
  const diverPage = await listDiverSummaries(db, shop.id, { query, cursor: after, filter });
  // The roster's empty state offers a bulk import beside the one-diver form,
  // for the shop arriving with a spreadsheet. Same gate the import page itself
  // enforces (`canPersonImportShopData`), so the door is only shown to whoever
  // may walk through it (ADR 20260724-role-gated-surfaces-hide-not-explain).
  const canImport = await canPersonImportShopData(db, shop.id, session.user.personId);

  async function addDiverAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const parsed = diverSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/divers?notice=invalid`);
    const diver = await createDiver(await getDb(), {
      shopId: staff.user.shopId,
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      phone: parsed.data.phone,
    });
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/divers`,
      diver
        ? `/shop/${staff.user.shopSlug}/divers/${diver.id}`
        : `/shop/${staff.user.shopSlug}/divers?notice=duplicate`,
    );
  }

  async function restoreDiverAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const db = await getDb();
    // Restoring is the inverse of the owner/manager-only deletion, so it takes
    // the same gate (H-14, ADR 20260724-role-authorization).
    if (!(await canPersonDeleteDiver(db, staff.user.shopId, staff.user.personId))) {
      revalidateAndRedirect(
        `/shop/${staff.user.shopSlug}/divers`,
        `/shop/${staff.user.shopSlug}/divers?notice=not-authorized`,
      );
    }
    const personId = String(formData.get("personId") ?? "");
    const restored = personId && (await restoreDiver(db, staff.user.shopId, personId));
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/divers`,
      `/shop/${staff.user.shopSlug}/divers?notice=${restored ? "restored" : "invalid"}`,
    );
  }

  const banner = noticeFromParam(notice, NOTICES);
  const noticeText = banner ? t(banner.key) : null;
  const noticeIsError = banner?.tone === "danger";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("divers.page.eyebrow")}
        title={t("divers.page.title")}
        description={t("divers.page.description")}
        meta={
          <span className="inline-flex items-center">
            <span aria-hidden="true">
              <Badge tone="primary" tabularNums>
                {diverPage.total}
              </Badge>
            </span>
            <span className="sr-only">
              {query
                ? t("divers.page.matchingCount", { count: diverPage.total })
                : t("divers.page.onFileCount", { count: diverPage.total })}
            </span>
          </span>
        }
      />

      {noticeText ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <ShopNotice tone={noticeIsError ? "danger" : "success"}>
            <p role="status">{noticeText}</p>
          </ShopNotice>
          {notice === "deleted" && deleted ? (
            <form action={restoreDiverAction}>
              <input type="hidden" name="personId" value={deleted} />
              <SubmitButton
                pendingLabel={t("divers.page.restoring")}
                className={buttonClass({
                  variant: "secondary",
                  size: "sm",
                  className: "border-success/30 text-success",
                })}
              >
                {t("divers.page.undoRemove")}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}

      {/* The id is the door the roster's empty state opens: with nobody on
          file, "add one here" used to be prose pointing at a collapsed
          disclosure two sections up, which is not a way forward. `scroll-mt`
          keeps the summary clear of the sticky header once it is scrolled to. */}
      <details
        id="add-diver"
        className="mt-8 scroll-mt-24 rounded-2xl border border-border bg-surface p-5 shadow-sm"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold [&::-webkit-details-marker]:hidden">
          {t("divers.page.addDiverSummary")}{" "}
          <span aria-hidden="true" className="text-xl font-normal text-primary">
            +
          </span>
        </summary>
        <p className="mt-2 text-sm text-muted">{t("divers.page.addDiverBody")}</p>
        <FieldGrid columns={3} className="mt-4" as="form" action={addDiverAction}>
          <Field label={t("divers.page.fullNameLabel")}>
            <input name="fullName" required autoComplete="name" className={controlClass} />
          </Field>
          <Field label={t("divers.page.emailLabel")} hint={t("divers.page.optionalHint")}>
            <input name="email" type="email" autoComplete="email" className={controlClass} />
          </Field>
          <Field label={t("divers.page.phoneLabel")} hint={t("divers.page.optionalHint")}>
            <input name="phone" type="tel" autoComplete="tel" className={controlClass} />
          </Field>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("divers.page.adding")}
              className={buttonClass({ size: "lg" })}
            >
              {t("divers.page.addDiver")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </details>

      <DiverList
        page={diverPage}
        shopSlug={shopSlug}
        query={query}
        filter={filter}
        cursorActive={Boolean(after)}
        locale={locale}
        importHref={canImport ? `/shop/${shopSlug}/settings/import` : null}
        copy={{
          viewAllDivers: t("divers.list.viewAllDivers"),
          viewMissingContact: t("divers.list.viewMissingContact"),
          viewInsured: t("divers.list.viewInsured"),
          savedViewsAriaLabel: t("divers.list.savedViewsAriaLabel"),
          namePromptText: t("divers.list.namePromptText"),
          removeSavedViewAriaLabel: t("divers.list.removeSavedViewAriaLabel"),
          saveThisView: t("divers.list.saveThisView"),
          peopleHeading: t("divers.list.peopleHeading"),
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
          cardCountOne: t("divers.list.cardCountOne"),
          cardCountOther: t("divers.list.cardCountOther"),
          pendingReviewText: t("divers.list.pendingReviewText"),
          toConfirmText: t("divers.list.toConfirmText"),
          noneText: t("divers.list.noneText"),
          tableHeaderPerson: t("divers.list.tableHeaderPerson"),
          tableHeaderCards: t("divers.list.tableHeaderCards"),
          tableHeaderAttention: t("divers.list.tableHeaderAttention"),
          showMoreDivers: t("divers.list.showMoreDivers"),
          backToTop: t("divers.list.backToTop"),
        }}
      />
    </main>
  );
}
