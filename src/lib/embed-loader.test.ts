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
  it("turns a framed kind into an iframe carrying the host page's color and face, and one credit", () => {
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
    expect(credits[0]?.textContent).toBe("Bookings by DiveDay");
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

  it("pins a course by slug, and never narrows the grid", () => {
    // The loader's half of issue #1284. `data-show` is one attribute doing two
    // jobs, and which job it does is decided by `data-diveday` — so a grid
    // that somehow carries one is still the whole board.
    host(`
      <div data-diveday="courses" data-shop="blue-mantis" data-look="light" data-lang="auto" data-show="open-water"></div>
      <div data-diveday="grid" data-shop="blue-mantis" data-look="light" data-lang="auto" data-show="open-water"></div>
    `);
    const courses = new URL(
      document.querySelector<HTMLIFrameElement>('iframe[data-diveday-frame="courses"]')?.src ?? "",
    );
    expect(courses.pathname).toBe("/s/blue-mantis/embed/courses");
    expect(courses.searchParams.get("show")).toBe("open-water");
    const grid = new URL(
      document.querySelector<HTMLIFrameElement>('iframe[data-diveday-frame="grid"]')?.src ?? "",
    );
    expect(grid.searchParams.has("show")).toBe(false);
  });

  it("frames the reviews widget by its own path, and never narrows it", () => {
    host(`
      <div data-diveday="reviews" data-shop="blue-mantis" data-look="light" data-lang="auto" data-show="t1"></div>
    `);
    const reviews = new URL(
      document.querySelector<HTMLIFrameElement>('iframe[data-diveday-frame="reviews"]')?.src ?? "",
    );
    expect(reviews.pathname).toBe("/s/blue-mantis/embed/reviews");
    expect(reviews.searchParams.has("show")).toBe(false);
    expect(reviews.searchParams.get("credit")).toBe("host");
  });

  it("darkens a pale host color until white reads on the button", () => {
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

  it("keeps a readable host color as it is, and DiveDay's lagoon for the light look", () => {
    host(`
      <a href="/s/blue-mantis" style="color: rgb(21, 132, 98)" data-diveday="button" data-shop="blue-mantis" data-look="site" data-lang="auto">Site</a>
      <a href="/s/blue-mantis" style="color: rgb(21, 132, 98)" data-diveday="button" data-shop="blue-mantis" data-look="light" data-lang="auto">Light</a>
    `);
    const [site, light] = document.querySelectorAll<HTMLAnchorElement>("[data-diveday=button]");
    expect(site?.style.background).toBe("rgb(21, 132, 98)");
    expect(light?.style.background).toBe("rgb(14, 116, 144)");
  });

  it("opens the lightbox as a native modal dialog that holds the page still, and gives focus back on close", () => {
    // jsdom has no showModal; the browser owns the top layer, the Tab loop and
    // Escape, which e2e/embed-catalogue.spec.ts drives in a real one. This
    // pins what the loader asks of the dialog.
    const proto = HTMLDialogElement.prototype;
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
    host(`
      <a href="/s/blue-mantis" data-diveday="lightbox" data-shop="blue-mantis" data-look="light" data-lang="auto">Book a dive</a>
    `);
    const link = document.querySelector<HTMLAnchorElement>("[data-diveday=lightbox]");
    const open = () => document.querySelector<HTMLDialogElement>("dialog[data-diveday-lightbox]");
    link?.click();
    const sheet = open();
    expect(sheet?.hasAttribute("open")).toBe(true);
    expect(sheet?.getAttribute("aria-label")).toBe("Book a dive");
    expect(document.body.style.overflow).toBe("hidden");
    const frame = sheet?.querySelector("iframe");
    expect(new URL(frame?.src ?? "").searchParams.get("embed")).toBe("1");
    const close = sheet?.querySelector<HTMLButtonElement>("button[aria-label=Close]");
    expect(document.activeElement).toBe(close);
    // The sheet's look is one !important stylesheet, so a host `dialog {}` rule
    // cannot restyle it, and it is the only way to reach ::backdrop.
    const rules = document.head.querySelector("style")?.textContent ?? "";
    expect(rules).toContain("dialog[data-diveday-lightbox]::backdrop");
    expect(rules).toContain("max-width:720px!important");
    // A click inside the sheet leaves it open; one on the backdrop (which the
    // browser reports on the dialog itself) and the close button end it.
    frame?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(open()).not.toBeNull();
    sheet?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(open()).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(link);
    link?.click();
    document.querySelector<HTMLButtonElement>("button[aria-label=Close]")?.click();
    expect(open()).toBeNull();
    expect(document.querySelectorAll("style").length).toBe(1);
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

  /**
   * **A widget with nothing to show folds away, credit and all** (#2317). The
   * reviews widget of a shop with none published says so with a height of
   * exactly 0; the 120px floor left a blank box and a "Bookings by DiveDay" line under
   * nothing on the shop's own page. Any other report keeps the floor, so a
   * garbled or missing number never hides a widget that has content.
   */
  it("folds a frame that reports nothing to show, and keeps the floor for anything else", () => {
    host(
      `<div data-diveday="reviews" data-shop="blue-mantis" data-look="light" data-lang="auto"></div>`,
    );
    const frame = document.querySelector<HTMLIFrameElement>("iframe[data-diveday-frame]");
    const credit = document.querySelector<HTMLAnchorElement>("a[data-diveday-credit]");
    expect(credit?.style.display).toBe("block");
    const deliver = (height: unknown) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: location.origin,
          source: frame?.contentWindow,
          data: { type: "diveday:height", height },
        }),
      );
    deliver(0);
    expect(frame?.style.height).toBe("0px");
    expect(credit?.style.display).toBe("none");
    // Reviews published later in the same session: the widget comes back.
    deliver(300);
    expect(frame?.style.height).toBe("300px");
    expect(credit?.style.display).toBe("block");
    for (const garbled of [undefined, "", "0", Number.NaN, -5, 40]) {
      deliver(garbled);
      expect(frame?.style.height).toBe("120px");
      expect(credit?.style.display).toBe("block");
    }
  });
});
