import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { canPersonManageWaiverTemplates } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getCurrentWaiverTemplate } from "@/db/waivers";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import type { NoticeTone } from "@/lib/staff-notices";
import { DEFAULT_WAIVER_BODY } from "@/lib/waivers";
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

export default async function WaiverTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  // Staff read dates in the language their own device asks for, same
  // negotiation as the public pages (docs ADR 20260729-diver-copy-localization).
  const locale = await requestLocale(shop?.defaultLocale);
  if (!shop) return null;
  const t = staffTranslator(locale);
  // The waiver is the shop's legal instrument; editing it (and the medical
  // jurisdiction it presents) is owner/manager work (H-14, ADR
  // 20260724-role-authorization). Other roles have no use for it, so the
  // surface doesn't exist for them rather than showing a read-only copy.
  // The Signatures tab (`./signatures/page.tsx`) runs the exact same gate —
  // never a looser one, since it's read access to signed medical records.
  const canManage = await canPersonManageWaiverTemplates(
    db,
    session.user.shopId,
    session.user.personId,
  );
  // Bounced to Today, same as every other H-14 refusal — but with an
  // explanatory notice rather than teleporting silently (task 82, UX persona
  // 11 "Kai"): Today already renders `shopHome.notice.*` codes.
  if (!canManage) redirect(`/shop/${shopSlug}?notice=waivers_not_authorized`);
  const current = await getCurrentWaiverTemplate(db, shop.id);

  const banner =
    notice === "saved"
      ? current
        ? t("waiversStaff.banner.savedNew")
        : t("waiversStaff.banner.savedFirst")
      : notice === "invalid"
        ? t("waiversStaff.banner.invalid")
        : undefined;
  const bannerTone: NoticeTone = notice === "invalid" ? "danger" : "success";

  const editForm = (
    <form action={saveWaiverAction} className="flex flex-col gap-5">
      <FieldGrid columns={1} className="gap-y-5">
        <Field label={t("waiversStaff.fieldLabel")}>
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
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          pendingLabel={t("waiversStaff.pendingLabel")}
          className={buttonClass({ size: "lg" })}
        >
          {current ? t("waiversStaff.saveNewVersion") : t("waiversStaff.saveWaiver")}
        </SubmitButton>
        {/* Beside the button, not under the `<h1>`: the release text is a
            fourteen-row textarea, so the top of this page is a screen and a
            half away from the control that was pressed. */}
        <FormStatus tone={bannerTone}>{banner}</FormStatus>
      </div>
    </form>
  );

  return (
    <>
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("waiversStaff.eyebrow")}
        title={t("waiversStaff.title")}
        description={t("waiversStaff.description")}
      />

      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t("waiversStaff.releaseTextHeading")}</h2>
        <p className="mt-1 text-sm text-muted">
          {current
            ? t("waiversStaff.releaseDescription.current")
            : t("waiversStaff.releaseDescription.sample")}
        </p>
        {current ? (
          <p className="mt-2 text-sm text-muted">
            {t("waiversStaff.versionInfo", {
              version: current.version,
              date: formatShortDate(current.createdAt, locale, shop.timezone),
            })}
          </p>
        ) : null}
        <div className="mt-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
          {editForm}
        </div>
      </section>
    </>
  );
}
