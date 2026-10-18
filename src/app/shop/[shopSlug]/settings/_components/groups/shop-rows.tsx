import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  ChoiceRow,
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
} from "@/components/ui/form";
import { formatMonthDay, monthNames } from "@/lib/format";
import { saveReopensOnAction, saveSeasonStartAction } from "../../shop-actions";
import { saveSearchListingAction } from "../../website-actions";
import { SettingsRow } from "../SettingsRows";
import { SectionNotice, type SettingsView } from "./kit";

/**
 * **The facts of the shop a shop sets once and rarely opens again**, as rows of
 * the Shop group: when its season starts and whether search engines list it.
 * (Which kinds of diving it runs is a switch now, on the Features page.) They sat in a "Rarely changed" group, defined
 * by how often it was opened rather than by what it held; each is a fact about
 * the shop, so each lives with the other facts of the shop. Functions rather
 * than components, so the rows are part of their group's own element tree (the
 * hub's tests read that tree unrendered). Every `#fragment` and `?saved=` id is
 * unchanged: only the group around them moved.
 */

/**
 * When the counting starts: the denominator behind the home's one fact of
 * scale (ADR 20260904-reef-all-the-way-down, Budget rule 3). A dive shop's year
 * rarely starts in January, and "your 400th diver of the season" is only true
 * against a date the shop chose.
 */
export function seasonRow(view: SettingsView) {
  const { shop, t, locale, banner, activeSection } = view;
  return (
    <SettingsRow
      heading={t("settings.main.season.heading")}
      value={formatMonthDay(shop.seasonStartMonth, shop.seasonStartDay, locale)}
      detail={t("settings.main.season.detail")}
      sectionId="season"
      activeSection={activeSection}
    >
      <SectionNotice banner={banner} section="season" active={activeSection} />
      <FieldGrid as="form" action={saveSeasonStartAction} columns={2} className="mt-4">
        <Field label={t("settings.main.season.monthLabel")}>
          <select
            name="seasonStartMonth"
            required
            defaultValue={shop.seasonStartMonth}
            className={controlClass}
          >
            {monthNames(locale).map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("settings.main.season.dayLabel")}>
          {/* A number rather than a second select: the days a month
                has depend on the month, and the action and the table both
                refuse a date the calendar does not have (`parseSeasonStart`
                and the `shops_season_start_day_in_month` constraint), so a
                31 chosen in April comes back as a refusal on the field
                rather than as a silently clamped 30. */}
          <input
            type="number"
            name="seasonStartDay"
            required
            min={1}
            max={31}
            defaultValue={shop.seasonStartDay}
            className={controlClass}
          />
        </Field>
        <FieldActions>
          <SubmitButton
            pendingLabel={t("settings.main.season.submitting")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("settings.main.season.submit")}
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
      {/* The other date a season has: when the boat goes back out. Only
              the public page's empty board reads it (`src/lib/off-season.ts`),
              and only while it is still ahead, so it is its own small form
              rather than a third field the counting would have to ignore. */}
      <FieldGrid as="form" action={saveReopensOnAction} columns={2} className="mt-6">
        <Field
          label={t("settings.main.season.reopensLabel")}
          description={t("settings.main.season.reopensHint")}
        >
          <DateField name="reopensOn" defaultValue={shop.reopensOn ?? ""} />
        </Field>
        <FieldActions>
          <SubmitButton
            pendingLabel={t("settings.main.season.submitting")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("settings.main.season.reopensSubmit")}
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </SettingsRow>
  );
}

/** Whether search engines list the shop. */
export function searchListingRow(view: SettingsView) {
  const { shop, t, banner, activeSection } = view;
  // A shop is listed by default and the box says so; unticking it drops the shop
  // out of sitemap.xml *and* makes its public pages emit robots: noindex (ADR
  // 20260813-search-listing-is-a-choice).
  return (
    <SettingsRow
      heading={t("settings.main.searchListing.heading")}
      value={
        shop.searchListingOptOutAt
          ? t("settings.main.searchListing.valueHidden")
          : t("settings.main.searchListing.valueListed")
      }
      detail={t("settings.main.searchListing.detail")}
      sectionId="searchListing"
      activeSection={activeSection}
    >
      <SectionNotice banner={banner} section="searchListing" active={activeSection} />
      <FieldGrid as="form" action={saveSearchListingAction} columns={1} className="mt-4">
        <ChoiceRow
          name="searchListed"
          type="checkbox"
          defaultChecked={!shop.searchListingOptOutAt}
          className="text-sm"
        >
          {t("settings.main.searchListing.label")}
        </ChoiceRow>
        <FieldActions>
          <SubmitButton
            pendingLabel={t("settings.main.searchListing.submitting")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("settings.main.searchListing.submit")}
          </SubmitButton>
        </FieldActions>
      </FieldGrid>
    </SettingsRow>
  );
}
