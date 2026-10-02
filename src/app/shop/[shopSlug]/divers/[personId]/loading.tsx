import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { ledgerRowBoxClass } from "@/components/ui/ledger";

/** The file's groups that every record renders a door for (`page.tsx`). */
const FILE_DOORS = [
  "details",
  "certifications",
  "waiver",
  "gear",
  "shelf",
  "notes",
  "support",
  "activity",
] as const;

/**
 * Body-shaped skeleton for a diver's record (design principle 1). Without one,
 * this route would inherit the roster's row-shaped skeleton from the parent
 * segment — a shape mismatch for a single record.
 *
 * It is shaped like the composition ADR 20260827-people-not-lists gave the
 * page, in the same order and at the same rhythm: masthead, the acts row, the
 * story's ledger rows, then the file's doors, all on the record's one
 * `space-y-10`. Deliberately **no block where the status ledger goes** — the
 * ledger renders nothing for a clear diver, and a skeleton that always draws
 * one would promise work that usually is not there and jump when it resolves
 * to nothing.
 *
 * **Every height is the loaded one's** (pixel-craft class 11;
 * `ledger-skeletons.test.tsx` pins them). This drew the record from before
 * its file became one door per group — four label-over-card blocks, 44px act
 * bars under 48px buttons, 56px story rows under 69px ones, a 20px meta line
 * where the contact links are 44px targets — and everything under the name
 * dropped about 28px when the record arrived.
 *
 * - The meta: the contact links' 44px line (`buttonClass` `sm`).
 * - The act: Book a departure, an `md` button, 48px. Contact details is the
 *   first file door below, not a second button.
 * - The story: `BookingStoryRow`s on the ledger's box, their 12px inset
 *   round a date beside a two-line title from `sm` (44px), and the three
 *   lines stacked below it (66px).
 * - The file: `DiverFileGroupDisclosure`'s door, 12px round a 24px heading
 *   between two rules: 50px.
 */
export default function DiverProfileLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton
          titleWidth="w-56"
          description={false}
          meta={
            <div className="flex h-11 items-center">
              <div className="h-5 w-72 max-w-full rounded bg-surface-sunken" />
            </div>
          }
        />
        <div className="mt-1 flex flex-wrap gap-2">
          <div className="h-12 w-44 rounded-lg bg-surface-sunken" />
        </div>
        <div className="mt-10 space-y-10">
          <div>
            <div className="h-4 w-24 rounded bg-surface-sunken" />
            <div className="mt-3">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className={`${ledgerRowBoxClass} py-3`}>
                  <div className="flex h-16.5 flex-col justify-center gap-2 sm:h-11 sm:flex-row sm:items-center sm:justify-start sm:gap-4">
                    <div className="shrink-0 sm:w-28">
                      <div className="h-4 w-20 rounded bg-surface-sunken" />
                    </div>
                    <div className="h-4 w-56 max-w-full rounded bg-surface-sunken" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          {FILE_DOORS.map((group) => (
            <div key={group} className="flex items-center gap-3 border-y border-border py-3">
              <div className="flex h-6 flex-1 items-center">
                <div className="h-4 w-40 rounded bg-surface-sunken" />
              </div>
              <div className="h-4 w-24 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
