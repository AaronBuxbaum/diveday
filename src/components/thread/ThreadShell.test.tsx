// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EntryDone, EntryShell, entryMainClass } from "@/components/account/EntryShell";
import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";
import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { THREAD_MEASURE_CLASS, ThreadShell } from "./ThreadShell";

afterEach(cleanup);

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");

/** Every non-test `.ts`/`.tsx` under `src/`, so a sweep can be stated as a fact. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function read(relativePath: string) {
  return readFileSync(join(SRC_DIR, relativePath), "utf8");
}

/** The four bearer pages the thread is made of (ADR 20260827-the-divers-thread, decision 1). */
const THREAD_PAGES = [
  "app/ready/[token]/page.tsx",
  "app/waivers/[token]/page.tsx",
  "app/recap/[token]/page.tsx",
  "app/claim/[token]/page.tsx",
] as const;

const THREAD_LOADING = THREAD_PAGES.map((page) => page.replace("page.tsx", "loading.tsx"));

/**
 * The bearer pages that mount `ThreadShell` **directly** — three of the four.
 *
 * `/recap/[token]` is a bearer page and part of the thread, but since slice 7d
 * it is a thin route that renders `AfterState`, and that component owns its own
 * `<main>` on purpose: the after-state's header *is* its moment, and it is
 * `print:hidden` so the keepsake prints alone. It is the same call the waiver's
 * completed state already made, and it does not escape the thread's one column
 * — `AfterState` takes the measure from this file's own exported
 * `THREAD_MEASURE_CLASS`, so the width cannot drift.
 */
const THREAD_SHELL_PAGES = THREAD_PAGES.filter((page) => page !== "app/recap/[token]/page.tsx");

describe("ThreadShell", () => {
  it("renders the shop's name as the eyebrow and exactly one h1", () => {
    render(
      <ThreadShell shopName="Blue Mantis Divers" title="Two-Tank — French Reef">
        <p>body</p>
      </ThreadShell>,
    );
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Two-Tank — French Reef");
    // The eyebrow is a paragraph, not a second heading: it names the context,
    // and a screen-reader user tabbing headings should meet the page's own
    // name once.
    expect(screen.getByText("Blue Mantis Divers").tagName).toBe("P");
  });

  it("puts the thread's column on its own <main> landmark", () => {
    const { container } = render(<ThreadShell shopName="Blue Mantis Divers" title="Waivers" />);
    const main = container.querySelector("main");
    expect(main?.className).toBe(THREAD_MEASURE_CLASS);
  });

  /**
   * The measure *is* the decision, so it is pinned as a string rather than as
   * "contains max-w-xl": the gutters and the vertical rhythm are the half that
   * drifted before this component existed.
   */
  it("holds the thread's measure at max-w-xl", () => {
    expect(THREAD_MEASURE_CLASS).toBe("mx-auto w-full max-w-xl flex-1 px-5 py-8 sm:px-6 sm:py-12");
  });

  it("spells the eyebrow and the title from the shared constants", () => {
    const source = readFileSync(join(HERE, "ThreadShell.tsx"), "utf8");
    expect(source).toContain("EYEBROW_CLASS");
    expect(source).toContain("SHELL_TITLE_CLASS");
    expect(SHELL_TITLE_CLASS).toBe("text-3xl font-bold tracking-tight");
    const { container } = render(<ThreadShell shopName="Blue Mantis Divers" title="Sign" />);
    expect(container.querySelector("p")?.className).toContain(EYEBROW_CLASS);
    expect(container.querySelector("h1")?.className).toContain(SHELL_TITLE_CLASS);
  });

  it("renders the meta slot exactly as the page hands it over", () => {
    render(
      <ThreadShell
        shopName="Blue Mantis Divers"
        title="Two-Tank"
        meta={<p className="mt-1">Sat, Aug 29 · 11:00 AM</p>}
      />,
    );
    expect(screen.getByText("Sat, Aug 29 · 11:00 AM")).toBeTruthy();
  });

  /**
   * 7a is chrome convergence and its coral budget is *none*
   * (20260827-clearwater-surface-language, decision 11). The shell carrying an
   * accent would spend the thread's three earned moments on furniture.
   */
  it("renders no accent ink", () => {
    const { container } = render(
      <ThreadShell shopName="Blue Mantis Divers" title="Two-Tank">
        <p>body</p>
      </ThreadShell>,
    );
    expect(container.innerHTML).not.toMatch(/accent/);
  });
});

