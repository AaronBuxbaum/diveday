import type { ReactNode } from "react";
import { PageEnter } from "@/components/PageEnter";

/** A template remounts on every move between a shop's diver pages, which is when the page rises in. */
export default function ShopSiteTemplate({ children }: { children: ReactNode }) {
  return <PageEnter>{children}</PageEnter>;
}
