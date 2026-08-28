import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/ledger";
import { canPersonManageWaiverTemplates } from "@/db/authz";
import {
  getCurrentWaiverTemplate,
  getSignedWaiverRecordForShop,
  listWaiverIntegrityAudit,
  standingWaiverExposure,
} from "@/db/waivers";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { OPERATIONAL_HORIZON_DAYS } from "@/lib/operational-window";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import type { NoticeTone } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { DEFAULT_WAIVER_BODY } from "@/lib/waivers";
import { PublishRelease, type PublishReleaseCopy } from "./_components/PublishRelease";
import { SignatureLog } from "./_components/SignatureLog";
import { saveWaiverAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Waivers — DiveDay",
};

/**
 * **The waiver surface, as one page** (ADR 20260827-people-not-lists,
 * decision 4; the language is ADR 20260827-clearwater-surface-language).
 *
 * The release a shop publishes and the signatures standing against it are one
 * subject read in one sitting — "what does it say, and who has agreed to it" —
 * and a tab strip made them two destinations that could disagree. The strip,
 * the shell layout that held it, and `waivers/signatures/page.tsx` are gone
 * (H-49); the old URL is a 308 Route Handler that keeps `?record=` and
 * `?page=`.
 *
 * Two decisions live in the parts below, each with its own doc comment and its
 * own rule test:
 *
 * - **`PublishRelease`** — materiality is a recorded choice, and then one
 *   Publish. H-54's semantics are untouched: `saveWaiverAction` still writes
 *   the same decision from the same `material` field, `standingWaiverExposure`
 *   is still counted before the save, and a material publish still puts every
 *   standing signature back in the queue. Only the shape of the asking moved.
 * - **`SignatureLog`** — the evidence trail as a day-grouped ledger, with
 *   integrity as a badge only when it is not valid.
 *
 * Security-sensitive: this is staff read access to signed, medical-adjacent
 * records. The gate is `canPersonManageWaiverTemplates` — the same one the
 * editor has always run, never a looser one now that the log shares the page —
 * and every query is scoped to the shop `requireShopSurface` resolved from the
 * *session*, never the `shopSlug` route param (which that helper additionally
 * refuses outright when it disagrees with the session). A `record` id copied
 * from another shop resolves to nothing: `getSignedWaiverRecordForShop`
 * filters on `shopId` too.
 */
