import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for /waivers (design principle 1) — the token lookup,
 * booking, and shop context have no loading state to show meanwhile, and
 * this is the page a diver opens from a text message the night before.
 *
 * Shaped like the page it stands in for: header, the step rail, then the
 * release document (unboxed text lines under a titled rule), then the form's
 * three sections.
 */
export default function WaiverLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        {/* The description, one `text-base` line: 24px, not the 20 it was
            drawn at (K-226). */}
        <div className="mt-2 h-6 w-56 max-w-full rounded bg-surface-sunken" />
        {/* The trip line a booked waiver prints under it (`mt-3`, 24px lines).
            Two of them: a trip's title, date and zoned time range wrap to two
            on a phone, and did at 1280 in the booked-waiver capture; with no
            placeholder the rail and the release below it landed 64px high
            (K-226). Two 20px bars 8px apart fill the 48px of two lines. */}
        <div className="mt-3 flex flex-col gap-2">
          <div className="h-5 w-full rounded bg-surface-sunken" />
          <div className="h-5 w-2/3 rounded bg-surface-sunken" />
        </div>
        {/* The step rail (`WaiverStepRail`): hairlines above and below, three
            marked segments, the count pushed to the end. It holds the rail's
            own height, which is the whole job — a skeleton that skipped it
            would drop the release a rail's worth up the page on arrival. */}
        <div className="mt-6 flex items-center gap-5 border-y border-border py-3">
          {[
            ["release", "w-20"],
            ["medical", "w-20"],
            ["sign", "w-14"],
          ].map(([key, width]) => (
            <div key={key} className="flex items-center gap-2">
              <div className="size-5 rounded-full bg-surface-sunken" />
              <div className={`h-4 rounded bg-surface-sunken ${width}`} />
            </div>
          ))}
          <div className="ms-auto h-4 w-20 rounded bg-surface-sunken" />
        </div>
        <div className="mt-8 border-b border-border pb-3">
          <div className="h-4 w-44 rounded bg-surface-sunken" />
        </div>
        <div className="mt-4 flex flex-col gap-2.5">
          {[
            ["line-1", "w-full"],
            ["line-2", "w-full"],
            ["line-3", "w-11/12"],
            ["line-4", "w-full"],
            ["line-5", "w-4/5"],
          ].map(([key, width]) => (
            <div key={key} className={`h-4 rounded bg-surface-sunken ${width}`} />
          ))}
        </div>
        <div className="mt-10 flex flex-col gap-10">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="h-7 w-48 max-w-full rounded bg-surface-sunken" />
              {/* The shell comes from the same place the signing form's own
                  card does. It stands in for all three sections at one shape:
                  only the signature is a card on the page, the questionnaire's
                  boxes are per-question `<fieldset>`s and the emergency contact
                  has no box at all — an approximation this file already made,
                  kept here so a refactor of the panel does not quietly restate
                  a medical page's structure. */}
              <div className={sectionCardClass({ padding: "none", className: "mt-4 h-14" })} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
