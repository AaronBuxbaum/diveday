import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { Field, FieldActions, FieldGrid, textareaClassFor } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { publicAppUrl } from "@/lib/notifications";
import { publicShopRegisterPath } from "@/lib/public-routes";
import { shopPath } from "@/lib/staff-notices";
import { savePackingAction } from "../../actions";
import { CounterQrCard } from "../../CounterQrCard";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { BOOKINGS_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";

/** The Bookings & waivers group: the waiver template, the counter's QR door, and the packing list. */
export function BookingsGroup({
  view,
  canManageWaivers,
}: {
  view: SettingsView;
  canManageWaivers: boolean;
}) {
  const { shop, shopSlug, t, banner, activeSection, notSet } = view;
  const packingValue =
    shop.packingList.length > 0
      ? t("settings.main.packing.value", { count: shop.packingList.length })
      : notSet;
  return (
    <SettingsGroup group={BOOKINGS_GROUP} label={t(BOOKINGS_GROUP.labelKey)}>
      <InsetGroup>
        {canManageWaivers ? (
          <SettingsDoorRow
            href={`/shop/${shopSlug}/waivers`}
            heading={t("settings.main.waivers.heading")}
          />
        ) : null}

        {/* The counter's own door (issue #1236): a QR a shop prints and
            puts on the desk, so a walk-in who has booked nothing can put
            themselves on file before they reach the front of the queue.
            A row of this group rather than a bordered card standing above
            it — there is nothing here to configure, so it is the one row
            that states an address instead of changing one. */}
        <CounterQrCard
          url={`${publicAppUrl() ?? ""}${publicShopRegisterPath(shopSlug)}`}
          title={t("settings.main.counterQr.heading")}
          description={t("settings.main.counterQr.description")}
          printHref={shopPath(shopSlug, "print", "counter-card")}
          printLabel={t("print.sheet.door")}
        />

        <SettingsRow
          heading={t("settings.main.packing.heading")}
          value={packingValue}
          description={t("settings.main.packing.description")}
          sectionId="packing"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="packing" active={activeSection} />
          <FieldGrid as="form" action={savePackingAction} columns={1} className="mt-4">
            <Field label={t("settings.main.packing.label")}>
              <textarea
                name="packingList"
                rows={6}
                maxLength={1212}
                defaultValue={shop.packingList.join("\n")}
                className={textareaClassFor(6)}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.packing.submitting")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.packing.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </SettingsRow>
      </InsetGroup>
    </SettingsGroup>
  );
}
