// @vitest-environment jsdom
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextHeadersStub } from "@/test/next-headers";
import { settingsPaneClass } from "./_components/settings-pane";

/**
 * **The shared left edge is a claim about the DOM, so it is checked in one.**
 * `settingsPaneClass` starts a column on the pane's own edge from `lg` with
 * `lg:[:not(:first-child)>&]:mx-0`, which Tailwind compiles to
 * `:not(:first-child)>.…`: the `<main>` drops its auto margins only when its
 * parent is not the first element in the frame. That holds for every settings
 * page only if the layout's pane `<div>` is each `<main>`'s direct parent and
 * the rail, or its skeleton, is an element before it; and a staffer who may
 * not manage the shop (the rail draws nothing for them, on
 * `/settings/calendar`) keeps a centred pane only if nothing else stands
 * there (K-250, K-312). The source sweep in `settings-pane.test.ts` pins the
 * class; this renders the real layout and asks the parsed DOM the question the
 * compiled selector asks.
 */
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/settings/boats",
}));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/db/authz", () => ({
  canPersonManageShopSettings: vi.fn(),
  canPersonManagePaymentSettings: vi.fn(async () => false),
}));
vi.mock("@/db/stripe-accounts", () => ({
  canAcceptPayments: () => true,
  getShopStripeAccount: vi.fn(async () => null),
}));

const { requireShopSurface } = await import("@/lib/session");
const { canPersonManageShopSettings } = await import("@/db/authz");
const { default: SettingsLayout } = await import("./layout");

type Surface = Awaited<ReturnType<typeof requireShopSurface>>;

const SURFACE = {
  session: { user: { shopId: "shop-1", personId: "person-1", roles: ["owner"] } },
  db: {},
  shop: { slug: "blue-mantis", hasBoatDiving: true, defaultLocale: "en-US" },
} as unknown as Surface;

// What `lg:[:not(:first-child)>&]:mx-0` compiles to, asked of the <main>.
const BESIDE_THE_RAIL = ":not(:first-child) > main";

beforeEach(() => {
  vi.mocked(requireShopSurface).mockResolvedValue(SURFACE);
});

/**
 * The frame as a browser holds it. `progressiveChunkSize: Infinity` writes a
 * finished Suspense boundary in place, which is the DOM React's `$RC` swap
 * leaves once a streamed rail lands; `signal` stops the render with the rail's
 * reads still pending, so its fallback stands where the rail will.
 */
async function renderFrame(signal?: AbortSignal) {
  const { prelude } = await prerender(
    <SettingsLayout params={Promise.resolve({ shopSlug: "blue-mantis" })}>
      <main className={settingsPaneClass()}>pane</main>
    </SettingsLayout>,
    { progressiveChunkSize: Number.POSITIVE_INFINITY, signal, onError: () => {} },
  );
  const html = await new Response(prelude).text();
  const main = document.createRange().createContextualFragment(html).querySelector("main");
  if (!main?.parentElement) throw new Error("the layout rendered no <main> inside a pane");
  return { main, pane: main.parentElement };
}

describe("the settings frame the pane's left edge reads", () => {
  it("stands the rail before the pane, so a manager's column starts on the pane's edge", async () => {
    vi.mocked(canPersonManageShopSettings).mockResolvedValue(true);
    const { main, pane } = await renderFrame();
    expect(pane.previousElementSibling?.tagName).toBe("NAV");
    expect(main.matches(BESIDE_THE_RAIL)).toBe(true);
  });

  it("stands the rail's skeleton there while its reads are pending, so the column starts on the same edge", async () => {
    vi.mocked(requireShopSurface).mockReturnValue(new Promise<Surface>(() => {}));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    const { main, pane } = await renderFrame(controller.signal);
    expect(pane.previousElementSibling).toHaveAttribute("aria-hidden", "true");
    expect(pane.previousElementSibling).toHaveClass("lg:w-[264px]");
    expect(main.matches(BESIDE_THE_RAIL)).toBe(true);
  });

  it("stands nothing before the pane when the rail draws nothing, so the column stays centred", async () => {
    vi.mocked(canPersonManageShopSettings).mockResolvedValue(false);
    const { main, pane } = await renderFrame();
    expect(pane.previousElementSibling).toBeNull();
    expect(main.matches(BESIDE_THE_RAIL)).toBe(false);
    expect(main).toHaveClass("mx-auto");
  });
});
