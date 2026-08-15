import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Badge } from "@/components/ui/badge";
import { canPersonManageWaiverTemplates } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getSignedWaiverRecordForShop, listWaiverIntegrityAudit } from "@/db/waivers";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { uuidParam } from "@/lib/uuid";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Signatures — DiveDay",
};

type SignedWaiverEntry = Awaited<ReturnType<typeof getSignedWaiverRecordForShop>>;
type Shop = NonNullable<Awaited<ReturnType<typeof getShopById>>>;

/**
 * One row of signed-record evidence, shared by the "jumped to from the
 * roster" highlight and the paginated list below it, so the two never drift
 * apart in what they show.
 */
function SignedRecordRow({
  entry,
  shopSlug,
  shop,
  locale,
  t,
}: {
  entry: NonNullable<SignedWaiverEntry>;
  shopSlug: string;
  shop: Shop;
  locale: string;
  t: StaffTranslator;
}) {
  return (
    <li
      id={`waiver-record-${entry.id}`}
      className="scroll-mt-24 flex flex-col gap-3 px-4 py-4 text-sm sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        <p className="font-medium">
          <Link href={`/shop/${shopSlug}/divers/${entry.personId}`} className="hover:underline">
            {entry.personName}
          </Link>
        </p>
        <p className="mt-0.5 text-muted">
          {entry.tripId && entry.tripTitle ? (
            <Link href={`/shop/${shopSlug}/trips/${entry.tripId}`} className="hover:underline">
              {entry.tripTitle}
              {entry.tripStartsAt
                ? ` · ${formatShortDate(entry.tripStartsAt, locale, shop.timezone)}`
                : ""}
            </Link>
          ) : (
            t("waiversStaff.signatures.noTrip")
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {entry.signedAt
            ? formatShortDate(entry.signedAt, locale, shop.timezone)
            : t("waiversStaff.signatures.noSignatureDate")}
        </p>
      </div>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <span
          className={
            entry.integrity === "valid"
              ? "font-medium text-success"
              : entry.integrity === "invalid"
                ? "font-medium text-danger"
                : "font-medium text-warning"
          }
        >
          {entry.integrity === "valid"
            ? t("waiversStaff.signatures.integrityValid")
            : entry.integrity === "invalid"
              ? t("waiversStaff.signatures.integrityInvalid")
              : t("waiversStaff.signatures.integrityUnsealed")}
        </span>
        {/* The medical flag is a summary badge only — the flagged prompts
            themselves (never the full questionnaire) sit behind this
            disclosure, the same gating the trip roster already applies
            (RosterSection.tsx). */}
        {entry.flaggedPrompts.length > 0 ? (
          <details>
            <summary className="flex cursor-pointer list-none items-center gap-2">
              <Badge tone="warning" size="sm">
                {t("waiversStaff.signatures.medicalFlag")}
              </Badge>
              <span className="text-xs font-medium text-warning underline">
                {t("waiversStaff.signatures.viewFlaggedAnswers")}
              </span>
            </summary>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-left text-sm text-warning">
              {entry.flaggedPrompts.map((prompt) => (
                <li key={prompt}>{prompt}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The waiver's evidence trail: every signed release on file for this shop —
 * who signed, which trip, and any medical follow-up — closing the loop
 * between the template editor, Today's blocker chasing, and the record
 * itself (task 155, UX persona assessment Lens 17). Linked from a signed
 * record's "View signed record" control on the trip roster
 * (`RosterSection.tsx`), which is where a `medical_review` blocker in Today
 * already sends staff.
 *
 * The roster's link carries the record's id as `?record=`, resolved through
 * `getSignedWaiverRecordForShop` and pinned above the paginated list — a shop
 * with a lot of signed history easily has that record fall past
 * `listWaiverIntegrityAudit`'s current page, so a URL anchor into the list
 * alone would silently land on nothing.
 *
 * Security-sensitive: this is staff read access to signed medical-adjacent
 * records. The gate below is the exact same `canPersonManageWaiverTemplates`
 * check the template editor uses (`../page.tsx`) — never a looser one — and
 * every query is scoped to `session.user.shopId`, never the `shopSlug` route
 * param, so visiting another shop's slug while signed in here cannot surface
 * another shop's records (`shop` itself is looked up *by* `session.user.shopId`),
 * and a `record` id copied from another shop resolves to nothing
 * (`getSignedWaiverRecordForShop` also filters on `shopId`).
 */
export default async function WaiverSignaturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string; record?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { page, record: recordParam } = await searchParams;
  // `waiver_records.id` is a `uuid` column, so a truncated or hand-edited
  // `?record=` does not resolve to nothing — it throws `invalid input syntax
  // for type uuid` and 500s this page. A malformed id is simply no highlight:
  // the log itself still renders, which is the page the staffer came for.
  const record = uuidParam(recordParam);
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const locale = await requestLocale(shop?.defaultLocale);
  if (!shop) return null;
  const t = staffTranslator(locale);
  const canManage = await canPersonManageWaiverTemplates(
    db,
    session.user.shopId,
    session.user.personId,
  );
  if (!canManage) redirect(`/shop/${shopSlug}?notice=waivers_not_authorized`);

  const highlighted = record ? await getSignedWaiverRecordForShop(db, shop.id, record) : null;
  // A non-numeric or missing `?page=` reads as page 1; the query clamps it into
  // range so a bookmarked page past the end lands on the last real one.
  const auditPage = await listWaiverIntegrityAudit(db, shop.id, {
    page: Number.parseInt(page ?? "", 10),
  });
  // The pinned record is rendered above; the list must not render it again.
  // `SignedRecordRow` puts `id="waiver-record-<id>"` on its `<li>`, so a
  // highlighted record that also falls on the visible page produced **two
  // elements with the same DOM id** — invalid HTML, two hit targets for one
  // anchor, and the same evidence row shown twice on one screen.
  //
  // It only surfaced as a test failure because it depends on where the record
  // lands: the list orders by `signedAt desc, id desc`, and `id` is a random
  // UUID, so a record sitting on a page boundary among rows that share a
  // timestamp crosses it or not depending on the UUIDs a given seed drew. The
  // demo's medical-review fixture sits on exactly that boundary.
  //
  // Only the rendered rows are filtered. `auditPage`'s total and page count
  // describe the whole log and stay untouched — the record has not gone
  // anywhere, it is one section further up.
  const entries = auditPage.entries.filter((entry) => entry.id !== highlighted?.id);
  const base = `/shop/${shopSlug}/waivers/signatures`;
  // The `?record=` highlight is a separate pin above this list, so it travels
  // with the page rather than being dropped the moment a reviewer turns one.
  // The anchor keeps a page turn landing on the list, not back at the header.
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (target > 1) query.set("page", String(target));
    if (record) query.set("record", record);
    const search = query.toString();
    return `${search ? `${base}?${search}` : base}#signed-records-heading`;
  };

  return (
    <>
      <ShopPageHeader
        eyebrow={t("waiversStaff.signatures.eyebrow")}
        title={t("waiversStaff.signatures.title")}
        description={t("waiversStaff.signatures.description")}
      />

      {highlighted ? (
        <section className="mt-8" aria-labelledby="signed-record-heading">
          <h2 id="signed-record-heading" className="text-lg font-semibold">
            {t("waiversStaff.signatures.signedRecordHeading")}
          </h2>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-primary/40 bg-surface">
            <SignedRecordRow
              entry={highlighted}
              shopSlug={shopSlug}
              shop={shop}
              locale={locale}
              t={t}
            />
          </ul>
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="signed-records-heading">
        <h2 id="signed-records-heading" className="text-lg font-semibold">
          {t("waiversStaff.signatures.heading")}
        </h2>
        {auditPage.total === 0 ? (
          <EmptyState className="mt-4">
            <p className="text-sm text-muted">{t("waiversStaff.signatures.noSignedRecords")}</p>
          </EmptyState>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
              {entries.map((entry) => (
                <SignedRecordRow
                  key={entry.id}
                  entry={entry}
                  shopSlug={shopSlug}
                  shop={shop}
                  locale={locale}
                  t={t}
                />
              ))}
            </ul>
            <Pager
              page={auditPage.page}
              pageCount={auditPage.pageCount}
              href={pageHref}
              total={t("waiversStaff.signatures.pagination.total", { count: auditPage.total })}
              t={t}
              className="mt-4"
            />
          </>
        )}
      </section>
    </>
  );
}
