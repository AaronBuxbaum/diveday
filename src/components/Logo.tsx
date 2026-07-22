/**
 * The bubble-trail mark: three ascending bubbles reading calm, controlled
 * ascent. The top bubble is always the rationed coral accent (ADR-0004); the
 * other two inherit `currentColor` so the mark reads correctly on any
 * surface — teal on sand, or white-on-primary inside a badge.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="7" cy="17" r="5" fill="currentColor" />
      <circle cx="15.5" cy="9" r="3.4" fill="currentColor" opacity="0.75" />
      <circle cx="19.5" cy="4.5" r="2" fill="var(--accent)" />
    </svg>
  );
}
