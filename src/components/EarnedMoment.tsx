/**
 * The one concentrated, coral-accented moment a surface earns when the user
 * finishes something — booking confirmed, waiver signed, everyone aboard,
 * you're all set (design/principles.md #3). It is deliberately the only place
 * `--accent` appears on a page, so joy stays rationed and keeps its meaning.
 * `rise-in` gives it a ≤400 ms entrance that the reduced-motion kill-switch
 * still neutralises.
 */
export function EarnedMoment({
  eyebrow,
  title,
  children,
  className = "",
  as: Heading = "h2",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /**
   * Heading level for `title`. Defaults to h2, correct when the page has its
   * own h1 elsewhere (as `/ready` and `/recap` do) — pass "h1" when this
   * moment is the page's only heading, or the screen-reader outline starts at
   * level two with no level-one heading at all.
   */
  as?: "h1" | "h2";
}) {
  return (
    <section
      className={`rise-in rounded-2xl border border-accent/40 bg-accent/10 p-6 sm:p-7 ${className}`.trim()}
    >
      {eyebrow ? (
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">{eyebrow}</p>
      ) : null}
      <Heading className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
        {title}
      </Heading>
      {children ? <div className="mt-3 text-muted">{children}</div> : null}
    </section>
  );
}