/**
 * The type ramp is one spelling in one place. Both assertions are about the
 * *tree* rather than about a rendering: a closed ramp only holds if a second
 * copy cannot be pasted somewhere nobody is looking.
 */
describe("the shell's title spelling is single-sourced", () => {
  it("is declared in src/components/ui/typography.ts and nowhere else", () => {
    const declaring = join(SRC_DIR, "components", "ui", "typography.ts");
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file !== declaring)
      .filter((file) => readFileSync(file, "utf8").includes(SHELL_TITLE_CLASS))
      .map((file) => relative(SRC_DIR, file));
    // Listed, not counted — nothing on screen will name the file.
    expect(offenders).toEqual([]);
  });

  it("is not spelled inline at any thread page", () => {
    for (const page of THREAD_PAGES) {
      expect(read(page)).not.toContain("text-3xl");
    }
  });
});

describe("TokenPageHeader is gone", () => {
  it("no longer exists", () => {
    expect(existsSync(join(SRC_DIR, "components", "TokenPageHeader.tsx"))).toBe(false);
  });

  it("is imported by no file under src/", () => {
    const offenders = sourceFiles(SRC_DIR)
      // The import path, not the word: this component's own doc comment names
      // the header it replaced, which is the point of the doc comment.
      .filter((file) => readFileSync(file, "utf8").includes("components/TokenPageHeader"))
      .map((file) => relative(SRC_DIR, file));
    expect(offenders).toEqual([]);
  });
});

describe("the thread's adopters", () => {
  it("are the bearer pages that mount it, and only those", () => {
    const adopters = sourceFiles(SRC_DIR)
      .filter((file) => /page\.tsx$/.test(file))
      .filter((file) => readFileSync(file, "utf8").includes("<ThreadShell"))
      .map((file) => relative(SRC_DIR, file).replaceAll("\\", "/"))
      .sort();
    // The set, not the count: this test's job is to stop the shell leaking onto
    // a page that is not a bearer page, which holds at three as well as four.
    expect(adopters).toEqual([...THREAD_SHELL_PAGES].sort());
  });

  it("no longer spell the thread's column themselves", () => {
    for (const page of [...THREAD_PAGES, ...THREAD_LOADING]) {
      expect(read(page)).not.toContain("mx-auto w-full max-w-xl");
    }
  });

  /**
   * A skeleton at a different measure from the page it stands in for is a
   * sideways layout jump on every navigation into the segment — which is the
   * one thing a `loading.tsx` exists to prevent.
   */
  it("hand their loading skeletons the same column", () => {
    for (const loading of THREAD_LOADING) {
      expect(read(loading)).toContain("THREAD_MEASURE_CLASS");
    }
  });

  /**
   * The migration moved `FlashParams` and the notice blocks inside the shell.
   * Which query params each page consumes is its `?notice=`/`?saved=`/`?error=`
   * contract, and 7a changes no route's behavior — so the lists are pinned
   * where the move could have dropped one.
   */
  it("keep their one-shot query-param contracts", () => {
    expect(read("app/ready/[token]/page.tsx")).toContain(
      'params={["saved", "error", "pay", "booked"]}',
    );
    expect(read("app/waivers/[token]/page.tsx")).toContain(
      'params={["saved", "error", "field", "at"]}',
    );
    expect(read("app/claim/[token]/page.tsx")).toContain('params={["error"]}');
  });
});

