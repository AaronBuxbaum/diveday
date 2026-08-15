import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for /waivers (design principle 1) — the token lookup,
 * booking, and shop context have no loading state to show meanwhile, and
 * this is the page a diver opens from a text message the night before.
 *
 * Shaped like the page it stands in for: header, then the release document
 * (unboxed text lines under a titled rule), then the form's numbered steps.
 */
export default function WaiverLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-56 max-w-full rounded bg-surface-sunken" />
        <div className="mt-10 border-b border-border pb-3">
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
              <div className="flex items-center gap-3">
                <div className="size-7 rounded-full bg-surface-sunken" />
                <div className="h-5 w-48 max-w-full rounded bg-surface-sunken" />
              </div>
              {/* The shell comes from the same place the signing form's own
                  card does. It stands in for all three steps at one shape:
                  only step 3 (the signature) is a card on the page, step 1's
                  boxes are per-question `<fieldset>`s and step 2 has no box at
                  all — an approximation this file already made, kept here so a
                  refactor of the panel does not quietly restate a medical
                  page's structure. */}
              <div className={sectionCardClass({ padding: "none", className: "mt-4 h-14" })} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
