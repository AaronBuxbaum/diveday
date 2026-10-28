import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { TimezoneOptions, type TimezoneZoneLabels } from "@/components/TimezoneOptions";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import type { stripeCurrencyMismatch } from "@/db/stripe-accounts";
import { currencyOptions } from "@/i18n/currency-labels";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import { toShopCurrency } from "@/lib/money";
import {
  type CuratedTimeZone,
  type CuratedTimezoneGroupKey,
  DEFAULT_TIMEZONE,
} from "@/lib/timezones";
import { AddressSearch } from "../../AddressSearch";
import {
  saveJuniorBuddyPolicyAction,
  saveTimezoneAction,
  saveUnitsAction,
} from "../../shop-actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { SectionNotice, SettingsGroup, type SettingsView, SHOP_GROUP } from "./kit";
import { searchListingRow, seasonRow } from "./shop-rows";

/**
 * The words for the timezone picker's structure. `src/lib/timezones.ts` hands
 * back zone ids and group keys — data with no language in it — and this is
 * where those become headings, the same division every other domain-layer code
 * in this file goes through. Sign-up has its own copy of this map against the
 * *diver* bundle (src/app/onboard/page.tsx): the two pages speak to different
 * audiences, and the structure they share lives in `TimezoneOptions`.
 */
const TIMEZONE_GROUP_KEYS: Record<CuratedTimezoneGroupKey | "allZones", StaffMessageKey> = {
  americas: "settings.main.timezone.groups.americas",
  caribbean: "settings.main.timezone.groups.caribbean",
  europeRedSea: "settings.main.timezone.groups.europeRedSea",
  asiaPacific: "settings.main.timezone.groups.asiaPacific",
  allZones: "settings.main.timezone.groups.allZones",
};

/**
 * A curated zone's label — how a shop owner names the place rather than how
 * IANA does ("Cancún / Cozumel", not "America/Cancun"). Only the pinned
 * shortcuts get one; every other zone reads as its own id, which needs no
 * translation and cannot drift from what gets stored.
 */
const CURATED_TIMEZONE_KEYS: Record<CuratedTimeZone, StaffMessageKey> = {
  "America/New_York": "settings.main.timezone.zones.eastern",
  "America/Chicago": "settings.main.timezone.zones.central",
  "America/Denver": "settings.main.timezone.zones.mountain",
  "America/Los_Angeles": "settings.main.timezone.zones.pacific",
  "Pacific/Honolulu": "settings.main.timezone.zones.hawaii",
  "America/Cancun": "settings.main.timezone.zones.cancun",
  "America/Belize": "settings.main.timezone.zones.belize",
  "America/Tegucigalpa": "settings.main.timezone.zones.roatan",
  "America/Cayman": "settings.main.timezone.zones.cayman",
  "America/Nassau": "settings.main.timezone.zones.nassau",
  "America/Puerto_Rico": "settings.main.timezone.zones.puertoRico",
  "America/Curacao": "settings.main.timezone.zones.bonaire",
  "Europe/London": "settings.main.timezone.zones.london",
  "Africa/Cairo": "settings.main.timezone.zones.cairo",
  "Indian/Maldives": "settings.main.timezone.zones.maldives",
  "Asia/Bangkok": "settings.main.timezone.zones.bangkok",
  "Asia/Jakarta": "settings.main.timezone.zones.jakarta",
  "Asia/Singapore": "settings.main.timezone.zones.singapore",
  "Asia/Makassar": "settings.main.timezone.zones.bali",
  "Asia/Manila": "settings.main.timezone.zones.manila",
  "Pacific/Palau": "settings.main.timezone.zones.palau",
  "Pacific/Fiji": "settings.main.timezone.zones.fiji",
  "Australia/Sydney": "settings.main.timezone.zones.sydney",
  "Pacific/Auckland": "settings.main.timezone.zones.auckland",
};

/**
 * The Shop group: the timezone every date is read through, the units a shop
 * reads its own numbers in, and where it is, then the season, the diving
 * options and the search listing (once "Rarely changed", issue #2813), and the
 * doors to the shop's registers. The contact row is Messages'.
 */
