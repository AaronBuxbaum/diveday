"use client";

import { Badge } from "@/components/ui/badge";
import { firstNameOf } from "@/lib/person-name";

type MissingDiver = {
  bookingId: string;
  fullName: string;
  rentsKit: boolean;
  /**
   * Readiness says this diver cannot board yet. Display only — the grid never
   * gates anything, it just stops saying "not yet called" beside somebody whose
   * own row says "Blocked". Absent on the offline copy, which carries readiness
   * but is a dock document, not a readiness screen.
   */
  blocked?: boolean;
};

/** Every word `MissingDiversGrid` renders, resolved server-side. */
export interface MissingDiversGridCopy {
  heading: string;
  /**
   * The pill beside the heading — what the *absence* means at this checkpoint,
   * in the checkpoint's own words. Never "missing": the people in this grid
   * are the ones nobody has said anything about yet, and a diver a human
   * actually recorded as not back aboard is on the roster below, not here.
   */
  statusLabel: string;
  tapHint: string;
  rentsKitLabel: string;
  ownKitLabel: string;
  /** The one readiness word (`readinessStatusText`), for a blocked diver's chip. */
  blockedLabel: string;
}

function getInitials(fullName: string): string {
  return fullName
    .split(" ")
    .map((name) => name[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Decorative only — picks a visually distinct border/fill for each diver's
// initials, nothing more. Deliberately excludes success/warning/danger: this
// grid sits right next to a manifest that uses those same tones to mean
// "flagged"/"ready"/"blocked", so a status-colored avatar would read as a
// status by accident (H-accessibility, colorblind-scanning persona).
function getAvatarColor(fullName: string): string {
  const colors = [
    "bg-primary text-primary-foreground border-primary-hover",
    "bg-accent text-accent-foreground border-accent",
    "bg-surface-sunken text-foreground border-border-strong",
    "bg-foreground/10 text-foreground border-border-strong",
  ];
  let hash = 0;
  for (let index = 0; index < fullName.length; index++) {
    hash = fullName.charCodeAt(index) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Who nobody has called yet, as faces — the list a crew member scans across a
 * deck, where a name in a roster of nine is slower to find than a face.
 *
 * **Tone follows the checkpoint, because the words do.** At the dock these are
 * people still to board: ordinary, expected, and worth no alarm colour — the
 * boat has not left. After a dive the same absence means nobody has counted
 * them back aboard, which is the state this whole page exists to close, so it
 * keeps the urgent tone. Both are supplied by the caller as words; this only
 * decides which fill goes behind them.
 */
export function MissingDiversGrid({
  divers,
  copy,
  tone = "urgent",
}: {
  divers: MissingDiver[];
  copy: MissingDiversGridCopy;
  /**
   * `neutral` at the dock, `urgent` after a dive. Never colour alone: the pill
   * carries the checkpoint's own words either way.
   */
  tone?: "neutral" | "urgent";
}) {
  if (divers.length === 0) return null;

  return (
    <section id="missing-divers-grid" className="mt-9 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{copy.heading}</h2>
        <Badge tone={tone === "urgent" ? "danger" : "neutral"}>{copy.statusLabel}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">{copy.tapHint}</p>
      <div className="mt-4 flex flex-wrap justify-start gap-4">
        {divers.map((diver) => {
          const colorClass = getAvatarColor(diver.fullName);
          return (
            <button
              key={diver.bookingId}
              type="button"
              onClick={() => {
                const element = document.getElementById(`diver-row-${diver.bookingId}`);
                if (!element) return;
                // Motion has a job (design/principles.md §5) and a reader who
                // asked for less of it still gets the jump — instantly, and
                // without the two-second ring pulsing at them.
                const reduced =
                  typeof window.matchMedia === "function" &&
                  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                element.scrollIntoView({
                  behavior: reduced ? "auto" : "smooth",
                  block: "center",
                });
                if (reduced) return;
                element.classList.add("ring-4", "ring-primary/50", "ring-offset-2");
                setTimeout(() => {
                  element.classList.remove("ring-4", "ring-primary/50", "ring-offset-2");
                }, 2000);
              }}
              className="group flex max-w-20 cursor-pointer flex-col items-center text-center transition-transform active:scale-95"
            >
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-full border-2 text-lg font-black ${colorClass} transition-transform group-hover:scale-105`}
              >
                {getInitials(diver.fullName)}
              </div>
              <span
                className="mt-1 block w-full truncate text-xs font-bold text-foreground"
                title={diver.fullName}
              >
                {/* The shared helper, not `.split(" ")[0]`: a stored name with
                    a leading space splits to an empty first token, and an
                    empty tile under a face is the one thing this grid cannot
                    show. The fallback is the diver's own stored name — the
                    tile's `title` and its initials already come from it, and
                    the alternative is inventing a word in a component that
                    holds no translator (every other string here arrives as
                    `copy`). */}
                {firstNameOf(diver.fullName, diver.fullName)}
              </span>
              <span className="block w-full truncate text-xs text-muted">
                {diver.rentsKit ? copy.rentsKitLabel : copy.ownKitLabel}
              </span>
              {/* A blocked diver's own row says "Blocked"; without this the
                  grid quietly said the opposite beside their face. Same word,
                  from the same readiness vocabulary — and *below* the kit
                  line, so one blocked diver doesn't push their own tile's
                  labels a line out of step with the rest of the row. */}
              {/* `toneMark={false}`: the canonical danger `Badge`, minus its
                  status mark — a tile is 80px wide and the mark would take a third of
                  the chip from a word the red fill has already coloured. Same
                  exemption the nav's blocked count takes. */}
              {diver.blocked ? (
                <Badge
                  tone="danger"
                  size="sm"
                  toneMark={false}
                  className="mt-0.5 max-w-full truncate font-semibold"
                >
                  {copy.blockedLabel}
                </Badge>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
