import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { diverTranslator } from "@/i18n/messages";
import { OwnPhoto } from "./OwnPhoto";

vi.mock("@/features/people/person-photo", () => ({ getDiverPhotoState: vi.fn() }));

import { getDiverPhotoState } from "@/features/people/person-photo";

const db = {} as AppDb;
const base = { db, token: "token", t: diverTranslator("en-US") };
beforeEach(() => vi.clearAllMocks());

describe("OwnPhoto", () => {
  it.each([
    { delivered: false, identityHeld: false },
    { delivered: true, identityHeld: true },
  ])("hides the control and reads nothing without a confirmed delivered link", async (state) => {
    expect(await OwnPhoto({ ...base, ...state })).toBeNull();
    expect(getDiverPhotoState).not.toHaveBeenCalled();
  });

  it("allows removal of an existing fallback without exposing its public URL", async () => {
    vi.mocked(getDiverPhotoState).mockResolvedValue({ hasPhoto: true, privatePhoto: null });
    const section = await OwnPhoto({ ...base, delivered: true, identityHeld: false });
    expect(section?.props.children.props).toMatchObject({ hasPhoto: true, photoUrl: null });
  });

  it("points a current private photo to the capability-scoped preview", async () => {
    vi.mocked(getDiverPhotoState).mockResolvedValue({
      hasPhoto: true,
      privatePhoto: { url: "private-url", assetId: "asset.jpg" },
    });
    const section = await OwnPhoto({ ...base, delivered: true, identityHeld: false });
    expect(section?.props.children.props.photoUrl).toBe("/ready/token/photo/asset.jpg");
  });
});
