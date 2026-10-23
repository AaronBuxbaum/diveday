import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import { MAX_DIVERS_PER_DIVEMASTER, MIN_DIVERS_PER_DIVEMASTER } from "@/lib/divemaster-ratio";
import { saveCrewScheduleAction } from "../../team-actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { SectionNotice, SettingsGroup, type SettingsView, TEAM_GROUP } from "./kit";

/**
 * The Team group: the door to the team page, whether the shop plans its crew
 * (both for whoever may manage staff), and who did what (every hub reader).
 */
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
        {canManageTeam ? (
          /* **A shop setting** (ADR 20261005-crew-schedule-is-a-setting, on
             for a new shop since 2026-10-23): a shop where the owner skippers
             every boat turns it off, and the Crew view, the crew line on the
             week and every "No crew" nudge go with it. The switch is a row of
             the Features page (issue #2814); what stays here is the target it
             is measured against, and only a shop that plans its crew is. */
          <SettingsRow
            heading={t("settings.main.crewSchedule.heading")}
            value={crewScheduleValue}
            sectionId="crewSchedule"
            activeSection={activeSection}
          >
            <SectionNotice banner={banner} section="crewSchedule" active={activeSection} />
            {shop.crewScheduleEnabled ? (
              <FieldGrid as="form" action={saveCrewScheduleAction} columns={1} className="mt-4">
                <Field
                  label={t("boats.diversPerDivemasterLabel")}
                  hint={t("boats.diversPerDivemasterHint")}
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
            ) : (
              <p className="mt-4 text-sm">
                <Link
                  href={`/shop/${shopSlug}/settings/features#crewSchedule`}
                  className="font-medium text-primary hover:underline"
                >
                  {t("settings.main.crewSchedule.turnOn")}
                </Link>
              </p>
            )}
          </SettingsRow>
        ) : null}

        {/* Who did what, across the team (D5). The hub is already owner and
          manager reading, the log's own gate; the page re-checks it. It sat
          under Data, where nobody asking "who changed this?" looked. */}
        <SettingsDoorRow
          href={`/shop/${shopSlug}/settings/activity`}
          heading={t("activity.log.title")}
        />
      </InsetGroup>
    </SettingsGroup>
  );
}
