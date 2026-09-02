// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contrastRatio } from "./brand";

/**
 * `public/embed.js` against a host page — the other half of the embed
 * contract. `embed-snippets.test.ts` pins what the generator writes; this pins
 * what the loader does with it (ADR 20260901-diveday-reimagined, decision 2),
 * so an attribute renamed in the loader fails here rather than on every shop's
 * website.
 */
const LOADER = readFileSync(path.resolve(__dirname, "../../public/embed.js"), "utf8");

function host(html: string) {
  document.body.innerHTML = html;
  // The loader reads its own origin off `document.currentScript`; inside a
  // test there is none, so it falls back to the page's — jsdom's localhost.
  new Function(LOADER)();
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("the loader", () => {
  it("turns a framed kind into an iframe carrying the host page's colour and face, and one credit", () => {
    // Inline, because jsdom's computed styles do not cascade a stylesheet
    // the way a browser's do; the loader reads computed colour and face either way.
    host(`
      <p><a href="/about" style="color: rgb(180, 83, 9)">a host link</a></p>
      <div style="font-family: Georgia, serif">
        <div data-diveday="grid" data-shop="blue-mantis" data-look="site" data-lang="es-ES"></div>
      </div>
    `);
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-diveday-frame="grid"]');
    expect(frame).not.toBeNull();
    const url = new URL(frame?.src ?? "");
    expect(url.pathname).toBe("/s/blue-mantis/embed/grid");
    expect(url.searchParams.get("brand")).toBe("#b45309");
    expect(url.searchParams.get("font")).toBe("Georgia, serif");
    expect(url.searchParams.get("lang")).toBe("es-ES");
    // The host page carries the credit, and the frame is told so.
    expect(url.searchParams.get("credit")).toBe("host");
    const credits = document.querySelectorAll('a[href*="utm_source=embed"]');
    expect(credits).toHaveLength(1);
    expect(credits[0]?.textContent).toBe("Powered by DiveDay");
  });

  it("frames the calendar as the schedule's compact mode and pins a departure by id", () => {
    host(`
      <div data-diveday="calendar" data-shop="blue-mantis" data-look="light" data-lang="auto"></div>
      <div data-diveday="departure" data-shop="blue-mantis" data-look="light" data-lang="auto" data-show="t1"></div>
    `);
    const calendar = new URL(
      document.querySelector<HTMLIFrameElement>('iframe[data-diveday-frame="calendar"]')?.src ?? "",
    );
    expect(calendar.pathname).toBe("/s/blue-mantis");
    expect(calendar.searchParams.get("embed")).toBe("1");
    // DiveDay's own look reads nothing off the host page.
    expect(calendar.searchParams.has("brand")).toBe(false);
    const departure = new URL(
      document.querySelector<HTMLIFrameElement>('iframe[data-diveday-frame="departure"]')?.src ??
        "",
    );
    expect(departure.searchParams.get("show")).toBe("t1");
  });

  it("darkens a pale host colour until white reads on the button", () => {
    // Amber: 1.9:1 on white as it stands. The settings copy promises the
    // button darkens itself, and this is the rule that keeps that promise —
    // the same 8% steps `deriveBrandTheme` takes on the server.
    host(`
      <a href="/s/blue-mantis" style="color: rgb(251, 191, 36)" data-diveday="button" data-shop="blue-mantis" data-look="site" data-lang="auto">Book</a>
    `);
    const button = document.querySelector<HTMLAnchorElement>("[data-diveday=button]");
    const fill = button?.style.background ?? "";
    const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(fill);
    expect(m).not.toBeNull();
    const hex = `#${[m?.[1], m?.[2], m?.[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
    expect(hex).not.toBe("#fbbf24");
    expect(contrastRatio(hex, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(button?.style.color).toBe("rgb(255, 255, 255)");
  });

  it("keeps a readable host colour as it is, and DiveDay's lagoon for the light look", () => {
    host(`
      <a href="/s/blue-mantis" style="color: rgb(21, 132, 98)" data-diveday="button" data-shop="blue-mantis" data-look="site" data-lang="auto">Site</a>
      <a href="/s/blue-mantis" style="color: rgb(21, 132, 98)" data-diveday="button" data-shop="blue-mantis" data-look="light" data-lang="auto">Light</a>
    `);
    const [site, light] = document.querySelectorAll<HTMLAnchorElement>("[data-diveday=button]");
    expect(site?.style.background).toBe("rgb(21, 132, 98)");
    expect(light?.style.background).toBe("rgb(14, 116, 144)");
  });

  it("opens the lightbox as a modal dialog that holds the page still and closes on Escape", () => {
    host(`
      <a href="/s/blue-mantis" data-diveday="lightbox" data-shop="blue-mantis" data-look="light" data-lang="auto">Book a dive</a>
    `);
    const link = document.querySelector<HTMLAnchorElement>("[data-diveday=lightbox]");
    link?.click();
    const sheet = document.querySelector('[data-diveday-lightbox] [role="dialog"]');
    expect(sheet?.getAttribute("aria-modal")).toBe("true");
    expect(sheet?.getAttribute("aria-label")).toBe("Book a dive");
    expect(document.body.style.overflow).toBe("hidden");
    const frame = sheet?.querySelector("iframe");
    expect(new URL(frame?.src ?? "").searchParams.get("embed")).toBe("1");
    const close = sheet?.querySelector<HTMLButtonElement>("button[aria-label=Close]");
    expect(document.activeElement).toBe(close);
    // Tab wraps at the sheet's two ends rather than leaving it: Shift+Tab off
    // the close button lands on the frame, Tab off the frame on the button.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(frame);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(close);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector("[data-diveday-lightbox]")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(link);
  });

  it("grows a frame to the height it reports, and believes only its own origin", () => {
    host(
      `<div data-diveday="courses" data-shop="blue-mantis" data-look="light" data-lang="auto"></div>`,
    );
    const frame = document.querySelector<HTMLIFrameElement>("iframe[data-diveday-frame]");
    expect(frame?.style.height).toBe("480px");
    const deliver = (origin: string, height: number) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          origin,
          source: frame?.contentWindow,
          data: { type: "diveday:height", height },
        }),
      );
    deliver("https://evil.example", 900);
    expect(frame?.style.height).toBe("480px");
    deliver(location.origin, 900);
    expect(frame?.style.height).toBe("900px");
    // Bounded: a runaway report cannot take the host page over.
    deliver(location.origin, 99999);
    expect(frame?.style.height).toBe("4000px");
  });
});