export default async function WaiversPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; count?: string; page?: string; record?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice, count, page, record: recordParam } = await searchParams;
  // `waiver_records.id` is a `uuid` column, so a truncated or hand-edited
  // `?record=` does not resolve to nothing — it throws `invalid input syntax
  // for type uuid` and 500s this page. A malformed id is simply no pin: the
  // log itself still renders, which is the page the staffer came for.
  const record = uuidParam(recordParam);
  // The waiver is the shop's legal instrument; editing it (and the medical
  // jurisdiction it presents) is owner/manager work (H-14, ADR
  // 20260724-role-authorization). Other roles have no use for it, so the
  // surface doesn't exist for them rather than showing a read-only copy — and
  // that now covers the signature log, which ran this identical gate one route
  // over.
  //
  // Refused staff are bounced to Today with an explanatory notice rather than
  // teleported silently (task 82, UX persona 11 "Kai"): Today already renders
  // `shopHome.notice.*` codes.
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageWaiverTemplates,
    refusal: { notice: "waivers-not-authorized" },
  });
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const [current, atRisk, highlighted, auditPage] = await Promise.all([
    getCurrentWaiverTemplate(db, shop.id),
    // What publishing a new version would cost, in signatures. Read on every
    // render so the choice below can state it *before* the tap — the count in
    // the notice afterwards is the same number, and arrives too late to change
    // a mind (issue #720).
    standingWaiverExposure(db, shop.id),
    record ? getSignedWaiverRecordForShop(db, shop.id, record) : null,
    // A non-numeric or missing `?page=` reads as page 1; the query clamps it
    // into range so a bookmarked page past the end lands on the last real one.
    listWaiverIntegrityAudit(db, shop.id, { page: Number.parseInt(page ?? "", 10) }),
  ]);

  const resigning = notice === "waiver-resigning" ? Number(count) : Number.NaN;
  // Two refusals, two sentences. `invalid` says the release is too short;
  // `waiver-materiality-required` says the edit was never called a correction
  // or a material change, which is not about the text at all. They shared one
  // code — and so one sentence — until 2026-08-28, and the staffer who met it
  // was an owner publishing a typo fix from a tab that had rendered no radios,
  // told to lengthen a release they had not shortened. See `./actions.ts`.
  const banner =
    notice === "saved"
      ? current
        ? t("waiversStaff.banner.savedNew")
        : t("waiversStaff.banner.savedFirst")
      : notice === "invalid"
        ? t("waiversStaff.banner.invalid")
        : notice === "waiver-materiality-required"
          ? t("waiversStaff.banner.materialityRequired")
          : notice === "waiver-unchanged"
            ? t("waiversStaff.banner.unchanged")
            : Number.isFinite(resigning) && resigning > 0
              ? t("waiversStaff.banner.resigning", { count: resigning })
              : undefined;
  // Warning, not success, for the same reason `requirements-blocking` is: the
  // save worked and there is nothing to undo, but the shop now owes those
  // divers a link. "Unchanged" is neutral — nothing happened, which is the
  // whole message.
  const bannerTone: NoticeTone =
    notice === "invalid" || notice === "waiver-materiality-required"
      ? "danger"
      : notice === "waiver-resigning"
        ? "warning"
        : notice === "waiver-unchanged"
          ? "neutral"
          : "success";

  // The material option states its own cost, so the sentences are composed
  // here — where the counts and the locale are — and handed over as words: a
  // staff Client Component never translates for itself.
  const publishCopy: PublishReleaseCopy = {
    choiceLegend: t("waiversStaff.publish.choiceLegend"),
    correction: t("waiversStaff.publish.correction"),
    correctionDetail: t("waiversStaff.publish.correctionDetail"),
    material: t("waiversStaff.publish.material"),
    materialDetail: [
      t("waiversStaff.publish.materialDetail", { count: atRisk.divers }),
      // The operational half. The lifetime number says what publishing costs;
      // this one says which boat it lands on, and it is the one that changes
      // what the shop does next (issue #790).
      atRisk.boardingSoon > 0
        ? t("waiversStaff.publish.materialBoarding", {
            count: atRisk.boardingSoon,
            days: OPERATIONAL_HORIZON_DAYS,
          })
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    action: t("waiversStaff.publish.action"),
    confirm: t("waiversStaff.publish.confirm", { count: atRisk.divers }),
    pending: t("waiversStaff.pendingLabel"),
  };

  // The pin renders inside its own day group below, so the page's own rows
  // must not render it a second time. `SignatureRow` puts
  // `id="waiver-record-<id>"` on its `<li>`, and a pinned record that also
  // falls on the visible page produced **two elements with the same DOM id** —
  // invalid HTML, two hit targets for one anchor, and the same evidence row
  // shown twice on one screen.
  //
  // It only ever surfaced as a test failure because it depends on where the
  // record lands: the list orders by `signedAt desc, id desc`, and `id` is a
  // random UUID, so a record sitting on a page boundary among rows that share
  // a timestamp crosses it or not depending on the UUIDs a given seed drew.
  //
  // Only the rendered rows are filtered. `auditPage`'s total and page count
  // describe the whole log and stay untouched — the record has not gone
  // anywhere, it is one day group further up.
  const entries = auditPage.entries.filter((entry) => entry.id !== highlighted?.id);
  const base = `/shop/${shopSlug}/waivers`;
  // The `?record=` pin travels with the page rather than being dropped the
  // moment a reviewer turns one, and the anchor keeps a page turn landing on
  // the log instead of back at the release editor above it.
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (target > 1) query.set("page", String(target));
    if (record) query.set("record", record);
    const search = query.toString();
    return `${search ? `${base}?${search}` : base}#signed-records-heading`;
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice", "count"]} />
      <ShopPageHeader
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.waivers)}
        title={t("waiversStaff.title")}
        // The version line is a fact about the release the page is named
        // after, so it rides under the title where a reader meets it before
        // the text — rather than as a second heading inside the card, which is
        // where it sat while that card had a heading of its own repeating the
        // field's.
        meta={
          current ? (
            <p className="text-sm text-muted">
              {t("waiversStaff.versionInfo", {
                version: current.version,
                date: formatShortDate(current.createdAt, locale, shop.timezone),
              })}
            </p>
          ) : undefined
        }
      />

      <SectionCard padding="lg">
        <form action={saveWaiverAction} className="flex flex-col gap-5">
          <FieldGrid columns={1} className="gap-y-5">
            <Field
              label={t("waiversStaff.fieldLabel")}
              // Only for a shop that has never published one: a starting text
              // nobody's counsel has read is the one thing about this box a
              // reader could get wrong.
              description={current ? undefined : t("waiversStaff.releaseDescription.sample")}
            >
              <textarea
                name="body"
                required
                rows={14}
                maxLength={12_000}
                defaultValue={current?.body ?? DEFAULT_WAIVER_BODY}
                placeholder={t("waiversStaff.placeholder")}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
          <PublishRelease copy={publishCopy} standingSignatures={atRisk.divers > 0} />
          {/* Beside the form, never a banner at the top of the page: the
              release is a fourteen-row textarea, so the top of this page is a
              screen and a half away from the control that was pressed. */}
          <FormStatus tone={bannerTone}>
            {banner}
            {/* The shop now owes those divers a link, and every one of them is
                a waiver row on their boat's station on the home. A door,
                rather than leaving them to hunt for it (issue #790). */}
            {notice === "waiver-resigning" && Number.isFinite(resigning) && resigning > 0 ? (
              <>
                {" "}
                <Link
                  href={`/shop/${shopSlug}`}
                  className="font-medium text-primary hover:underline"
                >
                  {t("waiversStaff.banner.resigningSendLink")}
                </Link>
              </>
            ) : null}
          </FormStatus>
        </form>
      </SectionCard>

      <section className="mt-10" aria-labelledby="signed-records-heading">
        <GroupLabel as="h2" id="signed-records-heading" className="scroll-mt-24">
          {t("waiversStaff.signatures.heading")}
        </GroupLabel>
        {auditPage.total === 0 ? (
          <EmptyState title={t("waiversStaff.signatures.noSignedRecords")} className="mt-4" />
        ) : (
          <>
            <div className="mt-4">
              <SignatureLog
                entries={entries}
                pinned={highlighted}
                shopSlug={shopSlug}
                locale={locale}
                timezone={shop.timezone}
                t={t}
              />
            </div>
            <Pager
              page={auditPage.page}
              pageCount={auditPage.pageCount}
              href={pageHref}
              total={t("waiversStaff.signatures.pagination.total", { count: auditPage.total })}
              t={t}
              className="mt-6"
            />
          </>
        )}
      </section>
    </main>
  );
}
