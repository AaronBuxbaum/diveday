import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { listActiveCourses } from "./courses";
import { readFormDraft } from "./form-drafts";
import { courses, people, shops, websiteSetupDrafts } from "./schema";
import {
  acceptSetupLine,
  dismissSetupLine,
  readWebsiteForSetup,
  readWebsiteSetup,
} from "./website-setup";

const ctx = fileScopedShopContext();

beforeEach(async () => {
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
});

const keyed = { ANTHROPIC_API_KEY: "test-anthropic-key" };

async function owner() {
  const [row] = await ctx.db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, ctx.shop.id))
    .limit(1);
  if (!row) throw new Error("no person");
  return row.id;
}

async function readSite() {
  const [course] = await listActiveCourses(ctx.db, ctx.shop.id);
  if (!course) throw new Error("seed has no course");
  const provider = fakeClaude({
    reply: () =>
      fakeClaudeMessage({
        text: JSON.stringify({
          tagline: { text: "Small boats, big reefs", source: "Small boats, big reefs." },
          description: null,
          phone: { text: "+1 305 555 0199", source: "Call +1 305 555 0199" },
          deskHours: { opens: "07:30", closes: "17:00", source: "Open 7:30 to 5" },
          coursePrices: [{ courseId: course.id, price: 512, source: `${course.title} $512` }],
          departures: [
            { title: "Two-tank reef", startTime: "08:00", price: 95, source: "Reef trip 8am $95" },
          ],
          policies: [{ text: "Cancel 24 hours ahead.", source: "Cancel 24 hours ahead." }],
          unreadable: false,
        }),
      }),
  });
  const outcome = await readWebsiteForSetup(ctx.db, {
    shopId: ctx.shop.id,
    site: "https://www.bluereefdivers.com/",
    provider,
    env: keyed,
  });
  return { outcome, provider, course };
}

describe("readWebsiteForSetup", () => {
  it("stores the proposals and writes nothing to the shop", async () => {
    const before = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    const { outcome, provider } = await readSite();
    expect(outcome).toBe("read");
    const setup = await readWebsiteSetup(ctx.db, ctx.shop.id);
    expect(setup?.host).toBe("www.bluereefdivers.com");
    expect(setup?.lines.map((line) => line.kind)).toEqual([
      "tagline",
      "phone",
      "deskHours",
      "coursePrice",
      "departure",
      "policy",
    ]);
    const after = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    expect(after).toEqual(before);
    // Allowed to fetch the pasted host only, and sent no person.
    const request = JSON.stringify(provider.requests[0]);
    expect(request).toContain('"allowed_domains":["www.bluereefdivers.com"]');
    expect(request).not.toContain("@");
  });

  it("refuses a site the fetch tool will not allow, without calling", async () => {
    const provider = fakeClaude();
    expect(
      await readWebsiteForSetup(ctx.db, {
        shopId: ctx.shop.id,
        site: "http://192.168.0.1",
        provider,
        env: keyed,
      }),
    ).toBe("bad-site");
    expect(provider.requests).toHaveLength(0);
  });
});

