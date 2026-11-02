import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { readyCopyKeepUntil } from "@/lib/ready-offline";
import { buildReadySnapshot, type ReadySnapshotFacts } from "./ready-snapshot";

const GENERATED_AT = Date.UTC(2026, 10, 1, 12, 0);
const TOKEN = "T".repeat(43);

function facts(overrides: Partial<ReadySnapshotFacts> = {}): ReadySnapshotFacts {
  return {
    locale: "en-US",
    generatedAt: GENERATED_AT,
    shop: {
      name: "Blue Mantis Dive",
      timezone: "America/Cancun",
      contactPhone: "+52 984 555 0100",
      contactEmail: "dock@bluemantis.example",
      address: {
        street: "1 Malecon",
        locality: "Cozumel",
        region: "QR",
        postalCode: "77600",
        country: "MX",
      },
      dockCallMinutes: 30,
    },
    trip: {
      title: "Two-Tank Reef",
      startsAt: new Date(Date.UTC(2026, 10, 2, 13, 0)),
      endsAt: new Date(Date.UTC(2026, 10, 2, 17, 0)),
      meetingPointLabel: null,
      meetingPointAddress: null,
      arrivalLandmark: "Blue awning",
      arrivalParkingNote: null,
      arrivalTransitNote: null,
      arrivalLookFor: null,
      arrivalFirstInteraction: null,
    },
    pickup: { time: null, location: null },
    openItems: [],
    sites: [],
    packing: { personal: [], bring: [] },
    changes: [],
    flySafe: null,
    ...overrides,
  };
}

const plain = (html: string) => html.replaceAll("\u00a0", " ");

const allDocuments = (snapshot: ReturnType<typeof buildReadySnapshot>) =>
  [snapshot.saved, snapshot.unverified, snapshot.rollback].join("\n");

