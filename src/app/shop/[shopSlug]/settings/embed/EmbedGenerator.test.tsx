// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DIVEDAY_BRAND_COLOR } from "@/lib/brand";
import { EMBED_KINDS, PLATFORMS } from "@/lib/embed-snippets";
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
  setsGroup: "Lists",
  look: "Look",
  lookSite: "Your site",
  lookLight: "DiveDay",
  lookNote: "Reads your page",
  language: "Language",
  languageAuto: "Follow the browser",
  languages: { "en-US": "English", "es-ES": "Español" },
  preview: "Preview",
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

function renderGenerator() {
  return render(
    <EmbedGenerator
      origin="https://diveday.example"
      shopSlug="blue-mantis"
      trips={[{ id: "t1", label: "Thu 27 Aug · 7:00 AM — Two-Tank Reef" }]}
      courses={[{ id: "open-water", label: "Open Water Diver" }]}
      sets={[
        { id: "set-boats", label: "Beginner boats", kind: "trip" },
        { id: "set-courses", label: "Entry-level courses", kind: "course" },
      ]}
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

  /**
   * **The fourth answer** (issue #1284): one of the shop's own named lists.
   * Its own attribute, and offered only where a list means anything.
   */
  it("puts a list on the grid, as data-set and never as data-show", async () => {
    const user = userEvent.setup();
    renderGenerator();
    await user.click(screen.getByRole("radio", { name: /kind grid/ }));

    const select = screen.getByLabelText("What it shows");
    expect(within(select).getByRole("option", { name: "Beginner boats" })).toBeInTheDocument();
    // A departures list on a grid; the courses list is a different namespace.
    expect(within(select).queryByRole("option", { name: "Entry-level courses" })).toBeNull();

    await user.selectOptions(select, "set:set-boats");
    const snippet = (screen.getByLabelText("Embed code") as HTMLTextAreaElement).value;
    expect(snippet).toContain('data-diveday="grid"');
    expect(snippet).toContain('data-set="set-boats"');
    expect(snippet).not.toContain("data-show");
  });

  it("offers the courses widget its own lists alongside one course", async () => {
    const user = userEvent.setup();
    renderGenerator();
    await user.click(screen.getByRole("radio", { name: /kind courses/ }));

    const select = screen.getByLabelText("What it shows");
    expect(within(select).getByRole("option", { name: "Open Water Diver" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Entry-level courses" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Beginner boats" })).toBeNull();
  });

  it("forgets a list when the shop crosses to a kind that cannot read one", async () => {
    const user = userEvent.setup();
    renderGenerator();
    await user.click(screen.getByRole("radio", { name: /kind grid/ }));
    await user.selectOptions(screen.getByLabelText("What it shows"), "set:set-boats");

    await user.click(screen.getByRole("radio", { name: /kind departure/ }));
    expect(screen.getByLabelText("What it shows")).toHaveValue("");
    expect((screen.getByLabelText("Embed code") as HTMLTextAreaElement).value).not.toContain(
      "set-boats",
    );
  });

  it("offers no lists at all for the kinds that point at one object", async () => {
    const user = userEvent.setup();
    renderGenerator();
    for (const kind of ["button", "lightbox", "departure", "qr"]) {
      await user.click(screen.getByRole("radio", { name: new RegExp(`kind ${kind}`) }));
      const select = screen.getByLabelText("What it shows");
      expect(within(select).queryByRole("group", { name: "Lists" })).toBeNull();
      expect(within(select).queryByRole("option", { name: "Beginner boats" })).toBeNull();
    }
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
