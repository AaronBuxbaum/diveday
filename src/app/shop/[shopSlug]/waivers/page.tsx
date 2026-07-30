import type { Metadata } from "next";
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
import {
  getCurrentWaiverTemplate,
  listWaiverIntegrityAudit,
  saveWaiverTemplate,
} from "@/db/waivers";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";

export const metadata: Metadata = {
  title: "Waiver — DiveDay",
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
  const canManage = await canPersonManageWaiverTemplates(
    db,
    session.user.shopId,
    session.user.personId,
  );
  if (!canManage) redirect(`/shop/${shopSlug}`);
  const current = await getCurrentWaiverTemplate(db, shop.id);
  const integrityAudit = await listWaiverIntegrityAudit(db, shop.id);

  async function saveWaiverAction(formData: FormData) {
    "use server";
    const staff = await requireStaffSession();
    const editor = await getDb();
    if (!(await canPersonManageWaiverTemplates(editor, staff.user.shopId, staff.user.personId))) {
      redirect(`/shop/${staff.user.shopSlug}`);
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
  const bannerIsError = notice === "invalid";

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
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("waiversStaff.eyebrow")}
        title={t("waiversStaff.title")}
        description={t("waiversStaff.description")}
      />

      {banner ? (
        <div className="mt-6">
          <ShopNotice
            tone={bannerIsError ? "danger" : "success"}
            role={bannerIsError ? "alert" : "status"}
          >
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

      <section className="mt-10" aria-labelledby="waiver-integrity-heading">
        <h2 id="waiver-integrity-heading" className="text-lg font-semibold">
          {t("waiversStaff.integrityHeading")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("waiversStaff.integrityDescription")}
        </p>
        {integrityAudit.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t("waiversStaff.noSignedRecords")}</p>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
              {integrityAudit.slice(0, 20).map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <span>
                    <span className="font-medium">{entry.personName}</span>
                    <span className="ml-2 text-muted">
                      {entry.signedAt
                        ? formatShortDate(entry.signedAt, locale, shop.timezone)
                        : t("waiversStaff.noSignatureDate")}
                    </span>
                  </span>
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
                      ? t("waiversStaff.integrityValid")
                      : entry.integrity === "invalid"
                        ? t("waiversStaff.integrityInvalid")
                        : t("waiversStaff.integrityUnsealed")}
                  </span>
                </li>
              ))}
            </ul>
            {integrityAudit.length > 20 ? (
              <p className="mt-2 text-xs text-muted">{t("waiversStaff.truncatedNotice")}</p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
