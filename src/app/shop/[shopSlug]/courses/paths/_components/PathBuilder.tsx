"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { MAX_PATH_STEPS } from "@/lib/courses";

/** A catalog course as the picker offers it — `gateLabel` arrives pre-composed from the server. */
export type PathBuilderCourse = {
  id: string;
  title: string;
  agency: string;
  isActive: boolean;
  gateLabel: string;
};

export type PathBuilderStep = { courseId: string; note: string };

/**
 * Every value is a plain ICU-style template string, never a function — see
 * the identical note on `DayByDayEditorCopy` (DayByDayEditor.tsx): step count
 * and course selection are unbounded, purely client-side state, so there is
 * no fixed set of server-rendered strings to hand down. `fill()` below does
 * the one-level `{token}` substitution locally.
 */
export interface PathBuilderCopy {
  noSteps: string;
  noStepsHeading: string;
  noStepsAction: string;
  stepLabel: string;
  courseGoneFromCatalog: string;
  hidden: string;
  moveEarlier: string;
  moveLater: string;
  removeFromPath: string;
  step: string;
  remove: string;
  stepNoteLabel: string;
  optionalHint: string;
  stepNotePlaceholder: string;
  addACourse: string;
  atCapDescription: string;
  notOnPathDescription: string;
  chooseACourse: string;
  hiddenSuffix: string;
  addToPath: string;
  allCoursesOnPath: string;
  pathPreviewLabel: string;
  whatADiverSees: string;
  addACourseToSee: string;
}

/** One-level `{token}` substitution — not a translator, just string.replace. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * The interactive half of "define a path": pick courses out of the catalog,
 * order them, annotate each rung, and watch the diver-facing summary rebuild as
 * you go.
 *
 * State lives here and serializes to one hidden JSON field on every change, the
 * same contract `DayByDayEditor` uses — the surrounding `<form>` submits it like
 * any other field and `sanitizePathSteps` (src/lib/courses.ts) re-validates it
 * server-side. Reordering is buttons, not drag-and-drop: a keyboard and a screen
 * reader get the identical affordance, and a wet thumb on a dock phone can
 * actually hit it (docs/design/forms-and-controls.md).
 */
export function PathBuilder({
  courses,
  initialSteps,
  copy,
}: {
  courses: PathBuilderCourse[];
  initialSteps: PathBuilderStep[];
  copy: PathBuilderCopy;
}) {
  const [steps, setSteps] = useState<PathBuilderStep[]>(initialSteps);
  const [picked, setPicked] = useState("");

  const byId = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const chosen = useMemo(() => new Set(steps.map((step) => step.courseId)), [steps]);
  const available = courses.filter((course) => !chosen.has(course.id));
  const atCap = steps.length >= MAX_PATH_STEPS;

  function addStep() {
    const courseId = picked || available[0]?.id;
    if (!courseId || chosen.has(courseId) || atCap) return;
    setSteps((current) => [...current, { courseId, note: "" }]);
    setPicked("");
  }

  function removeStep(index: number) {
    setSteps((current) => current.filter((_, i) => i !== index));
  }

  function moveStep(index: number, delta: number) {
    setSteps((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function setNote(index: number, note: string) {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, note } : step)));
  }

  return (
    <div className="flex flex-col gap-4">
      <input type="hidden" name="stepsJson" value={JSON.stringify(steps)} />

      {steps.length === 0 ? (
        // Was a hand-rolled dashed box copying `EmptyState`'s look from a
        // distance; now it is the component, so it can't drift from every other
        // empty state in the staff app. The picker below is the only way to put
        // a first rung on a path, so that is the door.
        <EmptyState>
          <h3 className="font-medium">{copy.noStepsHeading}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{copy.noSteps}</p>
          <a
            href="#path-add-course"
            className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
          >
            {copy.noStepsAction}
          </a>
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => {
            const course = byId.get(step.courseId);
            const position = index + 1;
            return (
              <li
                key={step.courseId}
                className="rounded-xl border border-border bg-surface p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary tabular-nums"
                  >
                    {position}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <span className="sr-only">{fill(copy.stepLabel, { position })}</span>
                      {course?.title ?? copy.courseGoneFromCatalog}
                      {course && !course.isActive ? (
                        <span className="ml-2 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted">
                          {copy.hidden}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">{course ? course.gateLabel : null}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveStep(index, -1)}
                      disabled={index === 0}
                      aria-label={fill(copy.moveEarlier, { course: course?.title ?? copy.step })}
                      className={buttonClass({ variant: "ghost", size: "sm", className: "px-3" })}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(index, 1)}
                      disabled={index === steps.length - 1}
                      aria-label={fill(copy.moveLater, { course: course?.title ?? copy.step })}
                      className={buttonClass({ variant: "ghost", size: "sm", className: "px-3" })}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStep(index)}
                      aria-label={fill(copy.removeFromPath, {
                        course: course?.title ?? copy.step,
                      })}
                      className={buttonClass({ variant: "danger", size: "sm" })}
                    >
                      {copy.remove}
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  <FieldGrid columns={1}>
                    <Field label={fill(copy.stepNoteLabel, { position })} hint={copy.optionalHint}>
                      <input
                        value={step.note}
                        onChange={(event) => setNote(index, event.target.value)}
                        maxLength={200}
                        placeholder={copy.stepNotePlaceholder}
                        className={controlClass}
                      />
                    </Field>
                  </FieldGrid>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div
        id="path-add-course"
        className="scroll-mt-24 rounded-xl border border-border bg-surface-sunken/40 p-4"
      >
        <div className="flex flex-wrap items-end gap-2">
          <Field
            label={copy.addACourse}
            description={atCap ? copy.atCapDescription : copy.notOnPathDescription}
            className="min-w-0"
          >
            <select
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
              disabled={available.length === 0 || atCap}
              className={`${controlClass} sm:max-w-sm`}
            >
              <option value="">{copy.chooseACourse}</option>
              {available.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title} · {course.agency.toUpperCase()}
                  {course.isActive ? "" : copy.hiddenSuffix}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            onClick={addStep}
            disabled={!picked || atCap}
            className={buttonClass({ variant: "secondary" })}
          >
            {copy.addToPath}
          </button>
        </div>
        {available.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{copy.allCoursesOnPath}</p>
        ) : null}
      </div>

      <section aria-label={copy.pathPreviewLabel} className="rounded-xl border border-border p-4">
        <h3 className="text-xs font-semibold tracking-widest text-primary uppercase">
          {copy.whatADiverSees}
        </h3>
        {steps.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{copy.addACourseToSee}</p>
        ) : (
          <p className="mt-2 text-sm leading-6">
            {steps.map((step, index) => (
              <span key={step.courseId}>
                {/* Spaces inside the separator, not padding around it: this line
                    is read aloud and copied out, and "OpenWater→Advanced" is
                    neither. */}
                {index > 0 ? (
                  <span aria-hidden="true" className="text-muted">
                    {" → "}
                  </span>
                ) : null}
                <span className="font-medium">{byId.get(step.courseId)?.title ?? "—"}</span>
              </span>
            ))}
          </p>
        )}
      </section>
    </div>
  );
}
