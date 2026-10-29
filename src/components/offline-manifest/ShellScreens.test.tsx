// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import {
  OfflineNoSavedTrip,
  OfflineOpeningScreen,
  OfflineTenantVerificationScreen,
} from "./ShellScreens";

afterEach(cleanup);

const t = offlineManifestTranslator("en-US");

describe("OfflineOpeningScreen", () => {
  it("says only what is true before the store has been read", () => {
    render(<OfflineOpeningScreen t={t} message="Reading this phone" />);
    expect(
      screen.getByRole("heading", { name: t("shared.offlineManifest.openingHeading") }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Reading this phone");
  });
});

describe("OfflineTenantVerificationScreen", () => {
  it("shows the shop-switch status without rendering roster content", () => {
    render(
      <OfflineTenantVerificationScreen
        t={t}
        message={t("shared.offlineManifest.reconcile.tenantChanged")}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: t("shared.offlineManifest.single.tenantChangedHeading"),
      }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Pending changes remain saved");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("OfflineNoSavedTrip", () => {
  it("says plainly that nothing was saved for a trip this device never held", () => {
    render(
      <OfflineNoSavedTrip
        t={t}
        message="Nothing here"
        removedForOtherShop={null}
        readFailed={false}
        discardNotice={null}
      />,
    );
    expect(
      screen.getByRole("heading", { name: t("shared.offlineManifest.single.emptyHeading") }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Nothing here");
    expect(screen.queryByText(t("shared.offlineManifest.single.readFailedHint"))).toBeNull();
  });

  it("says the copy could not be opened when the store read failed (issue 2637)", () => {
    render(
      <OfflineNoSavedTrip
        t={t}
        message="Could not read"
        removedForOtherShop={null}
        readFailed
        discardNotice={null}
      />,
    );
    expect(
      screen.getByRole("heading", { name: t("shared.offlineManifest.single.readFailedHeading") }),
    ).toBeTruthy();
    expect(screen.queryByText(t("shared.offlineManifest.single.emptyHeading"))).toBeNull();
    expect(screen.queryByText(t("shared.offlineManifest.single.emptyHint"))).toBeNull();
    expect(screen.getByText(t("shared.offlineManifest.single.readFailedHint"))).toBeTruthy();
    // The error line stays.
    expect(screen.getByRole("status").textContent).toBe("Could not read");
  });

  it("names the cross-shop purge instead of claiming nothing was ever saved", () => {
    render(
      <OfflineNoSavedTrip
        t={t}
        message="Nothing here"
        removedForOtherShop
        readFailed={false}
        discardNotice={null}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: t("shared.offlineManifest.single.removedOtherShopHeading"),
      }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      t("shared.offlineManifest.single.removedOtherShopMessage"),
    );
    expect(screen.queryByText(t("shared.offlineManifest.single.emptyHint"))).toBeNull();
  });
});
