import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import {
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { canPersonManageShopSettings } from "@/db/authz";
import { countBoatDepartures, listBoats } from "@/db/boats";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { AddPanel } from "../_components/AddPanel";
import { HullColorField } from "../_components/HullColorField";
import { settingsPaneClass } from "../_components/settings-pane";
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
    <main className={settingsPaneClass()}>
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
                    {/* A textarea, because the value is a sentence of up to
                        200 characters: a one-line box cut the seed's 72 at
                        its padding edge, mid-word (K-446). It grows with its
                        text and never shows fewer than two lines. */}
                    <div className="w-full sm:basis-full">
                      <textarea
                        name="description"
                        rows={2}
                        maxLength={200}
                        defaultValue={boat.description ?? ""}
                        placeholder={t("boats.descriptionLabel")}
                        aria-label={t("boats.descriptionLabel")}
                        className={textareaClassFor(2)}
                      />
                    </div>
                    {/* **The colour, with the boat under it** (ADR
                        20260919-one-idea, decision I · Tide). A hull is the
                        object a crew recognises before reading a name, so the
                        choice is made against the shape rather than against a
                        swatch — and the hint says why it is worth making at
                        all, which is the one thing a colour field cannot show
                        on its own. */}
                    <div className="w-full sm:basis-full">
                      <HullColorField
                        initial={boat.hullColor}
                        capacity={boat.capacity}
                        hint={t("boats.hullColorHint")}
                        pickerLabel={t("boats.hullColorPicker")}
                        fieldLabel={t("boats.hullColorLabel")}
                        previewLabel={t("boats.hullPreviewLabel", {
                          name: boat.name,
                          capacity: boat.capacity,
                        })}
                      />
                    </div>
                    {/* **Save and Delete on one line**, in the update form's
                        own action row rather than a form of their own apart.
                        The confirm posts to the delete through `formAction`,
                        taking the row's hidden `boatId` with it; Save comes
                        first, so Enter in a field saves and never deletes, and
                        names its own action so a delete in flight never reads
                        as a save. `flex-wrap` gives an armed confirm's message
                        a line of its own. Delete is `flush` (below), so the
                        row's gap hands back the 12px it gave up beside Save:
                        `gap-x-5`, the words 20px from Save's box as before. */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 w-full sm:w-auto justify-end">
                      <SubmitButton
                        pendingLabel={t("boats.submitting")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                        formAction={updateBoatAction}
                      >
                        {t("boats.submit")}
                      </SubmitButton>
                      {/* **The confirm says what the delete touches.** A hull
                          that has carried departures is history an insurer
                          asks about — the count is the fact a shop cannot get
                          from this row, and it is why this is a blocking
                          confirm rather than a bare button. A boat that never
                          sailed goes quietly, with no message to read. Nothing
                          is destroyed either way; the word is still "Delete"
                          and the shop is never told about a column (ADR
                          20260820-every-delete-is-soft). */}
                      {boatDepartures.get(boat.id) ? (
                        <InlineConfirm
                          formAction={deleteBoatAction}
                          triggerLabel={t("boats.deleteBoat")}
                          message={t("boats.deleteBoatDepartures", {
                            count: boatDepartures.get(boat.id) ?? 0,
                          })}
                          cancelLabel={t("boats.deleteBoatCancel")}
                          confirmLabel={t("boats.deleteBoatConfirm")}
                          pendingLabel={t("boats.deleteBoatPending")}
                          // `flush` puts "Delete boat" on the row's edge where
                          // it ends the row (a phone); the row's `p-3` in an
                          // `overflow-hidden` list is a pixel short of an outset
                          // ring past the flush fill, so it is inside. The armed
                          // block's confirm is not on that edge.
                          triggerClassName={buttonClass({
                            variant: "danger-ghost",
                            size: "sm",
                            flush: true,
                            className: "focus-visible:focus-ring-inset",
                          })}
                          confirmClassName={buttonClass({ variant: "danger-ghost", size: "sm" })}
                        />
                      ) : (
                        <InlineConfirm
                          formAction={deleteBoatAction}
                          triggerLabel={t("boats.deleteBoat")}
                          confirmLabel={t("boats.deleteBoatConfirm")}
                          pendingLabel={t("boats.deleteBoatPending")}
                          triggerClassName={buttonClass({
                            variant: "danger-ghost",
                            size: "sm",
                            flush: true,
                            className: "focus-visible:focus-ring-inset",
                          })}
                        />
                      )}
                    </div>
                  </form>
                </div>
              ))}
            </div>
          )}

          {/* **Every box says what it is for, above it.** An empty form has
              no values to read a box by, and its placeholders were its only
              labels: the 128px capacity box read "Capacity (se" and the
              description lost twenty characters of its own at 390 (K-145).
              Captions; a row above keeps its placeholders because its values say what each box
              holds. */}
          <AddPanel title={t("boats.createTitle")}>
            <FieldGrid as="form" columns={2} action={createBoatAction}>
              <Field label={t("boats.nameLabel")}>
                <input name="name" type="text" required className={controlClass} />
              </Field>
              <Field label={t("boats.capacityLabel")}>
                <input
                  name="capacity"
                  type="number"
                  required
                  min={1}
                  className={`${controlClass} tabular-nums`}
                />
              </Field>
              <Field label={t("boats.descriptionLabel")} className="sm:col-span-2">
                <textarea
                  name="description"
                  rows={2}
                  maxLength={200}
                  className={textareaClassFor(2)}
                />
              </Field>
              <FieldActions>
                <SubmitButton
                  pendingLabel={t("boats.submitting")}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {t("boats.addBoat")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </AddPanel>
        </div>
      </SectionCard>
    </main>
  );
}
