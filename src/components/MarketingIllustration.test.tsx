// @vitest-environment jsdom
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { MarketingIllustration } from "./MarketingIllustration";

afterEach(cleanup);

describe("MarketingIllustration", () => {
  for (const locale of ["en-US", "es-ES"] as const) {
    for (const scene of ["harbor", "classroom"] as const) {
      it(`labels the ${scene} scene as illustration in ${locale} and reserves its space`, () => {
        const t = diverTranslator(locale);
        render(<MarketingIllustration scene={scene} locale={locale} />);
        const image = screen.getByRole("img", { name: t(`marketing.illustrations.${scene}Alt`) });
        expect(image).toHaveAttribute("width", "1536");
        expect(image).toHaveAttribute("height", "1024");
        expect(image).toHaveAttribute("loading", "lazy");
        expect(image).toHaveAttribute("srcset");
        expect(screen.getByText(t("marketing.illustrations.caption"))).toBeInTheDocument();
        expect(statSync(join(process.cwd(), `public/marketing/${scene}.webp`)).size).toBeLessThan(
          500_000,
        );
      });
    }
  }
  it("keeps the original hero product proof and the website help and embeds copy", () => {
    const home = readFileSync(join(process.cwd(), "src/app/(marketing)/page.tsx"), "utf8");
    expect(home).toContain("<CaptainPhoneFrame");
    expect(home).toContain("<MarketingMockup");
    const copy = readFileSync(
      join(process.cwd(), "src/i18n/locales/en-US/content/marketing.json"),
      "utf8",
    );
    expect(copy).toContain("discuss");
    expect(copy).toContain("paste");
  });
});
