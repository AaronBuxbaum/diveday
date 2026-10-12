// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { offlineManifestTranslator } from "@/i18n/offline-manifest-messages";
import { OfflineNoSavedTrip, OfflineOpeningScreen } from "./ShellScreens";

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

describe("OfflineNoSavedTrip", () => {
  it("says plainly that nothing was saved for a trip this device never held", () => {
    render(
      <OfflineNoSavedTrip
        t={t}
        message="Nothing here"
        removedForOtherShop={null}
        discardNotice={null}
      />,
    );
    expect(
      screen.getByRole("heading", { name: t("shared.offlineManifest.single.emptyHeading") }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Nothing here");
  });

  it("names the cross-shop purge instead of claiming nothing was ever saved", () => {
    render(
      <OfflineNoSavedTrip t={t} message="Nothing here" removedForOtherShop discardNotice={null} />,
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
