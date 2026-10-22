import { describe, expect, it } from "vitest";
import { buildStructuredRequest } from "@/lib/claude/structured";
import {
  readSetupLines,
  setupLines,
  type WebsiteReading,
  websiteReadingCall,
} from "./website-setup";

const courses = [
  { id: "c-ow", name: "Open Water Diver" },
  { id: "c-aow", name: "Advanced Open Water" },
];

const reading: WebsiteReading = {
  tagline: { text: "Small boats, big reefs", source: "Small boats, big reefs." },
  description: {
    text: "Family-run since 1998 in Key Largo.",
    source: "Family-run since 1998 in Key Largo.",
  },
  phone: { text: "+1 305 555 0110", source: "Call us: +1 305 555 0110" },
  deskHours: { opens: "07:30", closes: "17:00", source: "Open daily 7:30am to 5pm" },
  coursePrices: [
    { courseId: "c-ow", price: 499, source: "Open Water course $499" },
    { courseId: "c-ow", price: 1, source: "duplicate" },
    { courseId: "c-unknown", price: 300, source: "Rescue $300" },
    { courseId: "c-aow", price: 0, source: "Advanced: call us" },
  ],
  departures: [
    {
      title: "Two-tank reef",
      startTime: "08:00",
      price: 95,
      source: "Two-tank reef trip, 8am, $95",
    },
    { title: "Night dive", startTime: "7pm", price: 80, source: "Night dive at 7pm" },
    { title: "Wreck", startTime: "13:00", price: null, source: "Afternoon wreck at 1pm" },
  ],
  policies: [
    {
      text: "Cancel 24 hours ahead for a full refund.",
      source: "Cancel 24 hours ahead for a full refund.",
    },
  ],
  unreadable: false,
};

describe("websiteReadingCall", () => {
  it("fetches only the pasted host, on the draft model, with the shop's courses as cached context", () => {
    const call = websiteReadingCall({
      site: "https://www.bluereef.com/trips",
      currency: "usd",
      courses,
    });
    if (!call) throw new Error("expected a call");
    const request = buildStructuredRequest(call);
    expect(request.model).toBe("claude-sonnet-5-5");
    expect(request.tools).toEqual([
      expect.objectContaining({
        type: "web_fetch_20260209",
        allowed_domains: ["www.bluereef.com"],
      }),
    ]);
    expect(request.messages[0]?.content).toBe(
      "Read the website https://www.bluereef.com/ and answer.",
    );
    expect(request.system).toContainEqual({
      type: "text",
      text: "<currency>USD</currency>\n<courses>\nc-ow: Open Water Diver\nc-aow: Advanced Open Water\n</courses>",
      cache_control: { type: "ephemeral" },
    });
  });

  it("is null for a site the fetch tool will not allow", () => {
    expect(
      websiteReadingCall({ site: "http://localhost:3000", currency: "usd", courses }),
    ).toBeNull();
    expect(websiteReadingCall({ site: "wixsite.com", currency: "usd", courses })).toBeNull();
  });
});

describe("setupLines", () => {
  it("turns a reading into lines, each beside its source", () => {
    const lines = setupLines(reading, courses);
    expect(lines.map((line) => [line.kind, line.text])).toEqual([
      ["tagline", "Small boats, big reefs"],
      ["description", "Family-run since 1998 in Key Largo."],
      ["phone", "+1 305 555 0110"],
      ["deskHours", "07:30–17:00"],
      ["coursePrice", "Open Water Diver"],
      ["departure", "Two-tank reef"],
      ["departure", "Wreck"],
      ["policy", "Cancel 24 hours ahead for a full refund."],
    ]);
    expect(lines.every((line) => line.status === "open" && line.source.length > 0)).toBe(true);
    expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
    expect(lines.find((line) => line.kind === "deskHours")).toMatchObject({
      opensMinute: 450,
      closesMinute: 1020,
    });
    expect(lines.find((line) => line.kind === "coursePrice")).toMatchObject({
      courseId: "c-ow",
      priceCents: 49_900,
      source: "Open Water course $499",
    });
    expect(
      lines.filter((line) => line.kind === "departure").map((line) => line.priceCents),
    ).toEqual([9_500, undefined]);
  });

  it("drops what a writer would refuse: a long tagline, a backwards day, a course not the shop's", () => {
    const lines = setupLines(
      {
        ...reading,
        tagline: { text: "x".repeat(121), source: "x" },
        deskHours: { opens: "17:00", closes: "08:00", source: "x" },
      },
      courses,
    );
    expect(lines.map((line) => line.kind)).not.toContain("tagline");
    expect(lines.map((line) => line.kind)).not.toContain("deskHours");
    expect(lines.filter((line) => line.kind === "coursePrice")).toHaveLength(1);
  });

  it("is nothing for a site that could not be read", () => {
    expect(setupLines({ ...reading, unreadable: true }, courses)).toEqual([]);
  });
});

describe("readSetupLines", () => {
  it("reads stored lines back and treats a malformed store as none", () => {
    const lines = setupLines(reading, courses);
    expect(readSetupLines(JSON.parse(JSON.stringify(lines)))).toEqual(lines);
    expect(readSetupLines([{ key: "x" }])).toEqual([]);
    expect(readSetupLines(null)).toEqual([]);
  });
});
