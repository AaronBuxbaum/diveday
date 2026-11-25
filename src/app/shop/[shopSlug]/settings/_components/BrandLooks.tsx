"use client";

import { ChoiceFieldset } from "@/components/ui/form";
import { BRAND_DISPLAY_FONTS, BRAND_LOOKS, brandDisplayFontFamily } from "@/lib/brand";

/**
 * Ready-made looks for the storefront (#4824): one tap fills the brand colour
 * and the headline face, and Save stores them like any hand-picked pair. The
 * two fields are plain form controls, so a look writes into them the way a
 * person would (the colour field is controlled, hence the `input` event).
 */
export function BrandLooks({
  legend,
  names,
}: {
  legend: string;
  names: Record<(typeof BRAND_LOOKS)[number]["code"], string>;
}) {
  function apply(color: string, font: string, form: HTMLFormElement | null) {
    const colorField = form?.elements.namedItem("brandColor");
    const fontField = form?.elements.namedItem("brandDisplayFont");
    if (colorField instanceof HTMLInputElement) {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(colorField, color);
      colorField.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (fontField instanceof HTMLSelectElement) fontField.value = font;
  }
  return (
    <ChoiceFieldset
      legend={legend}
      className="device-text-profile-grid"
      bodyClassName="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
    >
      {BRAND_LOOKS.map((look) => (
        <button
          key={look.code}
          type="button"
          onClick={(event) => apply(look.color, look.font, event.currentTarget.form)}
          className="flex min-h-11 items-center gap-2.5 rounded-inset border border-border-strong bg-surface px-3 py-2 text-start"
        >
          <span
            aria-hidden="true"
            className="size-5 shrink-0 rounded-full border border-border-strong"
            style={{ backgroundColor: look.color }}
          />
          <span
            className="text-base"
            style={{ fontFamily: brandDisplayFontFamily(look.font) }}
            title={BRAND_DISPLAY_FONTS[look.font].family}
          >
            {names[look.code]}
          </span>
        </button>
      ))}
    </ChoiceFieldset>
  );
}
