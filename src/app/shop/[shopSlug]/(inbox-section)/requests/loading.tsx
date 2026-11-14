import { ledgerRowBoxClass } from "@/components/ui/ledger";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Body-shaped skeleton for Requests (design principle 1): a day's group label,
 * the advice line under it, then the requests as
 * hairline rows on the page — the shape ADR 20260827-people-not-lists gave this
 * surface. The stack of bordered cards this used to draw went with the cards
 * themselves, so the skeleton and the page agree on height.
 */
function RequestRows({ count }: { count: number }) {
  return (
    <div className="mt-2">
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static bars, no identity of their own
          key={index}
          className={`flex items-center gap-4 py-3 ${ledgerRowBoxClass}`}
        >
          <Bone className="h-4 w-32 shrink-0" />
          <div className="flex-1 space-y-2">
            <Bone className="h-4 w-2/3" />
            <Bone className="h-3 w-1/2" />
          </div>
          <Bone className="h-4 w-24 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default function RequestsLoading() {
  return (
    <Pending>
      <div className="space-y-10">
        {[2, 1].map((rows) => (
          <div key={rows}>
            {/* `RequestDayGroup`'s label alone: the day's act is on each row. */}
            <Bone className="h-4 w-56 max-w-full" />
            <Bone className="mt-2 h-4 w-72 max-w-full" />
            <RequestRows count={rows} />
          </div>
        ))}
      </div>
    </Pending>
  );
}
