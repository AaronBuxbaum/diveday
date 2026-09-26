import { WeekLedgerSkeleton } from "../../_components/WeekLedgerSkeleton";

/**
 * **The framed schedule, drawn as the frame draws it** (K-371). The widget is
 * the next few departures and nothing above them — no identity band, no
 * heading, no filters, since `?embed=1` promises the host page no chrome — so
 * its skeleton is the ledger in the page's embed column, `px-3 py-4` at the
 * frame's full width. It used to inherit the storefront's, whose `max-w-6xl`
 * column, identity band and hero card sat 88px in from the frame's edge and
 * then vanished when the list arrived 12px from it.
 *
 * `loading.test.tsx` reads the column off the page's own embed branch, so the
 * two cannot drift apart.
 */
export default function EmbeddedScheduleLoading() {
  return (
    <main className="w-full flex-1 px-3 py-4">
      <WeekLedgerSkeleton />
    </main>
  );
}
