import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  e2eNow,
  manifestRow,
  openTripFromBoard,
  openTripTab,
  seededTripId,
} from "./helpers";

const DISPLAY_SETTINGS = "/shop/blue-mantis/settings/display";
/**
 * The one box, whose label names both ways in: a surname typed by a diver, or
 * the arrival code a wedge scanner types in for them (issue #1600).
 */
const KIOSK_BOX = "Last name, or scan your code";
const REEF_TRIP = "Two-Tank Reef — Molasses & French";
/**
 * A diver on today's boat the tablet will answer for: cleared to board, of age,
 * and with no stated support needs. Deliberately **not** Diego Alvarez, who
 * `check-in.spec.ts` taps at the desk — he states support needs in the seed and
 * the tablet routes him to a person on purpose (see the refusal test below).
 */
const READY_DIVER = "Ines Costa";
/** The demo's blocked diver: on today's boat, and readiness will not clear her. */
const BLOCKED_DIVER = "Priya Sharma";
/** On today's boat, `ready`, and sent to the desk anyway: she states support needs. */
const SUPPORT_NEEDS_DIVER = "Diego Alvarez";
/** On today's boat, `ready` on a guardian's co-signature, and a minor. */
const MINOR_DIVER = "Lena Fischer";

/**
 * **Self check-in at the counter** (N-24): the tablet a diver types their own
 * last name into, behind the same `display_tokens` credential the departures
 * board uses and no sign-in.
 *
 * `display_tokens` is cleared shop-wide by `/api/test/reset`, so every test
 * here starts with no screens and the shared blue-mantis fixture is enough.
 */
