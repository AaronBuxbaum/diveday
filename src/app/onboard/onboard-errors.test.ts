import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { onboardErrorField, onboardErrorMessage } from "./onboard-errors";

describe("onboarding refusal presentation", () => {
  it.each(["en-US", "es-ES"])("never echoes unknown query codes in %s", (locale) => {
    const t = diverTranslator(locale);
    for (const untrusted of ["__proto__", "<script>untrusted</script>"]) {
      expect(onboardErrorMessage(t, untrusted, {})).toBe(t("account.onboard.errors.invalidInput"));
      expect(onboardErrorField(untrusted)).toBe("form");
    }
  });

  it("keeps a known field refusal on its field and a rate limit on the form", () => {
    expect(onboardErrorField("shop_slug_taken")).toBe("shopSlug");
    expect(onboardErrorField("rate_limited")).toBe("form");
  });
});
