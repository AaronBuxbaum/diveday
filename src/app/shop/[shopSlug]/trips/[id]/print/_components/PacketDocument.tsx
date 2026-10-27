import type { ReactNode } from "react";

/** Opening-page ownership travels with the actual retained document, including warnings. */
export type PacketDocument = { document: ReactNode; openingPageName: string };

export function firstPacketPageName(sheets: readonly { packet: PacketDocument }[]) {
  return sheets[0]?.packet.openingPageName;
}

/** Share the opening named page with its summary instead of creating an unnamed cover. */
export function PacketSummary({
  openingPageName,
  children,
}: {
  openingPageName?: string;
  children: ReactNode;
}) {
  return (
    <header
      style={{ page: openingPageName }}
      className="mb-10 border-b border-border pb-6 print:mb-6"
    >
      {children}
    </header>
  );
}
