import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImageFileInput } from "@/components/ImageFileInput";
import { RemovablePhoto } from "@/components/RemovablePhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoiceRow, Field, FieldActions } from "@/components/ui/form";
import type { AppDb } from "@/db/client";
import { listDiveSites, listSiteBottomTimeOverrides } from "@/db/dive-sites";
import { diveSites, shops } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { STAFF_MESSAGES, staffTranslator } from "@/i18n/staff-messages";
import { seededTestDb } from "@/test/db";
import { findElements, hrefsIn, inputNamesIn, selectNamesIn } from "@/test/jsx-inspect";
import { BrandColorField } from "../BrandColorField";
import type { SettingsShop } from "../groups/kit";
import { DockDayForm, EmergencyReferenceForm } from "./BoatsSitesEditors";
import { ProfileForm } from "./ProfileForm";
import { RentalItemsForm } from "./RentalEditors";

/**
 * **The editors that left the hub for pages of their own** (#1854). Each is
 * the row's form, unchanged, so the hub's old assertions about it travel here
 * and are read off the editor directly rather than off a disclosure.
 */
const SHOP_SLUG = "blue-mantis";
const t = staffTranslator("en-US");

async function demoShop(
  change?: (db: AppDb, shopId: string) => Promise<void>,
): Promise<{ db: AppDb; shop: SettingsShop }> {
  const db = await seededTestDb();
  const seeded = await getShopBySlug(db, SHOP_SLUG);
  if (!seeded) throw new Error("demo shop missing");
  if (change) await change(db, seeded.id);
  const shop = await getShopBySlug(db, SHOP_SLUG);
  return { db, shop: shop as SettingsShop };
}

/** Every element in a tree carrying `name`, whatever renders it. */
function named(node: unknown, name: string, found: ReactElement<{ id?: string }>[] = []) {
  if (node === null || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) named(child, name, found);
    return found;
  }
  if ("props" in node) {
    const element = node as ReactElement<{ name?: unknown; id?: string; children?: unknown }>;
    if (element.props?.name === name) found.push(element);
    named(element.props?.children, name, found);
  }
  return found;
}

/**
 * Harbor's brand (ADR 20260901-diveday-reimagined, decision 2) is edited in
 * the same form as the logo and tagline: one place a shop says who it is.
 */
describe("the profile editor", () => {
  const PROFILE = STAFF_MESSAGES["en-US"].settings.main.profile;

  async function profileForm() {
    const { shop } = await demoShop(async (db, shopId) => {
      await db.update(shops).set({ logoUrl: "/dive-sites/logo.png" }).where(eq(shops.id, shopId));
    });
    return ProfileForm({ shop, t });
  }

  it("asks for the tagline, the logo and every brand field", async () => {
    const form = await profileForm();
    const names = inputNamesIn(form);
    for (const name of [
      "tagline",
      "logoFile",
      "brandHeroFile",
      "brandHeroImageAlt",
      "establishedYear",
      "badge",
    ]) {
      expect(names).toContain(name);
    }
    expect(selectNamesIn(form)).toContain("brandDisplayFont");
    // The colour is a Client Component (picker + hex field), so it appears in
    // the server tree as an element rather than as an `<input name>`.
    expect(findElements(form, BrandColorField)).toHaveLength(1);
  });

  /**
   * **No caption label wraps another label** (K-13 review): with a logo on
   * file the caption "Logo" once labelled the "Remove logo" box.
   */
  it("names the logo and cover-photo pickers with their captions, never the remove box", async () => {
    const form = await profileForm();
    const fields = findElements<{ label?: unknown; htmlFor?: string }>(form, Field);
    for (const [label, input] of [
      [PROFILE.logo, "logoFile"],
      [PROFILE.heroPhoto, "brandHeroFile"],
    ] as const) {
      const [field] = fields.filter((candidate) => candidate.props.label === label);
      expect(field?.props.htmlFor, label).toBeTruthy();
      const [picker] = named(form, input);
      expect(picker?.props.id, input).toBe(field?.props.htmlFor);
    }
  });

  /** A stored logo and cover photo come off the way every stored photo does (K-247). */
  it("takes a stored logo and cover photo back off the way every stored photo is", async () => {
    const form = await profileForm();
    const photos = findElements<{ name?: string; value?: string; shape?: string }>(
      form,
      RemovablePhoto,
    );
    expect(photos.map(({ props }) => [props.name, props.value ?? "true", props.shape])).toEqual([
      ["removeLogo", "true", "logo"],
      ["removeHero", "true", undefined],
    ]);
    expect(
      findElements<{ name?: string }>(form, ImageFileInput).map(({ props }) => props.name),
    ).toEqual(["logoFile", "brandHeroFile"]);
    expect(findElements(form, "img")).toHaveLength(0);
  });

  it("captions the badges as a group of choices, not with a field's label", async () => {
    const form = await profileForm();
    const groups = findElements<{ legend?: unknown; hint?: unknown; children?: unknown }>(
      form,
      ChoiceFieldset,
    ).filter((group) => group.props.legend === PROFILE.badges);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.props.hint).toBe(PROFILE.badgesHint);
    expect(inputNamesIn(groups[0]?.props.children)).toContain("badge");
    const wrapping = findElements<{ children?: unknown }>(form, Field).filter(
      (field) => findElements(field.props.children, ChoiceRow).length > 0,
    );
    expect(wrapping).toHaveLength(0);
  });
});

