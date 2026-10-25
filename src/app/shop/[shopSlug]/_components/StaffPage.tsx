import type { ReactNode } from "react";
import { type StaffPageWidth, staffPageClass } from "./staff-page";

/**
 * A staff page's `<main>`, at one of the two widths (`staff-page.ts`). The
 * width is declared once, here at the page's shell call, and its
 * `loading.tsx` declares the same one. `className` adds behaviour (a
 * skeleton's `animate-pulse`, a section rhythm), never a width.
 */
export function StaffPage({
  width = "reading",
  className,
  children,
}: {
  width?: StaffPageWidth;
  className?: string;
  children: ReactNode;
}) {
  return <main className={staffPageClass(width, className)}>{children}</main>;
}
