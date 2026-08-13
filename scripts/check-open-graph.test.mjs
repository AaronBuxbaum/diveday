import { describe, expect, it } from "vitest";

import {
  ACKNOWLEDGEMENT,
  countOpenGraphBlocks,
  findBareOpenGraphBlocks,
} from "./check-open-graph.mjs";

const lines = (source) => findBareOpenGraphBlocks(source).map((v) => v.line);

describe("a block that drops the site-level fields", () => {
  it("catches the shape every affected page had — its own words, no spread", () => {
    // src/app/s/[shopSlug]/page.tsx before 2026-08-12: og:url and og:title
    // present, og:site_name and og:type silently gone.
    expect(
      lines(`return {
  openGraph: { title, description, url: canonical },
};`),
    ).toEqual([2]);
  });

  it("catches a multi-line block, and reports the openGraph line rather than the brace", () => {
    expect(
      lines(`export const metadata = {
  title: "x",
  openGraph: {
    title: "x",
    url: "/x",
  },
};`),
    ).toEqual([3]);
  });

  it("reports each offending block separately in one file", () => {
    expect(
      lines(`const a = { openGraph: { url: "/a" } };
const b = { openGraph: { url: "/b" } };`),
    ).toEqual([1, 2]);
  });
});

describe("a block that names the site", () => {
  it("accepts openGraphSite, the site-level pair on its own", () => {
    expect(lines("openGraph: { ...openGraphSite, title, url: canonical },")).toEqual([]);
  });

  it("accepts sharedLinkCard, which contains it plus the card image", () => {
    expect(
      lines(`openGraph: {
  ...sharedLinkCard,
  title: "x",
  url: "/product",
},`),
    ).toEqual([]);
  });

  it("does not end the block early on a nested object", () => {
    // `images: [{ … }]` closes a brace mid-block; a naive scan would stop
    // there and miss the spread that follows.
    expect(
      lines(`openGraph: {
  images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  ...openGraphSite,
},`),
    ).toEqual([]);
  });
});

describe("what is not a declaration", () => {
  it("never flags a property read", () => {
    expect(lines("const site = metadata.openGraph?.siteName;")).toEqual([]);
  });

  it("never flags a longer identifier that merely ends in the key", () => {
    expect(lines("resolvedOpenGraph: { title },")).toEqual([]);
  });
});

describe("the acknowledgement", () => {
  it("accepts a bare block when the same line says why", () => {
    expect(
      lines(`openGraph: { title }, // ${ACKNOWLEDGEMENT}: a token page must not name the site`),
    ).toEqual([]);
  });

  it("accepts one when the line above says why", () => {
    expect(
      lines(`// ${ACKNOWLEDGEMENT}: a token page must not name the site
openGraph: { title },`),
    ).toEqual([]);
  });

  it("refuses a bare marker with no reason after it", () => {
    expect(lines(`openGraph: { title }, // ${ACKNOWLEDGEMENT}:`)).toEqual([1]);
  });
});

describe("the block count", () => {
  it("counts acknowledged blocks too — it reports coverage, not violations", () => {
    const source = `openGraph: { ...openGraphSite },
openGraph: { title }, // ${ACKNOWLEDGEMENT}: why`;
    expect(countOpenGraphBlocks(source)).toBe(2);
    expect(lines(source)).toEqual([]);
  });

  it("ignores an unterminated block rather than throwing", () => {
    expect(countOpenGraphBlocks("openGraph: { title")).toBe(0);
    expect(lines("openGraph: { title")).toEqual([]);
  });
});
