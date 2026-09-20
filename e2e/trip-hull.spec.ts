import { expect, signedInAsOwner, test } from "./fixtures";
import { tripPathByTitle } from "./helpers";

signedInAsOwner();

/**
 * **The departure drawn as its boat** — ADR 20260919-one-idea, decision I ·
 * Tide, slice 23c: "a departure's page is Deck's hull".
 *
 * The hull is a picture of what the rows already say, so every assertion here
 * is about the picture agreeing with them — and about the two rules that make
 * it safe to draw at all: no number on a seat, and no hull where there is no
 * boat.
 */
test("a boat departure draws its hull, and it agrees with the rows", async ({ page }) => {
  const trip = await tripPathByTitle(page, "blue-mantis", /Two-Tank Reef/);
  await page.goto(trip);

  // One image, named for the boat it is, with the count the masthead carries.
  const hull = page.getByRole("img", { name: /drawn as its seats/ });
  await expect(hull).toBeVisible();
  const label = (await hull.getAttribute("aria-label")) ?? "";
  expect(label).toMatch(/^Mantis I,/);
  const [, booked, capacity] = label.match(/(\d+) of (\d+) seats? taken/) ?? [];
  expect(Number(capacity)).toBeGreaterThan(0);
  expect(Number(booked)).toBeLessThanOrEqual(Number(capacity));

  // One seat per place the boat has — the picture is the count made spatial.
  const seats = hull.locator('rect[rx="9"]');
  await expect(seats).toHaveCount(Number(capacity));

  /**
   * **No number on a seat, ever.** The whole defence against a seat map
   * reading as a seating plan is that there is nothing on it to mistake for an
   * assignment; the only words are initials.
   */
  const words = await hull.locator("text").allTextContents();
  for (const word of words) expect(word).not.toMatch(/\d/);

  // And the boat is the shop's colour, not a colour this page invented.
  await expect(hull.locator("path").first()).toHaveAttribute("stroke", /^#[0-9a-f]{6}$/i);
});

/**
 * A shore dive and a pool session have a roster and no boat. An invented hull
 * would be a picture of something that is not there, so there is none — and
 * the roster underneath is untouched either way.
 */
test("a departure with no boat draws no hull, and still lists its divers", async ({ page }) => {
  const trip = await tripPathByTitle(page, "blue-mantis", /Tortugas Run/);
  await page.goto(trip);

  await expect(page.getByRole("img", { name: /drawn as its seats/ })).toHaveCount(0);
  // The rows are the record; the picture never was.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tortugas Run");
  await expect(
    page
      .locator("ol li, [data-roster-row]")
      .first()
      .or(page.getByText(/Blocked/).first()),
  ).toBeVisible();
});

/**
 * **The hull on paper** — ADR 20260919-one-idea §3b.4.
 *
 * The picture used to carry `print:hidden`, because the print palette
 * flattens `--success` and `--warning` onto one near-black: `aboard` and
 * `ashore` — the only two answers a head count has — came out of a printer
 * identical. `Hull.test.tsx` holds the eight states apart by reading the rules
 * out of `globals.css`, which proves the sheet *says* the right thing. This
 * proves the sheet **reaches the SVG**, which is a different failure: a
 * presentation attribute beats nothing, a class that never matched beats
 * nothing either, and only a browser can tell you which happened.
 */
test("the hull goes on the sheet, in the page's ink rather than the shop's paint", async ({
  page,
}) => {
  const trip = await tripPathByTitle(page, "blue-mantis", /Two-Tank Reef/);
  await page.goto(trip);
  const hull = page.getByRole("img", { name: /drawn as its seats/ });
  await expect(hull).toBeVisible();

  /**
   * Read the same nodes twice, and compare the two readings.
   *
   * **A one-sided reading proves nothing here**, and a first draft of this
   * test learned that the hard way: it compared a computed `rgb(...)` against
   * the inline `#rrggbb` it came from, which differ as strings whether or not
   * any rule matched, and it asserted the seats were distinct — which they
   * already are on screen, from their own attributes. Both passed with every
   * hull rule in `globals.css` renamed out of reach. What the sheet has to
   * prove is that it *moved* something.
   */
  const look = () =>
    hull.evaluate((svg) => {
      const stroke = (selector: string) => {
        const node = svg.querySelector(selector);
        return node ? getComputedStyle(node).stroke : null;
      };
      return {
        body: stroke(".hull-body"),
        midline: stroke(".hull-midline"),
        seats: [...svg.querySelectorAll(".hull-seat")].map((seat) => {
          const channels = (node: Element | null | undefined) => {
            if (!node) return "-";
            const style = getComputedStyle(node);
            return `${style.fill} | ${style.strokeWidth} | ${style.strokeDasharray}`;
          };
          const state = [...seat.classList].find((name) => name.startsWith("hull-seat-")) ?? "";
          // **The inner mark counts.** `booked` and `awaiting` share a seat
          // rule deliberately — the doubt is the dashed box inside the second
          // — so a comparison of seats alone is not a safe one. A first draft
          // of this test made it, and it would have gone red, for a reason
          // that is not a bug, on the first shop with an unread booking.
          const group = seat.parentElement;
          return {
            state,
            paper: `${channels(seat)} / ${channels(group?.querySelector(".hull-seat-inset"))} / ${
              group?.querySelector(".hull-seat-cross") ? "cross" : "-"
            }`,
          };
        }),
      };
    });

  const screen = await look();
  // What the printer sees, which is not what the screen shows.
  await page.emulateMedia({ media: "print" });
  // A manifest is a piece of paper: the boat is still on it.
  await expect(hull).toBeVisible();
  const paper = await look();

  // The boat arrives in the shop's colour, inline, on every one of these
  // nodes. Paper takes it back: a mid-tone brand prints as mid grey, and a
  // dark one would land on top of `blocked`.
  expect(screen.body).toMatch(/^rgb/);
  expect(paper.body).not.toBe(screen.body);
  expect(paper.midline).not.toBe(screen.midline);

  // Every seat carries the class the sheet reaches for, and no two of them
  // come off the printer alike. Colour is not one of the channels compared,
  // because it is not one a mono laser keeps — which is the whole of §3b.4.
  const byState = new Map<string, string>();
  for (const seat of paper.seats) {
    expect(seat.state).not.toBe("");
    byState.set(seat.state, seat.paper);
  }
  expect(byState.size).toBeGreaterThan(1);
  expect(new Set(byState.values()).size).toBe(byState.size);
});
