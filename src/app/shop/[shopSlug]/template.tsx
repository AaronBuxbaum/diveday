import type { ReactNode } from "react";
import { PageEnter } from "@/components/PageEnter";
import { SHOP_MAIN_ID } from "./_components/RouteFocus";

/** A template remounts on every move between staff pages, which is when the page rises in. */
export default function ShopTemplate({ children }: { children: ReactNode }) {
  return <PageEnter targetId={SHOP_MAIN_ID}>{children}</PageEnter>;
}
