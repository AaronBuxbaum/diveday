import { notFound, redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { AssistReadButton } from "@/components/assists/AssistReadButton";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { assistsAvailable } from "@/db/assists";
import { canPersonMergeDiver } from "@/db/authz";
import { readUnsurePair } from "@/db/desk-assists";
import { getDiverMergePreview } from "@/db/diver-merge";
import { getTripWithBooked } from "@/db/trips";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { resolveDiverNotice } from "@/lib/diver-notices";
import { formatDateTimeTz } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { noticeForForm, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { readSamePersonAction } from "./assist-action";
import { MergePreview } from "./MergePreview";

export const instant = true;

/**
 * **Merge one diver record into another** (issue #1240): the side-by-side a
 * staffer reads, and the choices they make, before two records become one.
 * `personId` is the record merged away and `survivorId` the record kept; the
 * preview's own "Keep … instead" swaps the two segments.
 *
 * Owner or manager only, like the merge itself (H-14): anyone else is sent to
 * the record with the same refusal the action gives. A pair that is not two
 * records of this shop is a 404, the same answer a stranger's id gets
 * anywhere, so the page never says whether another shop has that diver. A
 * record already merged away follows its pointer to the record it lives on.
 */
export default async function MergeDiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; personId: string; survivorId: string }>;
  searchParams: Promise<{ notice?: string; form?: string; trip?: string }>;
}) {
  const { shopSlug, personId, survivorId } = await params;
  if (!uuidParam(personId) || !uuidParam(survivorId)) notFound();
  const { notice, form, trip } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonMergeDiver,
    refusal: { notice: "not-authorized-merge", landing: ["divers", personId] },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const preview = await getDiverMergePreview(db, shop.id, personId, survivorId);
  if (!preview) notFound();
  if (preview.refusal === "already_merged") {
    // A stale bookmark or a second tab: go to the record that holds it now.
    redirect(shopPath(shop.slug, "divers", personId));
  }

  // A refusal the preview already states in place is not said twice: the
  // notice only speaks when the page itself shows nothing wrong (a race, or
  // the different-people box left unticked).
  //
  // A refused merge names the departure it collided on (issue #2333). The URL
  // carries only its id; the words come from this shop's own trip row, so a
  // crafted link can name nothing the shop does not hold.
  const conflictTripId = notice === "merge-booking-conflict" ? uuidParam(trip ?? "") : null;
  const conflictTrip =
    !preview.refusal && conflictTripId
      ? await getTripWithBooked(db, shop.id, conflictTripId)
      : null;
  const status = preview.refusal
    ? undefined
    : noticeForForm(
        resolveDiverNotice({
          notice,
          form,
          personId,
          personName: preview.source.fullName,
          locale,
          conflictDeparture: conflictTrip
            ? `${conflictTrip.title} · ${formatDateTimeTz(conflictTrip.startsAt, locale, shop.timezone)}`
            : undefined,
        }),
        "merge",
      );

  // Only for a pair the duplicate check matched on the name alone, and never
  // once a refusal already says the merge cannot happen.
  const canAssist =
    !preview.refusal &&
    (await assistsAvailable(db, shop.id)) &&
    (await readUnsurePair(db, shop.id, personId, survivorId)) !== null;

  return (
    <StaffPage width="reading">
      <ShopPageHeader
        eyebrow={preview.source.fullName}
        eyebrowHref={shopPath(shop.slug, "divers", personId)}
        title={t("divers.mergePreview.title")}
      />
      {canAssist ? (
        <div className="mt-6">
          <AssistReadButton
            read={readSamePersonAction.bind(null, shop.slug, personId, survivorId)}
            label={t("deskAssists.dupes.ask")}
            pendingLabel={t("deskAssists.dupes.pending")}
          />
        </div>
      ) : null}
      <div className="mt-8">
        <MergePreview
          preview={preview}
          shopSlug={shop.slug}
          locale={locale}
          timeZone={shop.timezone}
          t={t}
          status={status}
        />
      </div>
    </StaffPage>
  );
}
