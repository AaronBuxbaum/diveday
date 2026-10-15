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
  AccountGroup,
  BoatsSitesGroup,
  BookingsGroup,
  DataGroup,
  MessagesGroup,
  MoneyGroup,
  NotificationsGroup,
  RarelyChangedGroup,
  RentalsGroup,
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
      BoatsSitesGroup({ view }),
      BookingsGroup({ view, canManageWaivers: true }),
      RentalsGroup({ view }),
      MoneyGroup({ view, canPayments: true, account: null, connectConfigured: false }),
      MessagesGroup({ view, canManageMessaging: true }),
      NotificationsGroup({ view }),
      WebsiteGroup({ view }),
      await DataGroup({ view, db, personId, canExport: true, canImport: true }),
      AccountGroup({ view, canViewBilling: true }),
      RarelyChangedGroup({ view, canPayments: true }),
    ].map(shape);

    expect(rendered.map((group) => group.id)).toEqual(SETTINGS_GROUPS.map((group) => group.id));
    expect(rendered[0]?.rows).toEqual(["timezone", "units", "address"]);
    expect(rendered[1]?.rows).toEqual(["crewSchedule"]);
    expect(rendered[2]?.rows).toEqual([]);
    // PADI checks sit under the extension's own row, where a shop meets the checks.
    expect(rendered[3]?.rows).toEqual(["certCheck", "padiChecks", "packing"]);
    expect(rendered[4]?.rows).toEqual(["rentalTerms", "regulatorService"]);
    expect(rendered[5]?.rows).toEqual(["tax", "tips", "stripe"]);
    expect(rendered[6]?.rows).toEqual(["reviews", "reviewLink"]);
    // Every row that decides where mail goes, in one group (they were in
    // Shop, Messages and Account).
    expect(rendered[7]?.rows).toEqual(["contact", "deskHours"]);
    expect(hrefsIn(NotificationsGroup({ view }))).toEqual([
      `/shop/${view.shopSlug}/settings/email`,
    ]);
    expect(rendered[8]?.rows).toEqual([
      "shopPhotos",
      "dateRequests",
      "lastMinuteList",
      "publicYear",
    ]);
    expect(rendered[10]?.rows).toEqual([]);
    // The set-once rows, last.
    expect(rendered[11]?.rows).toEqual(["season", "divingOptions", "passThrough", "searchListing"]);
    expect(hrefsIn(RarelyChangedGroup({ view, canPayments: true }))).toEqual([
      `/shop/${view.shopSlug}/settings/trip-tags`,
    ]);
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

    // The activity log needs no gate of its own here: the hub is already
    // owner and manager reading, the log's own set, and the page re-checks.
    // So Team draws for a reader who cannot manage staff, with only that door.
    const team = TeamGroup({ view, canManageTeam: false });
    expect(shape(team).rows).toEqual([]);
    expect(hrefsIn(team)).toEqual([`/shop/${view.shopSlug}/settings/activity`]);

    expect(shape(RarelyChangedGroup({ view, canPayments: false })).rows).not.toContain(
      "passThrough",
    );

    const messages = MessagesGroup({ view, canManageMessaging: false });
    expect(hrefsIn(messages)).not.toContain(`/shop/${view.shopSlug}/settings/whatsapp`);

    expect(hrefsIn(AccountGroup({ view, canViewBilling: false }))).not.toContain(
      `/shop/${view.shopSlug}/settings/billing`,
    );
  });
});