describe("the doors keep max-w-md", () => {
  it("is what entryMainClass('sm') still returns", () => {
    expect(entryMainClass("sm")).toContain("max-w-md");
    expect(entryMainClass("sm")).not.toContain("max-w-xl");
    // `lg` (onboarding's two-section form) is the one door at the thread's
    // width, and that predates this slice.
    expect(entryMainClass("lg")).toContain("max-w-xl");
  });

  /**
   * `/verify` and `/reset-password` are deliberately **not** thread pages: they
   * are account lifecycle, not a booking, and the thread's measure does not
   * reach them.
   */
  it("still hold /verify and /reset-password", () => {
    for (const page of ["app/verify/[token]/page.tsx", "app/reset-password/[token]/page.tsx"]) {
      const source = read(page);
      expect(source).toContain("EntryShell");
      expect(source).not.toContain("ThreadShell");
    }
  });

  it("renders one h1 at the shell's title size at either width", () => {
    for (const width of ["sm", "lg"] as const) {
      const { container, unmount } = render(
        <EntryShell width={width} title="Sign in">
          <p>form</p>
        </EntryShell>,
      );
      const headings = screen.getAllByRole("heading", { level: 1 });
      expect(headings).toHaveLength(1);
      expect(container.querySelector("h1")?.className).toContain(SHELL_TITLE_CLASS);
      unmount();
    }
  });

  it("spells the eyebrow from the shared constant", () => {
    const { container } = render(
      <EntryShell eyebrow="Founding shop" title="Onboard">
        <p>form</p>
      </EntryShell>,
    );
    expect(container.querySelector("header p")?.className).toContain(EYEBROW_CLASS);
  });

  /**
   * A skeleton wider or narrower than the shell that replaces it is a sideways
   * jump on every navigation into the door, and two width-mismatched loading
   * files were found exactly that way. The frame is shared constants, so the
   * drift is structurally impossible — this holds the wiring.
   */
  it("hands EntryShellSkeleton the identical frame", () => {
    for (const width of ["sm", "lg"] as const) {
      const shell = render(
        <EntryShell width={width} title="Sign in">
          <p>form</p>
        </EntryShell>,
      );
      const shellMain = shell.container.querySelector("main")?.className;
      shell.unmount();
      const skeleton = render(<EntryShellSkeleton width={width} fields={["email"]} />);
      expect(skeleton.container.querySelector("main")?.className).toBe(shellMain);
      skeleton.unmount();
    }
  });
});

/**
 * Flat at rest (20260827-clearwater-surface-language, decision 1): a shadow
 * means "this floats above the page", and a terminal outcome is the page.
 */
describe("the terminal outcomes are flat", () => {
  it("EntryDone renders no shadow", () => {
    const { container } = render(
      <EntryDone
        glyph="expired"
        title="This link has expired"
        text="Ask the shop for a fresh one."
      />,
    );
    expect(container.innerHTML).not.toMatch(/shadow-/);
  });

  it("ExpiredLinkCard renders no shadow", () => {
    const { container } = render(
      <ExpiredLinkCard title="This link isn't available" text="Ask the shop for a fresh one." />,
    );
    expect(container.innerHTML).not.toMatch(/shadow-/);
  });

  it("neither gains accent ink", () => {
    const done = render(<EntryDone glyph="expired" title="Expired" text="Ask the shop." />);
    expect(done.container.innerHTML).not.toMatch(/accent/);
    done.unmount();
    const expired = render(<ExpiredLinkCard title="Expired" text="Ask the shop." />);
    expect(expired.container.innerHTML).not.toMatch(/accent/);
  });

  /**
   * D6, the rescue: the expired-link family keeps the way onward a caller
   * hands it (the email-me-a-fresh-link button) above the shop's contact line.
   */
  it("ExpiredLinkCard still carries a caller's way forward", () => {
    render(
      <ExpiredLinkCard title="Expired" text="Ask the shop.">
        <button type="button">Email me a fresh link</button>
      </ExpiredLinkCard>,
    );
    expect(screen.getByRole("button", { name: "Email me a fresh link" })).toBeTruthy();
  });
});

/**
 * The 404s and the error boundaries join the ramp and nothing else: measure and
 * type only, the same words from the same keys.
 */
