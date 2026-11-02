import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for a course form (design principle 1): the header and
 * its progress line, the form's words, then the signature card.
 */
export default function CourseFormsLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-6 w-56 max-w-full rounded bg-surface-sunken" />
        <div className="mt-6 flex flex-col gap-3 border-b border-border pb-8">
          {[
            ["a", "w-full"],
            ["b", "w-full"],
            ["c", "w-11/12"],
            ["d", "w-full"],
            ["e", "w-2/3"],
          ].map(([key, width]) => (
            <div key={key} className={`h-5 ${width} rounded bg-surface-sunken`} />
          ))}
        </div>
        <div className={sectionCardClass({ padding: "none", className: "mt-8 h-56" })} />
      </div>
    </main>
  );
}