describe("acceptSetupLine", () => {
  it("writes each accepted line through its own narrow writer, once", async () => {
    const { course } = await readSite();
    const setup = await readWebsiteSetup(ctx.db, ctx.shop.id);
    const key = (kind: string) => setup?.lines.find((line) => line.kind === kind)?.key ?? "";
    const personId = await owner();

    expect(
      await acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key: key("tagline") }),
    ).toBe("saved");
    expect(
      await acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key: key("tagline") }),
    ).toBe("gone");
    await acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key: key("deskHours") });
    await acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key: key("coursePrice") });
    const [shop] = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    expect(shop).toMatchObject({
      tagline: "Small boats, big reefs",
      deskOpensMinute: 450,
      deskClosesMinute: 1020,
    });
    expect(shop?.contactPhone).not.toBe("+1 305 555 0199");
    const [priced] = await ctx.db
      .select({ priceCents: courses.priceCents })
      .from(courses)
      .where(and(eq(courses.id, course.id), eq(courses.shopId, ctx.shop.id)));
    expect(priced?.priceCents).toBe(51_200);
  });

  it("hands a departure to the board as its own draft, and creates no trip", async () => {
    await readSite();
    const setup = await readWebsiteSetup(ctx.db, ctx.shop.id);
    const departure = setup?.lines.find((line) => line.kind === "departure");
    const personId = await owner();
    expect(
      await acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key: departure?.key ?? "" }),
    ).toBe("departure-drafted");
    const draft = await readFormDraft(ctx.db, ctx.shop.id, personId, "add_departure");
    expect(draft?.fields).toEqual({
      title: "Two-tank reef",
      startTime: "08:00",
      priceDollars: "95",
    });
  });

  it("has no writer for a policy, and dismissing a line stops offering it", async () => {
    await readSite();
    const setup = await readWebsiteSetup(ctx.db, ctx.shop.id);
    const policy = setup?.lines.find((line) => line.kind === "policy")?.key ?? "";
    const personId = await owner();
    expect(await acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key: policy })).toBe(
      "gone",
    );
    expect(await dismissSetupLine(ctx.db, ctx.shop.id, policy)).toBe(true);
    expect(await dismissSetupLine(ctx.db, ctx.shop.id, policy)).toBe(false);
    const after = await readWebsiteSetup(ctx.db, ctx.shop.id);
    expect(after?.lines.find((line) => line.key === policy)?.status).toBe("dismissed");
  });

  // Two interleaved taps on different lines: each writes its own line only.
  // That they also serialise on the draft row (a double tap writes once) is
  // a real-server question, in `website-setup.postgres.test.ts`.
  it("keeps both lines accepted when taps on two lines interleave", async () => {
    await readSite();
    const setup = await readWebsiteSetup(ctx.db, ctx.shop.id);
    const key = (kind: string) => setup?.lines.find((line) => line.kind === kind)?.key ?? "";
    const personId = await owner();
    const outcomes = await Promise.all([
      acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key: key("tagline") }),
      acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key: key("phone") }),
    ]);
    expect(outcomes).toEqual(["saved", "saved"]);
    const after = await readWebsiteSetup(ctx.db, ctx.shop.id);
    const status = (kind: string) => after?.lines.find((line) => line.kind === kind)?.status;
    expect([status("tagline"), status("phone")]).toEqual(["accepted", "accepted"]);
    expect(status("deskHours")).toBe("open");
  });

  it("refuses a tap from a page drawn before the site was read again", async () => {
    await readSite();
    const before = await readWebsiteSetup(ctx.db, ctx.shop.id);
    const stale = before?.lines.find((line) => line.kind === "tagline")?.key ?? "";
    const stalePolicy = before?.lines.find((line) => line.kind === "policy")?.key ?? "";
    const [shopBefore] = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    // Another tab reads the site again: the same positions, a new reading.
    await ctx.db
      .update(websiteSetupDrafts)
      .set({ readAt: new Date((before?.readAt.getTime() ?? 0) + 60_000) })
      .where(eq(websiteSetupDrafts.shopId, ctx.shop.id));
    const personId = await owner();
    expect(await acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key: stale })).toBe(
      "gone",
    );
    expect(await dismissSetupLine(ctx.db, ctx.shop.id, stalePolicy)).toBe(false);
    const [shopAfter] = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    expect(shopAfter?.tagline).toBe(shopBefore?.tagline);
    const after = await readWebsiteSetup(ctx.db, ctx.shop.id);
    expect(after?.lines.every((line) => line.status === "open")).toBe(true);
    // The new reading's own key still works.
    const fresh = after?.lines.find((line) => line.kind === "tagline")?.key ?? "";
    expect(fresh).not.toBe(stale);
    expect(await acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key: fresh })).toBe(
      "saved",
    );
  });

  it("refuses a key that names no reading or no line", async () => {
    await readSite();
    const setup = await readWebsiteSetup(ctx.db, ctx.shop.id);
    const personId = await owner();
    const stamp = String(setup?.readAt.getTime());
    for (const key of ["", "tagline-0", `${stamp}.`, `${stamp}.tagline-99`, "x.tagline-0"]) {
      expect(await acceptSetupLine(ctx.db, { shopId: ctx.shop.id, personId, key })).toBe("gone");
      expect(await dismissSetupLine(ctx.db, ctx.shop.id, key)).toBe(false);
    }
  });

  it("reads no other shop's proposals", async () => {
    await readSite();
    const setup = await readWebsiteSetup(ctx.db, ctx.shop.id);
    expect(
      await acceptSetupLine(ctx.db, {
        shopId: "00000000-0000-0000-0000-000000000000",
        personId: await owner(),
        key: setup?.lines[0]?.key ?? "",
      }),
    ).toBe("gone");
  });
});
