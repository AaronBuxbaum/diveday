import type { Metadata } from "next";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClassFor } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { canPersonManageShopSettings } from "@/db/authz";
import { countTripLensDepartures, listTripLenses } from "@/db/trip-lenses";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { LENS_NAME_MAX } from "@/lib/trip-lenses";
import { createTripLensAction, deleteTripLensAction, updateTripLensAction } from "../actions";
import { lensNoticeMessages } from "../sub-page-notices";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Kinds of day — DiveDay" };

/**
 * **Kinds of day** — ADR 20260904-reef-all-the-way-down, decision 2 (issue
 * #1162). The shop's own words for its departures, which a diver then filters
 * the public schedule by.
 *
 * On its own page rather than inside a hub row, for the reason `boats` is: a
 * list with a rename form and a delete confirm on every line is a page, and a
 * disclosure that opens onto one is a page wearing a row. Unconditional — a
 * shore-diving shop with no hull still names its kinds of day — so this route
 * carries no `hasBoatDiving` gate.
 *
 * **Every row here that holds a text box is an `md` row.** A list row would
 * take `sm`, but a box's type is 16px and `sm`'s is 14px, so a rename box
 * beside `sm` Save and Delete read as two sizes on all six rows of
 * `settings-kinds-of-day` (the pixel probe's `mismatched-controls` cluster,
 * 2026-09-25). The buttons take `md` and the boxes stand at its 48px, and the
 * delete confirm of a word that carries departures passes `size="md"` so the
 * Cancel `InlineConfirm` draws beside its confirm is `md` too.
 */
export default async function KindsOfDaySettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { db, session, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const shopLenses = await listTripLenses(db, session.user.shopId);
  // The same count as the fleet's, one word at a time: a shop's vocabulary is a
  // handful of rows and there is nothing to win by fanning out.
  const lensDepartures = new Map<string, number>();
  for (const lens of shopLenses) {
    lensDepartures.set(lens.id, await countTripLensDepartures(db, session.user.shopId, lens.id));
  }
  const banner = noticeFromParam(notice, lensNoticeMessages(t));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("lenses.heading")}
      />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}

      <SectionCard padding="lg">
        <div className="space-y-4">
          {shopLenses.length === 0 ? (
            <p className="text-sm text-muted italic">{t("lenses.noLenses")}</p>
          ) : (
            <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
              {shopLenses.map((lens) => (
                <div
                  key={lens.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 bg-surface"
                >
                  <form
                    action={updateTripLensAction}
                    className="flex flex-1 flex-col sm:flex-row sm:items-center gap-3 w-full"
                  >
                    <input type="hidden" name="lensId" value={lens.id} />
                    <div className="flex-1 w-full">
                      <input
                        name="name"
                        type="text"
                        required
                        maxLength={LENS_NAME_MAX}
                        defaultValue={lens.name}
                        aria-label={t("lenses.nameLabel")}
                        placeholder={t("lenses.nameLabel")}
                        className={controlClassFor("md")}
                      />
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                      <SubmitButton
                        pendingLabel={t("lenses.submitting")}
                        className={buttonClass({ variant: "secondary" })}
                      >
                        {t("lenses.submit")}
                      </SubmitButton>
                    </div>
                  </form>
                  {/* Its own form beside the rename, never inside it:
                      `InlineConfirm` submits the form it sits in, and forms
                      cannot nest. */}
                  <form action={deleteTripLensAction} className="shrink-0">
                    <input type="hidden" name="lensId" value={lens.id} />
                    {/* The confirm says what the delete touches. A word nothing
                        carries goes quietly, with no message to read. Nothing
                        is destroyed either way; the word on screen is still
                        "Delete" (ADR 20260820-every-delete-is-soft). */}
                    {lensDepartures.get(lens.id) ? (
                      <InlineConfirm
                        triggerLabel={t("lenses.delete")}
                        message={t("lenses.deleteDepartures", {
                          count: lensDepartures.get(lens.id) ?? 0,
                        })}
                        cancelLabel={t("lenses.deleteCancel")}
                        confirmLabel={t("lenses.deleteConfirm")}
                        pendingLabel={t("lenses.deletePending")}
                        triggerClassName={buttonClass({ variant: "danger-ghost" })}
                        size="md"
                      />
                    ) : (
                      <InlineConfirm
                        triggerLabel={t("lenses.delete")}
                        confirmLabel={t("lenses.deleteConfirm")}
                        pendingLabel={t("lenses.deletePending")}
                        triggerClassName={buttonClass({ variant: "danger-ghost" })}
                      />
                    )}
                  </form>
                </div>
              ))}
            </div>
          )}

          <div className="border border-dashed border-border rounded-lg p-4 bg-surface-sunken">
            <h2 className="text-sm font-medium mb-3">{t("lenses.createTitle")}</h2>
            <form
              action={createTripLensAction}
              className="flex flex-col sm:flex-row sm:items-start gap-3"
            >
              <div className="flex-1 w-full">
                <input
                  name="name"
                  type="text"
                  required
                  maxLength={LENS_NAME_MAX}
                  aria-label={t("lenses.nameLabel")}
                  placeholder={t("lenses.nameLabel")}
                  className={controlClassFor("md")}
                />
                {/* The one line that earns its place here: it names the
                    consequence a shop cannot see from this form, which is that
                    the word is public and divers filter by it. */}
                <p className="mt-1 text-xs text-muted">{t("lenses.nameHint")}</p>
              </div>
              <SubmitButton
                pendingLabel={t("lenses.adding")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("lenses.add")}
              </SubmitButton>
            </form>
          </div>
        </div>
      </SectionCard>
    </main>
  );
}
