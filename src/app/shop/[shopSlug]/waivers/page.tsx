import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { canPersonManageWaiverTemplates } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getCurrentWaiverTemplate, saveWaiverTemplate } from "@/db/waivers";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { type NoticeTone, noticeRole } from "@/lib/staff-notices";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Waivers — DiveDay",
};

const templateSchema = z.object({
  body: z.string().trim().min(40).max(12_000),
});

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

  async function saveWaiverAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const editor = await getDb();
    if (!(await canPersonManageWaiverTemplates(editor, staff.user.shopId, staff.user.personId))) {
      redirect(`/shop/${staff.user.shopSlug}?notice=waivers_not_authorized`);
    }
    const parsed = templateSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/shop/${staff.user.shopSlug}/waivers?notice=invalid`);
    await saveWaiverTemplate(await getDb(), {
      shopId: staff.user.shopId,
      title: DEFAULT_WAIVER_TITLE,
      body: parsed.data.body,
    });
    revalidateAndRedirect(
      `/shop/${staff.user.shopSlug}/waivers`,
      `/shop/${staff.user.shopSlug}/waivers?notice=saved`,
    );
  }

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
      <div>
        <SubmitButton
          pendingLabel={t("waiversStaff.pendingLabel")}
          className={buttonClass({ size: "lg" })}
        >
          {current ? t("waiversStaff.saveNewVersion") : t("waiversStaff.saveWaiver")}
        </SubmitButton>
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

      {/* This tab writes the waiver; nothing here sends or chases one. Not
          ready is where an unsigned waiver actually gets handled, so the job
          "someone hasn't signed" has a path out of the page it lands on. */}
      <p className="mt-3 text-sm text-muted">
        {t.rich("waiversStaff.chaseUnsigned", {
          link: (chunks) => (
            // Straight to the by-departure view, not the redirect that still
            // serves the old URL: an in-app link should land in one hop.
            <Link
              href={`/shop/${shopSlug}?view=departures`}
              // Underlined at rest, not only on hover: inside a block of prose
              // colour alone is the only thing distinguishing the link, which
              // no one perceiving colour differently can see (WCAG 1.4.1).
              className="text-primary underline underline-offset-2"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>

      {banner ? (
        <div className="mt-6">
          <ShopNotice tone={bannerTone} role={noticeRole(bannerTone)}>
            {banner}
          </ShopNotice>
        </div>
      ) : null}

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
