import Link from "next/link";
import { BoardingSeats } from "@/components/BoardingBar";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SUB_TITLE_CLASS } from "@/components/ui/typography";

export type TripPulseFact = {
  /** The whole sentence — "1 diver can’t board yet" — never a bare count. */
  text: string;
  /**
   * Where the fix lives: the filtered roster, the prep list, the crew panel,
   * the trip-filtered Orders index. Never the page this strip is already on.
   */
  href: string;
  /** Marks the facts that hold the boat up; the words already say so too. */
  tone?: "danger";
};

/**
 * The state of the boat, answered before anything asks to be configured.
 *
 * A staffer opening a trip arrives with one question — how is this boat
 * doing? — and this strip is the page's answer and its signature object: the
 * seat numbers as the headline, the boat drawn seat by seat underneath, and
 * then only the facts that need someone, in the order a staffer asks for them
 * (who can't board, who can't be packed for, who still owes money), each one
 * a full-size link to the surface that fixes it (principle 10: show the
 * answer, and put the action on the object). A fact at zero renders nothing
 * at all (principle 9: "none" is not a status).
 *
 * The facts are the most operational words on the page — "1 diver can't
 * board yet" is exactly the wet-thumb, in-glare tap the dock test protects —
 * so each stands on its own line with a 44px target, never as footnote links.
 *
 * Deliberately absent: an all-clear badge (the quiet caption is the all
 * clear), a heading (the trip header directly above already names the boat),
 * and any rendering on a cancelled or departed trip — this is a pulse, and
 * those have none.
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
  /** "9 of 12 booked · 3 seats open" — the strip in words and numbers. */
  caption: string;
  /** A full boat is a win worth noticing (principle 3) — the words say it, the ink underlines it. */
  captionTone?: "success";
  facts: TripPulseFact[];
}) {
  const ready = Math.max(0, booked - blocked - boarded);
  return (
    <section className="mt-8">
      <p
        className={`${SUB_TITLE_CLASS} tabular-nums ${
          captionTone === "success" ? "text-success-strong" : ""
        }`}
      >
        {caption}
      </p>
      <div className="mt-3">
        <BoardingSeats boarded={boarded} ready={ready} blocked={blocked} capacity={capacity} />
      </div>
      {facts.length > 0 ? (
        <div className="mt-2 flex flex-col">
          {facts.map((fact) => (
            <Link
              key={fact.href}
              href={fact.href}
              className={`inline-flex min-h-11 w-fit items-center text-base font-medium hover:underline ${
                fact.tone === "danger" ? "text-danger" : "text-primary"
              }`}
            >
              {fact.text}
              <DiveDayIcon name="chevron-right" className="ms-1 size-4" />
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
