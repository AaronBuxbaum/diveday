import { expect, signedInAsOwner, test } from "./fixtures";
import { openCounterFor, openDiverFileGroup, openRosterRow, walkInFormPath } from "./helpers";

for (const width of [390, 1280]) {
  test.describe(`consistent controls at ${width}px`, () => {
    signedInAsOwner();
    test.use({ viewport: { width, height: 844 } });

    test("the walk-in name and its remove action share a control size", async ({ page }) => {
      const tripId = await openCounterFor(page, "blue-mantis", "Priya Sharma");
      await page.goto(walkInFormPath("blue-mantis", tripId));
      await page.getByRole("button", { name: "Add another person" }).click();
      const person = page.getByRole("group", { name: "Person 2" });
      const input = person.getByLabel("Full name");
      const remove = person.getByRole("button", { name: "Remove person 2" });
      await expect(input).toBeVisible();
      const inputBox = await input.boundingBox();
      const removeBox = await remove.boundingBox();
      if (!inputBox || !removeBox) throw new Error("Walk-in controls are missing");
      expect(removeBox.height).toBe(inputBox.height);
      expect(removeBox.height).toBeGreaterThanOrEqual(48);
      if (width >= 640) expect(removeBox.y).toBe(inputBox.y);
      await remove.click();
      await expect(person).toHaveCount(0);
    });

    test("the coming-as editor keeps its select and save action level", async ({ page }) => {
      await openCounterFor(page, "blue-mantis", "Priya Sharma");
      await openRosterRow(page, "Priya Sharma");
      await page.getByText("Coming as: Diver", { exact: true }).click();
      const select = page.locator('select[name="participantType"]:visible');
      // Measure in one frame: the containing sheet can still be entering,
      // so separate boundingBox calls would compare two animation frames.
      const geometry = await select.evaluate((field) => {
        const button = field.closest("form")?.querySelector("button");
        if (!button) throw new Error("Coming-as save action is missing");
        const inputBox = field.getBoundingClientRect();
        const buttonBox = button.getBoundingClientRect();
        return {
          heightDifference: buttonBox.height - inputBox.height,
          topDifference: buttonBox.y - inputBox.y,
        };
      });
      expect(geometry.heightDifference).toBe(0);
      expect(geometry.topDifference).toBe(0);
    });

    test("the card-check disclosure has a complete touch target", async ({ page }) => {
      await page.goto("/shop/blue-mantis/settings#cert-check");
      await expect(page.locator('[data-settings-section="cert-check"] > details')).toHaveAttribute(
        "open",
        "",
      );
      const summary = page.locator("summary").filter({ hasText: "Try the checks" });
      await expect(summary).toBeVisible();
      const box = await summary.boundingBox();
      if (!box) throw new Error("Card-check disclosure is missing");
      // Bounding-box subtraction returned 43.99998474121094px for a 44px
      // control. Restore Chromium's 1/64px layout precision, preserving real
      // subpixel shortfalls rather than rounding to a whole CSS pixel.
      expect(Math.round(box.height * 64) / 64).toBeGreaterThanOrEqual(44);
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Run the checks" })).toBeVisible();
    });

    test("the catch-up dismiss action keeps a complete target on its inset", async ({
      page,
      request,
    }) => {
      const seeded = await request.post("/api/test/seed-trouble-states?mixedBoat=1");
      expect(seeded.ok()).toBe(true);
      const { mixedBoat } = (await seeded.json()) as { mixedBoat?: { tripId: string } };
      if (!mixedBoat) throw new Error("The mixed departure is missing");
      await page.goto(`/shop/blue-mantis/trips/${mixedBoat.tripId}/manifest`);
      const strip = page.getByRole("region", { name: /Since you looked at/ });
      const dismiss = strip.getByRole("button", { name: "Got it", exact: true });
      await expect(dismiss).toBeVisible();
      const geometry = await dismiss.evaluate(async (button) => {
        await document.fonts.ready;
        const panel = button.closest("section");
        if (!panel) throw new Error("The catch-up panel is missing");
        const bounds = button.getBoundingClientRect();
        const label = document.createRange();
        label.selectNodeContents(button);
        const labelBounds = label.getBoundingClientRect();
        return {
          width: bounds.width,
          height: bounds.height,
          labelRight: labelBounds.right,
          labelCenter: (labelBounds.left + labelBounds.right) / 2,
          targetCenter: (bounds.left + bounds.right) / 2,
          insetRight:
            panel.getBoundingClientRect().right -
            Number.parseFloat(getComputedStyle(panel).paddingRight),
        };
      });
      expect(geometry.width).toBeGreaterThanOrEqual(44);
      expect(geometry.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(geometry.labelCenter - geometry.targetCenter)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(geometry.labelRight - geometry.insetRight)).toBeLessThanOrEqual(0.5);
      await dismiss.click();
      await expect(strip).toHaveCount(0);
    });

    test("the email correction is a touch target and applies only on intent", async ({ page }) => {
      await page.goto("/s/blue-mantis");
      await page
        .getByRole("list", { name: "Upcoming trips" })
        .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
        .click();
      const email = page.getByLabel("Email", { exact: true });
      await email.fill("avery@gmial.com");
      await email.press("Tab");
      const correction = page.getByRole("button", { name: /avery@gmail\.com/ });
      await expect(correction).toBeVisible();
      await expect(email).toHaveValue("avery@gmial.com");
      const box = await correction.boundingBox();
      if (!box) throw new Error("Email correction is missing");
      expect(box.height).toBeGreaterThanOrEqual(44);
      await correction.click();
      await expect(email).toHaveValue("avery@gmail.com");
    });

    test("the course schedule keeps its times at the readable fact size", async ({ page }) => {
      await page.goto("/s/blue-mantis/courses/open-water-diver");
      const times = page.locator("#how-it-runs p");
      await expect(times.first()).toBeVisible();
      const sizes = await times.evaluateAll((elements) =>
        elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
      );
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
    });

    test("agency verification keeps a full target as a link or extension action", async ({
      page,
    }) => {
      await page.goto("/shop/blue-mantis/divers?q=Mateo+Duarte");
      await page.getByRole("link", { name: "Mateo Duarte", exact: true }).click();
      await openDiverFileGroup(page, "Certification records");
      const link = page.locator('a[href*="my.divessi.com"]:visible').first();
      await expect(link).toBeVisible();
      const label = (await link.textContent())?.trim();
      if (!label) throw new Error("Agency verification link has no label");
      // The credential must remain a separate fact. Measuring the text node
      // catches an inline control running into it even when the target is tall.
      const geometry = (control: Element) => {
        const row = control.closest("li");
        if (!row) throw new Error("Agency verification card is missing");
        const text = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        let credential = text.nextNode();
        while (credential && credential.textContent?.trim() !== "DEMO-0014") {
          credential = text.nextNode();
        }
        if (!credential) throw new Error("Agency verification credential is missing");
        const range = document.createRange();
        range.selectNodeContents(credential);
        const target = control.getBoundingClientRect();
        return {
          height: target.height,
          top: target.top,
          credentialBottom: range.getBoundingClientRect().bottom,
        };
      };
      const linkBox = await link.evaluate(geometry);
      expect(linkBox.height).toBeGreaterThanOrEqual(44);
      expect(linkBox.top).toBeGreaterThanOrEqual(linkBox.credentialBottom);

      await page.evaluate(() => {
        document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
        window.dispatchEvent(new Event("diveday-cert-check-ready"));
      });
      const action = page.getByRole("button", { name: label, exact: true });
      await expect(action).toBeVisible();
      const actionBox = await action.evaluate(geometry);
      expect(actionBox.height).toBeGreaterThanOrEqual(44);
      expect(actionBox.top).toBeGreaterThanOrEqual(actionBox.credentialBottom);
    });
  });
}
