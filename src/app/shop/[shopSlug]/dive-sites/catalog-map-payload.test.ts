import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { DIVE_SITE_TEMPLATES } from "@/content/dive-site-templates";
import { staffDiveSiteDepthText } from "@/i18n/depth-labels";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import { diverTranslator } from "@/i18n/messages";
import { staffTranslator } from "@/i18n/staff-messages";
import { compactCatalogPins } from "./catalog-map-pins";

it("measures seeded-content JSON, not RSC or network bytes, against the 774cd6c8 wire shape", () => {
  const t = staffTranslator("en-US");
  const diverT = diverTranslator("en-US");
  const rows = DIVE_SITE_TEMPLATES.flatMap(({ slug, briefing }) => {
    if (briefing.forecastLatitude == null || briefing.forecastLongitude == null) return [];
    // Seed IDs are random in the database. Use stable UUID-shaped IDs for reproducibility.
    const hash = createHash("sha256").update(slug).digest("hex");
    const templateId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    return [
      {
        ...briefing,
        templateId,
        slug,
        latitude: briefing.forecastLatitude,
        longitude: briefing.forecastLongitude,
        description: Array.from(briefing.description || briefing.currentNote || "")
          .slice(0, 360)
          .join(""),
      },
    ];
  }).sort((a, b) => a.slug.localeCompare(b.slug));
  const oldPins = rows.map((site) => ({
    id: site.templateId,
    name: site.name,
    latitude: site.latitude,
    longitude: site.longitude,
    details: [
      staffDiveSiteDepthText(t, site, "meters"),
      diveSiteDifficultyLabel(site.difficultyLevel, diverT),
    ].filter(Boolean),
    description: site.description,
    href: `/shop/blue-mantis/dive-sites?view=catalog&template=${encodeURIComponent(site.slug)}`,
    hrefLabel: t("diveSites.map.openSite"),
    tone: "primary",
  }));
  const compact = compactCatalogPins(rows);
  const bytes = (pins: unknown) => {
    const json = Buffer.from(JSON.stringify(pins));
    return {
      raw: json.length,
      gzip: gzipSync(json).length,
      brotli: brotliCompressSync(json).length,
    };
  };
  for (const pin of compact)
    expect(Object.keys(pin)).toEqual(["id", "slug", "name", "latitude", "longitude"]);
  expect(compact).toHaveLength(oldPins.length);
  expect(bytes(compact).raw).toBeLessThan(bytes(oldPins).raw);
  console.log(
    "catalog-seeded-json-bytes",
    JSON.stringify({
      rows: rows.length,
      locale: "en-US",
      depthUnit: "meters",
      deterministicIds: true,
      old774cd6c8: bytes(oldPins),
      compact: bytes(compact),
    }),
  );
});
