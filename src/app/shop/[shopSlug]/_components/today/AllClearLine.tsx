import { StatusMark } from "@/components/ui/StatusMark";

/**
 * **Good news wears the good-news tone** (UX review 2026-10-10, item 3). The
 * home's all-clear lines, the morning's boats-clear and the evening's "All
 * boats are home", draw in the success wash the gear register's "All home"
 * band uses. They once wore the coral wash or coral ink, which read as the
 * amber of a warning on a phone in the sun; amber is rationed for things that
 * need a hand, and a crew taught that amber can mean "all clear" stops reading
 * amber (visual review A07).
 */
export function AllClearLine({
  children,
  mark = false,
  className = "",
}: {
  children: React.ReactNode;
  /** The success mark before the words, for the morning's line. */
  mark?: boolean;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={`flex items-center gap-2 rounded-lg border border-success/30 bg-success-tint px-3 py-2 text-sm font-semibold text-success-strong ${className}`.trim()}
    >
      {mark ? <StatusMark variant="success" size="sm" /> : null}
      {children}
    </p>
  );
}
