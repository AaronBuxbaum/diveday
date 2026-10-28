/**
 * Visual captures: the front door: marketing, pricing, sign-in and its notices, onboarding, the legal and switching pages, the feature pages, and a freshly set-up shop.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import type { Page } from "@playwright/test";
import { LISTED_SHOP_SLUGS } from "../src/db/seed-identifiers";
import { diverTranslator } from "../src/i18n/messages";
import { type FeaturePageSlug, featurePagePath } from "../src/lib/feature-pages";
import { publicFindMyBookingPath } from "../src/lib/public-routes";
import { enrollSignInChallenge, startSignInChallenge } from "./auth-challenge";
import { expect, signedInAsOwner, test } from "./fixtures";
import { E2E_FROZEN_CLOCK } from "./servers";
import { mintOnboardFormPath } from "./setup-link";
import {
  capture,
  diverCopy,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  SPANISH,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    // Base viewport for navigation and clicks; `capture` resizes to each entry
    // in VIEWPORTS for the screenshots and restores this afterward.
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test.describe("public", () => {
      for (const locale of ["en-US", SPANISH] as const) {
        test.describe(`marketing menu ${locale}`, () => {
          test.use({ locale });
          test(`the mobile marketing menu opens and returns focus (${scheme})`, async ({
            page,
          }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.goto("/");
            const words = diverTranslator(locale);
            const nav = page.getByRole("navigation", { name: words("nav.mainNavigation") });
            const menu = nav.getByRole("button", { name: words("nav.menu"), exact: true });
            await expect(menu).toHaveAttribute("data-hydrated", "true");
            await menu.click();
            await expect(
              nav.getByRole("link", { name: words("nav.product"), exact: true }),
            ).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(menu).toHaveAttribute("aria-expanded", "false");
            await expect(menu).toBeFocused();
            await capture(page, "marketing-menu-open", scheme, {
              ...(locale === SPANISH ? { locale: SPANISH } : {}),
              beforeShot: async () => {
                if (await menu.isVisible()) {
                  if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
                  await expect(
                    nav.getByRole("link", { name: words("nav.product"), exact: true }),
                  ).toBeVisible();
                }
              },
            });
          });
        });
      }

      /**
       * **The counter's QR door** (issue #1236): the form a walk-in fills in
       * before any booking exists. Three groups — who they are, what they say
       * their card is, and the sizes that save a fitting — on a page a shop
       * prints a QR for and puts on the desk.
       */
      test(`the shopfront's register form renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/s/blue-mantis/register");
        await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
        await page.getByRole("heading", { level: 1 }).waitFor();
        await page.getByRole("button", { name: "Send it to the shop" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "shopfront-register", scheme);
      });

      for (const locale of ["en-US", SPANISH] as const) {
        test.describe(`registration certification ${locale}`, () => {
          test.use({ locale });
          test(`native agency selection reveals the existing declaration fields (${scheme})`, async ({
            page,
          }) => {
            const words = diverTranslator(locale);
            await page.goto("/s/blue-mantis/register");
            await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
            const agency = page.getByLabel(words("register.agencyLabel"));
            const level = page.getByLabel(words("register.levelLabel"));
            const number = page.getByLabel(words("register.identifierLabel"));
            await expect(page.getByText(words("register.uncertified"))).toBeVisible();
            await expect(level).toBeHidden();
            await expect(number).toBeHidden();
            await capture(page, "shopfront-register-uncertified", scheme, {
              ...(locale === SPANISH ? { locale: SPANISH } : {}),
            });
            await agency.selectOption("padi");
            await expect(level).toBeVisible();
            await level.selectOption("rescue");
            await number.fill("PADI-778899");
            await capture(page, "shopfront-register-certified", scheme, {
              ...(locale === SPANISH ? { locale: SPANISH } : {}),
            });
            await agency.selectOption("");
            await expect(level).toBeHidden();
            await agency.selectOption("padi");
            await expect(level).toHaveValue("rescue");
            await expect(number).toHaveValue("PADI-778899");
          });

          if (scheme === "light") {
            test("200% text size keeps populated certification disclosures readable and keyboard reachable", async ({
              page,
            }) => {
              const words = diverTranslator(locale);
              await page.goto("/s/blue-mantis/register");
              const form = page.locator("form[data-hydrated='true']");
              await expect(form).toBeVisible();
              // Existing course-form accessibility coverage uses root text size too.
              // This is text enlargement, not browser zoom or image scaling.
              await page.evaluate(() => {
                document.documentElement.style.fontSize = "200%";
              });
              await page.getByLabel(words("register.nameLabel")).fill("María Fernanda Rodríguez");
              await page.getByLabel(words("register.emailLabel")).fill("maria@example.test");
              await page.getByLabel(words("register.phoneLabel")).fill("+1 305 555 0147");
              await expect(form.locator("#phone ~ [id$='-description']")).toBeVisible();
              await page.getByLabel(words("register.wetsuitLabel")).fill("XL tall");
              await page.getByLabel(words("register.bootLabel")).fill("US 10 / EU 43");
              await page.getByLabel(words("register.finLabel")).fill("XL open heel");
              const agency = page.getByLabel(words("register.agencyLabel"));
              const level = page.getByLabel(words("register.levelLabel"));
              const number = page.getByLabel(words("register.identifierLabel"));
              const overflowChecks: {
                page: boolean;
                controls: string[];
                labels: (string | undefined)[];
              }[] = [];
              const headingChecks: boolean[] = [];
              const readable = async () => {
                await expect
                  .poll(async () =>
                    page.locator("[data-chrome-natural]").evaluate((header) => {
                      const token = Number.parseFloat(
                        getComputedStyle(document.documentElement).getPropertyValue("--chrome-h"),
                      );
                      return Math.abs(token - header.getBoundingClientRect().height);
                    }),
                  )
                  .toBeLessThanOrEqual(1);
                const heading = await page
                  .getByRole("heading", { level: 1 })
                  .evaluate((element) => {
                    const bounds = element.getBoundingClientRect();
                    const range = document.createRange();
                    range.selectNodeContents(element);
                    const lines = [...range.getClientRects()].map((rect) => ({
                      left: rect.left,
                      right: rect.right,
                    }));
                    const viewport = document.documentElement.clientWidth;
                    return {
                      viewport,
                      bounds: { left: bounds.left, right: bounds.right },
                      lines,
                      outsideViewport: lines.some(
                        (line) => line.left < -1 || line.right > viewport + 1,
                      ),
                    };
                  });
                headingChecks.push(heading.outsideViewport);
                await test.info().attach(`enlarged-heading-${page.viewportSize()?.width}`, {
                  body: JSON.stringify(heading, null, 2),
                  contentType: "application/json",
                });
                const chrome = await page.locator("[data-chrome-bar]").evaluate((header) => {
                  const bounds = header.getBoundingClientRect();
                  return {
                    viewport: window.innerWidth,
                    header: { top: bounds.top, bottom: bounds.bottom, height: bounds.height },
                    token: getComputedStyle(document.documentElement).getPropertyValue(
                      "--chrome-h",
                    ),
                    controls: [...header.querySelectorAll("a, button")].map((control) => {
                      const rect = control.getBoundingClientRect();
                      return {
                        name: control.textContent?.trim() || control.getAttribute("aria-label"),
                        top: rect.top,
                        bottom: rect.bottom,
                        left: rect.left,
                        right: rect.right,
                        outsideHeader: rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1,
                      };
                    }),
                  };
                });
                await test.info().attach(`enlarged-header-${page.viewportSize()?.width}`, {
                  body: JSON.stringify(chrome, null, 2),
                  contentType: "application/json",
                });
                const overflow = await form.evaluate((element) => {
                  const width = document.documentElement.clientWidth;
                  return {
                    page: document.documentElement.scrollWidth > width + 1,
                    controls: [...element.querySelectorAll("input, select, button")].flatMap(
                      (control) => {
                        const bounds = control.getBoundingClientRect();
                        return bounds.width > 0 && (bounds.left < -1 || bounds.right > width + 1)
                          ? [control.getAttribute("name") ?? control.tagName]
                          : [];
                      },
                    ),
                    labels: [
                      ...element.querySelectorAll("label, legend, p, [id$='-description']"),
                    ].flatMap((label) => {
                      const bounds = label.getBoundingClientRect();
                      if (bounds.width === 0) return [];
                      const range = document.createRange();
                      range.selectNodeContents(label);
                      return [...range.getClientRects()].some(
                        (rect) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1,
                      )
                        ? [label.textContent?.trim()]
                        : [];
                    }),
                  };
                });
                // Preserve the complete native capture matrix before reporting a
                // geometry failure, so the failing state remains reviewable.
                overflowChecks.push(overflow);
              };
              await expect(level).toBeHidden();
              await expect(number).toBeHidden();
              await capture(page, "shopfront-register-uncertified-text-200", scheme, {
                ...(locale === SPANISH ? { locale: SPANISH } : {}),
                beforeShot: readable,
              });
              await agency.selectOption("padi");
              await level.selectOption("rescue");
              await number.fill("PADI-778899");
              await capture(page, "shopfront-register-certified-text-200", scheme, {
                ...(locale === SPANISH ? { locale: SPANISH } : {}),
                beforeShot: async () => {
                  await agency.focus();
                  await page.keyboard.press("Tab");
                  await expect(level).toBeFocused();
                  await page.keyboard.press("Tab");
                  await expect(number).toBeFocused();
                  await readable();
                },
              });
              expect(headingChecks).toEqual([false, false, false, false]);
              expect(overflowChecks).toEqual([
                { page: false, controls: [], labels: [] },
                { page: false, controls: [], labels: [] },
                { page: false, controls: [], labels: [] },
                { page: false, controls: [], labels: [] },
              ]);
            });
          }
        });
      }

      /**
       * **The night-before reminder, on the diver's last boat** (ux-delight
       * sheet 2026-10-22, item 1; H-150): the fly-safe rule in hours under
       * the dock time, never a clock time. The email as sent, from the
       * preview route's fixture notification.
       */
      test(`the night-before reminder email says the fly-safe hours (${scheme})`, async ({
        page,
        request,
      }) => {
        const response = await request.get("/api/test/email-previews");
        expect(response.ok()).toBe(true);
        const { previews } = (await response.json()) as {
          previews: { kind: string; message: { html: string } }[];
        };
        const reminder = previews.find((preview) => preview.kind === "trip_reminder_24h");
        if (!reminder) throw new Error("no night-before reminder preview");
        await page.setContent(reminder.message.html);
        const flySafe = diverTranslator("en-US")("notifications.tripReminder.flySafe", {
          count: 24,
        });
        await page.getByText(flySafe).waitFor();
        await capture(page, "email-reminder-night-before", scheme);
      });

      test(`the landing page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/");
        await capture(page, "landing", scheme);
      });

      // The other two buyer-facing sales surfaces: the features hub (every
      // feature page by phase with its checklist folded under it, the groups
      // no page owns, honest-no scope) and the pricing page with its
      // objection FAQ. Copy changes here are product changes.
      test(`the product page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/product");
        await capture(page, "product", scheme);
      });

      test(`the pricing page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/pricing");
        await capture(page, "pricing", scheme);
      });

      // Where a shop the owner has spoken to is opened: two group labels over
      // the fields, the storefront address written under the shop link, and
      // the one trial sentence (ADR 20260827-first-light, decision 1). Only
      // behind the setup key (ADR 20260925-shops-are-set-up-by-hand).
      test(`the onboarding form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto(await mintOnboardFormPath(page));
        // This route owns a loading.tsx, and `goto` resolves on the document
        // load event while the body is still streaming — a bare capture here
        // once shot the skeleton and published it as the baseline
        // (onboard-light-vw-390, caught only when the next PR's correct
        // render diffed against it). The page's own <h1> is the readiness
        // proof: every page renders one, no skeleton does. Same wait on every
        // capture below whose route owns a loading.tsx.
        await page.locator("h1").first().waitFor();
        await capture(page, "onboard", scheme);
      });

      // What everyone without the key meets at `/onboard`: one sentence on how
      // a shop is set up and the door to the set-up form.
      test(`the closed onboarding door renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/onboard");
        await expect(page).toHaveURL(/\/get-set-up\?from=onboard-closed$/);
        await page.locator("h1").first().waitFor();
        await capture(page, "onboard-closed", scheme);
      });

      // Where every "Get set up" door lands (ADR 20261007-setup-request-form):
      // seven asks, two of them as pills.
      test(`the set-up request form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/get-set-up?from=pricing");
        await page.locator("h1").first().waitFor();
        await capture(page, "get-set-up", scheme);
      });

      // The form as a FareHarbor guide's concierge door opens it (2026-10-22):
      // "A booking system" answered, and "Which one?" asked and answered.
      test(`the set-up form asks which system (${scheme})`, async ({ page }) => {
        await page.goto("/get-set-up?from=switching-fareharbor-concierge");
        await page.locator("h1").first().waitFor();
        await page.getByRole("radio", { name: "FareHarbor" }).waitFor();
        await capture(page, "get-set-up-which-system", scheme);
      });

      // The thank-you page a sent request lands on, with the demo door.
      test(`the set-up request thank-you page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/get-set-up/sent");
        await page.locator("h1").first().waitFor();
        await capture(page, "get-set-up-sent", scheme);
      });

      // DiveDay's door for a diver who lost their link (fourth review, item
      // 50): the listed shops, each leading to its own find-my-booking.
      test(`the diver's shop picker renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/find-your-booking");
        await page.locator("h1").first().waitFor();
        // The picker lists every public shop in the shared database, so a shop
        // another capture made first (the Bookable Moment shop) would change
        // this picture with test order (#2690). Only the seeded listed shops
        // stay in the frame; the page is otherwise exactly as it rendered.
        await page.getByRole("list", { name: diverCopy("findYourBooking.listLabel") }).waitFor();
        await page.evaluate((kept) => {
          for (const item of document.querySelectorAll("main ul > li")) {
            const href = item.querySelector("a")?.getAttribute("href") ?? "";
            if (!kept.includes(href)) item.remove();
          }
        }, LISTED_SHOP_SLUGS.map(publicFindMyBookingPath));
        await expect(
          page
            .getByRole("list", { name: diverCopy("findYourBooking.listLabel") })
            .getByRole("listitem"),
        ).toHaveCount(LISTED_SHOP_SLUGS.length);
        await capture(page, "find-your-booking", scheme);
      });

      for (const locale of ["en-US", SPANISH] as const) {
        test.describe(`sign-in challenge ${locale}`, () => {
          // The browser locale also sets Accept-Language. Keep only setup in
          // English via the reader cookie, then switch it for the subject flow.
          test.use({
            locale,
            storageState: {
              cookies: [
                {
                  name: "diveday_locale",
                  value: "en-US",
                  domain: "127.0.0.1",
                  path: "/",
                  expires: -1,
                  httpOnly: false,
                  secure: false,
                  sameSite: "Lax",
                },
              ],
              origins: [],
            },
          });
          test(`the code-only sign-in states render true to the design ${locale} (${scheme})`, async ({
            page,
            privateShop,
          }) => {
            test.setTimeout(FLOW_TIMEOUT_MS);
            await enrollSignInChallenge(page, privateShop.slug);
            if (locale === SPANISH)
              await page
                .context()
                .addCookies([
                  { name: "diveday_locale", value: SPANISH, url: new URL(page.url()).origin },
                ]);
            await startSignInChallenge(page, privateShop.ownerEmail, locale);
            const words = diverTranslator(locale);
            const captureOptions = locale === SPANISH ? { locale: SPANISH } : {};
            await capture(page, "sign-in-second-factor-direct", scheme, captureOptions);
            await page
              .getByRole("textbox", { name: words("account.signIn.twoFactorCode") })
              .fill("AAAAAA");
            await page
              .getByRole("button", { name: words("account.signIn.verify"), exact: true })
              .click();
            await expect(page).toHaveURL(/\/sign-in\?error=invalid-code$/);
            await expect(
              page.getByRole("alert").filter({ hasText: words("account.signIn.invalidCode") }),
            ).toBeVisible();
            await capture(page, "sign-in-second-factor-invalid", scheme, captureOptions);
            let release!: () => void;
            let continued!: () => void;
            const gate = new Promise<void>((resolve) => {
              release = resolve;
            });
            const delivered = new Promise<void>((resolve) => {
              continued = resolve;
            });
            await page.route("**/sign-in*", async (route) => {
              if (route.request().method() === "POST") {
                await gate;
                await route.continue();
                continued();
              } else await route.continue();
            });
            try {
              await page
                .getByRole("textbox", { name: words("account.signIn.twoFactorCode") })
                .fill("AAAAAA");
              await page
                .getByRole("button", { name: words("account.signIn.verify"), exact: true })
                .click();
              await expect(
                page.getByRole("button", { name: words("account.signIn.signingIn"), exact: true }),
              ).toBeDisabled();
              await expect(
                page.getByRole("alert").filter({ hasText: words("account.signIn.invalidCode") }),
              ).toBeHidden();
              await capture(page, "sign-in-second-factor-pending", scheme, captureOptions);
            } finally {
              release();
              await delivered;
              await page.unroute("**/sign-in*");
            }
            await expect(
              page.getByRole("button", { name: words("account.signIn.verify"), exact: true }),
            ).toBeEnabled();
            expect(
              (
                await page.request.post(
                  `/api/test/seed-trouble-states?authChallengeState=expired&shop=${privateShop.slug}`,
                )
              ).ok(),
            ).toBe(true);
            await page.reload();
            await expect(
              page.getByLabel(words("account.common.password"), { exact: true }),
            ).toBeVisible();
            await capture(page, "sign-in-second-factor-expired", scheme, captureOptions);
          });
        });
      }

      test(`the sign-in page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/sign-in");
        await capture(page, "sign-in", scheme);
      });

      // The same form after a signed-out visitor followed a `/shop/**` link:
      // Auth.js's `callbackUrl` names the shop, so the page offers that shop's
      // public schedule instead of leaving a diver at a staff password field.
      test(`the sign-in shop escape hatch renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/sign-in?callbackUrl=%2Fshop%2Fblue-mantis%2Fdivers");
        await capture(page, "sign-in-shop-escape", scheme);
      });

      test(`the forgot-password page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/forgot-password");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "forgot-password", scheme);
      });

      // The sent door — the only home of the `sent` mark, and the one terminal
      // state reachable without a real token (ADR 20260827-first-light,
      // decision 2: the mark is a drawn stroke, never an emoji, so it is now a
      // thing a baseline can hold to across platforms at all). `?sent=1` is
      // exactly what the enumeration-safe action redirects to for every
      // outcome, so this is the real page and not a mock of it.
      test(`the reset-sent door renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/forgot-password?sent=1");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "forgot-password-sent", scheme);
      });

      // The token pages' one always-reachable state: an unrecognized token
      // never renders anything but this same closed notice (no live token to
      // capture the confirm/reset form with — see e2e/account-lifecycle.spec.ts).
      test(`the invalid email-verification notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/verify/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "verify-invalid", scheme);
      });

      test(`the invalid password-reset notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/reset-password/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "reset-password-invalid", scheme);
      });

      test(`the invalid unsubscribe notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/unsubscribe/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "unsubscribe-invalid", scheme);
      });

      test(`the invalid contact-confirmation notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/confirm-contact/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "confirm-contact-invalid", scheme);
      });

      // Its own test rather than another stop on a public tour: a trust page
      // whose baseline is skipped because a long test ran out of budget is the
      // one baseline you'd most want.
      /**
       * The two legal pages, published 2026-08-14
       * (FU-20260812-no-privacy-or-terms-page). Their own captures rather than
       * a stop on a public tour, for the same reason `/about` has one: these
       * are long unbroken columns of prose, which is the shape that breaks
       * quietest — a measure that runs too wide, a dark-mode contrast that
       * fails on muted body text, a definition list whose term and body run
       * together. Nothing about them is interactive, so a screenshot is
       * genuinely the whole test.
       */
      test(`the privacy page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/privacy");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await capture(page, "privacy", scheme);
      });

      test(`the terms page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/terms");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await capture(page, "terms", scheme);
      });

      // The page a shop owner opens on their worst morning, so the one whose
      // dark mode and phone width are worth a baseline: a status mark, a
      // headline, two ruled rows and a timestamp. The clock is frozen by the
      // harness, so "Last checked …" is stable pixels rather than a mask
      // (ADR 20260907-external-uptime-monitor).
      test(`the status page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/status");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await capture(page, "status", scheme);
      });

      test(`the about page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/about");
        await capture(page, "about", scheme);
      });

      // The migration-guides hub: one ruled row per thing a shop might be
      // leaving, the entry point to the portability wedge on the marketing side.
      // Also the only baseline covering `ImportPreviewFallback`, the mockup that
      // makes this page's "exactly what comes across" promise visible instead of
      // merely stated — its mapped-column chips and skipped row are the parts a
      // diff here should be read against.
      test(`the switching hub renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching");
        await page.getByRole("heading", { name: "Bring your shop with you" }).waitFor();
        await capture(page, "switching-hub", scheme);
      });

      // The "Switching from EVE" migration guide: the marketing face of the
      // portability wedge — export click-path, the shared scope table, and the
      // importer, on the market's most motivated switching pool. Represents the
      // one shared composition (`src/app/switching/_components/guide.tsx`) that
      // every guide, incumbent or not, renders as a single numbered move rail.
      test(`the EVE switching guide renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching/eve");
        await page.getByRole("heading", { name: "Moving your shop off EVE" }).waitFor();
        await capture(page, "switching-eve", scheme);
      });

      // The non-incumbent switching guide: shops coming from a spreadsheet — the
      // market's largest under-served pool. Same shared composition as the
      // incumbent guides, with its own first phase (columns-that-matter, the
      // downloadable template) and three rail phases instead of four — there is
      // no incumbent to cut over from.
      test(`the spreadsheet switching guide renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/switching/spreadsheet");
        await page.getByRole("heading", { name: "Bring the spreadsheet with you" }).waitFor();
        await capture(page, "switching-spreadsheet", scheme);
      });

      // The FareHarbor guide: the coexist-led variant of the composition, for a
      // booking channel a shop keeps rather than a records system it leaves —
      // the "keep it, or leave it" section (the ruled run-the-day list plus the
      // leave path) that only the channel guides render.
      test(`the FareHarbor switching guide renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/switching/fareharbor");
        await page
          .getByRole("heading", { name: "FareHarbor fills the seats. DiveDay runs the boat" })
          .waitFor();
        await capture(page, "switching-fareharbor", scheme);
      });

      // The Rezdy guide: the second booking-channel guide, same coexist shape
      // with its own copy (a monthly-plus-per-booking model). Baselined so its
      // page — and the extra hub row it adds — stay pixel-stable.
      test(`the Rezdy switching guide renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching/rezdy");
        await page
          .getByRole("heading", { name: "Rezdy sells the seats. DiveDay runs the boat" })
          .waitFor();
        await capture(page, "switching-rezdy", scheme);
      });

      // The twelve feature pages (`src/lib/feature-pages.ts`, H-93). One
      // template draws them all, so what differs from page to page is the copy
      // and the screen each one draws (`src/components/MarketingFeatureScreens.tsx`
      // and the three older drawings it reuses). Every page is captured because
      // every page draws a different screen, and the screen is the part a diff
      // here should be read against. Spelled out one by one rather than looped,
      // so each name is one `scripts/route-coverage.json` can find.
      const openFeaturePage = async (page: Page, slug: FeaturePageSlug) => {
        await page.goto(featurePagePath(slug));
        // The route owns a loading.tsx, so the page's own <h1> is the readiness
        // proof, as on the onboarding form: the skeleton draws none.
        await page.getByRole("heading", { level: 1 }).waitFor();
      };

      test(`the online booking feature page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openFeaturePage(page, "online-booking");
        await capture(page, "feature-online-booking", scheme);
      });

      test(`the website feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "website");
        await capture(page, "feature-website", scheme);
      });

      test(`the waivers feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "waivers");
        await capture(page, "feature-waivers", scheme);
      });

      test(`the certifications feature page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openFeaturePage(page, "certifications");
        await capture(page, "feature-certifications", scheme);
      });

      test(`the messages feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "messages");
        await capture(page, "feature-messages", scheme);
      });

      test(`the check-in feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "check-in");
        await capture(page, "feature-check-in", scheme);
      });

      test(`the boat manifest feature page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openFeaturePage(page, "boat-manifest");
        await capture(page, "feature-boat-manifest", scheme);
      });

      test(`the dive sites feature page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openFeaturePage(page, "dive-sites");
        await capture(page, "feature-dive-sites", scheme);
      });

      test(`the rental gear feature page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openFeaturePage(page, "rental-gear");
        await capture(page, "feature-rental-gear", scheme);
      });

      test(`the schedule feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "schedule");
        await capture(page, "feature-schedule", scheme);
      });

      test(`the courses feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "courses");
        await capture(page, "feature-courses", scheme);
      });

      test(`the payments feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "payments");
        await capture(page, "feature-payments", scheme);
      });

      /**
       * The seeded demo shop's day spine never runs dry, so the shared
       * `EmptyState` card the spine renders when nothing needs attention
       * (docs/design/principles.md, terminal-vs-section empty states) has no
       * other baseline. A freshly onboarded shop is the real "empty queue"
       * scenario — same flow as e2e/onboard.spec.ts's first-run checklist test.
       *
       * **Two captures in one test, deliberately.** `settings-billing` is
       * this shop's Settings > Billing page — demo shops have no Billing door
       * and are never billed, so `blue-mantis` (the seeded demo shop the
       * other settings captures use) can never show a trial's standing. Both
       * images contain the shop's slug — the first-run checklist renders the
       * public schedule URL. A second test would have to onboard a *second*
       * shop, because `/api/test/reset` reseeds the demo shop and purges
       * minted demo shops but does not delete one created through `/onboard`,
       * so the slug would have to differ — and a different slug is different
       * pixels in every baseline. Splitting here would move a baseline to buy
       * isolation, which is the wrong trade; the captures are one
       * onboarded session anyway. The trial's standing is clock-anchored and
       * deterministic: this shop's `created_at` is the harness's one frozen
       * instant, so "21 days left" and the end date never drift between runs.
       */
      test(`a freshly onboarded shop's Today tab renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // A real sign-up flow, then two captures.
        test.setTimeout(FLOW_TIMEOUT_MS);
        // Deterministic, not Date.now(): this slug renders on screen (the
        // "Share your public schedule" URL), and neither DIVEDAY_CLOCK nor the
        // browser-context clock fixture freezes a value read in the Node.js
        // test process itself — a wall-clock slug here is a permanent visual
        // diff between CI runs, not a real regression. `scheme` alone
        // (light/dark) is unique enough since this test runs once per scheme
        // and the suite has no retries (playwright.config.ts).
        const unique = `today-empty-${scheme}`;
        await page.goto(await mintOnboardFormPath(page));
        await page
          .locator('input[name="shopName"]')
          .filter({ visible: true })
          .fill("Fresh Shop E2E");
        await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
        await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
        await page
          .locator('input[name="ownerEmail"]')
          .filter({ visible: true })
          .fill(`${unique}@example.com`);
        await page
          .locator('input[name="ownerPassword"]')
          .filter({ visible: true })
          .fill("trial-pass-123");
        await page.getByRole("button", { name: "Create shop & start trial" }).click();
        await page.waitForURL(new RegExp(`/shop/${unique}$`));
        await page.getByRole("heading", { name: "First morning" }).waitFor();
        // The canvas's `FirstMorning` board: the setup ledger as the day
        // spine's leading group, under its own group label (ADR
        // 20260827-first-light, decision 6). The checklist is the page now. The queue's "Nothing is waiting on
        // you" state — a claim about a roster this shop does not have — used to
        // render directly beneath it, and the header sentence above said "No
        // boats out today" of a shop that has never had a board (issue #711).
        await expect(page.getByRole("heading", { name: "Nothing is waiting on you" })).toHaveCount(
          0,
        );
        await capture(page, "today-empty", scheme);

        // **`today-empty-departures` retired here**, with the by-departure view
        // it photographed: that capture existed to catch `BlockerGroups`'s own
        // `EmptyState`, and both are gone (ADR
        // 20260827-clearwater-surface-language, decision 4). The one empty
        // state left on this page is the spine's, which `today-empty` above
        // already frames.

        // **The page this shop is told to paste on its website.** Step 4 of the
        // checklist above hands over this URL, and nothing had ever
        // photographed what a visitor finds at it before the shop has data —
        // the seed, the specs and every other capture see a shop with a board.
        // What was there: an empty state telling a diver to call a number the
        // page withholds, a discount list for boats that do not exist, and the
        // one form that would help switched off because the shop had not set a
        // contact email (issue #710). Free to take here — the shop already
        // exists and this is one navigation.
        await page.goto(`/s/${unique}`);
        // A shop this new has nothing on the board, so it lands in the quiet
        // state N-45 designed rather than the empty list it used to show. The
        // heading it waits for is the one that replaced "No trips on the books
        // yet" — a sentence that read as a shop which had stopped rather than
        // one which had not started, which is exactly the wrong thing to say
        // on the page a shop is told to paste on its own website.
        await page.getByRole("heading", { name: "Nothing on the water for a while" }).waitFor();
        // **Day zero is a shape, not a failure state** (ADR
        // 20260827-clearwater-surface-language, decision 8). The
        // schedule heading stays concise without a fabricated tagline or
        // rating. With no boat to book, the date-request composer supplies
        // the page's primary action.
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          diverCopy("schedule.title"),
        );
        await expect(page.getByRole("region", { name: "Next boat with space" })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Book this boat" })).toHaveCount(0);
        await capture(page, "public-schedule-new-shop", scheme);
        // In the quiet state the composer is the page's one primary and comes
        // up already open, so there is no disclosure left to click — the shot
        // above now carries the form rather than a collapsed row. Assert it is
        // reachable without one, which is the promotion N-45 makes.
        await expect(page.locator("details#request-a-date > summary")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();

        // **The board before anything is on it.** The `schedule-builder`
        // baseline is shot against blue-mantis, whose board always has
        // fourteen departures, so the state a new owner actually opens on had
        // no capture at all — and it had grown four controls, two of them
        // primary-weight, one of which ("Add a booking") leads to a departure
        // picker with no departures in it (issue 797). The header now stands
        // down here and the empty state holds the one door. Free to take —
        // the shop and the session already exist.
        await page.goto(`/shop/${unique}/schedule/board`);
        await page.getByRole("heading", { name: "Nothing upcoming on the board" }).waitFor();
        await capture(page, "schedule-builder-empty", scheme);

        // Same session, straight to Settings > Billing: the one place a trial
        // shop's owner sees its standing (days left, and — with the billing
        // env absent here, as in every e2e build — "billing isn't turned on").
        await page.goto(`/shop/${unique}/settings/billing`);
        await page.getByRole("heading", { name: "Your plan" }).waitFor();
        await capture(page, "settings-billing", scheme);

        // **The Gear page before a fleet exists** (issue #2412): the empty
        // register and the one door it holds, which nothing photographed. Free
        // to take here for the reason the board's empty frame is: the shop and
        // its session already exist, and no other shop in the suite has no gear.
        await page.goto(`/shop/${unique}/gear`);
        await page.getByRole("heading", { name: "No gear on the register yet" }).waitFor();
        await capture(page, "gear-empty", scheme);
      });

      /**
       * The bookable moment: the first departure ever landing on the board is
       * the exact instant the first-run checklist (and the share link it
       * carried) leaves Today, so the created notice grows into a share card
       * exactly once — e2e/first-ten-minutes.spec.ts drives the behavior, this
       * is the surface. Same fresh-shop-per-scheme pattern (and deterministic
       * slug reasoning) as the `today-empty` capture above: the slug renders
       * inside the card, so it must not contain a wall-clock stamp.
       */
      test(`the first bookable moment renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const unique = `bookable-${scheme}`;
        await page.goto(await mintOnboardFormPath(page));
        await page
          .locator('input[name="shopName"]')
          .filter({ visible: true })
          .fill("Bookable Moment E2E");
        await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
        await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
        await page
          .locator('input[name="ownerEmail"]')
          .filter({ visible: true })
          .fill(`${unique}@example.com`);
        await page
          .locator('input[name="ownerPassword"]')
          .filter({ visible: true })
          .fill("trial-pass-123");
        await page.getByRole("button", { name: "Create shop & start trial" }).click();
        await page.waitForURL(new RegExp(`/shop/${unique}$`));

        // The first (and only-ever-first) departure, dated off the frozen
        // clock so the card and queue rows render pixel-identically per run.
        await page.goto(`/shop/${unique}/schedule/board/new`);
        const tomorrow = new Date(Date.parse(E2E_FROZEN_CLOCK) + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        await page.locator('input[name="title"]').fill("Two-Tank Morning Reef");
        await page.locator('input[name="date"]').fill(tomorrow);
        await page.getByLabel("Departs").fill("08:00");
        await page.getByLabel("Returns").fill("12:30");
        await page.getByRole("button", { name: "Put it on the board" }).click();
        await page.waitForURL(new RegExp(`/shop/${unique}\\?created=`));
        await page.getByRole("heading", { name: "Your shop is bookable" }).waitFor();
        await capture(page, "today-first-bookable", scheme);

        // The orientation's *other* form, on the same shop rather than a
        // second sign-up. `RoleOrientationCard` above is what a Today with
        // nothing on it renders; the moment the page has work to show
        // (`hasWorkToShow`, src/app/shop/[shopSlug]/page.tsx) the same pointer
        // compresses to `RoleOrientationLine` so the queue keeps the top of
        // the page. Reaching that state needs a real shop whose owner has not
        // dismissed orientation *and* a queue row — the demo shop suppresses
        // orientation entirely and `today-empty` deliberately has no bookings,
        // so no other capture in this suite can render the line.
        //
        // One hand-entered diver is enough: seating owes a waiver on join
        // (src/db/seat-diver.ts), the departure is inside the operational
        // horizon, so Today gains a waiver row.
        await page.goto(`/shop/${unique}/bookings/new`);
        await page.getByRole("link", { name: /Two-Tank Morning Reef/ }).click();
        await page.getByRole("link", { name: "Add diver" }).click();
        await page.waitForURL(/\/divers\/new\?/);
        await page.getByLabel("Full name").fill("Marisol Vega");
        await page.getByLabel("Email", { exact: true }).fill(`marisol-${scheme}@example.com`);
        await page.getByRole("button", { name: "Add to trip" }).click();
        await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);

        await page.goto(`/shop/${unique}`);
        // The line's own tour link, which is what the line exists to keep.
        await page
          .getByRole("link", { name: "Open Schedule to see this week’s departures." })
          .waitFor();
        // ...and proof it is the line and not the card: the two forms share
        // that link, so waiting on it alone would pass on either.
        await expect(
          page.getByRole("heading", { name: "New here? A few pointers for your role" }),
        ).toHaveCount(0);
        // **The coral morning, in the same frame** (the canvas's `FirstBooking`
        // board; ADR 20260827-first-light, decision 6). Marisol Vega is this
        // shop's first booking ever and her departure is still ahead, so the
        // once-ever moment is live here — and it is live in exactly one place
        // in the suite, because every other shop with bookings has more than
        // one. Deliberately *not* a second capture: it is the same page at the
        // same viewport, and a duplicate frame buys a name, not a baseline.
        await expect(page.getByText("Your first booking")).toBeVisible();
        // `.first()`: her name is also the subject of the waiver row her own
        // seat just created, which is the point — the moment names the diver,
        // the queue names the job.
        await expect(page.getByText("Marisol Vega").first()).toBeVisible();
        await capture(page, "today-orientation-line", scheme);
      });
    });

    /**
     * The marketing header's second face. `MarketingNavView` renders two
     * different bars off one session read: signed out it offers "Sign in" and
     * "Try the live demo" (#934); signed in it drops the sign-in link entirely
     * and turns the CTA slot into the way back to that staffer's own shop.
     * Every public capture above is the signed-out bar, so the signed-in one —
     * the header a shop owner actually sees every time they come back to read
     * the pricing page — had no baseline at all.
     *
     * Its own `test.describe` because `signedInAsOwner()` is a describe-scoped
     * `storageState`; the sibling "public" block must stay anonymous.
     *
     * Shot on `/onboard` rather than the landing page because it is the
     * shortest marketing surface (one sentence and a mail), so the duplicated
     * body below the header costs the least. The header markup is identical
     * on every marketing route, so this frame is the state, not a special case
     * of it.
     */
    test.describe("public, signed in", () => {
      signedInAsOwner();

      test(`the marketing header renders true to the design for a signed-in staffer (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/onboard");
        // Wait on the signed-in CTA itself, not the page heading: the heading
        // renders in the static shell, so it proves nothing about the
        // session-aware nav having streamed in over MarketingNavFallback.
        // Scoped to the banner because the footer grew its own session-aware
        // "Go to shop" link when it was aligned with the nav (#394). That one
        // streams in from a different server component, so waiting on whichever
        // resolved first would let the header still be showing its fallback at
        // capture time — the one thing this frame exists to catch.
        //
        // By landmark role rather than by the nav's accessible name: that name
        // is `t("nav.mainNavigation")`, a message-bundle string, so matching on
        // its English text would couple this spec to one locale. `banner` is
        // the `<header>` the nav sits in and carries no copy.
        await page.getByRole("banner").getByRole("link", { name: "Go to shop" }).waitFor();
        await capture(page, "marketing-nav-signed-in", scheme);
      });
    });
  });
}
