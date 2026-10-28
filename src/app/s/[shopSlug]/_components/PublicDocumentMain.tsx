import type { ReactNode } from "react";
import { departurePaperRule } from "@/app/shop/[shopSlug]/trips/[id]/_components/DeparturePaperIdentity";

/** The route's paper margins carry its identity on every detached sheet. */
export function PublicDocumentMain({
  kind,
  shopName,
  title,
  className,
  children,
}: {
  kind: "schedule" | "course";
  shopName: string;
  title: string;
  className: string;
  children: ReactNode;
}) {
  const pageName = kind === "schedule" ? "departure-public-schedule" : "departure-public-course";
  return (
    <main data-departure-paper={pageName} className={className}>
      <style>
        {departurePaperRule(pageName, [shopName, title], "") +
          `@media print{body{page:${pageName}}body,#main-content{display:block;min-height:0}[data-departure-paper=${pageName}]{padding:0}[data-public-print-identity]{display:none}}`}
      </style>
      {children}
    </main>
  );
}
