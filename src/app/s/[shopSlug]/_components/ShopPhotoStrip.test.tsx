import type { ReactElement } from "react";
import { expect, it } from "vitest";

import { PhotoLightbox } from "@/components/PhotoLightbox";
import type { DiverTranslator } from "@/i18n/messages";

import { ShopPhotoStrip } from "./ShopPhotoStrip";

it("passes serializable thumbnail data across the server-to-client boundary", () => {
  const t = ((key: string) => key) as DiverTranslator;
  const strip = ShopPhotoStrip({ urls: ["/shop.jpg"], label: "Shop photos", t });
  const lightbox = (strip?.type === PhotoLightbox ? strip : strip?.props.children) as ReactElement<
    Record<string, unknown>
  >;
  expect(lightbox.type).toBe(PhotoLightbox);
  // Next serializes these props before the client can hydrate the photo controls.
  expect(() => structuredClone(lightbox.props)).not.toThrow();
});
