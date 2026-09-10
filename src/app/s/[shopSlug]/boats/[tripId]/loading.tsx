import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Body-shaped skeleton for the follow-the-boat page (ADR
 * 20260804-instant-navigation): the header, the stage word and the two quiet
 * lines under it, the day's own line as five hairline rows, the one note, and
 * the two doors.
 *
 * `max-w-xl` with the page. Without this file the route would fall back to the
 * storefront's schedule skeleton at `max-w-6xl`, which is the wrong width and
 * the wrong shape — and this is a page somebody opens on a phone at the dock,
 * where the first paint is most of what they see.
 */
export default function FollowTheBoatLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton
          titleWidth="w-56"
          description={false}
          meta={<div className="h-6 w-64 max-w-full rounded bg-surface-sunken" />}
        />
        {/* The stage word, then what the crew said and when. */}
        <div className="h-8 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-48 rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-36 rounded bg-surface-sunken" />

        {/* The day: a group label and five hairline rows. */}
        <div className="mt-8 h-4 w-20 rounded bg-surface-sunken" />
        <div className="mt-2 flex flex-col">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex min-h-13 items-center gap-3 border-t border-border">
              <div className="size-2 shrink-0 rounded-full bg-surface-sunken" />
              <div className="h-4 w-40 max-w-full rounded bg-surface-sunken" />
              <div className="ms-auto h-4 w-16 rounded bg-surface-sunken" />
            </div>
          ))}
          <div className="border-b border-border" />
        </div>

        {/* The one note, then the two doors. */}
        <div className="mt-6 h-8 w-full rounded bg-surface-sunken" />
        <div className="mt-8 flex flex-col border-t border-border">
          {[0, 1].map((row) => (
            <div key={row} className="flex min-h-13 items-center gap-3 border-b border-border">
              <div className="h-4 w-44 max-w-full rounded bg-surface-sunken" />
              <div className="ms-auto h-4 w-24 rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
