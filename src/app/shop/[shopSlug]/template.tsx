import type { ReactNode } from "react";
import { PageEnter } from "@/components/PageEnter";

/** A template remounts on every move between staff pages, which is when the page rises in. */
export default function ShopTemplate({ children }: { children: ReactNode }) {
  return <PageEnter>{children}</PageEnter>;
}
