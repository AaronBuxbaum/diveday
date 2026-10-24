import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImageFileInput } from "@/components/ImageFileInput";
import { RemovablePhoto } from "@/components/RemovablePhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureRow } from "@/components/ui/disclosure";
import { ChoiceFieldset, ChoiceRow, Field, FieldActions } from "@/components/ui/form";
import type { AppDb } from "@/db/client";
import { listDiveSites, listSiteBottomTimeOverrides } from "@/db/dive-sites";
import { diveSites, shops } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { STAFF_MESSAGES, staffTranslator } from "@/i18n/staff-messages";
import { publicSchedulePath } from "@/lib/public-routes";
import { fileScopedShopContext } from "@/test/db";
import { findElements, hrefsIn, inputNamesIn, selectNamesIn } from "@/test/jsx-inspect";
import { BrandColorField } from "../BrandColorField";
import { BrandPreview } from "../BrandPreview";
import type { SettingsShop } from "../groups/kit";
import { DockDayForm, EmergencyReferenceForm } from "./BoatsSitesEditors";
import { ProfileForm } from "./ProfileForm";
import { RentalsForm } from "./RentalsForm";

const ctx = fileScopedShopContext();

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
  const db = ctx.db;
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

  it("opens the saved storefront separately and keeps the brand preview", async () => {
    const form = await profileForm();
    const savedStorefrontLabel = t("settings.main.profile.viewSavedStorefront");
    const links = findElements<{
      href?: string;
      target?: string;
      rel?: string;
      children?: unknown;
    }>(form, "a");
    const savedStorefront = links.find(({ props }) => props.href === publicSchedulePath(SHOP_SLUG));

    expect(savedStorefront?.props).toMatchObject({
      target: "_blank",
      rel: "noopener noreferrer",
      children: savedStorefrontLabel,
    });
    expect(findElements(form, BrandPreview)).toHaveLength(1);
  });

  it("uses the Spanish saved-storefront label for the same public route", async () => {
    const { shop } = await demoShop();
    const form = ProfileForm({ shop, t: staffTranslator("es-ES") });
    const savedStorefront = findElements<{ href?: string; children?: unknown }>(form, "a").find(
      ({ props }) => props.href === publicSchedulePath(SHOP_SLUG),
    );

    expect(savedStorefront?.props.children).toBe(
      staffTranslator("es-ES")("settings.main.profile.viewSavedStorefront"),
    );
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
    return EmergencyReferenceForm({ shop, t, locale: "en-US" });
  }

  it("states each contact's saved number while keeping every closed editor in the save", async () => {
    const { shop } = await demoShop();
    const form = EmergencyReferenceForm({
      shop: {
        ...shop,
        emergencyReference: {
          ...shop.emergencyReference,
          lines: [
            { label: "Chamber", phone: "+1 305 555 0101" },
            { label: "Coast guard", phone: "+1 305 555 0102" },
          ],
        },
      },
      t,
      locale: "en-US",
    });
    const rows = findElements<{ id: string; heading: string; value?: unknown }>(
      form,
      DisclosureRow,
    );
    expect(
      rows
        .filter((row) => row.props.id.startsWith("emergency-contact-"))
        .map((row) => ({
          heading: row.props.heading,
          value: row.props.value,
        })),
    ).toEqual([
      { heading: "Chamber", value: "+1 305 555 0101" },
      { heading: "Coast guard", value: "+1 305 555 0102" },
      { heading: EMERGENCY.addContact, value: undefined },
    ]);
    expect(named(form, "emergencyPhone-0")[0]?.props).toMatchObject({
      defaultValue: "+1 305 555 0101",
    });
    expect(named(form, "emergencyPhone-1")[0]?.props).toMatchObject({
      defaultValue: "+1 305 555 0102",
    });
    expect(inputNamesIn(form).filter((name) => name.startsWith("emergencyPhone-"))).toEqual([
      "emergencyPhone-0",
      "emergencyPhone-1",
      "emergencyPhone-2",
    ]);
  });

  it("offers no sixth contact when all five slots are in use", async () => {
    const { shop } = await demoShop();
    const form = EmergencyReferenceForm({
      shop: {
        ...shop,
        emergencyReference: {
          ...shop.emergencyReference,
          lines: Array.from({ length: 5 }, (_, index) => ({
            label: `Contact ${index}`,
            phone: `555-${index}`,
          })),
        },
      },
      t,
      locale: "en-US",
    });
    expect(
      findElements<{ heading: string }>(form, DisclosureRow).some(
        (row) => row.props.heading === EMERGENCY.addContact,
      ),
    ).toBe(false);
    expect(inputNamesIn(form).filter((name) => name.startsWith("emergencyPhone-"))).toHaveLength(5);
  });

  it("omits the removed emergency-reference explanation", async () => {
    const paragraphs = findElements<{ children?: unknown }>(await emergencyForm(), "p");
    expect(
      paragraphs.filter((p) =>
        String(p.props.children).includes("These ride on the boat manifest"),
      ),
    ).toHaveLength(0);
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

  /** The examples wrap in Add contact, never cut in a box's placeholder (K-583). */
  it("gives its examples once, under the new contact's label, where they wrap", async () => {
    const lines = findElements<{ description?: unknown; children?: unknown }>(
      await emergencyForm(),
      Field,
    ).filter((field) => {
      const control = field.props.children as ReactElement<{ name?: string }> | undefined;
      return control?.props?.name?.startsWith("emergencyLabel-");
    });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const control = line.props.children as ReactElement<{ placeholder?: unknown }>;
      expect(control.props.placeholder).toBeUndefined();
    }
    expect(lines.filter((line) => line.props.description === EMERGENCY.lineExamples)).toHaveLength(
      1,
    );
  });

  /** H-118: the shore contact's alert address, and the box that records their consent. */
  it("asks for the shore contact's alert address beside an unticked consent box", async () => {
    const form = await emergencyForm();
    expect(inputNamesIn(form)).toEqual(
      expect.arrayContaining(["shoreAlertEmail", "shoreAlertConsent", "shoreAlertConsentFor"]),
    );
    const [consent] = findElements<{ name?: string; defaultChecked?: boolean }>(
      form,
      ChoiceRow,
    ).filter((row) => row.props.name === "shoreAlertConsent");
    expect(consent?.props.defaultChecked).toBe(false);
    // Drawn empty, the box vouches for no address yet.
    expect(named(form, "shoreAlertConsentFor")[0]?.props).toMatchObject({ value: "" });
  });

  // Owner review #4: the free-text line is for a person, never a recipient.
  it("says DiveDay never messages the free-text shore contact", async () => {
    const [field] = findElements<{ description?: unknown; children?: unknown }>(
      await emergencyForm(),
      Field,
    ).filter(
      (candidate) =>
        (candidate.props.children as ReactElement<{ name?: string }> | undefined)?.props?.name ===
        "emergencyShoreContact",
    );
    expect(field?.props.description).toBe(EMERGENCY.shoreContactDescription);
  });

  // Owner review #3: a demo shop's form says it sends nothing.
  it("says a demo shop sends nothing", async () => {
    expect(renderToStaticMarkup(await emergencyForm())).toContain(EMERGENCY.shoreAlertDemo);
  });

  async function onFile(confirmedAt: Date | null, demo = true) {
    const { shop } = await demoShop(async (db, shopId) => {
      await db
        .update(shops)
        .set({
          isDemo: demo,
          shoreAlertEmail: "shore@example.com",
          shoreAlertConsentAt: new Date("2026-10-15T14:30:00Z"),
          shoreAlertConsentByPersonId: shopId,
          shoreAlertConfirmedAt: confirmedAt,
        })
        .where(eq(shops.id, shopId));
    });
    return shop;
  }

  it("draws the box ticked for the address on file, and says who recorded it and when", async () => {
    const shop = await onFile(new Date("2026-10-16T09:00:00Z"));
    const form = EmergencyReferenceForm({ shop, t, locale: "en-US", consentByName: "Dana Reyes" });
    // The tick speaks for this address only (owner review #1).
    expect(named(form, "shoreAlertConsentFor")[0]?.props).toMatchObject({
      value: "shore@example.com",
    });
    const html = renderToStaticMarkup(form).replaceAll("\u00a0", " ");
    expect(html).toContain('value="shore@example.com"');
    expect(html).toMatch(
      /name="shoreAlertConsent"[^>]*checked=""|checked=""[^>]*name="shoreAlertConsent"/,
    );
    expect(html).toMatch(/Recorded Oct 15[^<]* by Dana Reyes/);
    expect(html).toContain("They confirmed Oct 16");
  });

  it("says a saved address is waiting for its confirmation, with a way to send the link again", async () => {
    const shop = await onFile(null, false);
    const html = renderToStaticMarkup(
      EmergencyReferenceForm({ shop, t, locale: "en-US", consentByName: "Dana Reyes" }),
    );
    expect(html).toContain(EMERGENCY.shoreAlertWaiting);
    // Dive-domain re-review #3: it may never have arrived; say what to do.
    expect(html).toContain("Send the link again if they didn’t get it.");
    expect(html).toContain(EMERGENCY.shoreAlertResend);
    expect(html).not.toContain("They confirmed");
  });

  // Dive-domain re-review #2: the shop sees which number its alerts give.
  it("says which phone the alerts tell the shore contact to call, or that there is none", async () => {
    const shop = await onFile(null, false);
    const withPhone = renderToStaticMarkup(
      EmergencyReferenceForm({
        shop: { ...shop, contactPhone: "+1 305 555 0100" },
        t,
        locale: "en-US",
      }),
    );
    expect(withPhone).toContain("Alerts tell them to call +1 305 555 0100.");
    const noPhone = renderToStaticMarkup(
      EmergencyReferenceForm({ shop: { ...shop, contactPhone: null }, t, locale: "en-US" }),
    );
    expect(noPhone).toContain(EMERGENCY.shoreAlertNoPhone);
  });
});

