import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { ChoiceRow, controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { MAX_DIVERS_PER_DIVEMASTER, MIN_DIVERS_PER_DIVEMASTER } from "@/lib/divemaster-ratio";
import { saveCrewScheduleAction } from "../../actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { SectionNotice, SettingsGroup, type SettingsView, TEAM_GROUP } from "./kit";

/** The Team group: the door to the team page, and whether the shop plans its crew. */
export function TeamGroup({ view, canManageTeam }: { view: SettingsView; canManageTeam: boolean }) {
  const { shop, shopSlug, t, banner, activeSection } = view;
  // The target rides on the row while the switch is on: a hub row states what
  // it holds, and a target nobody can see without opening the row is a target
  // nobody remembers they set. Off, there is nothing it is measured against.
  const crewScheduleValue = shop.crewScheduleEnabled ? (
    <FactLine
      facts={[
        t("settings.main.crewSchedule.on"),
        t("boats.diversPerDivemasterValue", { ratio: shop.diversPerDivemaster }),
      ]}
    />
  ) : (
    t("settings.main.crewSchedule.off")
  );
  return (
    <SettingsGroup group={TEAM_GROUP} label={t(TEAM_GROUP.labelKey)}>
      <InsetGroup>
        {/* An owner opening Settings to add a colleague used to find no
          door to Team anywhere on this page — only the nav's "Set up"
          menu and ⌘K knew it existed. */}
        {canManageTeam ? (
          <SettingsDoorRow
            href={`/shop/${shopSlug}/settings/team`}
            heading={t("settings.main.team.heading")}
          />
        ) : null}
        {/* **Off for a new shop** (ADR 20261005-crew-schedule-is-a-setting):
            a shop where the owner skippers every boat keeps no roster,
            and the Crew view, the crew line on the week and every "No
            crew" nudge would be noise to it. */}
        <SettingsRow
          heading={t("settings.main.crewSchedule.heading")}
          value={crewScheduleValue}
          sectionId="crewSchedule"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="crewSchedule" active={activeSection} />
          <FieldGrid as="form" action={saveCrewScheduleAction} columns={1} className="mt-4">
            <ChoiceRow
              name="crewScheduleEnabled"
              type="checkbox"
              defaultChecked={shop.crewScheduleEnabled}
              className="text-sm"
            >
              <span className="block font-medium">{t("settings.main.crewSchedule.label")}</span>
              <span className="block text-xs text-muted">
                {t("settings.main.crewSchedule.description")}
              </span>
            </ChoiceRow>
            {/* Beside the switch, because only a shop that plans its crew
              is ever measured against it (`shopCrewTarget`). */}
            <Field
              label={t("boats.diversPerDivemasterLabel")}
              hint={t("boats.diversPerDivemasterHint")}
              className="mt-2"
            >
              <input
                name="diversPerDivemaster"
                type="number"
                inputMode="numeric"
                min={MIN_DIVERS_PER_DIVEMASTER}
                max={MAX_DIVERS_PER_DIVEMASTER}
                defaultValue={shop.diversPerDivemaster}
                className={controlClass}
              />
            </Field>
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.crewSchedule.saving")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.crewSchedule.save")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </SettingsRow>
      </InsetGroup>
    </SettingsGroup>
  );
}
