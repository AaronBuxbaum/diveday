// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEGMENT_CORNER, segmentedTrackClass } from "@/components/ui/segmented";
import { DIVEDAY_BRAND_COLOR } from "@/lib/brand";
import { EMBED_KINDS, PLATFORMS } from "@/lib/embed-snippets";
import { rendersFlush } from "@/test/button-flush";
import { EmbedGenerator, type EmbedGeneratorCopy } from "./EmbedGenerator";

vi.mock("qrcode", () => ({ toDataURL: vi.fn(async () => "data:image/png;base64,QUJD") }));

const copy: EmbedGeneratorCopy = {
  what: "What to embed",
  showRequired: "Pick the departure this card is for.",
  kinds: Object.fromEntries(
    EMBED_KINDS.map((k) => [k, `kind ${k}`]),
  ) as EmbedGeneratorCopy["kinds"],
  kindHints: Object.fromEntries(
    EMBED_KINDS.map((k) => [k, `hint ${k}`]),
  ) as EmbedGeneratorCopy["kindHints"],
  shows: "What it shows",
  showEverything: "Everything",
  showDeparture: "One departure",
  showAllCourses: "Every course",
  look: "Look",
  lookSite: "Your site",
  lookLight: "DiveDay",
  lookNote: "Reads your page",
  language: "Language",
  languageAuto: "Follow the browser",
  languages: { "en-US": "English", "es-ES": "Español" },
  preview: "Preview",
  openPreview: "Open the preview",
  platform: "Where it goes",
  platforms: Object.fromEntries(
    PLATFORMS.map((p) => [p, `platform ${p}`]),
  ) as EmbedGeneratorCopy["platforms"],
  platformNotes: Object.fromEntries(
    PLATFORMS.map((p) => [p, `note ${p}`]),
  ) as EmbedGeneratorCopy["platformNotes"],
  snippet: "Put it on your site",
  code: "Embed code",
  buttonText: "Book a dive",
  partnerName: "Partner",
  partnerPlaceholder: "e.g. hotel",
  partnerLink: "Partner link",
  partnerLinkField: "Referral link",
  qrAlt: "QR code",
  qrDownload: "Download PNG",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Failed",
};

function renderGenerator(props: { kinds?: readonly (typeof EMBED_KINDS)[number][] } = {}) {
  return render(
    <EmbedGenerator
      origin="https://diveday.example"
      shopSlug="blue-mantis"
      {...props}
      trips={[{ id: "t1", label: "Thu 27 Aug · 7:00 AM — Two-Tank Reef" }]}
      courses={[{ id: "open-water", label: "Open Water Diver" }]}
      locales={["en-US", "es-ES"]}
      previewHost={{ brand: DIVEDAY_BRAND_COLOR, font: null }}
      copy={copy}
    />,
  );
}

afterEach(cleanup);

/**
 * The generator composes through `src/lib/embed-snippets.ts`; what these pin
 * is that each choice reaches the snippet (ADR 20260901-diveday-reimagined,
 * slice 13d).
 */
