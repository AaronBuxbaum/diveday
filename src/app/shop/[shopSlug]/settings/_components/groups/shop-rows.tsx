import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import {
  ChoiceRow,
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
} from "@/components/ui/form";
import { formatMonthDay, monthNames } from "@/lib/format";
import { saveDivingOptionsAction } from "../../boat-actions";
import { saveReopensOnAction, saveSeasonStartAction } from "../../shop-actions";
import { saveSearchListingAction } from "../../website-actions";
import { SettingsRow } from "../SettingsRows";
import { SectionNotice, type SettingsView } from "./kit";

/**
 * **The facts of the shop a shop sets once and rarely opens again**, as rows of
 * the Shop group: when its season starts, which kinds of diving it runs, and
 * whether search engines list it. They sat in a "Rarely changed" group, defined
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

/** Which of boat, shore and pool diving the shop runs. */
export function divingOptionsRow(view: SettingsView) {
  const { shop, t, banner, activeSection } = view;
  const value = (
    <FactLine
      facts={[
        shop.hasBoatDiving ? t("boats.boatEnabled") : t("boats.boatDisabled"),
        shop.hasShoreDiving ? t("boats.shoreEnabled") : t("boats.shoreDisabled"),
        shop.hasPoolDiving ? t("boats.poolEnabled") : t("boats.poolDisabled"),
      ]}
    />
  );
  return (
    <SettingsRow
      heading={t("boats.divingOptionsHeading")}
      value={value}
      sectionId="divingOptions"
      activeSection={activeSection}
    >
      <SectionNotice banner={banner} section="divingOptions" active={activeSection} />
      <FieldGrid as="form" action={saveDivingOptionsAction} columns={1} className="mt-4">
        {/* Boat first, and on by default: it is what the product assumed
                before this row existed, and what `trips.dive_mode` still
                defaults to. Turning it off is what hides the Boats row
                in Boats & sites and takes the hull out of the Requests planner.

                Each box sits on its name's line, not between the name and
                the sentence under it, which `items-center` did (K-13). */}
        <ChoiceRow
          name="hasBoatDiving"
          type="checkbox"
          defaultChecked={shop.hasBoatDiving}
          className="text-sm"
        >
          <span className="block font-medium">{t("boats.boatDivingLabel")}</span>
          <span className="block text-xs text-muted">{t("boats.boatDivingDescription")}</span>
        </ChoiceRow>
        <ChoiceRow
          name="hasShoreDiving"
          type="checkbox"
          defaultChecked={shop.hasShoreDiving}
          className="mt-2 text-sm"
        >
          <span className="block font-medium">{t("boats.shoreDivingLabel")}</span>
          <span className="block text-xs text-muted">{t("boats.shoreDivingDescription")}</span>
        </ChoiceRow>
        <ChoiceRow
          name="hasPoolDiving"
          type="checkbox"
          defaultChecked={shop.hasPoolDiving}
          className="mt-2 text-sm"
        >
          <span className="block font-medium">{t("boats.poolDivingLabel")}</span>
          <span className="block text-xs text-muted">{t("boats.poolDivingDescription")}</span>
        </ChoiceRow>
        <FieldActions>
          <SubmitButton
            pendingLabel={t("boats.divingOptionsSubmitting")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("boats.divingOptionsSubmit")}
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