/**
 * **The count beside the catalog** (issue #1792, H-78): how many divers' fits
 * still ask for a piece the shop dropped, said where the catalog is edited and
 * silent at zero. The form offers no way to clear them.
 */
describe("the Rentals form", () => {
  it("says how many fits still ask for a dropped piece", async () => {
    const { shop } = await demoShop();
    const html = renderToStaticMarkup(
      <RentalsForm shop={shop} t={t} locale="en-US" droppedFits={3} />,
    );
    expect(html).toContain("3 divers’ rental fits still ask for gear you no longer rent.");
    const one = renderToStaticMarkup(
      <RentalsForm shop={shop} t={t} locale="en-US" droppedFits={1} />,
    );
    expect(one).toContain("1 diver’s rental fit still asks for gear you no longer rent.");
  });

  it("is one table: a tick and a price per piece, the full set, the terms and the interval", async () => {
    const { shop } = await demoShop();
    const html = renderToStaticMarkup(<RentalsForm shop={shop} t={t} locale="en-US" />);
    expect(html).toContain('name="setPrice"');
    expect(html).toContain('name="nitroxPrice"');
    expect(html).toContain('name="price_fins"');
    expect(html).toContain('name="rentalTerms"');
    expect(html).toContain('name="regulatorServiceMonths"');
    // One form, one save.
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
  });

  it("leaves out the regulator interval while gear servicing is switched off", async () => {
    const { shop } = await demoShop();
    const html = renderToStaticMarkup(
      <RentalsForm shop={{ ...shop, workOrdersEnabled: false }} t={t} locale="en-US" />,
    );
    expect(html).toContain('name="rentalTerms"');
    expect(html).not.toContain('name="regulatorServiceMonths"');
  });

  /** Issue 3004: how the shop fills nitrox places Rent out's O2-clean warning. */
  it("asks how the shop fills nitrox, opening on what is stored", async () => {
    const { shop } = await demoShop();
    const html = renderToStaticMarkup(<RentalsForm shop={shop} t={t} locale="en-US" />);
    expect(html).toContain('name="nitroxFillMethod"');
    expect(html).toContain(t("settings.main.rentals.nitroxFill.label"));
    expect(html).toMatch(/<option value="blending" selected="">/);
    const membrane = renderToStaticMarkup(
      <RentalsForm shop={{ ...shop, nitroxFillMethod: "membrane_premix" }} t={t} locale="en-US" />,
    );
    expect(membrane).toMatch(/<option value="membrane_premix" selected="">/);
  });

  it("says nothing when no fit asks for a dropped piece", async () => {
    const { shop } = await demoShop();
    const html = renderToStaticMarkup(
      <RentalsForm shop={shop} t={t} locale="en-US" droppedFits={0} />,
    );
    expect(html).not.toContain("no longer rent");
  });
});
