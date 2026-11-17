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
}: {
  sentence: TripSentence;
  /** The door to Roll call, worded; null where the page has none yet. */
  rollCall: { href: string; label: string } | null;
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
        {sentence.sub ? (
          <p className="mt-1.5 text-muted tabular-nums sm:mt-2">{sentence.sub}</p>
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
