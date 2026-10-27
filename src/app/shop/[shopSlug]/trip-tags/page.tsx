import type { Metadata } from "next";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureRow, DisclosureRowList } from "@/components/ui/disclosure";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { canPersonManageTripTags } from "@/db/authz";
import { countDeparturesByTripLens, listTripLenses } from "@/db/trip-lenses";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { LENS_NAME_MAX } from "@/lib/trip-lenses";
import { registerPaneClass } from "../_components/register-pane";
import { createTripLensAction, deleteTripLensAction, updateTripLensAction } from "./actions";
import { lensNoticeMessages, tripTagRefusalTarget } from "./notices";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Trip tags — DiveDay" };

/**
 * **Trip tags** — ADR 20260904-reef-all-the-way-down, decision 2 (issue
 * #1162), cut down to a plain list by ADR 20261001-logbook. The shop's own
 * tags for its departures, which a diver then filters the public schedule by:
 * add one, rename one, delete one.
 *
 * On its own page rather than inside a hub row, for the reason `boats` is: a
 * list with a rename form and a delete confirm on every line is a page, and a
 * disclosure that opens onto one is a page wearing a row. Unconditional — a
 * shore-diving shop with no hull still tags its departures — so this route
 * carries no `hasBoatDiving` gate.
 *
 * Names are readable at rest. Opening a row reveals its rename form and
 * history-aware delete; the add form uses the same disclosure vocabulary.
 */
export default async function TripTagsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; lens?: string }>;
}) {
  const { shopSlug } = await params;
  const query = await searchParams;
  const { notice } = query;
  const refusedEditor = tripTagRefusalTarget(query);
  const { db, session, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageTripTags,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // The same count as the fleet's: one grouped read beside the words.
  const [shopLenses, lensDepartures] = await Promise.all([
    listTripLenses(db, session.user.shopId),
    countDeparturesByTripLens(db, session.user.shopId),
  ]);
  const banner = noticeFromParam(notice, lensNoticeMessages(t));

  return (
    <main className={registerPaneClass()}>
      <FlashParams params={["notice", "lens"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("lenses.heading")}
      />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}

      <DisclosureRowList>
        {shopLenses.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted sm:px-5">{t("lenses.noLenses")}</p>
        ) : (
          shopLenses.map((lens) => (
            <DisclosureRow
              key={lens.id}
              id={`tag-${lens.id}`}
              heading={lens.name}
              open={refusedEditor === lens.id}
            >
              <FieldGrid as="form" action={updateTripLensAction} columns={1}>
                <input type="hidden" name="lensId" value={lens.id} />
                <Field label={t("lenses.nameLabel")}>
                  <input
                    name="name"
                    type="text"
                    required
                    maxLength={LENS_NAME_MAX}
                    defaultValue={lens.name}
                    className={controlClass}
                  />
                </Field>
                {/* Save comes first so Enter renames. Delete takes the same
                    lensId through its own formAction and names the history it affects. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 w-full sm:w-auto justify-end">
                  <SubmitButton
                    pendingLabel={t("lenses.submitting")}
                    className={buttonClass({ variant: "secondary" })}
                    formAction={updateTripLensAction}
                  >
                    {t("lenses.submit")}
                  </SubmitButton>
                  {/* The confirm says what the delete touches. A word
                          nothing carries goes quietly, with no message to read.
                          Nothing is destroyed either way; the word on screen is
                          still "Delete" (ADR 20260820-every-delete-is-soft). */}
                  {lensDepartures.get(lens.id) ? (
                    <InlineConfirm
                      formAction={deleteTripLensAction}
                      triggerLabel={t("lenses.delete")}
                      message={t("lenses.deleteDepartures", {
                        count: lensDepartures.get(lens.id) ?? 0,
                      })}
                      cancelLabel={t("lenses.deleteCancel")}
                      confirmLabel={t("lenses.deleteConfirm")}
                      pendingLabel={t("lenses.deletePending")}
                      triggerClassName={buttonClass({
                        variant: "danger-ghost",
                        flush: true,
                        className: "focus-visible:focus-ring-inset",
                      })}
                      confirmClassName={buttonClass({ variant: "danger-ghost" })}
                      size="md"
                    />
                  ) : (
                    <InlineConfirm
                      formAction={deleteTripLensAction}
                      triggerLabel={t("lenses.delete")}
                      confirmLabel={t("lenses.deleteConfirm")}
                      pendingLabel={t("lenses.deletePending")}
                      triggerClassName={buttonClass({
                        variant: "danger-ghost",
                        flush: true,
                        className: "focus-visible:focus-ring-inset",
                      })}
                    />
                  )}
                </div>
              </FieldGrid>
            </DisclosureRow>
          ))
        )}

        <DisclosureRow
          className="print:[&:not([open])]:hidden"
          id="tag-new"
          heading={t("lenses.createTitle")}
          open={refusedEditor === "new"}
        >
          <FieldGrid as="form" action={createTripLensAction} columns={1}>
            <Field label={t("lenses.nameLabel")} description={t("lenses.nameHint")}>
              <input
                name="name"
                type="text"
                required
                maxLength={LENS_NAME_MAX}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("lenses.adding")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("lenses.add")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </DisclosureRow>
      </DisclosureRowList>
    </main>
  );
}
