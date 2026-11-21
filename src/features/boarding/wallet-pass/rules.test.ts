// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { DIVEDAY_BRAND_COLOR } from "@/lib/brand";
import { configuredWalletPlatforms } from "./config";
import {
  buildPassContent,
  type PassContentInput,
  passAuthenticationToken,
  passContentHash,
  passTokenMatches,
  walletPlatformForAgent,
} from "./rules";

const input: PassContentInput = {
  shopName: "Blue Mantis",
  title: "Two-Tank Reef",
  diverName: "Yara Test",
  locale: "en-US",
  timeZone: "America/New_York",
  startsAt: new Date("2026-07-21T12:00:00Z"),
  endsAt: new Date("2026-07-21T16:00:00Z"),
  dockCallMinutes: 30,
  brandColor: DIVEDAY_BRAND_COLOR,
  boat: "Mantis II",
  meetingPlace: "South dock",
  crew: ["Keiko"],
  sites: ["Reef"],
  phone: "+1 555 0100",
  stage: null,
  voided: false,
  labels: {
    date: "Date",
    dockCall: "Dock call",
    departs: "Departs",
    boat: "Boat",
    diver: "Name",
    meetingPlace: "Meeting place",
    crew: "Crew",
    sites: "Sites",
    phone: "Phone",
    plan: "Plans can move. This pass will update with them.",
    description: "Your departure",
  },
};

describe("a departure a diver may show around", () => {
  it("is deterministic, branded, timezone-labelled and carries no capability, barcode or booking/money/medical facts", () => {
    const content = buildPassContent(input);
    expect(content).toEqual(buildPassContent(input));
    expect(passContentHash(content)).toBe(passContentHash(buildPassContent(input)));
    expect(content.auxiliaryFields.find((field) => field.key === "diver")?.value).toBe(
      input.diverName,
    );
    expect(content.secondaryFields.find((field) => field.key === "departs")?.value).toMatch(/EDT/);
    expect(JSON.stringify(content)).not.toMatch(
      /http|\/ready\/|barcode|booking|medical|waiver|\$/i,
    );
    expect(content.relevantDate).toBe("2026-07-21T11:30:00.000Z");
    expect(content.expirationDate).toBe("2026-07-22T16:00:00.000Z");
  });
  it("only changes time facts when the departure moves", () => {
    const before = buildPassContent(input);
    const after = buildPassContent({ ...input, startsAt: new Date("2026-07-21T13:00:00Z") });
    expect(after).toEqual({
      ...before,
      secondaryFields: after.secondaryFields,
      relevantDate: after.relevantDate,
    });
    expect(after.secondaryFields[0]).toEqual(before.secondaryFields[0]);
    expect(after.secondaryFields[1]).not.toEqual(before.secondaryFields[1]);
    expect(after.secondaryFields[2]).not.toEqual(before.secondaryFields[2]);
  });
  it("only repeats a recorded stage, voids a cancelled departure, and strips links in free text", () => {
    expect(buildPassContent(input).headerFields).toEqual([]);
    expect(buildPassContent({ ...input, stage: "Boarding", voided: true })).toMatchObject({
      headerFields: [{ key: "stage", label: "", value: "Boarding" }],
      voided: true,
    });
    expect(
      JSON.stringify(
        buildPassContent({
          ...input,
          meetingPlace: "South dock https://dive.day/ready/private-token",
        }),
      ),
    ).not.toContain("private-token");
  });
  it("keeps incomplete/absent platform credentials dark, and handles desktop and device selection", () => {
    expect(configuredWalletPlatforms({})).toEqual([]);
    expect(configuredWalletPlatforms({ APPLE_PASS_TYPE_ID: "pass.test" })).toEqual([]);
    expect(
      configuredWalletPlatforms({
        GOOGLE_WALLET_ISSUER_ID: "123",
        GOOGLE_WALLET_SERVICE_ACCOUNT_JSON: "not json",
      }),
    ).toEqual([]);
    expect(walletPlatformForAgent("iPhone Safari", ["apple", "google"])).toBe("apple");
    expect(walletPlatformForAgent("Android", ["apple", "google"])).toBe("google");
    expect(walletPlatformForAgent("Android", ["apple"])).toBeNull();
    expect(walletPlatformForAgent("desktop", ["apple", "google"])).toBeNull();
  });
  it("derives a stable per-pass credential with constant-time hash verification, separate from booking links", () => {
    const token = passAuthenticationToken("pass-one");
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(token).toBe(passAuthenticationToken("pass-one"));
    expect(token).not.toBe(passAuthenticationToken("pass-two"));
    expect(passTokenMatches(token, hashBearerToken(token))).toBe(true);
    expect(passTokenMatches("wrong", hashBearerToken(token))).toBe(false);
    expect(passTokenMatches(token, "bad-length")).toBe(false);
  });
});

it("prints the plan sentence once, without repeating it as its own label", () => {
  const plan = buildPassContent(input).backFields.find((field) => field.key === "plan");
  expect(plan).toEqual({ key: "plan", label: "", value: input.labels.plan });
});

it("only selects Apple automatically for Safari on a Mac", () => {
  expect(
    walletPlatformForAgent("Mozilla/5.0 (Macintosh) Chrome/150.0 Safari/537.36", [
      "apple",
      "google",
    ]),
  ).toBeNull();
  expect(
    walletPlatformForAgent("Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15", [
      "apple",
      "google",
    ]),
  ).toBe("apple");
});
