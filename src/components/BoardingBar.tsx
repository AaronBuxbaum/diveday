import { ProgressBar } from "@/components/ui/ProgressBar";
/**
 * The glance: one bar for "can this boat sail?". Boarded fills from the left,
 * then divers who are clear to board, then anyone blocked; the unfilled track
 * is seats still open. Decorative on purpose — the caption beside it carries
 * every fact in words and numbers, so the bar never has to be read, only
 * glanced at (principle 6: state is never color alone).
 *
 * One bar, one grammar: Today's departure board and the trip page's own pulse
 * both render this exact component, so "how is this boat doing" always looks
 * the same wherever a staffer meets it.
 */
export function BoardingBar({
  boarded,
  ready,
  blocked,
  capacity,
}: {
  boarded: number;
  ready: number;
  blocked: number;
  capacity: number;
}) {
  const total = Math.max(capacity, boarded + ready + blocked, 1);
  return (
    <ProgressBar
      // Decorative: the caption beside it carries every fact in words and
      // numbers, so the bar is glanced at and never read (principle 6).
      aria-hidden="true"
      className="h-2"
      // Left to right as a staffer reads it; `ProgressBar` works out the
      // stacking. It also owns the motion — this bar used to jump while the
      // manifest's roll-call bar next door animated, on two surfaces somebody
      // moves between all morning (issue #834).
      segments={[
        { key: "boarded", fraction: boarded / total, className: "bg-primary" },
        { key: "ready", fraction: ready / total, className: "bg-success/70" },
        { key: "blocked", fraction: blocked / total, className: "bg-danger" },
      ]}
    />
  );
}
