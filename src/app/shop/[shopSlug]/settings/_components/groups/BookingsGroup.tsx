import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { ChoiceRow, Field, FieldActions, FieldGrid, textareaClassFor } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { EXTENSION_STORE_URL } from "@/lib/cert-check-extension";
import { publicAppUrl } from "@/lib/notifications";
import { publicShopRegisterPath } from "@/lib/public-routes";
import { shopPath } from "@/lib/staff-notices";
import { savePackingAction } from "../../booking-actions";
import { CounterQrCard } from "../../CounterQrCard";
import { CertCheckExtensionStatus } from "../CertCheckExtensionStatus";
import { CertCheckTryPanel } from "../CertCheckTryPanel";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { BOOKINGS_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";
import { rentalRows } from "./rental-rows";

/**
 * The Bookings group: how a booking is taken and prepared. The waiver template,
 * the counter's QR door, card checks and the packing list, the dock day's
 * rhythm, and what the shop rents (for the reader who may manage payments).
 */
export function BookingsGroup({
  view,
  canManageWaivers,
  canPayments,
}: {
  view: SettingsView;
  canManageWaivers: boolean;
  canPayments: boolean;
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
            that states an address instead of changing one. Gone while
            counter sign-up is switched off on Features. */}
        {shop.selfRegistrationEnabled ? (
          <CounterQrCard
            url={`${publicAppUrl() ?? ""}${publicShopRegisterPath(shopSlug)}`}
            title={t("settings.main.counterQr.heading")}
            description={t("settings.main.counterQr.description")}
            printHref={shopPath(shopSlug, "print", "counter-card")}
            printLabel={t("print.sheet.door")}
          />
        ) : null}

        {/* The DiveDay browser extension (H-20261008-cert-check-extension): whether this browser has
            it, where to get it once it is listed, and a try-it disclosure (#2817).
            Nothing to save. PADI's own opt-in is a row on the Features page. */}
        <SettingsRow
          heading={t("settings.main.certCheck.heading")}
          value={
            <CertCheckExtensionStatus
              added={t.raw("settings.main.certCheck.added")}
              notAdded={t("settings.main.certCheck.notAdded")}
              outdated={t.raw("settings.main.certCheck.outdated")}
            />
          }
          description={t("settings.main.certCheck.description")}
          sectionId="certCheck"
          activeSection={activeSection}
        >
          <div className="mt-4 flex flex-wrap gap-3">
            {EXTENSION_STORE_URL ? (
              <a
                href={EXTENSION_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.certCheck.install")}
              </a>
            ) : null}
          </div>
          {/* The extension's own steps, sample pages only (no agency is
              looked up), for a staffer to run alone and send back (#2817:
              a disclosure on this row, not a page of its own). */}
          <CompactDisclosureRow
            label={t("settings.main.certCheck.try")}
            className="mt-4"
            bodyClassName="mt-2 mb-3"
          >
            <p className="text-sm text-muted">{t("settings.certChecks.description")}</p>
            <div className="mt-3">
              <CertCheckTryPanel t={t} padiOn={shop.padiChecksEnabled} />
            </div>
          </CompactDisclosureRow>
        </SettingsRow>

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
            <ChoiceRow
              name="packingLogbook"
              type="checkbox"
              defaultChecked={shop.packingLogbook}
              className="text-sm"
            >
              {t("settings.main.packing.logbook")}
            </ChoiceRow>
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

        {/* How the day on the dock runs: the arrival call and the minutes the
          rest of the day is built from. A page of its own (#1854). */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/dock-day`}
          heading={t("settings.main.dockCall.heading")}
        />

        {/* Rentals are payment-settings work: the catalogue and its prices
          price a booking. Currency is not here; it lives in the Shop group's
          Units row with depth and water temperature. */}
        {canPayments ? rentalRows(view) : null}
      </InsetGroup>
    </SettingsGroup>
  );
}
