import { Fragment } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import type { listSiteBottomTimeOverrides } from "@/db/dive-sites";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import {
  DOCK_DAY_FIELDS,
  DOCK_DAY_LIMITS,
  type DockDayStep,
  dockDayOffsets,
} from "@/lib/diver-planning";
import { EMERGENCY_LINE_SLOTS } from "@/lib/emergency-reference";
import { saveDockDayRhythmAction, saveEmergencyReferenceAction } from "../../actions";
import type { SettingsShop } from "../groups/kit";

/*
 * **The emergency reference and the dock-day rhythm**, the two Boats & sites
 * editors that were rows on the settings hub and are pages of their own now
 * (`/settings/emergency-reference`, `/settings/dock-day`, #1854). The markup
 * is the rows' own, unchanged; only where it renders moved.
 */

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

/** The numbers a crew dials during, and the plan (issue #688). */
export function EmergencyReferenceForm({
  shop,
  t,
  className = "",
}: {
  shop: SettingsShop;
  t: StaffTranslator;
  className?: string;
}) {
  return (
    <form
      action={saveEmergencyReferenceAction}
      className={`flex flex-col gap-4 ${className}`.trim()}
    >
      <FieldGrid columns={2}>
        {EMERGENCY_LINE_SLOTS.map((slot, index) => (
          <Fragment key={slot}>
            {/* The examples are the first line's description, which
                wraps: as every label box's placeholder they were cut
                mid-word in a half-width box (K-583). */}
            <Field
              label={t("settings.main.emergency.lineLabel", { n: index + 1 })}
              description={index === 0 ? t("settings.main.emergency.lineExamples") : undefined}
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
  );
}

/**
 * The six numbers of the dock day, one save, and the beats they produce
 * beneath, with the sites that override the shop-wide bottom time.
 */
export function DockDayForm({
  shop,
  shopSlug,
  t,
  siteBottomTimeOverrides,
}: {
  shop: SettingsShop;
  shopSlug: string;
  t: StaffTranslator;
  siteBottomTimeOverrides: Awaited<ReturnType<typeof listSiteBottomTimeOverrides>>;
}) {
  return (
    <>
      <FieldGrid as="form" action={saveDockDayRhythmAction} columns={2}>
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
    </>
  );
}