describe("the backstops ramp without changing a word", () => {
  it("say the page's name at the shell's size", () => {
    for (const file of [
      "app/not-found.tsx",
      "app/s/[shopSlug]/not-found.tsx",
      "components/ErrorPage.tsx",
    ]) {
      expect(read(file)).toContain("SHELL_TITLE_CLASS");
    }
  });

  it("still resolve the same message keys", () => {
    const root = read("app/not-found.tsx");
    for (const key of ["notFound.heading", "notFound.body", "notFound.backHome"]) {
      expect(root).toContain(key);
    }
    const shop = read("app/s/[shopSlug]/not-found.tsx");
    for (const key of ["notFound.shop.heading", "notFound.shop.action"]) {
      expect(shop).toContain(key);
    }
  });
});

/**
 * **The diver's counterpart to Boat Mode** (issue #1214, delight report D54).
 *
 * `.glare-mode` was already the app's whole answer to a phone in the sun — an
 * AAA palette, 16px minimum type, 44px minimum targets, all declared on
 * `documentElement` in `globals.css` and therefore global to whatever page is
 * open. The only thing mounting it was the crew's offline manifest, so a diver
 * on the same dock could not ask for any of it.
 */
describe("the thread's contrast control", () => {
  const copy = {
    modeLabel: "Screen contrast",
    labelAuto: "Auto",
    labelStandard: "Standard",
    labelFull: "High",
  };

  /**
   * The preference is device-wide and the detector is what applies it, so it is
   * unconditional: a diver who chose High on their readiness page keeps it on
   * the waiver and the claim without being asked again. Only the *buttons* are
   * opt-in per page.
   */
  it("applies the stored preference on every page built on the shell", () => {
    render(<ThreadShell shopName="Blue Mantis" title="Two-Tank Reef" />);
    // `AmbientGlareDetector` renders null and works through an effect on the
    // document element, so the fact under test is that the effect ran at all.
    expect(document.documentElement.classList.contains("glare-mode")).toBe(false);
    expect(screen.queryByRole("group", { name: "Screen contrast" })).toBeNull();
  });

  it("renders the three states as one radio group when a page asks for them", () => {
    render(<ThreadShell shopName="Blue Mantis" title="Two-Tank Reef" contrastCopy={copy} />);
    const group = screen.getByRole("group", { name: "Screen contrast" });
    expect(group).toBeTruthy();
    // Real radios, so exactly one is on and arrow keys move between them.
    for (const label of ["Auto", "Standard", "High"]) {
      expect(screen.getByRole("radio", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("radio", { name: "Auto" })).toHaveProperty("checked", true);
  });

  /**
   * **The boundary the ticket names**: never hide a safety or money fact. The
   * control is additive — it appends one fieldset after the page's own
   * children and changes nothing about them — so this asserts the children
   * survive it rather than trusting that they do.
   */
  it("adds itself after the page's content and takes none of it away", () => {
    render(
      <ThreadShell shopName="Blue Mantis" title="Two-Tank Reef" contrastCopy={copy}>
        <p>Balance due $120</p>
        <p>Waiver not signed</p>
      </ThreadShell>,
    );
    expect(screen.getByText("Balance due $120")).toBeTruthy();
    expect(screen.getByText("Waiver not signed")).toBeTruthy();
    const main = screen.getByRole("main");
    const group = screen.getByRole("group", { name: "Screen contrast" });
    // Last, after everything the page is about — it is a setting for this
    // device, not a step in the thread.
    expect(main.lastElementChild?.contains(group)).toBe(true);
  });

  /**
   * The two long surfaces a diver dwells on carry the buttons. `/claim` and
   * `/recap` are short cards they pass through, and still get the preference
   * from the detector above — stated here so a later reader can tell the split
   * from an omission.
   */
  it("is offered by the readiness and waiver pages", () => {
    for (const page of ["app/ready/[token]/page.tsx", "app/waivers/[token]/page.tsx"]) {
      expect(read(page), `${page} should offer the contrast control`).toContain(
        "contrastCopy={diverContrastCopy(t)}",
      );
    }
  });
});
