import Link from "next/link";
import { BoardingBar } from "@/components/BoardingBar";

export type TripPulseFact = {
  /** The whole sentence — "1 diver can’t board yet" — never a bare count. */
  text: string;
  /** Where the fix lives: the filtered roster, the prep list, the crew panel. */
  href: string;
  /** Marks the facts that hold the boat up; the words already say so too. */
  tone?: "danger";
};

/**
 * The state of the boat, answered before anything asks to be configured.
 *
 * A staffer opening a trip arrives with one question — how is this boat
 * doing? — and the Overview used to answer with forms: details to edit,
 * requirements to edit, crew to assign. The facts lived one tab away each
 * (booked on Guests, blocked on the Manifest, gear gaps on Prep). This strip
 * puts the answer first: the same bar-and-caption grammar as Today's
 * departure board — boarded, then clear to board, then blocked, with open
 * seats as the unfilled track — then only the facts that need someone, each
 * one a link to the surface that fixes it (principle 10: show the answer,
 * and put the action on the object). A fact at zero renders nothing at all
 * (principle 9: "none" is not a status).
 *
 * The facts are the most operational words on the page — "1 diver can't
 * board yet" is exactly the wet-thumb, in-glare tap the dock test protects —
 * so they render at full text size with 44px targets, never as footnote
 * links.
 *
 * Deliberately absent: an all-clear badge (the quiet caption is the all
 * clear), a heading (the trip header directly above already names the boat),
 * and any rendering on a cancelled or departed trip — this is a pulse, and
 * those have none; the recap material takes the page over instead.
 */
export function TripPulse({
  booked,
  boarded,
  blocked,
  capacity,
  caption,
  captionTone,
  facts,
}: {
  booked: number;
  /** Divers already recorded aboard at the departure checkpoint. */
  boarded: number;
  blocked: number;
  capacity: number;
  /** "9 of 12 booked · 3 seats open" — the bar in words and numbers. */
  caption: string;
  /** A full boat is a win worth noticing (principle 3) — the words say it, the ink underlines it. */
  captionTone?: "success";
  facts: TripPulseFact[];
}) {
  return (
    <section className="mt-8">
      <BoardingBar
        boarded={boarded}
        ready={Math.max(0, booked - blocked - boarded)}
        blocked={blocked}
        capacity={capacity}
      />
      <div className="mt-1 flex flex-wrap items-center gap-x-5">
        <p
          className={`text-base tabular-nums ${
            captionTone === "success" ? "font-medium text-success" : "text-muted"
          }`}
        >
          {caption}
        </p>
        {facts.map((fact) => (
          <Link
            key={fact.href}
            href={fact.href}
            className={`inline-flex min-h-11 items-center font-medium hover:underline ${
              fact.tone === "danger" ? "text-danger" : "text-primary"
            }`}
          >
            {fact.text}&nbsp;<span aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
