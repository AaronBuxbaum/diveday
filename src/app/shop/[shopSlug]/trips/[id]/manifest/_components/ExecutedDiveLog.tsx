"use client";

import { useActionState, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import type { ExecutedDive } from "@/db/schema";
import { type DepthUnit, depthInUnit, maxEnteredDepth } from "@/lib/depth-units";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { utcToWallTime } from "@/lib/zoned";
import type { ExecutedDiveResult } from "../actions";

function dateTimeValue(value: Date | null, timeZone: string) {
  if (!value) return "";
  const wall = utcToWallTime(value, timeZone);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/**
 * The words this surface needs, resolved on the server and handed down —
 * `staffTranslator` is server-side only, and this became a Client Component so
 * a refusal could be shown beside the form that caused it.
 */
export type ExecutedDiveLabels = {
  heading: string;
  description: string;
  actualSite: string;
  unknown: string;
  maxDepth: string;
  enteredAt: string;
  exitedAt: string;
  visibility: string;
  current: string;
  notRecordedDepth: string;
  save: string;
  saved: string;
  /** One per refusal `saveExecutedDiveAction` can return. */
  refusals: Record<Extract<ExecutedDiveResult, { status: "error" }>["reason"], string>;
};

/**
 * One dive's log, for the checkpoint the crew is standing at.
 *
 * **Every field is controlled, deliberately.** A refusal has to leave what the
 * divemaster typed exactly where it was — that is the whole harm this fixes
 * (issue #1018) — and an uncontrolled form is at the mercy of React's own
 * post-action form reset. Holding the values in state makes "nothing is lost"
 * a property of the component rather than a hope about the framework.
 */
export function ExecutedDiveLog({
  planned,
  liveDiveSites,
  executed,
  action,
  labels,
  timeZone,
  depthUnit,
  checkpoint,
}: {
  /**
   * `diveLabel` and `plannedSiteLabel` arrive already composed. Both interpolate
   * a runtime value, and a Server Component cannot hand a Client Component a
   * function to do it with — so the page resolves them per planned dive.
   */
  planned: ReadonlyArray<{
    diveNumber: number;
    diveSite: { id: string; name: string } | null;
    diveLabel: string;
    plannedSiteLabel: string;
  }>;
  liveDiveSites: ReadonlyArray<{ id: string; name: string }>;
  executed: ReadonlyArray<{
    executed: ExecutedDive;
    actualSite: { id: string; name: string } | null;
  }>;
  action: (
    previous: ExecutedDiveResult | undefined,
    formData: FormData,
  ) => Promise<ExecutedDiveResult>;
  labels: ExecutedDiveLabels;
  timeZone: string;
  depthUnit: DepthUnit;
  checkpoint: RollCallCheckpoint;
}) {
  const byNumber = new Map(executed.map((row) => [row.executed.diveNumber, row]));
  const activeDiveNumber = Number(/^after_dive_(\d+)$/.exec(checkpoint)?.[1] ?? 0);
  return (
    <section className="mt-8" aria-labelledby="executed-dive-heading">
      <h2 id="executed-dive-heading" className="text-lg font-semibold">
        {labels.heading}
      </h2>
      <p className="mt-1 text-sm text-muted">{labels.description}</p>
      <div className="mt-4 space-y-4">
        {planned
          .filter(({ diveNumber }) => diveNumber === activeDiveNumber)
          .map(({ diveNumber, diveSite, diveLabel, plannedSiteLabel }) => (
            <ExecutedDiveForm
              key={diveNumber}
              diveNumber={diveNumber}
              plannedSite={diveSite}
              diveLabel={diveLabel}
              plannedSiteLabel={plannedSiteLabel}
              row={byNumber.get(diveNumber)}
              liveDiveSites={liveDiveSites}
              action={action}
              labels={labels}
              timeZone={timeZone}
              depthUnit={depthUnit}
            />
          ))}
      </div>
    </section>
  );
}

function ExecutedDiveForm({
  diveNumber,
  plannedSite,
  diveLabel,
  plannedSiteLabel,
  row,
  liveDiveSites,
  action,
  labels,
  timeZone,
  depthUnit,
}: {
  diveNumber: number;
  plannedSite: { id: string; name: string } | null;
  diveLabel: string;
  plannedSiteLabel: string;
  row?: { executed: ExecutedDive; actualSite: { id: string; name: string } | null };
  liveDiveSites: ReadonlyArray<{ id: string; name: string }>;
  action: (
    previous: ExecutedDiveResult | undefined,
    formData: FormData,
  ) => Promise<ExecutedDiveResult>;
  labels: ExecutedDiveLabels;
  timeZone: string;
  depthUnit: DepthUnit;
}) {
  const [result, formAction] = useActionState(action, undefined);
  // A saved null means staff explicitly recorded that the actual site was
  // unknown; only a missing row gets the planned-site default.
  const executedSite = row ? row.actualSite : plannedSite;
  const [actualSiteId, setActualSiteId] = useState(executedSite?.id ?? "");
  const [maxDepth, setMaxDepth] = useState(
    row?.executed.maxDepthMeters == null
      ? ""
      : String(depthInUnit(row.executed.maxDepthMeters, depthUnit)),
  );
  const [enteredAt, setEnteredAt] = useState(
    dateTimeValue(row?.executed.enteredAt ?? null, timeZone),
  );
  const [exitedAt, setExitedAt] = useState(dateTimeValue(row?.executed.exitedAt ?? null, timeZone));
  const [visibility, setVisibility] = useState(
    String(row?.executed.observedConditions?.visibility ?? ""),
  );
  const [current, setCurrent] = useState(String(row?.executed.observedConditions?.current ?? ""));
  const [depthNotRecorded, setDepthNotRecorded] = useState(
    row?.executed.notRecorded.includes("depth") ?? false,
  );
  // The two times are what a transposition lands on, so the refusal is wired to
  // both fields as well as stated in the action row — `Field`'s `error` sets
  // `aria-invalid` and `aria-describedby` for a reader who never sees the row.
  const timesError = result?.status === "error" && result.reason === "times_transposed";
  const depthError = result?.status === "error" && result.reason === "depth_out_of_range";

  return (
    <form action={formAction} className={sectionCardClass({ padding: "md" })}>
      <input type="hidden" name="diveNumber" value={diveNumber} />
      <h3 className="font-semibold">{diveLabel}</h3>
      <p className="mt-1 text-sm text-muted">{plannedSiteLabel}</p>
      <FieldGrid columns={2} className="mt-4">
        <Field label={labels.actualSite}>
          <select
            name="actualSiteId"
            value={actualSiteId}
            onChange={(event) => setActualSiteId(event.target.value)}
            className={controlClass}
          >
            <option value="">{labels.unknown}</option>
            {liveDiveSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={labels.maxDepth}
          error={depthError ? labels.refusals.depth_out_of_range : undefined}
        >
          <input
            name="maxDepthMeters"
            type="number"
            min="0"
            max={maxEnteredDepth(depthUnit)}
            step="0.1"
            value={maxDepth}
            onChange={(event) => setMaxDepth(event.target.value)}
            className={`${controlClass} tabular-nums`}
          />
        </Field>
        <Field
          label={labels.enteredAt}
          error={timesError ? labels.refusals.times_transposed : undefined}
        >
          <input
            name="enteredAt"
            type="datetime-local"
            value={enteredAt}
            onChange={(event) => setEnteredAt(event.target.value)}
            className={controlClass}
          />
        </Field>
        <Field
          label={labels.exitedAt}
          error={timesError ? labels.refusals.times_transposed : undefined}
        >
          <input
            name="exitedAt"
            type="datetime-local"
            value={exitedAt}
            onChange={(event) => setExitedAt(event.target.value)}
            className={controlClass}
          />
        </Field>
        <Field label={labels.visibility}>
          <input
            name="visibility"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value)}
            className={controlClass}
          />
        </Field>
        <Field label={labels.current}>
          <input
            name="current"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input
          name="notRecorded"
          type="checkbox"
          value="depth"
          checked={depthNotRecorded}
          onChange={(event) => setDepthNotRecorded(event.target.checked)}
          className="size-4 accent-primary"
        />
        {labels.notRecordedDepth}
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClass({ size: "sm" })}>
          {labels.save}
        </button>
        {result?.status === "error" ? (
          <FormStatus>{labels.refusals[result.reason]}</FormStatus>
        ) : result?.status === "ok" ? (
          <FormStatus tone="success">{labels.saved}</FormStatus>
        ) : null}
      </div>
    </form>
  );
}
