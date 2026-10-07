import { Fragment } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FactLine } from "@/components/ui/FactLine";
import {
  ChoiceRow,
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import { InsetGroup } from "@/components/ui/ledger";
import type { AppDb } from "@/db/client";
import { listSiteBottomTimeOverrides } from "@/db/dive-sites";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import {
  DOCK_DAY_FIELDS,
  DOCK_DAY_LIMITS,
  type DockDayStep,
  dockDayOffsets,
} from "@/lib/diver-planning";
import { EMERGENCY_LINE_SLOTS, hasEmergencyReference } from "@/lib/emergency-reference";
import {
  saveDivingOptionsAction,
  saveDockDayRhythmAction,
  saveEmergencyReferenceAction,
} from "../../actions";
import { SettingsDoorRow, SettingsRow } from "../SettingsRows";
import { BOATS_SITES_GROUP, SectionNotice, SettingsGroup, type SettingsView } from "./kit";

/**
 * Staff words for the beats of the dock day these fields produce. The
 * diver-facing page names the same steps from `diver.json`; these are the staff
 * bundle's own, because a shop owner configuring the rhythm and a diver reading
 * it are two different readers. Typed against `DockDayStep`, so a new beat is a
 * compile error here until it has a word — `return` included, even though the
 * preview stops before it, because a trip's return time is the trip's to state.
 */
const DOCK_DAY_STEP_KEYS: Record<DockDayStep, StaffMessageKey> = {
  arrive: "settings.main.dockCall.stepArrive",
  gearSetup: "settings.main.dockCall.stepGearSetup",
  briefing: "settings.main.dockCall.stepBriefing",
  departure: "settings.main.dockCall.stepDeparture",
  boatRide: "settings.main.dockCall.stepBoatRide",
  dive: "settings.main.dockCall.stepDive",
  surfaceInterval: "settings.main.dockCall.stepSurfaceInterval",
  return: "settings.main.dockCall.stepReturn",
};

/**
 * The rhythm's six fields, in the order they are read and edited: what a shop
 * does at the dock, then what the day looks like once the lines are off. One
 * row per field rather than six hand-written `<Field>`s, so the bounds always
 * come from `DOCK_DAY_LIMITS` — the same table the server action refuses
 * against and the same the table's CHECK constraints enforce.
 */
const DOCK_DAY_FIELD_KEYS: Record<
  (typeof DOCK_DAY_FIELDS)[number],
  { label: StaffMessageKey; description: StaffMessageKey }
> = {
  dockCallMinutes: {
    label: "settings.main.dockCall.dockCallLabel",
    description: "settings.main.dockCall.dockCallDescription",
  },
  gearSetupMinutes: {
    label: "settings.main.dockCall.gearSetupLabel",
    description: "settings.main.dockCall.gearSetupDescription",
  },
  briefingMinutes: {
    label: "settings.main.dockCall.briefingLabel",
    description: "settings.main.dockCall.briefingDescription",
  },
  boatRideMinutes: {
    label: "settings.main.dockCall.boatRideLabel",
    description: "settings.main.dockCall.boatRideDescription",
  },
  bottomTimeMinutes: {
    label: "settings.main.dockCall.bottomTimeLabel",
    description: "settings.main.dockCall.bottomTimeDescription",
  },
  surfaceIntervalMinutes: {
    label: "settings.main.dockCall.surfaceIntervalLabel",
    description: "settings.main.dockCall.surfaceIntervalDescription",
  },
};

/**
 * The Boats & sites group. Async: the dock-day preview reads which sites
 * override the shop-wide bottom time, so the group streams under its own
 * `<Suspense>` instead of holding the whole hub.
 */
export async function BoatsSitesGroup({ view, db }: { view: SettingsView; db: AppDb }) {
  const { shop, shopSlug, t, banner, activeSection } = view;
  // A site carrying its own `expectedBottomTimeMinutes` overrides the
  // shop-wide figure for any dive that visits it, and the preview is drawn
  // from the shop-wide figure alone. Empty for a shop that has overridden
  // nothing, and then the preview says nothing extra.
  const siteBottomTimeOverrides = await listSiteBottomTimeOverrides(db, shop.id);
  const divingOptionsValue = (
    <FactLine
      facts={[
        shop.hasBoatDiving ? t("boats.boatEnabled") : t("boats.boatDisabled"),
        shop.hasShoreDiving ? t("boats.shoreEnabled") : t("boats.shoreDisabled"),
        shop.hasPoolDiving ? t("boats.poolEnabled") : t("boats.poolDisabled"),
      ]}
    />
  );
  // A count, not the numbers themselves: this row is read on the hub and the
  // numbers belong on the boat, not on a settings list somebody is scrolling.
  const emergencyValue = hasEmergencyReference(shop.emergencyReference)
    ? t("settings.main.emergency.value", { count: shop.emergencyReference.lines.length })
    : t("settings.main.emergency.empty");
  const dockCallValue = t("settings.main.dockCall.value", { count: shop.dockCallMinutes });
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
        <SettingsRow
          heading={t("settings.main.emergency.heading")}
          value={emergencyValue}
          // The row's description, where every row's first body line sits:
          // as a `<p>` inside the `mt-4` form it sat 16px lower (K-437).
          description={t("settings.main.emergency.intro")}
          sectionId="emergency"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="emergency" active={activeSection} />
          <form action={saveEmergencyReferenceAction} className="mt-4 flex flex-col gap-4">
            <FieldGrid columns={2}>
              {EMERGENCY_LINE_SLOTS.map((slot, index) => (
                <Fragment key={slot}>
                  {/* The examples are the first line's description, which
                      wraps: as every label box's placeholder they were cut
                      mid-word in a half-width box (K-583). */}
                  <Field
                    label={t("settings.main.emergency.lineLabel", { n: index + 1 })}
                    description={
                      index === 0 ? t("settings.main.emergency.lineExamples") : undefined
                    }
                  >
                    <input
                      name={`emergencyLabel-${index}`}
                      type="text"
                      maxLength={80}
                      defaultValue={shop.emergencyReference.lines[index]?.label ?? ""}
                      className={controlClass}
                    />
                  </Field>
                  <Field label={t("settings.main.emergency.phoneLabel", { n: index + 1 })}>
                    <input
                      name={`emergencyPhone-${index}`}
                      type="tel"
                      maxLength={40}
                      defaultValue={shop.emergencyReference.lines[index]?.phone ?? ""}
                      className={controlClass}
                    />
                  </Field>
                </Fragment>
              ))}
              <Field label={t("settings.main.emergency.vesselLabel")}>
                <input
                  name="emergencyVessel"
                  type="text"
                  maxLength={120}
                  defaultValue={shop.emergencyReference.vessel}
                  className={controlClass}
                />
              </Field>
              <Field label={t("settings.main.emergency.shoreContactLabel")}>
                <input
                  name="emergencyShoreContact"
                  type="text"
                  maxLength={160}
                  defaultValue={shop.emergencyReference.shoreContact}
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
            <Field label={t("settings.main.emergency.planLabel")}>
              <textarea
                name="emergencyPlan"
                rows={4}
                maxLength={2000}
                defaultValue={shop.emergencyReference.plan}
                className={textareaClassFor(4)}
              />
            </Field>
            {/* The hub's one Save: `md` in `FieldActions`. It was `sm` in
                a bare div, 44px beside every other row's 48px (K-308). */}
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.emergency.saving")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.emergency.submit")}
              </SubmitButton>
            </FieldActions>
          </form>
        </SettingsRow>

        <SettingsRow
          heading={t("settings.main.dockCall.heading")}
          value={dockCallValue}
          description={t("settings.main.dockCall.description")}
          sectionId="dockCall"
          activeSection={activeSection}
        >
          <SectionNotice banner={banner} section="dockCall" active={activeSection} />
          {/* Six numbers, one save. The day used to come out of the single
            arrival-call box below: the briefing was half of it capped at
            15, and the two beats on the water were the trip window's own
            thirds — so a shop that briefs on the boat, kits up on board,
            walks in off a beach, or runs one tank had no way to say so and
            read DiveDay telling their divers a day they don't run. Each
            field states what zero means where zero is meaningful, because
            "0" is how a shop says "we don't do that one". */}
          <FieldGrid as="form" action={saveDockDayRhythmAction} columns={2} className="mt-4">
            {DOCK_DAY_FIELDS.map((field) => (
              <Field
                key={field}
                label={t(DOCK_DAY_FIELD_KEYS[field].label)}
                description={t(DOCK_DAY_FIELD_KEYS[field].description)}
              >
                <input
                  name={field}
                  type="number"
                  inputMode="numeric"
                  required
                  min={DOCK_DAY_LIMITS[field].min}
                  max={DOCK_DAY_LIMITS[field].max}
                  step={5}
                  defaultValue={shop[field]}
                  className={`${controlClass} tabular-nums`}
                />
              </Field>
            ))}
            <FieldActions>
              <SubmitButton
                pendingLabel={t("settings.main.dockCall.submitting")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("settings.main.dockCall.submit")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
          {/* The answer to "where do I set the dock-day rhythm?" — which used
            to be nowhere a reader could see. Showing the beats the fields
            produce, as offsets from departure, is what makes the form and
            the diver-facing timeline visibly the same thing. Offsets, not
            clock times: this row is about every departure, not one — which
            is also why it stops at the last dive rather than inventing a
            return, since each trip publishes its own. Two dives, because
            that is what most of this catalogue is; a departure's own
            planned count is what the diver's page lays out.

            One beat per line on a phone and the strip from `sm` up: a
            greedy wrap at 390 put two beats on the third of six lines
            and one on every other (K-585). */}
          <dl className="mt-5 grid gap-y-1 text-sm text-muted sm:flex sm:flex-wrap sm:gap-x-6">
            {dockDayOffsets(shop).map(({ step, number, minutesFromDeparture }) => (
              <div key={`${step}-${number ?? 0}`} className="flex items-baseline gap-2">
                <dt>{t(DOCK_DAY_STEP_KEYS[step], { number: number ?? 1 })}</dt>
                <dd className="font-medium text-foreground tabular-nums">
                  {minutesFromDeparture === 0
                    ? t("settings.main.dockCall.atDeparture")
                    : minutesFromDeparture < 0
                      ? t("settings.main.dockCall.minutesBefore", {
                          count: -minutesFromDeparture,
                        })
                      : t("settings.main.dockCall.minutesAfter", {
                          count: minutesFromDeparture,
                        })}
                </dd>
              </div>
            ))}
          </dl>
          {/* The preview above describes every departure except the ones it
            doesn't. A site with its own `expected_bottom_time_minutes`
            overrides "Time in the water per dive" for any dive that visits
            it, and until this line the number could be read nowhere but the
            box that wrote it — a shop that overrode five of its eight sites
            read a preview silently wrong for five of them
            (FU-20260812-site-bottom-time-is-write-only). Each site is a
            link, because the answer to "why does that one differ?" is the
            site's own page. A shop that has overridden nothing sees
            nothing. */}
          {siteBottomTimeOverrides.length > 0 ? (
            <div className="mt-3">
              <p className="text-sm text-muted">
                {t("settings.main.dockCall.siteOverrides", {
                  count: siteBottomTimeOverrides.length,
                })}
              </p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {siteBottomTimeOverrides.map((site) => (
                  <li key={site.id}>
                    <a
                      href={`/shop/${shopSlug}/dive-sites/${site.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {t("settings.main.dockCall.siteOverride", {
                        name: site.name,
                        count: site.minutes,
                      })}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
      </InsetGroup>
    </SettingsGroup>
  );
}
