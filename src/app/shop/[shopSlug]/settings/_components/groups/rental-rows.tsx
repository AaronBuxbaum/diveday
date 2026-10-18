import { SettingsDoorRow } from "../SettingsRows";
import type { SettingsView } from "./kit";

/**
 * **The rental row of the Bookings group**: one door to the Rentals page
 * (#2815), where what a shop rents, what it charges and the terms every rental
 * ticket prints are set together. A function rather than a component, so the
 * row is part of its group's own element tree.
 */
export function rentalRows(view: SettingsView) {
  const { shopSlug, t } = view;
  return (
    <>
      {/* Currency is not here. It lives in the "Units" row with depth
        and water temperature — a shop looking for "what do we measure
        things in" should find all three answers in one place. */}
      <SettingsDoorRow
        href={`/shop/${shopSlug}/settings/rentals`}
        heading={t("settings.main.rentals.heading")}
      />
    </>
  );
}
