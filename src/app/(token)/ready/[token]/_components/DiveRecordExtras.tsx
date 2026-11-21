import Image from "next/image";
import { DiveProfileChart } from "@/components/DiveProfileChart";
import { groupLabelClass } from "@/components/ui/group-label";
import type { AfterStateProps } from "@/features/after-the-dive/recap-after-state";
import { depthText, temperatureText } from "@/i18n/unit-labels";
import { AFTER_STATE_TEST_IDS } from "./after-state-test-ids";

/**
 * **The boat's photos, as the top of the keepsake**: the first three of what the diver's recap holds
 * (their own, the crew's, and what other divers shared with the boat), one large and two beside it.
 * The full set, and the door to add more, stays in the photos row below; this is only the cover.
 */
export function RecordPhotoStrip({
  t,
  photos,
  tripTitle,
}: Pick<AfterStateProps, "t" | "photos"> & { tripTitle: string }) {
  const shown = photos.slice(0, 3);
  if (shown.length === 0) return null;
  const [lead, ...rest] = shown;
  if (!lead) return null;
  const alt = (caption: string | null) => caption ?? t("recap.photoAlt", { trip: tripTitle });
  return (
    <div
      data-testid={AFTER_STATE_TEST_IDS.photoStrip}
      className={
        rest.length === 0
          ? "grid grid-cols-1"
          : rest.length === 1
            ? "grid grid-cols-2 gap-px"
            : "grid grid-cols-3 grid-rows-2 gap-px"
      }
    >
      <div
        className={`relative ${rest.length === 2 ? "col-span-2 row-span-2" : ""} ${rest.length === 0 ? "aspect-[16/9]" : "aspect-[4/3]"}`}
      >
        <Image
          src={lead.imageUrl}
          alt={alt(lead.caption)}
          fill
          sizes="(min-width: 640px) 528px, 100vw"
          className="object-cover"
        />
      </div>
      {rest.map((photo) => (
        <div key={photo.id} className="relative aspect-[4/3]">
          <Image
            src={photo.imageUrl}
            alt={alt(photo.caption)}
            fill
            sizes="(min-width: 640px) 176px, 34vw"
            className="object-cover"
          />
        </div>
      ))}
    </div>
  );
}

/**
 * **What the diver's own computer logged that day** — depth over time and the facts beside it, one
 * block per recording. Only from a file a staff member imported for this person; nothing here is
 * drawn without a recording behind it, and a recording with no profile shows its facts alone. It is
 * the diver's evidence, never the shop's record, so it carries no claim on the logbook sheet and is
 * not on it (`DiveRecord`'s doc comment).
 */
export function RecordComputerDives({
  t,
  shop,
  computerDives,
}: Pick<AfterStateProps, "t" | "shop" | "computerDives">) {
  if (computerDives.length === 0) return null;
  const feet = shop.depthUnit === "feet";
  const heading = t("recap.profile.heading");
  return (
    <section
      data-testid={AFTER_STATE_TEST_IDS.computerDives}
      aria-label={heading}
      className="mt-8 space-y-6 rounded-panel border border-border bg-surface p-5 sm:p-6"
    >
      <div>
        <h2 className={groupLabelClass()}>{heading}</h2>
        <p className="mt-2 text-sm text-muted">{t("recap.profile.unlinked")}</p>
      </div>
      {computerDives.map((dive, index) => {
        const minutes =
          dive.durationSeconds === null ? null : Math.max(1, Math.round(dive.durationSeconds / 60));
        const facts = [
          dive.maxMeters !== null
            ? [t("recap.profile.maxDepth"), depthText(t, dive.maxMeters, shop.depthUnit)]
            : null,
          dive.averageMeters !== null
            ? [t("recap.profile.avgDepth"), depthText(t, dive.averageMeters, shop.depthUnit)]
            : null,
          minutes !== null
            ? [t("recap.profile.diveTime"), t("recap.profile.minutesValue", { minutes })]
            : null,
          dive.coldestC !== null
            ? [t("recap.profile.coldest"), temperatureText(t, dive.coldestC, shop.temperatureUnit)]
            : null,
        ].filter((fact): fact is string[] => fact !== null);
        return (
          <section
            // A day holds a handful of recordings in file order; the index is their identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={index}
            aria-label={dive.recordedAt}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className={groupLabelClass()}>{dive.recordedAt}</h3>
              {dive.device ? <p className="text-xs text-muted">{dive.device}</p> : null}
            </div>
            {facts.length > 0 ? (
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="mt-0.5 text-base font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {dive.samples.length > 1 && dive.maxMeters !== null ? (
              <DiveProfileChart
                samples={dive.samples}
                unit={feet ? "ft" : "m"}
                className="mt-3 h-auto w-full"
                labels={{
                  stop: (stopMinutes) => t("recap.profile.stop", { minutes: stopMinutes }),
                  max: t("recap.profile.max", {
                    depth: depthText(t, dive.maxMeters, shop.depthUnit),
                  }),
                  minutes: t("recap.profile.axisMinutes"),
                }}
              />
            ) : null}
          </section>
        );
      })}
    </section>
  );
}
