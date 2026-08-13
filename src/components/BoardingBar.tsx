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
  const width = (count: number) => ({ width: `${(count / total) * 100}%` });
  return (
    <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-surface-sunken">
      {boarded > 0 ? <div style={width(boarded)} className="bg-primary" /> : null}
      {ready > 0 ? <div style={width(ready)} className="bg-success/70" /> : null}
      {blocked > 0 ? <div style={width(blocked)} className="bg-danger" /> : null}
    </div>
  );
}
