import type { Metadata } from "next";
import Link from "next/link";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { canPersonManageWaiverTemplates } from "@/db/authz";
import { getCurrentWaiverTemplate, standingWaiverExposure } from "@/db/waivers";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { OPERATIONAL_HORIZON_DAYS } from "@/lib/operational-window";
import { requireShopSurface } from "@/lib/session";
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
  searchParams: Promise<{ notice?: string; count?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice, count } = await searchParams;
  // The waiver is the shop's legal instrument; editing it (and the medical
  // jurisdiction it presents) is owner/manager work (H-14, ADR
  // 20260724-role-authorization). Other roles have no use for it, so the
  // surface doesn't exist for them rather than showing a read-only copy.
  // The Signatures tab (`./signatures/page.tsx`) runs the exact same gate —
  // never a looser one, since it's read access to signed medical records.
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
  const current = await getCurrentWaiverTemplate(db, shop.id);
  // What publishing a new version would cost, in signatures. Read on every
  // render so the confirm below can say it *before* the tap — the count in the
  // notice afterwards is the same number, and arrives too late to change a
  // mind (issue #720).
  const atRisk = await standingWaiverExposure(db, shop.id);

  const resigning = notice === "waiver-resigning" ? Number(count) : Number.NaN;
  const banner =
    notice === "saved"
      ? current
        ? t("waiversStaff.banner.savedNew")
        : t("waiversStaff.banner.savedFirst")
      : notice === "invalid"
        ? t("waiversStaff.banner.invalid")
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
    notice === "invalid"
      ? "danger"
      : notice === "waiver-resigning"
        ? "warning"
        : notice === "waiver-unchanged"
          ? "neutral"
          : "success";

  const materialityMessage = [
    t("waiversStaff.confirm.message", { count: atRisk.divers }),
    atRisk.boardingSoon > 0
      ? t("waiversStaff.confirm.boardingSoon", {
          count: atRisk.boardingSoon,
          days: OPERATIONAL_HORIZON_DAYS,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" ");

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
        {/* Two steps only when there is something to lose. A first release, or
            one nobody has signed against yet, costs nothing to publish and gets
            no ceremony; once signatures stand on the current version, the tap
            invalidates all of them at once and the number goes in front of the
            staffer rather than in the notice afterwards. */}
        {atRisk.divers > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <InlineConfirm
              triggerLabel={t("waiversStaff.confirm.materialTrigger")}
              triggerClassName={buttonClass({ size: "lg" })}
              message={materialityMessage}
              confirmLabel={t("waiversStaff.confirm.materialPublish")}
              cancelLabel={t("waiversStaff.confirm.cancel")}
              pendingLabel={t("waiversStaff.pendingLabel")}
              confirmFields={{ material: "material" }}
            />
            <InlineConfirm
              triggerLabel={t("waiversStaff.confirm.nonMaterialTrigger")}
              triggerClassName={buttonClass({ variant: "secondary", size: "lg" })}
              message={t("waiversStaff.confirm.nonMaterialMessage")}
              confirmLabel={t("waiversStaff.confirm.nonMaterialPublish")}
              cancelLabel={t("waiversStaff.confirm.cancel")}
              pendingLabel={t("waiversStaff.pendingLabel")}
              confirmFields={{ material: "non-material" }}
            />
          </div>
        ) : (
          <SubmitButton
            pendingLabel={t("waiversStaff.pendingLabel")}
            className={buttonClass({ size: "lg" })}
          >
            {current ? t("waiversStaff.saveNewVersion") : t("waiversStaff.saveWaiver")}
          </SubmitButton>
        )}
        {/* Beside the button, not under the `<h1>`: the release text is a
            fourteen-row textarea, so the top of this page is a screen and a
            half away from the control that was pressed. */}
        <FormStatus tone={bannerTone}>
          {banner}
          {/* The shop now owes those divers a link, and the batch send that
              issues one per departure already exists on the by-departure view.
              A door, rather than leaving them to hunt for it (issue #790). */}
          {notice === "waiver-resigning" && Number.isFinite(resigning) && resigning > 0 ? (
            <>
              {" "}
              <Link
                href={`/shop/${shopSlug}?view=departures`}
                className="font-medium text-primary hover:underline"
              >
                {t("waiversStaff.banner.resigningSendLink")}
              </Link>
            </>
          ) : null}
        </FormStatus>
      </div>
    </form>
  );

  return (
    <>
      <FlashParams params={["notice", "count"]} />
      <ShopPageHeader
        eyebrow={t("waiversStaff.eyebrow")}
        title={t("waiversStaff.title")}
        description={t("waiversStaff.description")}
      />

      {/* One card, one subject, so the heading is the card's: the release text
          is the section, and a heading floated above it named a region the
          border disagreed with. The version line is a status about the text in
          the box, so it rides the header row beside the heading rather than
          becoming a second description under it. */}
      <SectionCard
        padding="lg"
        className="mt-10"
        title={t("waiversStaff.releaseTextHeading")}
        description={
          current
            ? t("waiversStaff.releaseDescription.current")
            : t("waiversStaff.releaseDescription.sample")
        }
        actions={
          current ? (
            <p className="text-sm text-muted">
              {t("waiversStaff.versionInfo", {
                version: current.version,
                date: formatShortDate(current.createdAt, locale, shop.timezone),
              })}
            </p>
          ) : null
        }
      >
        {editForm}
      </SectionCard>
    </>
  );
}
