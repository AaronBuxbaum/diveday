import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Body-shaped skeleton for `/recap` (design principle 1), shaped like the
 * thread's after-state that replaces it (ADR 20260827-the-divers-thread,
 * decision 4): the coral greeting, the dive record, the crew's word, the one
 * review ask, the private pulse beside it, the run of quiet doors, and the one
 * next dive under them (slice 16i of ADR 20260904-reef-all-the-way-down).
 *
 * Same measure as `/ready`'s, because they are one surface on two URLs now.
 */
export default function RecapLoading() {
  return (
    <main className={THREAD_MEASURE_CLASS}>
      <Pending>
        {/* The greeting, which is this state's earned moment: one block. */}
        <SectionCard as="div" pending padding="none" className="h-36" />
        {/* The dive record — the only thing on the page that prints. */}
        <SectionCard as="div" pending padding="none" className="mt-8 h-72" />
        {/* The crew's word. */}
        <Bone className="mt-10 h-6 w-full max-w-md" />
        <Bone className="mt-2 h-5 w-40" />
        {/* The one ask. */}
        <SectionCard as="div" pending padding="none" className="mt-10 h-64" />
        {/* The private pulse, beside the review and not a card: a heading, a
            line under it, a row of chips and a note (slice 16i). */}
        <div className="mt-10">
          <Bone className="h-6 w-48" />
          <Bone className="mt-2 h-5 w-full max-w-sm" />
          <div className="mt-4 flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((chip) => (
              <Bone shape="control" key={chip} className="h-11 w-24" />
            ))}
          </div>
          <Bone shape="control" className="mt-3 h-20 w-full" />
        </div>
        {/* The quiet doors: hairline rows on the page background, no card. */}
        <div className="mt-10">
          {[0, 1].map((row) => (
            <div key={row} className="border-t border-border py-4 last:border-b">
              <Bone className="h-6 w-40" />
            </div>
          ))}
        </div>
        {/* One next dive, when the board has one for this diver. */}
        <SectionCard as="div" pending padding="none" className="mt-10 h-40" />
      </Pending>
    </main>
  );
}
