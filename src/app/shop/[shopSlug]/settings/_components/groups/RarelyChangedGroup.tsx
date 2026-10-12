import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import {
  ChoiceRow,
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  PriceField,
} from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { formatMoneyScanned, formatMonthDay, monthNames } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import { saveDivingOptionsAction } from "../../boat-actions";
import { savePassThroughFeeAction } from "../../money-actions";
import { saveSeasonStartAction } from "../../shop-actions";
import { saveSearchListingAction } from "../../website-actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { RARELY_CHANGED_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";

/**
 * The rows a shop sets once, when it opens, and then never again: when its
 * season starts, which kinds of diving it runs, its trip tags, a pass-through
 * fee, and whether search engines list it. They sat among the rows a shop
 * touches every week, making each of those groups twice as long to scan.
 * Here, last, each still folded to its answer, and every `#fragment` and
 * `?saved=` id is unchanged: only the group around them moved.
 */
export function RarelyChangedGroup({
  view,
  canPayments,
}: {
  view: SettingsView;
  canPayments: boolean;
}) {
  const { shop, shopSlug, t, locale, banner, activeSection, notSet } = view;
  const shopCurrency = toShopCurrency(shop.currency);
  const divingOptionsValue = (
    <FactLine
      facts={[
        shop.hasBoatDiving ? t("boats.boatEnabled") : t("boats.boatDisabled"),
        shop.hasShoreDiving ? t("boats.shoreEnabled") : t("boats.shoreDisabled"),
        shop.hasPoolDiving ? t("boats.poolEnabled") : t("boats.poolDisabled"),
      ]}
    />
  );
  const passThroughFee = parsePassThroughFee(shop.passThroughFee);
  const passThroughValue = passThroughFee ? (
    <FactLine
      facts={[
        { value: passThroughFee.name, wraps: true },
        t("settings.main.passThrough.value", {
          price: formatMoneyScanned(passThroughFee.amountCents, shopCurrency, locale),
        }),
      ]}
    />
  ) : (
    notSet
  );
  return (
    <SettingsGroup group={RARELY_CHANGED_GROUP} label={t(RARELY_CHANGED_GROUP.labelKey)}>
      <InsetGroup>
        {/* When the counting starts: the denominator behind the home's one
          fact of scale (ADR 20260904-reef-all-the-way-down, Budget rule 3).
          A dive shop's year rarely starts in January, and "your 400th diver
          of the season" is only true against a date the shop chose. */}
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
        </SettingsRow>

        <SettingsRow
          heading={t("boats.divingOptionsHeading")}
          value={divingOptionsValue}
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

        {/* **Trip tags** — ADR 20260904-reef-all-the-way-down, decision 2
          (issue #1162). The shop's own tags for its departures, which a
          diver then filters the public schedule by. Unconditional: a
          shore-diving shop with no hull still tags its departures, so
          this row carries no `hasBoatDiving` gate. */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/trip-tags`}
          heading={t("lenses.heading")}
        />

        {canPayments ? (
          <SettingsRow
            heading={t("settings.main.passThrough.heading")}
            value={passThroughValue}
            description={t("settings.main.passThrough.description")}
            detail={t("settings.main.passThrough.detail")}
            sectionId="passThrough"
            activeSection={activeSection}
          >
            <SectionNotice banner={banner} section="passThrough" active={activeSection} />
            <form action={savePassThroughFeeAction} className="mt-4">
              <FieldGrid columns={2}>
                <Field label={t("settings.main.passThrough.nameLabel")}>
                  <input
                    name="passThroughName"
                    defaultValue={passThroughFee?.name ?? ""}
                    maxLength={120}
                    className={controlClass}
                    placeholder={t("settings.main.passThrough.namePlaceholder")}
                  />
                </Field>
                <PriceField
                  name="passThroughAmount"
                  label={t("settings.main.passThrough.amountLabel")}
                  hint={t("settings.main.passThrough.amountHint")}
                  cents={passThroughFee?.amountCents ?? null}
                  currency={shopCurrency}
                  locale={locale}
                  copy={forgivingCopy(t)}
                />
              </FieldGrid>
              <p className="mt-3 text-sm text-muted">{t("settings.main.passThrough.clearHint")}</p>
              <SubmitButton
                pendingLabel={t("settings.main.passThrough.submitting")}
                className={buttonClass({ variant: "secondary", className: "mt-3" })}
              >
                {t("settings.main.passThrough.submit")}
              </SubmitButton>
            </form>
          </SettingsRow>
        ) : null}

        {/* A shop is listed by default and the box says so; unticking it drops the shop out of
          sitemap.xml *and* makes its public pages emit robots: noindex
          (ADR 20260813-search-listing-is-a-choice). */}
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
      </InsetGroup>
    </SettingsGroup>
  );
}
