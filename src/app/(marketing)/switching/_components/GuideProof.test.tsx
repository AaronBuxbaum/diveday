// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { FEATURE_PAGES } from "@/lib/feature-pages";

vi.mock("@/app/actions/demo", () => ({ enterDemoAction: vi.fn() }));
const { GuideProof } = await import("./GuideProof");
afterEach(cleanup);

it.each(DIVER_LOCALES)("shows the crew workflow and opens its Today demo in %s", (locale) => {
  const t = diverTranslator(locale);
  const { container } = render(<GuideProof locale={locale} source="switching-peek-mid" />);
  expect(screen.getByRole("heading", { name: t("switching.common.proof.title") })).toBeVisible();
  expect(screen.getByText("Priya Sharma")).toBeVisible();
  expect(screen.getByText("Diego Alvarez")).toBeVisible();
  expect(container.querySelector('input[name="role"]')).toHaveValue("owner");
  expect(container.querySelector('input[name="landing"]')).toHaveValue("today");
  // The concierge panel below carries Get set up; this band offers only the demo.
  expect(screen.queryByRole("link", { name: t("marketing.common.getSetUp") })).toBeNull();
  const routes = new Set(FEATURE_PAGES.map(({ slug }) => `/product/${slug}`));
  for (const link of container.querySelectorAll('a[href^="/product/"]')) {
    expect(routes.has(link.getAttribute("href") ?? "")).toBe(true);
  }
});
