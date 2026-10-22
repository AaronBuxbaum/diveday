import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeClaude, fakeClaudeMessage } from "@/test/fakes";
import { importAssistFor, waiverDraftFromPdf } from "./file-assists";
import { claudeUsage, shops } from "./schema";

const ctx = fileScopedShopContext();

beforeEach(async () => {
  await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
});

const keyed = { ANTHROPIC_API_KEY: "test-anthropic-key" };

function answering(value: unknown) {
  return fakeClaude({ reply: () => fakeClaudeMessage({ text: JSON.stringify(value) }) });
}

const CSV = [
  "Nom complet,Courriel,Brevet,Taille combi,Antécédents médicaux",
  "Lena Vogel,lena.vogel@example.org,Sauveteur,M,asthma",
  "Ari Cohen,ari.cohen@example.org,Fortgeschritten,L,none",
].join("\n");

describe("importAssistFor", () => {
  it("maps the columns the importer could not, from masked samples, and never sends a medical column", async () => {
    const provider = answering({
      columns: [
        { header: "Taille combi", field: "wetsuit_size" },
        { header: "Brevet", field: "certification_level" },
      ],
      levels: [
        { spelling: "sauveteur", level: "rescue" },
        { spelling: "fortgeschritten", level: "advanced_open_water" },
      ],
    });
    const assist = await importAssistFor(ctx.db, {
      shopId: ctx.shop.id,
      csv: CSV,
      provider,
      env: keyed,
    });
    expect(assist?.headers).toMatchObject({ "Taille combi": "wetsuit_size" });
    const sent = JSON.stringify(provider.requests[0]);
    expect(sent).not.toContain("lena.vogel@example.org");
    expect(sent).not.toContain("asthma");
    expect(sent).not.toContain("Antécédents médicaux");
    const [usage] = await ctx.db
      .select({ feature: claudeUsage.feature })
      .from(claudeUsage)
      .where(eq(claudeUsage.shopId, ctx.shop.id));
    expect(usage?.feature).toBe("import_mapping");
  });

  it("asks nothing when every column already maps", async () => {
    const provider = answering({ columns: [], levels: [] });
    expect(
      await importAssistFor(ctx.db, {
        shopId: ctx.shop.id,
        csv: "first_name,last_name,email\nLena,Vogel,lena@example.org",
        provider,
        env: keyed,
      }),
    ).toBeNull();
    expect(provider.requests).toHaveLength(0);
  });
});

const PDF = new TextEncoder().encode("%PDF-1.7\n% a release\n");

describe("waiverDraftFromPdf", () => {
  const body = "I understand that scuba diving carries risks, and I take part of my own free will.";

  it("drafts the release text from a PDF", async () => {
    const provider = answering({ body, notAWaiver: false, confidence: 0.9 });
    expect(
      await waiverDraftFromPdf(ctx.db, { shopId: ctx.shop.id, bytes: PDF, provider, env: keyed }),
    ).toBe(body);
    expect(JSON.stringify(provider.requests[0])).toContain('"media_type":"application/pdf"');
  });

  it("refuses a file that is not a PDF, or a document that is not a waiver", async () => {
    const provider = answering({ body: "", notAWaiver: true, confidence: 0.9 });
    expect(
      await waiverDraftFromPdf(ctx.db, {
        shopId: ctx.shop.id,
        bytes: new TextEncoder().encode("<html>"),
        provider,
        env: keyed,
      }),
    ).toBeNull();
    expect(provider.requests).toHaveLength(0);
    expect(
      await waiverDraftFromPdf(ctx.db, { shopId: ctx.shop.id, bytes: PDF, provider, env: keyed }),
    ).toBeNull();
  });
});
