import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab } from "./helpers";
import type { AuditCapture } from "./visual-audit-capture";

type BoundaryLevel = "segment" | "global";
type BodyKey = "bodyDone" | "bodySaved" | "bodyBooked";

const LOCALIZED_BOUNDARIES = [
  { name: "claim", path: "/claim/not-a-real-token", body: "bodyDone" },
  { name: "contact", path: "/confirm-contact/not-a-real-token", body: "bodyDone" },
  { name: "invite", path: "/invite/not-a-real-token", body: "bodyDone" },
  { name: "ready", path: "/ready/not-a-real-token", body: "bodyDone" },
  { name: "reset", path: "/reset-password/not-a-real-token", body: "bodyDone" },
  { name: "unsubscribe", path: "/unsubscribe/not-a-real-token", body: "bodyDone" },
  { name: "verify", path: "/verify/not-a-real-token", body: "bodyDone" },
  { name: "waiver", path: "/waivers/not-a-real-token", body: "bodySaved" },
  { name: "recap", path: "/recap/not-a-real-token", body: "bodySaved" },
  { name: "shopfront", path: "/s/blue-mantis", body: "bodyBooked" },
] satisfies readonly { name: string; path: string; body: BodyKey }[];

/**
 * Show the installed Next boundary's real fallback, as DevTools can do.
 *
 * This is deliberately a controlled appearance/reset audit, not evidence that
 * a particular application fault is caught. No markup, product hook or fault
 * route is added: the existing handler renders its own errorComponent with
 * the route's real providers, shell and styles.
 *
 * The structural contract is checked against the installed Next sources:
 * client/components/error-boundary.js stores {error: {thrownValue}} and
 * previousPathname. app-router.js wraps the custom global fallback in one
 * further handler for Next's built-in last resort, so the custom global
 * handler is second-last. Fail closed if that contract stops being present.
 */
async function boundaryState(page: Page, level: BoundaryLevel, show: boolean) {
  return page.evaluate(
    ({ level, show }) => {
      const heading = Array.from(document.querySelectorAll("h1")).find(
        (candidate) => candidate.getClientRects().length > 0,
      );
      if (!heading) return 0;
      const fiberKey = Object.getOwnPropertyNames(heading).find((key) =>
        key.startsWith("__reactFiber$"),
      );
      if (!fiberKey) return 0;
      const handlers = [];
      let fiber = Reflect.get(heading, fiberKey);
      while (fiber && typeof fiber === "object") {
        const instance = Reflect.get(fiber, "stateNode");
        if (instance && typeof instance === "object") {
          const props = Reflect.get(instance, "props");
          const state = Reflect.get(instance, "state");
          if (
            props &&
            typeof props === "object" &&
            Reflect.get(props, "errorComponent") &&
            state &&
            typeof state === "object" &&
            Object.hasOwn(state, "previousPathname") &&
            typeof Reflect.get(instance, "setState") === "function"
          ) {
            handlers.push(instance);
          }
        }
        fiber = Reflect.get(fiber, "return");
      }
      if (show) {
        const handler = level === "global" ? handlers.at(-2) : handlers[0];
        if (!handler) throw new Error("The installed Next error handler was not found");
        Reflect.apply(Reflect.get(handler, "setState"), handler, [
          { error: { thrownValue: new Error("Controlled visual audit boundary state") } },
        ]);
      }
      return handlers.length;
    },
    { level, show },
  );
}