describe("EmbedGenerator", () => {
  it("offers every kind and starts on the calendar", () => {
    renderGenerator();
    expect(screen.getAllByRole("radio", { name: /kind / })).toHaveLength(EMBED_KINDS.length);
    expect((screen.getByLabelText("Embed code") as HTMLTextAreaElement).value).toContain(
      'data-diveday="calendar"',
    );
  });

  /**
   * **The reviews widget** (K3): the shop's published reviews, framed by path
   * like the other widgets, with nothing to narrow — so no "What it shows".
   */
  it("frames the reviews widget, with nothing to choose but its look and language", async () => {
    const user = userEvent.setup();
    renderGenerator();
    await user.click(screen.getByRole("radio", { name: /kind reviews/ }));
    expect(screen.queryByLabelText("What it shows")).toBeNull();
    const snippet = screen.getByLabelText("Embed code") as HTMLTextAreaElement;
    expect(snippet.value).toContain('<div data-diveday="reviews" data-shop="blue-mantis"');
    expect(screen.getByTitle("Preview").getAttribute("src")).toContain(
      "/s/blue-mantis/embed/reviews",
    );
  });

  it("offers only the kinds the page hands it", () => {
    renderGenerator({ kinds: EMBED_KINDS.filter((kind) => kind !== "reviews") });
    expect(screen.queryByRole("radio", { name: /kind reviews/ })).toBeNull();
    expect(screen.getAllByRole("radio", { name: /kind / })).toHaveLength(EMBED_KINDS.length - 1);
  });

  /**
   * Too narrow to read (a phone), the widget is not drawn small: the same
   * frame opens in a tab of its own (Aaron, 2026-10-03). Which of the two
   * shows is a container query, so both are in the DOM and must agree.
   */
  it("offers the framed widget full size in a new tab, at the frame's own URL", () => {
    renderGenerator();
    const frame = screen.getByTitle("Preview") as HTMLIFrameElement;
    const open = screen.getByRole("link", { name: "Open the preview" });
    expect(open.getAttribute("href")).toBe(frame.getAttribute("src"));
    expect(open.getAttribute("target")).toBe("_blank");
  });

  it("changes the snippet as the shop chooses", async () => {
    const user = userEvent.setup();
    renderGenerator();
    await user.click(screen.getByRole("radio", { name: /kind departure/ }));
    await user.selectOptions(screen.getByLabelText("What it shows"), "t1");
    await user.click(screen.getByRole("radio", { name: "DiveDay" }));
    await user.selectOptions(screen.getByLabelText("Language"), "es-ES");
    const snippet = screen.getByLabelText("Embed code") as HTMLTextAreaElement;
    expect(snippet.value).toContain('data-diveday="departure"');
    expect(snippet.value).toContain('data-show="t1"');
    expect(snippet.value).toContain('data-look="light"');
    expect(snippet.value).toContain('data-lang="es-ES"');
  });

  /**
   * **"What it shows" now has four answers, not two** (issue #1284, completing
   * ADR 20260901-diveday-reimagined decision 2). The courses widget can frame
   * one course, chosen by slug from the shop's active list.
   */
  it("offers the shop's courses when the widget is the course list", async () => {
    const user = userEvent.setup();
    renderGenerator();
    await user.click(screen.getByRole("radio", { name: /kind courses/ }));

    const select = screen.getByLabelText("What it shows");
    // "Every course" rather than "Everything on the board": the catalogue is
    // still the default, and it is a valid answer rather than a missing one.
    expect(within(select).getByRole("option", { name: "Every course" })).toBeInTheDocument();
    expect(screen.queryByText("Pick the departure this card is for.")).toBeNull();
    expect((screen.getByLabelText("Embed code") as HTMLTextAreaElement).value).not.toContain(
      "data-show",
    );

    await user.selectOptions(select, "open-water");
    expect((screen.getByLabelText("Embed code") as HTMLTextAreaElement).value).toContain(
      'data-diveday="courses"',
    );
    expect((screen.getByLabelText("Embed code") as HTMLTextAreaElement).value).toContain(
      'data-show="open-water"',
    );
  });

  /**
   * The bug this guards is silent and only shows up on the shop's own website:
   * `show` holds a trip id for every kind but one and a course slug for
   * `courses`, so a choice carried across that line frames the courses widget
   * with a UUID and the diver gets a 404 where a course list should be.
   */
  it("forgets the departure when the shop crosses to courses, and keeps it otherwise", async () => {
    const user = userEvent.setup();
    renderGenerator();

    await user.click(screen.getByRole("radio", { name: /kind departure/ }));
    await user.selectOptions(screen.getByLabelText("What it shows"), "t1");
    // Same namespace: the QR code points at the departure already chosen.
    await user.click(screen.getByRole("radio", { name: /kind qr/ }));
    expect(screen.getByLabelText("What it shows")).toHaveValue("t1");

    await user.click(screen.getByRole("radio", { name: /kind courses/ }));
    expect(screen.getByLabelText("What it shows")).toHaveValue("");
    expect((screen.getByLabelText("Embed code") as HTMLTextAreaElement).value).not.toContain("t1");
  });

  it("draws the QR code from the target and offers the partner link attributed", async () => {
    const user = userEvent.setup();
    renderGenerator();
    await user.click(screen.getByRole("radio", { name: /kind qr/ }));
    expect(await screen.findByAltText("QR code")).toHaveAttribute(
      "src",
      "data:image/png;base64,QUJD",
    );
    await user.click(screen.getByRole("radio", { name: /kind partner/ }));
    await user.type(screen.getByLabelText("Partner"), "The Reef Hotel");
    expect(screen.getByLabelText("Referral link")).toHaveValue(
      "https://diveday.example/s/blue-mantis?utm_source=partner&utm_medium=referral&utm_campaign=the-reef-hotel",
    );
  });

  /**
   * The look toggle is a segmented choice between two radios, and it takes the
   * segmented recipe rather than a copy of it. The copy's `rounded-lg` segments
   * sat 5px inside a 12px track, where they nest at 7px — the probe's
   * `nested-corners` flag on `settings-embed` at both widths.
   */
  it("draws the look toggle from the segmented recipe, nested in its track's corner", () => {
    renderGenerator();
    const site = screen.getByRole("radio", { name: "Your site" }).closest("label");
    const light = screen.getByRole("radio", { name: "DiveDay" }).closest("label");
    const track = site?.parentElement;
    for (const token of segmentedTrackClass.split(" ")) expect(track).toHaveClass(token);
    for (const segment of [site, light]) {
      expect(segment).toHaveClass(SEGMENT_CORNER);
      expect(segment).not.toHaveClass("rounded-lg");
      // Keyboard focus is the global ring's utility, not a hand-drawn outline.
      expect(segment).toHaveClass("has-[:focus-visible]:focus-ring");
      expect(segment?.className).not.toMatch(/outline-/);
    }
  });

  /**
   * Each look label is its radio's whole tap target (the radio itself is
   * `sr-only`). It was `min-h-9`, 36px, under the 44px floor every target
   * clears (principles.md §2). jsdom lays nothing out, so this pins the floor
   * the label carries; the probe's `small-target` check measures it.
   */
  /**
   * Each snippet's Copy starts the line under its box, so its word sits on the
   * box's edge. It sat 12px inside it, at x 446 against 433 (pixel probe,
   * SETTINGS-2-20, K-06).
   */
  it("puts each snippet's Copy on the edge of the box above it", () => {
    renderGenerator();
    const triggers = screen.getAllByRole("button", { name: "Copy" });
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) expect(rendersFlush(trigger, "ghost", "sm")).toBe(true);
  });

  /**
   * The look's caption wrapped both radios in its `<label>`, so it labelled the
   * first: "Your site" was named by the caption and its own words together, and
   * a click on "Look" chose it (#1972, K-13 review). The caption names the pair
   * as a group now and labels neither.
   */
  it("captions the two looks as a group, each radio named by its own words", () => {
    const { container } = renderGenerator();
    expect(container.querySelector("label label")).toBeNull();
    const group = screen.getByRole("group", { name: /^Look/ });
    expect(within(group).getByRole("radio", { name: "Your site" })).toHaveAttribute(
      "value",
      "site",
    );
    expect(within(group).getByRole("radio", { name: "DiveDay" })).toHaveAttribute("value", "light");
    expect(within(group).getByText("Look").closest("label")).toBeNull();
  });

  it("gives both look labels, the radios' tap targets, the 44px floor and not the 36px one", () => {
    const { container } = renderGenerator();
    const labels = [...container.querySelectorAll('input[type="radio"]')]
      .filter((radio) => ["site", "light"].includes((radio as HTMLInputElement).value))
      .map((radio) => radio.closest("label"));
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label).toHaveClass("min-h-11");
      expect(label).not.toHaveClass("min-h-9");
    }
  });

  /**
   * The platform chips are their radios' tap targets too, and they were the
   * last of the three at `min-h-9`: 36px chips 4px apart (K-443,
   * SETTINGS-2-23). The probe cannot see them, since the radio is `sr-only`.
   */
  it("gives every platform chip the 44px floor, a gap apart", () => {
    renderGenerator();
    const radios = screen.getAllByRole("radio", { name: /^platform / });
    expect(radios).toHaveLength(PLATFORMS.length);
    for (const radio of radios) {
      const chip = radio.closest("label");
      expect(chip).toHaveClass("min-h-11", "inline-flex", "items-center");
      expect(chip).not.toHaveClass("min-h-9");
      expect(chip?.parentElement).toHaveClass("gap-2");
    }
  });

  /**
   * A kind tile is stretched to the taller tile beside it in its grid row, and
   * `justify-center` then pushed the shorter one's title down: "Button" 9px
   * under "Lightbox" at 1280 and 17px at 390 (K-442, SETTINGS-2-21). Titles
   * start at the top, so one row's titles share a line.
   */
  it("starts every kind tile's title at its top", () => {
    renderGenerator();
    for (const radio of screen.getAllByRole("radio", { name: /^kind / })) {
      const tile = radio.closest("label");
      expect(tile).toHaveClass("justify-start");
      expect(tile).not.toHaveClass("justify-center");
    }
  });

  /**
   * Look and Language stood side by side in a two-column grid inside the
   * form's 26rem column: 200px each, so the select cut "Follow the visitor's
   * browser" at "br" (K-144, SETTINGS-2-02), and the 54px Look track stood
   * beside the 44px select (K-445, SETTINGS-2-32). One column gives each
   * control the column's whole width and a row of its own.
   */
  it("stacks Look and Language, each on a row of its own", () => {
    renderGenerator();
    const language = screen.getByRole("combobox", { name: "Language" });
    const grid = language.closest(".row-span-2")?.parentElement;
    expect(grid).toContainElement(screen.getByRole("radio", { name: "DiveDay" }));
    expect(grid).toHaveClass("grid", "grid-cols-1");
    expect(grid?.className).not.toMatch(/(?:^|\s)\w+:grid-cols-/);
  });
});

/**
 * The settings page (a Server Component) reads the platform list, so it must
 * come from a plain module. A value exported from this `"use client"` file
 * reaches the server as a client reference — `PLATFORMS.map` was a
 * production-only crash on 2026-09-02 while every unit test stayed green.
 */
it("exports only components from the client module", async () => {
  const exported = await import("./EmbedGenerator");
  for (const [name, value] of Object.entries(exported)) {
    expect(typeof value, name).toBe("function");
  }
});
