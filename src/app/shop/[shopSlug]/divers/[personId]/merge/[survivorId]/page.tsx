import { notFound, redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { canPersonMergeDiver } from "@/db/authz";
import { getDiverMergePreview } from "@/db/diver-merge";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { noticeForForm, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { resolveDiverNotice } from "../../_components/record-notices";
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
  searchParams: Promise<{ notice?: string; form?: string }>;
}) {
  const { shopSlug, personId, survivorId } = await params;
  if (!uuidParam(personId) || !uuidParam(survivorId)) notFound();
  const { notice, form } = await searchParams;
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
  const status = preview.refusal
    ? undefined
    : noticeForForm(resolveDiverNotice({ notice, form, personId, locale }), "merge");

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={preview.source.fullName}
        eyebrowHref={shopPath(shop.slug, "divers", personId)}
        title={t("divers.mergePreview.title")}
      />
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
    </main>
  );
}