async function auditFallback(
  page: Page,
  captureAudit: AuditCapture,
  name: string,
  expected: { title: string; body: string; reset: string; minimumTarget: number },
  level: BoundaryLevel = "segment",
) {
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        "main .animate-pulse:not([data-live-pulse]), [data-suspense-placeholder]",
      ),
  );
  const originalHeading = (
    await page.getByRole("heading", { level: 1 }).first().innerText()
  ).trim();
  await expect
    .poll(() => boundaryState(page, level, false))
    .toBeGreaterThanOrEqual(level === "global" ? 2 : 1);
  await boundaryState(page, level, true);
  await expect(
    page.getByRole("heading", { level: 1, name: expected.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(expected.body, { exact: true })).toBeVisible();
  const reset = page.getByRole("button", { name: expected.reset, exact: true });
  await expect(reset).toBeVisible();
  const measurements: object[] = [];
  await captureAudit(page, name, "light", {
    beforeShot: async () => {
      const geometry = await reset.evaluate(async (button) => {
        await document.fonts.ready;
        const heading = Array.from(document.querySelectorAll("h1")).find(
          (candidate) => candidate.getClientRects().length > 0,
        );
        if (!heading) throw new Error("The error fallback has no heading");
        const titleStyle = getComputedStyle(heading);
        const bodyStyle = getComputedStyle(document.body);
        const target = button.getBoundingClientRect();
        return {
          viewport: window.innerWidth,
          headingFont: titleStyle.fontFamily,
          headingSize: titleStyle.fontSize,
          headingWeight: titleStyle.fontWeight,
          bodyFont: bodyStyle.fontFamily,
          plexVariable: bodyStyle.getPropertyValue("--font-plex-sans"),
          plexLoaded:
            document.fonts.check("700 30px plexSans") &&
            Array.from(document.fonts).some(
              (face) =>
                face.family.replace(/^["']|["']$/g, "") === "plexSans" &&
                face.weight === "700" &&
                face.status === "loaded",
            ),
          targetWidth: target.width,
          targetHeight: target.height,
        };
      });
      expect(geometry.targetHeight).toBeGreaterThanOrEqual(expected.minimumTarget);
      expect(geometry.targetWidth).toBeGreaterThanOrEqual(44);
      if (level === "global") {
        expect(geometry.headingSize).toBe("30px");
        expect(geometry.headingWeight).toBe("700");
        expect(geometry.headingFont).toContain("plexSans");
        expect(geometry.bodyFont).toContain("plexSans");
        expect(geometry.plexVariable.trim()).not.toBe("");
        expect(geometry.plexLoaded).toBe(true);
      }
      measurements.push(geometry);
    },
  });
  await test.info().attach("controlled-boundary-geometry", {
    body: JSON.stringify({ evidence: "appearance and reset", name, measurements }, null, 2),
    contentType: "application/json",
  });
  await reset.click();
  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(originalHeading);
  await expect(reset).toHaveCount(0);
}

/** One-off audit only: these states are reached by controlled framework state. */
export function registerErrorAuditCaptures(captureAudit: AuditCapture) {
  if (process.env.VISUAL_EXHAUSTIVE_AUDIT !== "1") return;

  for (const locale of ["en-US", "es-ES"] as const) {
    const copy = diverTranslator(locale);
    test.describe(`light mode — controlled localized error fallbacks (${locale})`, () => {
      test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 }, locale });
      for (const boundary of LOCALIZED_BOUNDARIES) {
        test(`${boundary.name} renders its actual fallback and resets`, async ({ page }) => {
          await page.goto(boundary.path);
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await auditFallback(page, captureAudit, `error-${boundary.name}-${locale}`, {
            title: copy("errorBoundary.title"),
            body: copy(`errorBoundary.${boundary.body}`),
            reset: copy("errorBoundary.tryAgain"),
            minimumTarget: 44,
          });
        });
      }
    });
  }

  test.describe("light mode — controlled staff error fallbacks", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });
    const staffFailure = {
      title: "That didn’t go through",
      body: "This screen ran into a problem. Your last change may not have saved — tap to try again.",
      reset: "Try again",
      minimumTarget: 56,
    };
    test("the staff-day fallback renders in the real staff shell and resets", async ({ page }) => {
      await page.goto("/shop/blue-mantis");
      await auditFallback(page, captureAudit, "error-staff-day", staffFailure);
    });
    test("the departure fallback renders in the real trip shell and resets", async ({ page }) => {
      await page.goto("/shop/blue-mantis/schedule/board");
      await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
      await openTripTab(page, "Trip");
      await auditFallback(page, captureAudit, "error-staff-departure", staffFailure);
    });
  });

  test.describe("light mode — controlled root error fallback", () => {
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });
    test("the global fallback replaces the real layout and resets", async ({ page }) => {
      await page.goto("/about");
      await auditFallback(
        page,
        captureAudit,
        "error-global",
        {
          title: "Something went sideways",
          body: "That one's on us — it's already been reported. Try again, or write in directly if it keeps happening; reaching out is always welcome.",
          reset: "Try again",
          minimumTarget: 44,
        },
        "global",
      );
    });
  });
}