export function ShopGroup({
  view,
  canPayments,
  hasPricedRecords,
  currencyMismatch,
  addressLookupEnabled,
  boatsWithoutRadioIdentity,
}: {
  view: SettingsView;
  canPayments: boolean;
  hasPricedRecords: boolean;
  currencyMismatch: ReturnType<typeof stripeCurrencyMismatch>;
  addressLookupEnabled: boolean;
  /** Live boats with neither a call sign nor an MMSI (review B1), named on the fleet's door. */
  boatsWithoutRadioIdentity: number;
}) {
  const { shop, shopSlug, t, locale, banner, activeSection, notSet } = view;
  const shopCurrency = toShopCurrency(shop.currency);
  const zoneId = shop.timezone || DEFAULT_TIMEZONE;
  const timezoneValue =
    zoneId in CURATED_TIMEZONE_KEYS ? t(CURATED_TIMEZONE_KEYS[zoneId as CuratedTimeZone]) : zoneId;
  // A row that states several facts does it through `FactLine`, so a line
  // wraps only between facts (K-235).
  const addressValue =
    [shop.addressStreet, shop.addressLocality].filter(Boolean).join(", ") || notSet;
  const unitsValue = (
    <FactLine
      facts={[
        t(shop.depthUnit === "feet" ? "settings.main.units.feet" : "settings.main.units.meters"),
        t(
          shop.temperatureUnit === "fahrenheit"
            ? "settings.main.units.fahrenheit"
            : "settings.main.units.celsius",
        ),
        shopCurrency.toUpperCase(),
      ]}
    />
  );
  return (
    <SettingsGroup group={SHOP_GROUP} label={t(SHOP_GROUP.labelKey)}>
      <InsetGroup>
        {/* First editable row, because it is the setting every other date
          and time on every surface is read through — the board's day
          headers, "sailing today", a departure's 08:30. Sign-up asked once
          and nothing could change it afterwards, so a shop that clicked
          past the picker read its own schedule in US Eastern forever.

          Every "Save" submit on this page renders `secondary`, not the
          default primary — this is a settings hub (docs/design/forms-and-
          controls.md, "Settings hubs are the one place..."), so only the
          Stripe "Connect"/"Reconnect" CTA below keeps primary weight. */}
        <SettingsRow
          heading={t("settings.main.timezone.heading")}
          value={timezoneValue}
          detail={t("settings.main.timezone.detail")}
          sectionId="timezone"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="timezone" active={activeSection} />
          <FieldGrid as="form" action={saveTimezoneAction} columns={1} className="mt-4">
            <Field label={t("settings.main.timezone.label")}>
              {/* No device detection here, unlike sign-up: a stored zone is
                an answer somebody already gave, and the whole point of this
                row is to change it deliberately. */}
              <select
                name="timezone"
                required
                defaultValue={shop.timezone || DEFAULT_TIMEZONE}
                className={controlClass}
              >
                <TimezoneOptions
                  selected={shop.timezone || DEFAULT_TIMEZONE}
                  groupLabels={{
                    americas: t(TIMEZONE_GROUP_KEYS.americas),
                    caribbean: t(TIMEZONE_GROUP_KEYS.caribbean),
                    europeRedSea: t(TIMEZONE_GROUP_KEYS.europeRedSea),
                    asiaPacific: t(TIMEZONE_GROUP_KEYS.asiaPacific),
                    allZones: t(TIMEZONE_GROUP_KEYS.allZones),
                  }}
                  zoneLabels={
                    Object.fromEntries(
                      Object.entries(CURATED_TIMEZONE_KEYS).map(([zone, key]) => [zone, t(key)]),
                    ) as TimezoneZoneLabels
                  }
                />
              </select>
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.timezone.submitting")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.timezone.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </SettingsRow>

        {/* One row for the three units a shop reads its own numbers in.
          Depth stays stored in metres and water temperature in Celsius
          whatever these say (H-08); currency is the one that reinterprets
          rather than converts, which is what its own marker explains. The
          three are genuinely independent — a Caribbean operator serving
          American divers publishes feet and Celsius — so they are three
          fields, not one. */}
        <SettingsRow
          heading={t("settings.main.units.heading")}
          value={unitsValue}
          sectionId="units"
          activeSection={activeSection}
          // The setup checklist's currency-and-depth step links to
          // `settings#units`, and for as long as this row carried neither
          // of these that link did **nothing**: the page loaded at the top
          // with the row still shut, leaving a brand-new shop to hunt for
          // the one setting it had just been sent to answer. The row is a
          // `<details>`, so a fragment only reveals it when the target is
          // *inside* it (`anchorId`) or `AutoOpenDetails` opens it on a
          // client navigation (`openOnHash`) — which is why the three rows
          // that already had deep links have both.
        >
          <SectionNotice banner={banner} section="units" active={activeSection} />
          {/* What Stripe reports for the connected account is advisory, so a
          disagreement is surfaced rather than silently resolved either way
          (ADR 20260731-shop-currency). Stripe refuses a session in a currency
          the account can't settle, so this is the difference between a
          warning here and a failed checkout later. */}
          {currencyMismatch ? (
            <div className="mt-4">
              <ShopNotice tone="warning" role="status">
                {t("settings.main.units.currencyMismatch", {
                  shopCurrency: currencyMismatch.shopCurrency.toUpperCase(),
                  accountCurrency: currencyMismatch.accountCurrency.toUpperCase(),
                })}
              </ShopNotice>
            </div>
          ) : null}
          <FieldGrid as="form" action={saveUnitsAction} columns={2} className="mt-4">
            {/* The explanations render as plain helper text, not InfoHint
              buttons — inside an open disclosure the reader has already
              asked for detail, and three ⓘ controls hiding three facts
              fail remove-until-it-breaks. */}
            <Field label={t("settings.main.units.depthLabel")}>
              <select name="depthUnit" defaultValue={shop.depthUnit} className={controlClass}>
                <option value="meters">{t("settings.main.units.meters")}</option>
                <option value="feet">{t("settings.main.units.feet")}</option>
              </select>
            </Field>
            <Field label={t("settings.main.units.temperatureLabel")}>
              <select
                name="temperatureUnit"
                defaultValue={shop.temperatureUnit}
                className={controlClass}
              >
                <option value="celsius">{t("settings.main.units.celsius")}</option>
                <option value="fahrenheit">{t("settings.main.units.fahrenheit")}</option>
              </select>
            </Field>
            {/* Owner/manager only (H-14): this decides what a diver's card is
            charged in. Hiding it is convenience — `saveUnitsAction` re-checks
            the gate against live roles for any submission that carries the
            field anyway. */}
            {canPayments ? (
              <Field label={t("settings.main.units.currencyLabel")}>
                <select
                  name="currency"
                  defaultValue={toShopCurrency(shop.currency)}
                  className={controlClass}
                >
                  {currencyOptions(locale).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {/* **What changing it will do**, and only once there is
                something for it to do it to. `price_cents` counts the
                *current* currency's minor unit and nothing converts on a
                switch, so a shop that priced a $95 trip and moves to pesos
                is left with a ninety-five peso trip (ADR
                20260731-shop-currency). Before any money exists the change
                is free, and saying this to a shop on its first afternoon
                would be noise (issue #712). Informs, never refuses: the
                shop that genuinely set the wrong currency needs that select
                to work.

                Outside the `<Field>`, not inside it: `Field`'s contract is
                a single control, and a second child makes it fall back to
                wrapping everything in the `<label>` — which folded this
                sentence into the select's accessible *name* and broke every
                `getByLabel("Charge and display in")` in the suite. */}
            {canPayments && hasPricedRecords ? (
              <p className="text-sm text-warning-strong sm:col-span-2">
                {t("settings.main.units.currencyRepricingWarning")}
              </p>
            ) : null}
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.units.submitting")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.units.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </SettingsRow>

        <SettingsRow
          heading={t("settings.main.juniorBuddy.heading")}
          value={t(
            shop.requireAdultBuddyForTeens
              ? "settings.main.juniorBuddy.required"
              : "settings.main.juniorBuddy.optional",
          )}
          detail={t("settings.main.juniorBuddy.detail")}
          sectionId="juniorBuddy"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="juniorBuddy" active={activeSection} />
          <FieldGrid as="form" action={saveJuniorBuddyPolicyAction} columns={1} className="mt-4">
            <Field label={t("settings.main.juniorBuddy.label")}>
              <select
                name="juniorBuddy"
                defaultValue={shop.requireAdultBuddyForTeens ? "required" : "optional"}
                className={controlClass}
              >
                <option value="optional">{t("settings.main.juniorBuddy.optional")}</option>
                <option value="required">{t("settings.main.juniorBuddy.required")}</option>
              </select>
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.juniorBuddy.saving")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.juniorBuddy.save")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </SettingsRow>

        {/* One search box, no Save: picking a place *is* the save (ADR
          20260811-address-is-one-search-box). The five free-text boxes that
          used to sit under the lookup are gone — they were the source of
          every mangled address the lookup was introduced to prevent. */}
        <SettingsRow
          heading={t("settings.main.address.heading")}
          value={addressValue}
          detail={t("settings.main.address.detail")}
          sectionId="address"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="address" active={activeSection} />
          <AddressSearch
            initial={{
              addressStreet: shop.addressStreet ?? "",
              addressLocality: shop.addressLocality ?? "",
              addressRegion: shop.addressRegion ?? "",
              addressPostalCode: shop.addressPostalCode ?? "",
              addressCountry: shop.addressCountry ?? "",
            }}
            // No geocoder credentials is the ordinary local and self-hosted
            // case: the card says so in a sentence rather than offering a box
            // that answers nothing (src/lib/address-lookup.ts).
            enabled={addressLookupEnabled}
            copy={{
              searchLabel: t("settings.main.address.searchLabel"),
              searchPlaceholder: t("settings.main.address.searchPlaceholder"),
              searching: t("settings.main.address.searching"),
              saving: t("settings.main.address.saving"),
              noMatches: t("settings.main.address.noMatches"),
              lookupFailed: t("settings.main.address.lookupFailed"),
              lookupResting: t("settings.main.address.lookupResting"),
              notConfigured: t("settings.main.address.notConfigured"),
              suggestionsLabel: t("settings.main.address.suggestionsLabel"),
              currentLabel: t("settings.main.address.currentLabel"),
              noneSet: t("settings.main.address.noneSet"),
              removeLabel: t("settings.main.address.remove"),
              removing: t("settings.main.address.removing"),
            }}
          />
        </SettingsRow>

        {seasonRow(view)}

        {searchListingRow(view)}

        {/* **Not gated on boat diving.** A shore operation's crew needs a chamber number exactly as much as a
            boat's does. Its own row rather than a line inside another
            because it is the one thing on this page a crew reads when
            something has gone wrong (issue #688). */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/emergency-reference`}
          heading={t("settings.main.emergency.heading")}
        />

        {/* **The registers are doors, not settings** (glossary "Register and
            setting", issue #2659): each is a table of the shop's things that a
            departure points at, at its own address beside gear, with a
            permission of its own. Settings links to them and holds none. A
            shore-and-pool shop has no hulls to name, so the fleet's door is
            gone rather than empty. */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/dive-sites`}
          heading={t("settings.main.diveSites.heading")}
        />

        {shop.hasBoatDiving ? (
          <SettingsDoorRow
            href={`/shop/${shopSlug}/boats`}
            heading={t("boats.heading")}
            note={
              boatsWithoutRadioIdentity > 0
                ? t("boats.radioIdentityMissing", { count: boatsWithoutRadioIdentity })
                : undefined
            }
          />
        ) : null}

        <SettingsDoorRow href={`/shop/${shopSlug}/trip-tags`} heading={t("lenses.heading")} />

        <SettingsDoorRow
          href={`/shop/${shopSlug}/safety-checklist`}
          heading={t("settings.main.safetyChecklist.heading")}
        />
      </InsetGroup>
    </SettingsGroup>
  );
}
