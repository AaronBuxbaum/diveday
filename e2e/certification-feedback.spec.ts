import { staffTranslator } from "../src/i18n/staff-messages";
import {
  AUDIT_DIVER,
  checkLowerCardRoster,
  savedLowerCard,
  submitLowerCard,
} from "./certification-feedback-helpers";
import { expect, test } from "./fixtures";
import { openThreadStep } from "./helpers";

for (const device of [
  { name: "desktop", viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
]) {
  test.describe(device.name, () => {
    test.use({
      viewport: device.viewport,
      hasTouch: device.hasTouch,
      isMobile: device.isMobile,
      colorScheme: "light",
    });
    test("a lower submitted certification survives reload and remains blocked on staff surfaces", async ({
      page,
      privateShop,
    }) => {
      // Public booking, card submission, reload, roster and Today are separate navigations.
      test.setTimeout(90_000);
      const { tripId, readyPath } = await submitLowerCard(page, privateShop.slug);
      // TEMPORARY: capture only disclosure state and input sequencing, never page data.
      if (device.hasTouch) {
        await page.addInitScript(() => {
          const entries: string[] = [];
          const ids = new WeakMap<Element, number>();
          let nextId = 0;
          const id = (element: Element) => {
            if (!ids.has(element)) ids.set(element, ++nextId);
            return ids.get(element);
          };
          const record = (line: string) => {
            entries.push(`${Math.round(performance.now())} ${line}`);
            if (entries.length > 120) entries.shift();
          };
          const details = (element: Element | null) =>
            element?.closest<HTMLDetailsElement>('[data-thread-step="certification"] > details');
          for (const type of [
            "pointerdown",
            "pointerup",
            "touchstart",
            "touchend",
            "click",
            "toggle",
          ]) {
            for (const capture of [true, false]) {
              document.addEventListener(
                type,
                (event) => {
                  const target = event.target instanceof Element ? event.target : null;
                  const node = details(target);
                  if (node)
                    record(
                      `${type} ${capture ? "capture" : "bubble"} id=${id(node)} open=${node.open} hydrated=${node.dataset.hydrated === "true"} summary=${!!target?.closest("summary")} prevented=${event.defaultPrevented}`,
                    );
                },
                { capture },
              );
            }
          }
          new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              if (
                mutation.type !== "attributes" ||
                !(mutation.target instanceof HTMLDetailsElement)
              )
                continue;
              const node = details(mutation.target);
              if (node === mutation.target)
                record(
                  `attribute ${mutation.attributeName} id=${id(node)} open=${node.open} hydrated=${node.dataset.hydrated === "true"} connected=${node.isConnected}`,
                );
            }
          }).observe(document, {
            subtree: true,
            attributes: true,
            attributeFilter: ["open", "data-hydrated"],
          });
          (window as Window & { __certDebug?: string[] }).__certDebug = entries;
        });
      }
      await page.reload();
      const saved = await openThreadStep(page, "certification");
      await expect(saved.getByText(savedLowerCard())).toBeVisible();
      if (device.hasTouch) {
        await saved.locator(":scope > summary").tap();
        try {
          await expect(saved).not.toHaveAttribute("open", "");
        } catch (error) {
          const entries = await page
            .evaluate(() => (window as Window & { __certDebug?: string[] }).__certDebug ?? [])
            .catch(() => []);
          process.stderr.write(
            `TEMPORARY certification disclosure events: ${JSON.stringify(entries)}\n`,
          );
          throw error;
        }
        await saved.locator(":scope > summary").tap();
        await expect(saved.getByText(savedLowerCard())).toBeVisible();
      }
      await expect(page.locator("body")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await checkLowerCardRoster(page, privateShop.slug, tripId);
      await page.goto(`/shop/${privateShop.slug}`);
      // The seeded Deep Wreck sails tomorrow, inside Today's folded horizon.
      await page
        .locator("summary")
        .filter({ hasText: /^Tomorrow/ })
        .click();
      const row = page.getByRole("listitem").filter({ hasText: AUDIT_DIVER });
      const t = staffTranslator("en-US");
      await expect(
        row.getByText(t("today.diverItem.certificationInsufficient"), { exact: false }),
      ).toBeVisible();
      await expect(
        row.getByText(t("today.diverItem.certificationMissing"), { exact: false }),
      ).toHaveCount(0);
      await page.goto(readyPath);
      await expect(
        (await openThreadStep(page, "certification")).getByText(savedLowerCard()),
      ).toBeVisible();
    });
  });
}
