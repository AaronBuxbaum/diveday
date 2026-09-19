import type { ReactNode } from "react";
import type { SkyScheme } from "@/lib/sky-scheme";

/**
 * **The top of a day-shaped surface** — ADR 20260919-one-idea, decision I · Tide.
 *
 * One flat gradient for the hour the shop is reading at, and whatever the
 * surface puts on it: its name, the date, the day in a line, the strip. The
 * four gradients and their ink live in `globals.css` under `.sky`; this decides
 * only which one, from the code `skyReadingFor` returned.
 *
 * **Light by day because it is day.** The band does not follow the reader's
 * colour scheme — it follows the sun over the shop, which is the whole of
 * H-77's "light mode should render light" answered without a toggle. At night
 * it is near-black in both schemes, exactly like `--device-frame`.
 *
 * **It carries no fact.** The sky says what hour it is. Every number on it —
 * the boats, the count, the conditions — is a child this renders, and each one
 * is said again in words below.
 */

export function SkyBand({
  scheme,
  children,
  className,
}: {
  scheme: SkyScheme;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`sky ${className ?? ""}`.trim()} data-scheme={scheme}>
      {children}
    </div>
  );
}
