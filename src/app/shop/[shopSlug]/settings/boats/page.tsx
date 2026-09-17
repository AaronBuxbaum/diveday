import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { canPersonManageShopSettings } from "@/db/authz";
import { countBoatDepartures, listBoats } from "@/db/boats";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { createBoatAction, deleteBoatAction, updateBoatAction } from "../actions";
import { boatNoticeMessages } from "../sub-page-notices";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Boats — DiveDay" };

/**
 * **The shop's hulls, on a page of their own** — the second half of the
 * settings directory's rule (ADR 20260827-clearwater-surface-language,
 * decision 6): a row states an answer and opens the form that changes it, and
 * a row whose "form" is a list of boats with a Save and a Delete on each one
 * is not a row, it is a page wearing a disclosure. The hub lists it as a door
 * now; this is what the door opens.
 *
 * Nothing about the editor itself changed — the same three forms per hull, the
 * same confirm that names how many departures a hull has carried before it is
 * deleted, the same actions.
 *
 * A shore-and-pool shop has no hulls to name, so this route does not exist for
 * them: `hasBoatDiving` is the same condition that used to decide whether the
 * hub drew the row, and turning boat diving back on brings the fleet back
 * exactly as it was (nothing is deleted when the option goes off).
 */
export default async function BoatsSettingsPage({
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
  if (!shop.hasBoatDiving) notFound();

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const shopBoats = await listBoats(db, session.user.shopId);
  // **How much history each hull carries**, so the confirm can say so before a
  // shop taps Delete. Sequential rather than a fan-out: this reads through the
  // same executor and a shop's fleet is a handful of rows.
  const boatDepartures = new Map<string, number>();
  for (const boat of shopBoats) {
    boatDepartures.set(boat.id, await countBoatDepartures(db, session.user.shopId, boat.id));
  }
  const banner = noticeFromParam(notice, boatNoticeMessages(t));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("boats.heading")}
      />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}

      <SectionCard padding="lg">
        <div className="space-y-4">
          {shopBoats.length === 0 ? (
            <p className="text-sm text-muted italic">{t("boats.noBoats")}</p>
          ) : (
            <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
              {shopBoats.map((boat) => (
                <div
                  key={boat.id}
                  className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 bg-surface"
                >
                  <form
                    action={updateBoatAction}
                    className="flex flex-1 flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-3 w-full"
                  >
                    <input type="hidden" name="boatId" value={boat.id} />
                    <div className="flex-1 w-full">
                      <input
                        name="name"
                        type="text"
                        required
                        defaultValue={boat.name}
                        placeholder={t("boats.nameLabel")}
                        aria-label={t("boats.nameLabel")}
                        className={controlClass}
                      />
                    </div>
                    <div className="w-full sm:w-32 flex items-center gap-2">
                      <input
                        name="capacity"
                        type="number"
                        required
                        min={1}
                        defaultValue={boat.capacity}
                        placeholder={t("boats.capacityLabel")}
                        aria-label={t("boats.capacityLabel")}
                        className={`${controlClass} tabular-nums`}
                      />
                    </div>
                    <div className="w-full sm:basis-full">
                      <input
                        name="description"
                        type="text"
                        maxLength={200}
                        defaultValue={boat.description ?? ""}
                        placeholder={t("boats.descriptionLabel")}
                        aria-label={t("boats.descriptionLabel")}
                        className={controlClass}
                      />
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                      <SubmitButton
                        pendingLabel={t("boats.submitting")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        {t("boats.submit")}
                      </SubmitButton>
                    </div>
                  </form>
                  {/* Its own form, beside the update rather than inside it:
                      `InlineConfirm` submits the form it sits in, and forms
                      cannot nest. */}
                  <form action={deleteBoatAction} className="shrink-0">
                    <input type="hidden" name="boatId" value={boat.id} />
                    {/* **The confirm says what the delete touches.** A hull
                        that has carried departures is history an insurer asks
                        about — the count is the fact a shop cannot get from
                        this row, and it is why this is a blocking confirm
                        rather than a bare button. A boat that never sailed
                        goes quietly, with no message to read. Nothing is
                        destroyed either way; the word is still "Delete" and
                        the shop is never told about a column (ADR
                        20260820-every-delete-is-soft). */}
                    {boatDepartures.get(boat.id) ? (
                      <InlineConfirm
                        triggerLabel={t("boats.deleteBoat")}
                        message={t("boats.deleteBoatDepartures", {
                          count: boatDepartures.get(boat.id) ?? 0,
                        })}
                        cancelLabel={t("boats.deleteBoatCancel")}
                        confirmLabel={t("boats.deleteBoatConfirm")}
                        pendingLabel={t("boats.deleteBoatPending")}
                        triggerClassName={buttonClass({ variant: "danger-ghost", size: "sm" })}
                      />
                    ) : (
                      <InlineConfirm
                        triggerLabel={t("boats.deleteBoat")}
                        confirmLabel={t("boats.deleteBoatConfirm")}
                        pendingLabel={t("boats.deleteBoatPending")}
                        triggerClassName={buttonClass({ variant: "danger-ghost", size: "sm" })}
                      />
                    )}
                  </form>
                </div>
              ))}
            </div>
          )}

          <div className="border border-dashed border-border rounded-lg p-4 bg-surface-sunken">
            <h2 className="text-sm font-medium mb-3">{t("boats.createTitle")}</h2>
            <form
              action={createBoatAction}
              className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-3"
            >
              <div className="flex-1 w-full">
                <input
                  name="name"
                  type="text"
                  required
                  placeholder={t("boats.nameLabel")}
                  aria-label={t("boats.nameLabel")}
                  className={controlClass}
                />
              </div>
              <div className="w-full sm:w-32">
                <input
                  name="capacity"
                  type="number"
                  required
                  min={1}
                  placeholder={t("boats.capacityLabel")}
                  aria-label={t("boats.capacityLabel")}
                  className={`${controlClass} tabular-nums`}
                />
              </div>
              <div className="w-full sm:basis-full">
                <input
                  name="description"
                  type="text"
                  maxLength={200}
                  placeholder={t("boats.descriptionLabel")}
                  aria-label={t("boats.descriptionLabel")}
                  className={controlClass}
                />
              </div>
              <SubmitButton
                pendingLabel={t("boats.submitting")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("boats.addBoat")}
              </SubmitButton>
            </form>
          </div>
        </div>
      </SectionCard>
    </main>
  );
}
