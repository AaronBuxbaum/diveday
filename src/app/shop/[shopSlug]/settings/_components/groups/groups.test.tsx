import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { AppDb } from "@/db/client";
import { listShopStaff } from "@/db/staff-accounts";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import { findElements, hrefsIn } from "@/test/jsx-inspect";
import { SETTINGS_GROUPS } from "../../settings-groups";
import { SettingsRow } from "../SettingsRows";
import {
  BookingsGroup,
  DataGroup,
  FeaturesGroup,
  MessagesGroup,
  MoneyGroup,
  ShopGroup,
  TeamGroup,
  WebsiteGroup,
} from "./groups";
import { SettingsGroup, type SettingsView } from "./kit";

const ctx = fileScopedShopContext();

async function viewFor(): Promise<{ db: AppDb; view: SettingsView; personId: string }> {
  const { db, shop } = ctx;
  const owner = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes("owner"));
  if (!owner) throw new Error("the seed has no owner");
  const t = staffTranslator("en-US");
  return {
    db,
    personId: owner.personId,
    view: {
      shop,
      shopSlug: shop.slug,
      t,
      locale: "en-US",
      banner: undefined,
      activeSection: null,
      notSet: t("settings.main.summary.notSet"),
    },
  };
}

/** The group's id and the section ids of the rows it drew. */
function shape(element: ReactElement) {
  const [group] = findElements<{ group: { id: string } }>(element, SettingsGroup);
  const rows = findElements<{ sectionId?: string }>(element, SettingsRow).flatMap((row) =>
    row.props.sectionId ? [row.props.sectionId] : [],
  );
  return { id: group?.props.group.id, rows };
}

const shopGroup = (view: SettingsView, hasBoatDiving = true) =>
  ShopGroup({
    view: { ...view, shop: { ...view.shop, hasBoatDiving } },
    canPayments: true,
    hasPricedRecords: false,
    currencyMismatch: null,
    addressLookupEnabled: false,
    boatsWithoutRadioIdentity: 0,
  });

describe("each settings group renders as its own component", () => {
  it("draws every group under its registered id, with its own rows", async () => {
    const { db, view, personId } = await viewFor();
    const rendered = [
      shopGroup(view),
      TeamGroup({ view, canManageTeam: true }),
      BookingsGroup({ view, canManageWaivers: true, canPayments: true }),
      MoneyGroup({
        view,
        canPayments: true,
        canViewBilling: true,
        account: null,
        connectConfigured: false,
      }),
      MessagesGroup({ view, canManageMessaging: true }),
      WebsiteGroup({ view }),
      FeaturesGroup({ view }),
      await DataGroup({ view, db, personId, canExport: true, canImport: true }),
    ].map(shape);

    // Seven groups (issue #2813) and Features (#2814), in the registry's order.
    expect(rendered.map((group) => group.id)).toEqual(SETTINGS_GROUPS.map((group) => group.id));
    expect(SETTINGS_GROUPS).toHaveLength(8);
    // The set-once rows (season, listing) live with the shop.
    expect(rendered[0]?.rows).toEqual([
      "timezone",
      "units",
      "juniorBuddy",
      "address",
      "season",
      "searchListing",
    ]);
    expect(rendered[1]?.rows).toEqual(["crewSchedule"]);
    // No on/off switch is a row any more: they are all on the Features page.
    expect(rendered[2]?.rows).toEqual(["certCheck", "packing"]);
    expect(rendered[3]?.rows).toEqual(["passThrough", "stripe"]);
    expect(rendered[4]?.rows).toEqual(["contact", "deskHours", "reviewLink"]);
    expect(rendered[5]?.rows).toEqual(["shopPhotos"]);
    expect(rendered[6]?.rows).toEqual([]);
    expect(hrefsIn(FeaturesGroup({ view }))).toEqual([`/shop/${view.shopSlug}/settings/features`]);
    expect(rendered[7]?.rows).toEqual([]);
  });

  it("keeps the registers beside the shop, and the shop's own mail out of Messages", async () => {
    const { view } = await viewFor();
    const base = `/shop/${view.shopSlug}`;
    expect(hrefsIn(shopGroup(view))).toEqual([
      `${base}/settings/emergency-reference`,
      `${base}/dive-sites`,
      `${base}/boats`,
      `${base}/trip-tags`,
      `${base}/safety-checklist`,
    ]);
    // A shop that does not dive from a boat has no fleet page, so no door.
    expect(hrefsIn(shopGroup(view, false))).not.toContain(`${base}/boats`);
    // `/settings/email` is the reader's own (My account), not a shop setting.
    expect(hrefsIn(MessagesGroup({ view, canManageMessaging: true }))).toEqual([
      `${base}/settings/whatsapp`,
    ]);
  });

  it("opens Your data at the first part this reader may use", async () => {
    const { db, view, personId } = await viewFor();
    const base = `/shop/${view.shopSlug}/settings`;
    expect(
      hrefsIn(await DataGroup({ view, db, personId, canExport: true, canImport: true })),
    ).toEqual([`${base}/export`]);
    expect(
      hrefsIn(await DataGroup({ view, db, personId, canExport: false, canImport: true })),
    ).toEqual([`${base}/import`]);
    expect(
      hrefsIn(await DataGroup({ view, db, personId, canExport: false, canImport: false })),
    ).toEqual([`${base}/integrations`]);
  });

  it("hides what its gates hide", async () => {
    const { view } = await viewFor();
    const base = `/shop/${view.shopSlug}`;
    const money = MoneyGroup({
      view,
      canPayments: false,
      canViewBilling: false,
      account: null,
      connectConfigured: false,
    });
    expect(shape(money).rows).toEqual([]);
    expect(hrefsIn(money)).not.toContain(`${base}/settings/billing`);
    expect(
      hrefsIn(
        MoneyGroup({
          view,
          canPayments: true,
          canViewBilling: true,
          account: null,
          connectConfigured: false,
        }),
      ),
    ).toContain(`${base}/settings/billing`);

    // The activity log needs no gate of its own here: the hub is already
    // owner and manager reading, the log's own set, and the page re-checks.
    // So Team draws for a reader who cannot manage staff, with only that door.
    const team = TeamGroup({ view, canManageTeam: false });
    expect(shape(team).rows).toEqual([]);
    expect(hrefsIn(team)).toEqual([`${base}/settings/activity`]);

    // The Rentals door is payment-settings work.
    const noPayments = BookingsGroup({ view, canManageWaivers: false, canPayments: false });
    expect(hrefsIn(noPayments)).not.toContain(`${base}/settings/rentals`);

    // Card checks is one row with its try-it inside (#2817): no page to link to.
    expect(hrefsIn(noPayments).some((href) => href.includes("cert-checks"))).toBe(false);

    const messages = MessagesGroup({ view, canManageMessaging: false });
    expect(hrefsIn(messages)).not.toContain(`${base}/settings/whatsapp`);
  });
});
