import type { ReactNode } from "react";

/** Actions get a full, right-aligned line below sm so list labels keep their measure.
 * Responsive list actions follow ADR 20260830-responsive-surface-consistency. */
export function ListItemActions({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto ${className}`.trim()}
    >
      {children}
    </div>
  );
}
