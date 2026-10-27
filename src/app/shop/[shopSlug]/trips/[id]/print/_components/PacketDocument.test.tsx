import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { keptSheets } from "./kept-sheets";
import { firstPacketPageName, type PacketDocument, PacketSummary } from "./PacketDocument";

describe("packet summary opening-page ownership", () => {
  it("uses the first retained document's warning page when an earlier departure is missing", () => {
    const changed: PacketDocument = {
      openingPageName: "departure-b-changed",
      document: <p>Refresh this packet</p>,
    };
    const stable: PacketDocument = {
      openingPageName: "departure-c-dives",
      document: <p>Trip C</p>,
    };
    const sheets = keptSheets(
      [
        { status: "fulfilled", value: null },
        { status: "fulfilled", value: changed },
        { status: "fulfilled", value: stable },
      ],
      ["a", "b", "c"],
    );
    expect(firstPacketPageName(sheets)).toBe("departure-b-changed");
    const html = renderToStaticMarkup(
      <PacketSummary openingPageName={firstPacketPageName(sheets)}>Day summary</PacketSummary>,
    );
    expect(html).toContain('style="page:departure-b-changed"');
    expect(html).not.toContain("departure-a");
    expect(html).not.toContain("departure-c-dives");
  });

  it("leaves an empty day's summary unnamed without inventing a trip", () => {
    expect(firstPacketPageName([])).toBeUndefined();
    const html = renderToStaticMarkup(
      <PacketSummary openingPageName={firstPacketPageName([])}>Empty day</PacketSummary>,
    );
    expect(html).not.toContain("page:");
    expect(html).toContain("Empty day");
  });
});
