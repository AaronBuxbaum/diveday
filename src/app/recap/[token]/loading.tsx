import { sectionCardClass } from "@/components/ui/card";

/**
 * Body-shaped skeleton for /recap (design principle 1) — shaped like the
 * afterglow arc it stands in for: kicker, title, the coral moment's card,
 * the route section, then the one ask card.
 */
export default function RecapLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-2 h-5 w-40 rounded bg-surface-sunken" />
        {/* The share-button row — h-11 matches the button's 44px floor, so
            the coral card below streams in exactly where this stood. */}
        <div className="mt-4 h-11 w-36 rounded-lg bg-surface-sunken" />
        {/* Both bordered blocks — the coral moment and the one ask — take the
            card's shell from the same place the page's own cards do. */}
        <div className={sectionCardClass({ padding: "none", className: "mt-8 h-40" })} />
        <div className="mt-10 h-3 w-36 rounded bg-surface-sunken" />
        <div className="mt-4 h-56 rounded-2xl bg-surface-sunken" />
        <div className={sectionCardClass({ padding: "none", className: "mt-12 h-64 sm:mt-14" })} />
      </div>
    </main>
  );
}
