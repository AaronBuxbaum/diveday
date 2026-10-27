import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * **The paper day** (N-54): one printable document holding every departure of
 * today, so a dead tablet costs a printer rather than the day.
 *
 * What is worth driving in a browser here is not the assembly — `TripPacket`
 * is the same component the per-trip packet prints, and `e2e/trips.spec.ts`
 * already pins its three sections — but the two things only a real page can
 * answer: that the day's own door reaches it, and that widening one departure
 * to several did not put a control back on paper. The packet hides every
 * button through one `.trip-print-bundle` rule, and that rule is a backstop
 * whose whole value is that nobody has to remember it.
 */
test.describe("the paper day", () => {
  signedInAsOwner();

  test("the morning end of the day spine prints every departure of today", async ({ page }) => {
    // Composing the manifest and prep readers once per departure is still the
    // slowest staff render in the app, and it is a document nobody navigates
    // twice — the budget belongs to the printer, not to the 15s default. It no
    // longer belongs at ninety seconds, though: the page now composes three
    // departures at a time instead of all of them at once (issue #1598), and
    // measured here at one worker on an idle machine the whole test is 6.5s.
    // Forty-five is about seven times that, which covers a four-shard runner
    // with room to spare and still fails a genuinely stuck render inside a
    // minute rather than inside two.
    test.setTimeout(45_000);

    await page.goto("/shop/blue-mantis");
    // The day's own stations, by the heading each one wears. Read before the
    // packet so the assertion below compares two independent renders of the
    // same day rather than the packet against itself.
    const stationHeadings = page
      .getByRole("heading", { level: 3 })
      .filter({ has: page.locator('a[href*="/trips/"]') });
    // The spine streams its stations in behind the route's own `loading.tsx`,
    // so wait for the first one the page actually renders. `allInnerTexts`
    // resolves against whatever is in the DOM at the moment it is called and
    // never retries, so reading it straight after `goto` raced the stream and
    // returned an empty list — the page was still fetching when it answered.
    await expect(stationHeadings.first()).toBeVisible();
    const stationTitles = await stationHeadings.allInnerTexts();
    expect(stationTitles.length).toBeGreaterThan(0);

    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Print the day" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup).toHaveURL(/\/shop\/blue-mantis\/print$/);
    await expect(popup.getByRole("heading", { level: 1, name: "Day packet" })).toBeVisible();

    // Three sections per departure, and the same three the single-trip packet
    // prints: the dive plan rendered as words, the manifest (which carries the
    // roster's waiver state and the shop's emergency card), and the morning
    // packing list.
    // Wait for the document's own completion marker before counting anything.
    // `PacketReady` renders after the last sheet and is what `AutoPrint` waits
    // on before opening the dialog, so it is the app's own answer to "the
    // document is whole" rather than a timing guess. Counting before it lands
    // would read a partial number, and the `toHaveCount(departures)` lines
    // below would then auto-wait to that wrong number and pass.
    await expect(popup.locator("[data-packet-ready]")).toBeAttached();
    const divePlans = popup.getByRole("heading", { name: "Dive plan", exact: true });
    const departures = await divePlans.count();
    expect(departures).toBeGreaterThan(0);
    await expect(popup.getByRole("heading", { name: "Manifest", exact: true })).toHaveCount(
      departures,
    );
    await expect(popup.getByRole("heading", { name: "Prep", exact: true })).toHaveCount(departures);

    // Every boat the day spine showed is on the paper. The packet can hold
    // more — a departure that sailed an hour ago has left the spine's
    // forward-looking stations and is still very much on today's sheet — so
    // this is containment, not equality.
    for (const title of stationTitles) {
      // A Needs-you group heading also links its boat and adds the time
      // after " · "; the boat's title is what the packet prints.
      const boat = title.split("\n")[0].split(" · ")[0].trim();
      await expect(popup.getByText(boat, { exact: false }).first()).toBeVisible();
    }

    // The sheet says which day it is: paper outlives the morning it left the
    // printer, and a captain holding page seven has no other way to tell.
    await expect(popup.getByText(/\d{4}/).first()).toBeVisible();

    // Each departure's three sections own different named pages. The name
    // transition creates the physical break even when break-before is auto
    // on a section that is its wrapper's first child. Verify the browser's
    // resolved ownership, then the actual paginated PDF rather than a CSS
    // break-before value that cannot describe named-page transitions.
    await popup.emulateMedia({ media: "print" });
    const sectionPages = await popup.locator(".print-bundle-page").evaluateAll((elements) =>
      elements.map((element) => {
        // Plan/prep wrap their section; the composed manifest owns its name inside it.
        const owner =
          element.closest("[data-departure-paper]") ??
          element.querySelector("[data-departure-paper]");
        return {
          headingId: element.getAttribute("aria-labelledby"),
          page: owner ? getComputedStyle(owner).page : null,
        };
      }),
    );
    expect(sectionPages).toHaveLength(departures * 3);
    const sectionNames = ["dives", "manifest", "prep"];
    for (const [index, section] of sectionPages.entries()) {
      const name = sectionNames[index % sectionNames.length];
      const prefix = `print-${name}-`;
      expect(section.headingId).toMatch(new RegExp(`^${prefix}`));
      const tripId = section.headingId?.slice(prefix.length).toLowerCase();
      const paperName = name === "manifest" ? "manifest-departure" : name;
      expect(section.page).toBe(`departure-${tripId}-${paperName}`);
    }
    expect(new Set(sectionPages.map((section) => section.page)).size).toBe(sectionPages.length);
    await popup.evaluate(() => document.fonts.ready);
    const pdf = await popup.pdf({ format: "Letter", preferCSSPageSize: true });
    // Every section starts its own sheet; a long section may continue on more.
    const sheets = pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? [];
    expect(sheets.length).toBeGreaterThanOrEqual(sectionPages.length);
    await popup.emulateMedia({ media: "screen" });

    // **No element id is emitted twice.** The manifest and prep pages carry
    // fixed ids, and this document renders both once per departure: a repeat
    // means every `aria-labelledby` and every `#roll-call-list` jump after the
    // first departure silently points at the *first* boat's element, on the
    // two sections that say whether a boat is safe to leave.
    const duplicateIds = await popup.evaluate(() => {
      const seen = new Map<string, number>();
      for (const element of document.querySelectorAll("[id]")) {
        seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
      }
      return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    });
    expect(duplicateIds, JSON.stringify(duplicateIds)).toEqual([]);

    // Not one control on paper, however many departures the day holds — the
    // same claim `e2e/trips.spec.ts` makes of the single-trip packet, made
    // again here because widening it is exactly the change that could put one
    // back. Named rather than counted, for the reason that spec gives.
    await popup.emulateMedia({ media: "print" });
    const controls = await popup.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          box.width > 0 &&
          box.height > 0
        );
      };
      // Less the roll call's person buttons, whose content is the name the
      // sheet exists to carry (`button[data-print-content]`, as in trips.spec).
      return [
        ...document.querySelectorAll("button:not([data-print-content]), select, textarea, input"),
      ]
        .filter(visible)
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}: ${(element.textContent ?? "").trim().slice(0, 30) || (element as HTMLInputElement).name || "(unnamed)"}`,
        );
    });
    expect(controls).toEqual([]);

    // **And every roll-call name is on it.** The person's name line is the
    // packet's `data-print-content` (a plain line since the packet renders its
    // paper, B03; a button once): while the backstop hid it with every other
    // button the day's two departures printed 8 + 2 and 9 + 2 roster rows
    // with no name in any of them. Every person the sheet carries is on paper
    // and says who they are.
    const people = await popup
      .locator(".trip-print-bundle [data-print-content]")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          onPaper:
            getComputedStyle(element).display !== "none" &&
            element.getBoundingClientRect().height > 0,
          text: (element as HTMLElement).innerText.trim(),
        })),
      );
    expect(people.length).toBeGreaterThan(0);
    expect(people.filter((person) => !person.onPaper || !/\p{L}/u.test(person.text))).toEqual([]);

    // **And each name is one line on paper, not the deck's 76px row.** The
    // person button's floor and inset are its 56px mark's, and the mark does
    // not print: carried to paper they made every name a 16mm band, and a full
    // boat's roll call ran to extra sheets of the packet a captain counts
    // pages on. On paper the button is its content and 4px a side.
    const slack = await popup
      .locator(".trip-print-bundle [data-print-content]")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const tallest = Math.max(
            0,
            ...[...element.children].map((child) => child.getBoundingClientRect().height),
          );
          return {
            text: (element as HTMLElement).innerText.trim().slice(0, 30),
            slack: Math.round(element.getBoundingClientRect().height - tallest),
          };
        }),
      );
    expect(slack.filter((person) => person.slack > 10)).toEqual([]);
    await popup.emulateMedia({ media: "screen" });
    await popup.close();
  });
});

test("the paper day is staff-only", async ({ page }) => {
  // Signed out, and so refused at the door rather than handed a document
  // holding every diver's emergency contact for the day.
  await page.goto("/shop/blue-mantis/print");
  await expect(page).toHaveURL(/\/sign-in/);
});
