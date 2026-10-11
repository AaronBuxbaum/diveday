import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { ChoiceRow, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { saveDivingOptionsAction } from "../../boat-actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { BOATS_SITES_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";

/**
 * The Boats & sites group. The emergency reference and the dock-day rhythm,
 * which were rows here, are pages of their own (#1854); the dock day's
 * site-override read went with it, so the group no longer reads anything.
 */
export function BoatsSitesGroup({ view }: { view: SettingsView }) {
  const { shop, shopSlug, t, banner, activeSection } = view;
  const divingOptionsValue = (
    <FactLine
      facts={[
        shop.hasBoatDiving ? t("boats.boatEnabled") : t("boats.boatDisabled"),
        shop.hasShoreDiving ? t("boats.shoreEnabled") : t("boats.shoreDisabled"),
        shop.hasPoolDiving ? t("boats.poolEnabled") : t("boats.poolDisabled"),
      ]}
    />
  );
  return (
    <SettingsGroup group={BOATS_SITES_GROUP} label={t(BOATS_SITES_GROUP.labelKey)}>
      <InsetGroup>
        {/* A shore-and-pool shop has no hulls to name, so the row is gone
            rather than empty — an empty control for a thing you do not own
            is a question you have to answer twice. Existing boat rows are
            left alone: turning the option back on brings the fleet back
            exactly as it was. */}
        {shop.hasBoatDiving ? (
          <SettingsDoorRow href={`/shop/${shopSlug}/settings/boats`} heading={t("boats.heading")} />
        ) : null}

        {/* A reference library the daily surfaces consume — the board's add
          panel reads the dive-site list. It left the header nav with the
          cut to a five-section nav; an owner's path to it is this page (and the
          palette). */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/dive-sites`}
          heading={t("settings.main.diveSites.heading")}
        />

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
                below and takes the hull out of the Requests planner.

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

        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/safety-checklist`}
          heading={t("settings.main.safetyChecklist.heading")}
        />

        {/* **Not gated on boat diving.** A shore operation's crew needs a chamber number exactly as much as a
            boat's does. Its own row rather than a line inside another
            because it is the one thing on this page a crew reads when
            something has gone wrong (issue #688). */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/emergency-reference`}
          heading={t("settings.main.emergency.heading")}
        />

        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/dock-day`}
          heading={t("settings.main.dockCall.heading")}
        />

        {/* **Trip tags** — ADR 20260904-reef-all-the-way-down, decision 2
          (issue #1162). The shop's own tags for its departures, which a
          diver then filters the public schedule by. Unconditional: a
          shore-diving shop with no hull still tags its departures, so
          this row carries no `hasBoatDiving` gate. */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/trip-tags`}
          heading={t("lenses.heading")}
        />
      </InsetGroup>
    </SettingsGroup>
  );
}