describe("the dock-day editor", () => {
  async function dockDayForm(change?: (db: AppDb, shopId: string) => Promise<string>) {
    let overridden = "";
    const { db, shop } = await demoShop(async (db, shopId) => {
      if (change) overridden = await change(db, shopId);
    });
    const form = DockDayForm({
      shop,
      shopSlug: SHOP_SLUG,
      t,
      siteBottomTimeOverrides: await listSiteBottomTimeOverrides(db, shop.id),
    });
    return { form, overridden };
  }

  /** One beat per line on a phone, the strip it was from `sm` up (K-585). */
  it("stacks the beats on a phone and runs them as a strip from sm up", async () => {
    const { form } = await dockDayForm();
    const lists = findElements<{ className?: string }>(form, "dl");
    expect(lists).toHaveLength(1);
    const classes = lists[0]?.props.className?.split(" ") ?? [];
    expect(classes).toEqual(expect.arrayContaining(["grid", "sm:flex", "sm:flex-wrap"]));
    expect(classes).not.toContain("flex");
    expect(classes).not.toContain("flex-wrap");
  });

  it("says nothing extra when no site sets its own bottom time", async () => {
    const { form } = await dockDayForm();
    expect(hrefsIn(form).filter((href) => href.includes("/dive-sites/"))).toHaveLength(0);
  });

  it("links the sites that set their own bottom time", async () => {
    const { form, overridden } = await dockDayForm(async (db, shopId) => {
      const [site] = await listDiveSites(db, shopId);
      if (!site) throw new Error("the seed has no dive site");
      await db
        .update(diveSites)
        .set({ expectedBottomTimeMinutes: 30 })
        .where(eq(diveSites.id, site.id));
      return site.id;
    });
    expect(hrefsIn(form)).toContain(`/shop/${SHOP_SLUG}/dive-sites/${overridden}`);
  });
});

/**
 * **The emergency reference editor**: the one thing in settings a crew reads
 * when something has gone wrong. Its page states what it is for, as its
 * description, so the form does not say it again.
 */
describe("the emergency reference editor", () => {
  const EMERGENCY = STAFF_MESSAGES["en-US"].settings.main.emergency;

  async function emergencyForm() {
    const { shop } = await demoShop();
    return EmergencyReferenceForm({ shop, t });
  }

  it("leaves what it is for to the page's description", async () => {
    const paragraphs = findElements<{ children?: unknown }>(await emergencyForm(), "p");
    expect(paragraphs.filter((p) => p.props.children === EMERGENCY.intro)).toHaveLength(0);
  });

  /** One Save at the default 48px with 16px, in `FieldActions` (K-308). */
  it("saves with the one Save, at its size and in its row", async () => {
    const saves = findElements<{ children?: unknown; className?: string }>(
      findElements(await emergencyForm(), FieldActions),
      SubmitButton,
    ).filter((button) => button.props.children === EMERGENCY.submit);
    expect(saves).toHaveLength(1);
    expect(saves[0]?.props.className).toBe(buttonClass({ variant: "secondary" }));
  });

  /** The examples wrap under the first line, never cut in a box's placeholder (K-583). */
  it("gives its examples once, under the first line, where they wrap", async () => {
    const lines = findElements<{ description?: unknown; children?: unknown }>(
      await emergencyForm(),
      Field,
    ).filter((field) => {
      const control = field.props.children as ReactElement<{ name?: string }> | undefined;
      return control?.props?.name?.startsWith("emergencyLabel-");
    });
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const control = line.props.children as ReactElement<{ placeholder?: unknown }>;
      expect(control.props.placeholder).toBeUndefined();
    }
    expect(lines.map((line) => line.props.description)).toEqual([
      EMERGENCY.lineExamples,
      ...lines.slice(1).map(() => undefined),
    ]);
  });
});

/**
 * **The count beside the catalog** (issue #1792, H-78): how many divers' fits
 * still ask for a piece the shop dropped, said where the catalog is edited and
 * silent at zero. The form offers no way to clear them.
 */
describe("the rental catalog editor", () => {
  it("says how many fits still ask for a dropped piece", async () => {
    const { shop } = await demoShop();
    const html = renderToStaticMarkup(<RentalItemsForm shop={shop} t={t} droppedFits={3} />);
    expect(html).toContain("3 divers’ rental fits still ask for gear you no longer rent.");
    const one = renderToStaticMarkup(<RentalItemsForm shop={shop} t={t} droppedFits={1} />);
    expect(one).toContain("1 diver’s rental fit still asks for gear you no longer rent.");
  });

  it("says nothing when no fit asks for a dropped piece", async () => {
    const { shop } = await demoShop();
    const html = renderToStaticMarkup(<RentalItemsForm shop={shop} t={t} droppedFits={0} />);
    expect(html).not.toContain("no longer rent");
  });
});
