import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { ExecutedDive } from "@/db/schema";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type DepthUnit, depthInUnit, maxEnteredDepth } from "@/lib/depth-units";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { utcToWallTime } from "@/lib/zoned";

function dateTimeValue(value: Date | null, timeZone: string) {
  if (!value) return "";
  const wall = utcToWallTime(value, timeZone);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

export function ExecutedDiveLog({
  planned,
  liveDiveSites,
  executed,
  action,
  t,
  timeZone,
  depthUnit,
  checkpoint,
}: {
  planned: ReadonlyArray<{ diveNumber: number; diveSite: { id: string; name: string } | null }>;
  liveDiveSites: ReadonlyArray<{ id: string; name: string }>;
  executed: ReadonlyArray<{
    executed: ExecutedDive;
    actualSite: { id: string; name: string } | null;
  }>;
  // i18n-exempt: TypeScript return type, not user-facing copy.
  action: (formData: FormData) => void | Promise<void>;
  t: StaffTranslator;
  timeZone: string;
  depthUnit: DepthUnit;
  checkpoint: RollCallCheckpoint;
}) {
  const byNumber = new Map(executed.map((row) => [row.executed.diveNumber, row]));
  const activeDiveNumber = Number(/^after_dive_(\d+)$/.exec(checkpoint)?.[1] ?? 0);
  return (
    <section className="mt-8" aria-labelledby="executed-dive-heading">
      <h2 id="executed-dive-heading" className="text-lg font-semibold">
        {t("manifest.executedDive.heading")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("manifest.executedDive.description")}</p>
      <div className="mt-4 space-y-4">
        {planned
          .filter(({ diveNumber }) => diveNumber === activeDiveNumber)
          .map(({ diveNumber, diveSite }) => {
            const row = byNumber.get(diveNumber);
            // A saved null means staff explicitly recorded that the actual
            // site was unknown; only a missing row gets the planned-site
            // default.
            const executedSite = row ? row.actualSite : diveSite;
            return (
              <form
                key={diveNumber}
                action={action}
                className={sectionCardClass({ padding: "md" })}
              >
                <input type="hidden" name="diveNumber" value={diveNumber} />
                <h3 className="font-semibold">
                  {t("manifest.executedDive.dive", { number: diveNumber })}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {t("manifest.executedDive.plannedSite", {
                    site: diveSite?.name ?? t("manifest.executedDive.unknown"),
                  })}
                </p>
                <FieldGrid columns={2} className="mt-4">
                  <Field label={t("manifest.executedDive.actualSite")}>
                    <select
                      name="actualSiteId"
                      defaultValue={executedSite?.id ?? ""}
                      className={controlClass}
                    >
                      <option value="">{t("manifest.executedDive.unknown")}</option>
                      {liveDiveSites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={t("manifest.executedDive.maxDepth", {
                      unit: depthUnit === "feet" ? "ft" : "m",
                    })}
                  >
                    <input
                      name="maxDepthMeters"
                      type="number"
                      min="0"
                      max={maxEnteredDepth(depthUnit)}
                      step="0.1"
                      defaultValue={
                        row?.executed.maxDepthMeters == null
                          ? ""
                          : depthInUnit(row.executed.maxDepthMeters, depthUnit)
                      }
                      className={`${controlClass} tabular-nums`}
                    />
                  </Field>
                  <Field label={t("manifest.executedDive.enteredAt")}>
                    <input
                      name="enteredAt"
                      type="datetime-local"
                      defaultValue={dateTimeValue(row?.executed.enteredAt ?? null, timeZone)}
                      className={controlClass}
                    />
                  </Field>
                  <Field label={t("manifest.executedDive.exitedAt")}>
                    <input
                      name="exitedAt"
                      type="datetime-local"
                      defaultValue={dateTimeValue(row?.executed.exitedAt ?? null, timeZone)}
                      className={controlClass}
                    />
                  </Field>
                  <Field label={t("manifest.executedDive.visibility")}>
                    <input
                      name="visibility"
                      defaultValue={String(row?.executed.observedConditions?.visibility ?? "")}
                      className={controlClass}
                    />
                  </Field>
                  <Field label={t("manifest.executedDive.current")}>
                    <input
                      name="current"
                      defaultValue={String(row?.executed.observedConditions?.current ?? "")}
                      className={controlClass}
                    />
                  </Field>
                </FieldGrid>
                <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
                  <input
                    name="notRecorded"
                    type="checkbox"
                    value="depth"
                    className="size-4 accent-primary"
                    defaultChecked={row?.executed.notRecorded.includes("depth")}
                  />
                  {t("manifest.executedDive.notRecordedDepth")}
                </label>
                <button type="submit" className={buttonClass({ size: "sm", className: "mt-4" })}>
                  {t("manifest.executedDive.save")}
                </button>
              </form>
            );
          })}
      </div>
    </section>
  );
}
