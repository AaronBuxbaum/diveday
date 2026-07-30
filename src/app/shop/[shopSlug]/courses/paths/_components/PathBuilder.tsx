"use client";

import { useMemo, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { MAX_PATH_STEPS } from "@/lib/courses";
import { CERTIFICATION_LEVEL_LABELS, type CertificationLevel } from "@/lib/readiness";

/** A catalog course as the picker offers it. */
export type PathBuilderCourse = {
  id: string;
  title: string;
  agency: string;
  isActive: boolean;
  minimumCertificationLevel: CertificationLevel | null;
};

export type PathBuilderStep = { courseId: string; note: string };

function gateLabel(level: CertificationLevel | null): string {
  return level ? `${CERTIFICATION_LEVEL_LABELS[level]} or higher` : "Open to uncertified divers";
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
}: {
  courses: PathBuilderCourse[];
  initialSteps: PathBuilderStep[];
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
        <p className="rounded-xl border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">
          No courses on this path yet. Add the first one a diver would take, then build upward.
        </p>
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
                      <span className="sr-only">{`Step ${position}: `}</span>
                      {course?.title ?? "Course no longer in the catalog"}
                      {course && !course.isActive ? (
                        <span className="ml-2 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted">
                          Hidden
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      {course ? gateLabel(course.minimumCertificationLevel) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveStep(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${course?.title ?? "step"} earlier`}
                      className={buttonClass({ variant: "ghost", size: "sm", className: "px-3" })}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(index, 1)}
                      disabled={index === steps.length - 1}
                      aria-label={`Move ${course?.title ?? "step"} later`}
                      className={buttonClass({ variant: "ghost", size: "sm", className: "px-3" })}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStep(index)}
                      aria-label={`Remove ${course?.title ?? "step"} from this path`}
                      className={buttonClass({ variant: "danger", size: "sm" })}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  <FieldGrid columns={1}>
                    <Field label={`Step ${position} note`} hint="(optional)">
                      <input
                        value={step.note}
                        onChange={(event) => setNote(index, event.target.value)}
                        maxLength={200}
                        placeholder="Most divers wait a season before this one"
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

      <div className="rounded-xl border border-border bg-surface-sunken/40 p-4">
        <FieldGrid columns={1} className="gap-y-3">
          <Field
            label="Add a course"
            description={
              atCap
                ? `A path holds up to ${MAX_PATH_STEPS} courses.`
                : "Only courses that aren't already on this path are listed."
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={picked}
                onChange={(event) => setPicked(event.target.value)}
                disabled={available.length === 0 || atCap}
                className={`${controlClass} sm:max-w-sm`}
              >
                <option value="">Choose a course…</option>
                {available.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title} · {course.agency.toUpperCase()}
                    {course.isActive ? "" : " (hidden)"}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addStep}
                disabled={!picked || atCap}
                className={buttonClass({ variant: "secondary" })}
              >
                Add to path
              </button>
            </div>
          </Field>
        </FieldGrid>
        {available.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Every course in your catalog is already on this path.
          </p>
        ) : null}
      </div>

      <section aria-label="Path preview" className="rounded-xl border border-border p-4">
        <h3 className="text-xs font-semibold tracking-widest text-primary uppercase">
          What a diver sees
        </h3>
        {steps.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Add a course to see the progression.</p>
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