test.describe("self check-in at the counter", () => {
  signedInAsOwner();

  /**
   * The whole arc in one pass, because the arc is the feature: a manager mints
   * a link that says what it opens, a stranger uses it unaided, and the desk
   * sees the arrival — while the rail sees nothing at all.
   */
  test("a diver checks themselves in, the desk sees it, and the manifest does not", async ({
    page,
  }) => {
    // The manifest half at the end walks the schedule board and opens a tab; a
    // nine-diver roster is simply slow (see manifest.spec.ts).
    test.setTimeout(60_000);

    await page.goto(DISPLAY_SETTINGS);
    await page.getByLabel("Which screen").fill("Counter tablet");
    // The purpose is a choice with no default: nothing is minted until a
    // manager says which of the two surfaces this link opens.
    await page.getByRole("radio", { name: "Self check-in" }).check();
    await page.getByRole("button", { name: "Create link" }).click();
    await expect(page.getByRole("heading", { name: "Open this on the screen" })).toBeVisible();
    const url = (await page.locator("p.font-mono").first().innerText()).trim();
    expect(url).toMatch(/\/check-in\/[A-Za-z0-9_-]{40,}$/);

    // The tablet on the counter has no session and no cookies.
    const visitor = await page.context().browser()?.newContext();
    if (!visitor) throw new Error("no browser to open a signed-out context with");
    try {
      const kiosk = makeActivitySafe(await visitor.newPage());
      const opened = await kiosk.goto(url);
      expect(opened?.status()).toBe(200);
      await expect(
        kiosk.getByRole("heading", { level: 1, name: "Blue Mantis Divers" }),
      ).toBeVisible();

      // A surname is all it asks for, and all it takes.
      await kiosk.getByLabel(KIOSK_BOX).fill("Costa");
      await kiosk.getByRole("button", { name: "Check in" }).click();
      await expect(kiosk.getByText("You’re set, Ines.")).toBeVisible();

      /**
       * Everything the card says, read **once**. The panel names a diver and
       * stands in a lobby, so it wipes itself after twelve seconds
       * (`CLEAR_AFTER_MS` in `KioskConsole.tsx`); a run of separate locator
       * assertions would race that timer on a loaded runner. One snapshot, then
       * assertions against the string.
       */
      const answered = await kiosk.locator("main").innerText();
      // The two facts a diver walks away with: which boat, and where to stand.
      expect(answered).toContain(REEF_TRIP);
      // Nothing about anyone else. One diver's answer must never be a window
      // onto the day's roster.
      expect(answered).not.toContain(BLOCKED_DIVER);
      expect(answered).not.toContain("Tom Okafor");
      // No phone number, and no readiness vocabulary either.
      expect(answered).not.toMatch(/\+?\d[\d\s().-]{8,}\d/);
      expect(answered).not.toMatch(/Blocked|Ready to board/);
      // Not the diver's whole name either: a first name is enough for the
      // person standing in front of the screen to know it means them.
      expect(answered).not.toContain(READY_DIVER);

      // Nothing for a crawler. A `<meta>` has no layout box, so the fixture's
      // visibility filter could never match it: a raw locator on purpose.
      await expect(kiosk.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      // And nothing about the answer in the URL: a shared tablet must not leave
      // the last diver's name in its address bar, its history or a bookmark.
      expect(new URL(kiosk.url()).search).toBe("");
    } finally {
      await visitor.close();
    }

    // **The desk sees an arrival.** The staff counter is where a kiosk tap
    // lands, and it lands as the settled "checked in" state — the same one a
    // staffer's own tap produces.
    await page.goto("/shop/blue-mantis/check-in");
    const search = page.getByRole("searchbox", { name: "Scan or search diver" });
    await expect(search).toHaveAttribute("data-hydrated", "true");
    await search.fill(READY_DIVER);
    await search.press("Enter");
    await expect(
      page.getByRole("button", { name: `Undo check-in for ${READY_DIVER}` }),
    ).toBeVisible({ timeout: 15_000 });

    /**
     * **And the rail sees nothing.** This is the assertion the whole feature is
     * built around: arrival is the desk's question, boarding is the crew's, and
     * nothing a diver taps on a lobby tablet may put a name on a boat. An
     * unboarded diver's manifest row still offers "Mark boarded"; a boarded
     * one's does not.
     */
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, REEF_TRIP);
    await openTripTab(page, "Manifest");
    await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
    await expect(
      manifestRow(page, READY_DIVER).getByRole("button", { name: "Mark boarded" }),
    ).toBeVisible();
  });

  /**
   * **Every refusal is the same sentence.** A tablet in a lobby is operated by
   * whoever walks up to it, so an answer that varied with *why* — nobody by
   * that name, two people by that name, a diver whose waiver is unsigned, an
   * arrival code that was never minted — would answer questions about a
   * stranger's booking to anyone willing to type. Four of those causes, one
   * answer.
   */
  test("an unknown name, a blocked diver and a bad answer all read the same", async ({
    page,
    request,
  }) => {
    const seeded = await request.post("/api/test/seed-display-token", {
      data: { label: "Counter tablet", purpose: "check_in" },
    });
    expect(seeded.ok()).toBe(true);
    const { path } = (await seeded.json()) as { path: string };

    const visitor = await page.context().browser()?.newContext();
    if (!visitor) throw new Error("no browser to open a signed-out context with");
    try {
      const kiosk = makeActivitySafe(await visitor.newPage());
      await kiosk.goto(path);
      const box = kiosk.getByLabel(KIOSK_BOX);
      const submit = kiosk.getByRole("button", { name: "Check in" });

      // Nobody by that name.
      await box.fill("Nobodyhere");
      await submit.click();
      await expect(kiosk.getByText("See the desk")).toBeVisible();

      // A reload before the second try, so the card below is unambiguously the
      // second answer: both refusals are word-for-word the same sentence, and
      // the first one is still on the glass until its own timer clears it.
      await kiosk.reload();

      // A diver readiness will not clear — refused ashore, while there is still
      // somebody to talk to, which is the whole reason the counter exists.
      await kiosk.getByLabel(KIOSK_BOX).fill("Sharma");
      await kiosk.getByRole("button", { name: "Check in" }).click();
      await expect(kiosk.getByText("See the desk")).toBeVisible();
      // It names nobody, and it does not say what the blocker was.
      const refused = await kiosk.locator("main").innerText();
      expect(refused).not.toContain(BLOCKED_DIVER);
      expect(refused).not.toContain("waiver");

      // The blocked diver is still bookable and still blocked: the tap changed
      // nothing at all.
      await page.goto("/shop/blue-mantis/check-in");
      const search = page.getByRole("searchbox", { name: "Scan or search diver" });
      await expect(search).toHaveAttribute("data-hydrated", "true");
      await search.fill(BLOCKED_DIVER);
      await search.press("Enter");
      await expect(
        page.getByRole("button", { name: `Undo check-in for ${BLOCKED_DIVER}` }),
      ).toHaveCount(0);

      /**
       * **Two divers readiness *does* clear, and the tablet still will not
       * answer for.** Neither is a gate — support needs never gate boarding,
       * and a minor with a guardian's co-signature is `ready` — they are a
       * routing rule about which door answers. The whole value of a stated
       * support need is the conversation it starts at arrival, and a shop whose
       * practice is to see the guardian at the counter should not have a tablet
       * answer instead. It discloses nothing to send them: the sentence is the
       * same one an unknown name gets (`dive-domain-expert` review).
       */
      for (const surname of ["Alvarez", "Fischer"]) {
        await kiosk.reload();
        await kiosk.getByLabel(KIOSK_BOX).fill(surname);
        await kiosk.getByRole("button", { name: "Check in" }).click();
        await expect(kiosk.getByText("See the desk")).toBeVisible();
        const sent = await kiosk.locator("main").innerText();
        expect(sent).not.toContain(SUPPORT_NEEDS_DIVER);
        expect(sent).not.toContain(MINOR_DIVER);
      }

      /**
       * **And a code nobody minted.** The box now recognises a 43-character
       * base64url string as a scanned arrival credential rather than a surname
       * (issue #1600), which is exactly the kind of branch that wants an oracle
       * bolted to it: "that is not a real code" would tell whoever typed it that
       * the shape was right. It gets the one sentence instead, and the guessing
       * cost is 256 bits against a per-link rate limit.
       */
      await kiosk.reload();
      await kiosk.getByLabel(KIOSK_BOX).fill("x".repeat(43));
      await kiosk.getByRole("button", { name: "Check in" }).click();
      await expect(kiosk.getByText("See the desk")).toBeVisible();
    } finally {
      await visitor.close();
    }
  });

  /**
   * **A scanned arrival code, end to end in the browser** (issues #1600 and
   * #1725).
   *
   * The credential exists only as a QR image on a diver's saved arrival card —
   * the route draws it with `QRCode.toDataURL` and the file holds nothing else
   * — so a spec cannot read it out of the download without a decoder this
   * repository deliberately does not carry. `/api/test/seed-arrival-code` mints
   * one through `issueBookingCapability`, which is the same writer the card
   * uses, so what is typed below is a code the product could have made.
   *
   * The same diver the first test checks in by surname, on purpose: the two
   * doors have to end on the same card, and a scan that produced a *different*
   * answer would be the defect worth catching.
   */
  test("a scanned code checks the same diver in as a typed surname, and the desk sees it", async ({
    page,
    request,
  }) => {
    const minted = await request.post("/api/test/seed-arrival-code", {
      data: { email: "ines.costa@example.com" },
    });
    expect(minted.ok()).toBe(true);
    const { token } = (await minted.json()) as { token: string };

    const seeded = await request.post("/api/test/seed-display-token", {
      data: { label: "Counter tablet", purpose: "check_in" },
    });
    expect(seeded.ok()).toBe(true);
    const { path } = (await seeded.json()) as { path: string };

    const visitor = await page.context().browser()?.newContext();
    if (!visitor) throw new Error("no browser to open a signed-out context with");
    try {
      const kiosk = makeActivitySafe(await visitor.newPage());
      await kiosk.goto(path);
      // One box, and the scanner types into it exactly as a thumb does — a
      // wedge scanner is a keyboard (`readKioskInput` tells the two apart by
      // the shape of what arrives, not by which field it came from).
      await kiosk.getByLabel(KIOSK_BOX).fill(token);
      await kiosk.getByRole("button", { name: "Check in" }).click();
      await expect(kiosk.getByText("You’re set, Ines.")).toBeVisible();
      const answered = await kiosk.locator("main").innerText();
      expect(answered).toContain(REEF_TRIP);
      // The scanned path discloses no more than the typed one: not the diver's
      // full name, and nobody else on the boat.
      expect(answered).not.toContain(READY_DIVER);
      expect(answered).not.toContain(BLOCKED_DIVER);
      // And the code is not left in the address bar of a shared tablet.
      expect(new URL(kiosk.url()).search).toBe("");
    } finally {
      await visitor.close();
    }

    // The desk's half, which is the point: a scan is an arrival, and it lands
    // in the same settled state a staffer's own tap produces.
    await page.goto("/shop/blue-mantis/check-in");
    const search = page.getByRole("searchbox", { name: "Scan or search diver" });
    await expect(search).toHaveAttribute("data-hydrated", "true");
    await search.fill(READY_DIVER);
    await search.press("Enter");
    await expect(
      page.getByRole("button", { name: `Undo check-in for ${READY_DIVER}` }),
    ).toBeVisible({ timeout: 15_000 });
  });

  /**
   * **The code on a card the diver lost** (issue #1729).
   *
   * A diver who printed an arrival card and left it in a bag can retire it from
   * their own thread, and `stopArrivalCodesFromReady` revokes every live
   * `arrival` row for the booking rather than one identifiable card. That is a
   * refusal cause the counter did not have before, and what a stopped code
   * still buys if it scans is a false arrival on a manifest — so it gets the
   * same one sentence every other miss gets, and it gets it here rather than
   * only in `src/db/kiosk-check-in.test.ts`.
   *
   * Its own departure, today and inside the tablet's six-hour window
   * (`kioskArrivalsWindow`): a code minted against a boat outside that window
   * is refused for the *window*, which would make this pass for the wrong
   * reason and go on passing if the revoke stopped working.
   */
  test("a code the diver stopped reads the same as one nobody minted", async ({
    page,
    request,
  }) => {
    // A create, a public booking, a mint, a revoke and a kiosk visit.
    test.setTimeout(60_000);
    const stamp = e2eNow().getTime();
    const title = `Kiosk code boat ${stamp}`;
    const email = `kiosk-code-${stamp}@example.com`;

    // 12:00 against the fleet's frozen 09:30 in the shop's own zone: inside the
    // kiosk's window, and far enough ahead that it has not sailed.
    await createTrip(page, {
      title,
      date: daysFromNow(0),
      departsAt: "12:00",
      returnsAt: "14:00",
    });
    const tripId = await seededTripId(page, "blue-mantis", title);
    await page.goto(`/s/blue-mantis/trips/${tripId}`);
    await bookASeatAndOpenThread(page, "Kiosk Code Diver", email);
    const readyPath = new URL(page.url()).pathname;

    const minted = await request.post("/api/test/seed-arrival-code", { data: { email } });
    expect(minted.ok()).toBe(true);
    const { token } = (await minted.json()) as { token: string };

    // The diver's own control, which renders only once a live `arrival` row
    // exists — the mint above is one, exactly as a download would be.
    await page.goto(readyPath);
    await page.getByRole("button", { name: "Stop the code on a saved card" }).click();
    await page.getByRole("button", { name: "Yes, stop the code" }).click();
    await expect(page.getByRole("status")).toContainText("Your old code no longer scans.");

    const seeded = await request.post("/api/test/seed-display-token", {
      data: { label: "Counter tablet", purpose: "check_in" },
    });
    expect(seeded.ok()).toBe(true);
    const { path } = (await seeded.json()) as { path: string };

    const visitor = await page.context().browser()?.newContext();
    if (!visitor) throw new Error("no browser to open a signed-out context with");
    try {
      const kiosk = makeActivitySafe(await visitor.newPage());
      await kiosk.goto(path);
      await kiosk.getByLabel(KIOSK_BOX).fill(token);
      await kiosk.getByRole("button", { name: "Check in" }).click();
      await expect(kiosk.getByText("See the desk")).toBeVisible();
      // It names nobody and says nothing about why — the property every refusal
      // on this surface shares, and the reason a stopped code cannot be told
      // from one nobody ever minted.
      const refused = await kiosk.locator("main").innerText();
      expect(refused).not.toContain("Kiosk Code Diver");
      expect(refused).not.toMatch(/stopped|expired|revoked/i);
    } finally {
      await visitor.close();
    }

    // And nothing was written: the diver is still expected, not arrived.
    await page.goto("/shop/blue-mantis/check-in");
    const search = page.getByRole("searchbox", { name: "Scan or search diver" });
    await expect(search).toHaveAttribute("data-hydrated", "true");
    await search.fill("Kiosk Code Diver");
    await search.press("Enter");
    await expect(
      page.getByRole("button", { name: "Undo check-in for Kiosk Code Diver" }),
    ).toHaveCount(0);
  });

  /**
   * **A board link is not a kiosk link.** A shop hands the board's URL to
   * whoever mounts a TV; if that URL also opened the counter, mounting a TV
   * would be granting a surface that writes. Refused with the same card an
   * unknown token gets, so a holder cannot learn from it that their link is
   * real.
   */
  test("a board link, a made-up token and a revoked link all go dark alike", async ({
    page,
    request,
  }) => {
    const board = await request.post("/api/test/seed-display-token", {
      data: { label: "Lobby TV", purpose: "board" },
    });
    expect(board.ok()).toBe(true);
    const boardToken = ((await board.json()) as { token: string }).token;

    const kioskLink = await request.post("/api/test/seed-display-token", {
      data: { label: "Counter tablet", purpose: "check_in" },
    });
    expect(kioskLink.ok()).toBe(true);
    const kioskPath = ((await kioskLink.json()) as { path: string }).path;

    const visitor = await page.context().browser()?.newContext();
    if (!visitor) throw new Error("no browser to open a signed-out context with");
    try {
      const tablet = makeActivitySafe(await visitor.newPage());

      // The board's own token, at the counter's door.
      await tablet.goto(`/check-in/${boardToken}`);
      await expect(tablet.getByRole("heading", { name: "This tablet isn’t set up" })).toBeVisible();
      await expect(tablet.getByLabel(KIOSK_BOX)).toHaveCount(0);
      await expect(tablet.getByText("Blue Mantis")).toHaveCount(0);

      // A token that was never ours: the same card, so the two are
      // indistinguishable from the outside.
      await tablet.goto("/check-in/not-a-real-token");
      await expect(tablet.getByRole("heading", { name: "This tablet isn’t set up" })).toBeVisible();

      // The live one works, until the shop revokes it.
      await tablet.goto(kioskPath);
      await expect(tablet.getByLabel(KIOSK_BOX)).toBeVisible();

      await page.goto(DISPLAY_SETTINGS);
      await page.getByRole("button", { name: "Revoke Counter tablet" }).click();
      await page.getByRole("button", { name: "Yes, revoke it" }).click();
      await expect(page.getByText("Link revoked.")).toBeVisible();

      await tablet.goto(kioskPath);
      await expect(tablet.getByRole("heading", { name: "This tablet isn’t set up" })).toBeVisible();
      await expect(tablet.getByLabel(KIOSK_BOX)).toHaveCount(0);
    } finally {
      await visitor.close();
    }
  });
});
