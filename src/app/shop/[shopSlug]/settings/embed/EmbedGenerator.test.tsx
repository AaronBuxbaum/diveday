// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBED_KINDS, PLATFORMS } from "@/lib/embed-snippets";
import { EmbedGenerator, type EmbedGeneratorCopy } from "./EmbedGenerator";

vi.mock("qrcode", () => ({ toDataURL: vi.fn(async () => "data:image/png;base64,QUJD") }));

const copy: EmbedGeneratorCopy = {
  what: "What to embed",
  kinds: Object.fromEntries(
    EMBED_KINDS.map((k) => [k, `kind ${k}`]),
  ) as EmbedGeneratorCopy["kinds"],
  kindHints: Object.fromEntries(
    EMBED_KINDS.map((k) => [k, `hint ${k}`]),
  ) as EmbedGeneratorCopy["kindHints"],
  shows: "What it shows",
  showEverything: "Everything",
  showDeparture: "One departure",
  look: "Look",
  lookSite: "Your site",
  lookLight: "DiveDay",
  lookNote: "Reads your page",
  language: "Language",
  languageAuto: "Follow the browser",
  languages: { "en-US": "English", "es-ES": "Español" },
  preview: "Preview",
  previewNote: "note",
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
      locales={["en-US", "es-ES"]}
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