describe("buildReadySnapshot", () => {
  it("says where and when, in absolute terms, with the dock call", () => {
    const saved = plain(buildReadySnapshot(facts()).saved);
    expect(saved).toContain("Blue Mantis Dive");
    expect(saved).toContain("Two-Tank Reef");
    expect(saved).toContain("Mon, Nov 2");
    expect(saved).toContain("Aim to be at the dock by");
    expect(saved).toContain("1 Malecon, Cozumel");
    expect(saved).toContain("Blue awning");
    // Read offline a day later, "Tomorrow" would be a lie.
    expect(saved).not.toMatch(/Today|Tomorrow|Yesterday/);
  });

  it("is dated by the server clock in the shop's zone and the page's language", () => {
    const english = buildReadySnapshot(facts()).saved;
    expect(english.replaceAll(" ", " ")).toContain("generated Nov 1, 7:00 AM EST");
    const spanish = buildReadySnapshot(facts({ locale: "es-ES" }));
    expect(spanish.saved).toContain('lang="es-ES"');
    expect(spanish.saved).toContain("Sin cobertura");
    expect(spanish.saved).not.toContain("No signal");
  });

  it("names the hotel pickup instead of the dock call when staff set one", () => {
    const { saved } = buildReadySnapshot(
      facts({ pickup: { time: "06:45", location: "Hotel Playa" } }),
    );
    expect(saved).toContain("06:45 pickup at Hotel Playa");
    expect(saved).not.toContain("Aim to be at the dock");
  });

  it("expires a day after the boat is due back, by the server's own rule", () => {
    const f = facts();
    expect(buildReadySnapshot(f).keepUntil).toBe(readyCopyKeepUntil(f.trip));
    expect(buildReadySnapshot(f).generatedAt).toBe(GENERATED_AT);
  });

  it("serves a clock warning that shows the saved time and none of the trip", () => {
    const { rollback: warning, saved } = buildReadySnapshot(facts());
    const rollback = plain(warning);
    const t = diverTranslator("en-US");
    expect(rollback).toContain(t("ready.offlineClockRollbackHeading"));
    expect(rollback.replaceAll(" ", " ")).toContain("Nov 1, 7:00 AM EST");
    expect(rollback).not.toContain("Two-Tank Reef");
    expect(rollback).not.toContain("Blue Mantis");
    expect(saved).not.toContain(t("ready.offlineClockRollbackHeading"));
  });

  it("adds the unverified-clock warning above the same page", () => {
    const { unverified, saved } = buildReadySnapshot(facts());
    const t = diverTranslator("en-US");
    expect(unverified).toContain(t("ready.offlineClockUnverified"));
    expect(unverified).toContain("Two-Tank Reef");
    expect(saved).not.toContain(t("ready.offlineClockUnverified"));
  });

  it("holds no script, form, link, image or frame in any document", () => {
    const snapshot = buildReadySnapshot(facts());
    expect(allDocuments(snapshot)).not.toMatch(/<(script|form|a|img|iframe|link|input|button)\b/i);
    expect(allDocuments(snapshot)).not.toMatch(/\son[a-z]+=|javascript:/i);
  });

  it("escapes what a shop typed, so a hostile meeting point cannot become markup", () => {
    const hostile = `"><script>fetch('/ready/${TOKEN}')</script><img src=x onerror=alert(1)>`;
    const f = facts();
    const snapshot = buildReadySnapshot({
      ...f,
      trip: { ...f.trip, title: hostile, meetingPointLabel: hostile, arrivalLookFor: hostile },
      shop: { ...f.shop, name: hostile },
    });
    expect(allDocuments(snapshot)).not.toMatch(/<script|<img/i);
    expect(snapshot.saved).toContain("&lt;script&gt;");
  });

  /**
   * The builder reads the fields it names and nothing else. A caller that hands
   * it a whole booking, person or token by mistake still leaks none of it.
   */
  it("never carries a field it was not given a place for", () => {
    const f = facts();
    const smuggled = {
      ...f,
      token: TOKEN,
      claimUrl: `/claim/${"C".repeat(43)}`,
      person: { email: "diver@example.com", emergencyContact: "Sam 555-0199" },
      shop: { ...f.shop, stripeAccount: "acct_secret", rentalItems: ["secret rental"] },
      trip: { ...f.trip, seatPriceCents: 987654, id: "trip-uuid-secret" },
    } as ReadySnapshotFacts;
    const documents = allDocuments(buildReadySnapshot(smuggled));
    for (const secret of [
      TOKEN,
      "/claim/",
      "diver@example.com",
      "Sam 555-0199",
      "acct_secret",
      "secret rental",
      "987654",
      "trip-uuid-secret",
    ]) {
      expect(documents).not.toContain(secret);
    }
  });

  it("names the dock call's time zone, so it reads right from anywhere", () => {
    expect(plain(buildReadySnapshot(facts()).saved)).toMatch(/dock by 7:30 AM EST/);
  });

  describe("the checklist and the rest of the page's outstanding words", () => {
    it("lists the open items in the page's own sentences, as of the save", () => {
      const { saved } = buildReadySnapshot(
        facts({ openItems: ["certification_missing", "medical_review"] }),
      );
      const t = diverTranslator("en-US");
      expect(saved).toContain(t("ready.offlineOutstandingHeading"));
      expect(saved).toContain(t("ready.checklistDetail.certificationMissing"));
      expect(saved).toContain(t("ready.checklistDetail.medicalReview"));
      expect(saved).not.toContain(t("ready.offlineOutstandingNone"));
    });

    it("says an empty list was empty when saved, and never that the diver is ready", () => {
      const { saved } = buildReadySnapshot(facts());
      expect(saved).toContain("Nothing on your checklist was open when this was saved");
      expect(saved).not.toMatch(/\bready to (dive|board)|all set/i);
    });

    it("carries the planned sites, the bring list, what changed and the fly-safe time", () => {
      const { saved } = plainSnapshot(
        facts({
          sites: ["Palancar Reef", "Palancar Reef", "Columbia"],
          packing: { personal: ["mask"], bring: ["Reef-safe sunscreen"] },
          changes: [
            {
              id: "e1",
              tripId: "t",
              kind: "meeting_point",
              source: "shop",
              occurredAt: new Date(Date.UTC(2026, 10, 1, 9, 0)),
              beforeValue: {},
              afterValue: { meetingPointLabel: "North pier" },
            } as never,
          ],
          flySafe: {
            reason: "single",
            from: new Date(Date.UTC(2026, 10, 3, 17, 0)),
            hours: 18,
          } as never,
        }),
      );
      expect(saved).toContain("Planned sites");
      expect(saved).toContain("Palancar Reef");
      expect(saved).toContain("Columbia");
      expect(saved).toContain("Reef-safe sunscreen");
      expect(saved).toContain("What changed");
      expect(saved).toContain("North pier");
      expect(saved).toContain("Flying home soon?");
      expect(saved).toContain("18 hours");
    });

    it("voices the open items in the page's language", () => {
      const { saved } = buildReadySnapshot(
        facts({ locale: "es-ES", openItems: ["certification_missing"] }),
      );
      expect(saved).toContain(diverTranslator("es-ES")("ready.offlineOutstandingHeading"));
      expect(saved).toContain(
        diverTranslator("es-ES")("ready.checklistDetail.certificationMissing"),
      );
    });

    it("escapes everything it carries", () => {
      const { saved } = buildReadySnapshot(
        facts({
          sites: ["<img src=x onerror=alert(1)>"],
          packing: { personal: [], bring: ["<b>"] },
        }),
      );
      expect(saved).not.toContain("<img");
      expect(saved).not.toContain("<b>");
    });
  });
});

function plainSnapshot(f: ReadySnapshotFacts) {
  const s = buildReadySnapshot(f);
  return { ...s, saved: plain(s.saved) };
}
