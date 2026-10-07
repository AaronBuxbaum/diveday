import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { AppDb } from "@/db/client";
import { listShopStaff } from "@/db/staff-accounts";
import { staffTranslator } from "@/i18n/staff-messages";
import { seededShopContext } from "@/test/db";
import { findElements, hrefsIn } from "@/test/jsx-inspect";
import { SETTINGS_GROUPS } from "../../settings-groups";
import { SettingsRow } from "../SettingsRows";
import {
  AccountGroup,
  BoatsSitesGroup,
  BookingsGroup,
  DataGroup,
  MessagesGroup,
  MoneyGroup,
  RentalsGroup,
  ShopGroup,
  TeamGroup,
  WebsiteGroup,
} from "./groups";
import { SettingsGroup, type SettingsView } from "./kit";

async function viewFor(): Promise<{ db: AppDb; view: SettingsView; personId: string }> {
  const { db, shop } = await seededShopContext();
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

describe("each settings group renders as its own component", () => {
  it("draws every group under its registered id, with its own rows", async () => {
    const { db, view, personId } = await viewFor();
    const rendered = [
      ShopGroup({
        view,
        canPayments: true,
        hasPricedRecords: false,
        currencyMismatch: null,
        addressLookupEnabled: false,
      }),
      TeamGroup({ view, canManageTeam: true }),
      await BoatsSitesGroup({ view, db }),
      BookingsGroup({ view, canManageWaivers: true }),
      RentalsGroup({ view }),
      MoneyGroup({ view, canPayments: true, account: null, connectConfigured: false }),
      MessagesGroup({ view, canManageMessaging: true }),
      WebsiteGroup({ view }),
      await DataGroup({ view, db, personId, canExport: true, canImport: true }),
      AccountGroup({ view, canViewBilling: true }),
    ].map(shape);

    expect(rendered.map((group) => group.id)).toEqual(SETTINGS_GROUPS.map((group) => group.id));
    expect(rendered[0]?.rows).toEqual(["timezone", "season", "units", "contact", "address"]);
    expect(rendered[1]?.rows).toEqual(["crewSchedule"]);
    expect(rendered[2]?.rows).toEqual(["divingOptions", "emergency", "dockCall"]);
    expect(rendered[4]?.rows).toEqual(["rentals", "rentalPricing"]);
    expect(rendered[5]?.rows).toEqual(["tax", "passThrough", "tips", "stripe"]);
    expect(rendered[6]?.rows).toEqual(["reviews", "reviewLink"]);
    expect(rendered[7]?.rows).toEqual([
      "profile",
      "shopPhotos",
      "searchListing",
      "dateRequests",
      "lastMinuteList",
    ]);
    expect(rendered[9]?.rows).toEqual([]);
    expect(hrefsIn(AccountGroup({ view, canViewBilling: true }))).toContain(
      `/shop/${view.shopSlug}/settings/billing`,
    );
  });

  it("hides what its gates hide", async () => {
    const { db, view, personId } = await viewFor();
    const money = MoneyGroup({ view, canPayments: false, account: null, connectConfigured: false });
    expect(shape(money).rows).toEqual([]);

    const data = await DataGroup({ view, db, personId, canExport: false, canImport: false });
    expect(hrefsIn(data)).toEqual([`/shop/${view.shopSlug}/settings/integrations`]);

    const messages = MessagesGroup({ view, canManageMessaging: false });
    expect(hrefsIn(messages)).not.toContain(`/shop/${view.shopSlug}/settings/whatsapp`);

    expect(hrefsIn(AccountGroup({ view, canViewBilling: false }))).not.toContain(
      `/shop/${view.shopSlug}/settings/billing`,
    );
  });
});
