import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { TripSentence } from "./trip-sentence";

/**
 * The sentence under the phase strip, its emphasis in the alarm color, the
 * quieter line under it, and, from Check-in on, the **Roll call** door: the
 * crew's way onto the boat's own screen, dark like the deck it opens.
 */
export function TripSentenceLine({
  sentence,
  rollCall,
  seats = null,
}: {
  sentence: TripSentence;
  /** The door to Roll call, worded; null where the page has none yet. */
  rollCall: { href: string; label: string } | null;
  /** Filling's bar: one block a seat, the booked ones filled; on a departure sold elsewhere, one a guest, the ready ones filled. */
  seats?: { booked: number; capacity: number } | null;
}) {
  return (
    <div
      data-trip-sentence=""
      className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8"
    >
      <div className="min-w-0">
        <p className={`${SECTION_TITLE_CLASS} text-balance`}>
          <Emphasised text={sentence.headline} emphasis={sentence.emphasis} />
        </p>
        {/* The bar draws the headline's count, so it sits right under it;
            the booked line follows as its own fact. */}
        {seats && seats.capacity > 0 ? <SeatBar {...seats} /> : null}
        {sentence.sub ? (
          <p className={`text-muted tabular-nums ${seats ? "mt-3" : "mt-1.5 sm:mt-2"}`}>
            {sentence.sub}
          </p>
        ) : null}
      </div>
      {rollCall ? (
        <Link
          href={rollCall.href}
          data-roll-call-door=""
          className={`${buttonClass({ variant: "bare", size: "boat" })} shrink-0 rounded-inset bg-device-frame text-device-frame-foreground hover:opacity-90`}
        >
          {rollCall.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * The seats as blocks, booked then open. Decoration only: the headline above
 * and the line under it already say the count in words.
 */
function SeatBar({ booked, capacity }: { booked: number; capacity: number }) {
  const filled = Math.min(booked, capacity);
  return (
    <div data-seat-bar="" aria-hidden="true" className="mt-4 flex max-w-md gap-1">
      {Array.from({ length: capacity }, (_, seat) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a seat is its position
          key={seat}
          data-seat={seat < filled ? "booked" : "open"}
          className={`h-2.5 min-w-0 flex-1 rounded-full ${seat < filled ? "bg-primary" : "bg-border"}`}
        />
      ))}
    </div>
  );
}

/** `text` with its first `emphasis` set in the alarm color. */
function Emphasised({ text, emphasis }: { text: string; emphasis: string | null }) {
  const at = emphasis ? text.indexOf(emphasis) : -1;
  if (!emphasis || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="text-danger">{emphasis}</span>
      {text.slice(at + emphasis.length)}
    </>
  );
}
