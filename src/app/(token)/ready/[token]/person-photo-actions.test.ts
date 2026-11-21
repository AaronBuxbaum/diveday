import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./action-helpers", () => ({ contextFor: vi.fn() }));
vi.mock("@/features/people/person-photo", () => ({ changePrivatePersonPhoto: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { changePrivatePersonPhoto } from "@/features/people/person-photo";
import { contextFor } from "./action-helpers";
import { saveOwnPhotoAction } from "./person-photo-actions";

const initial = { outcome: null } as const;
const db = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(contextFor).mockResolvedValue({
    ok: true,
    db,
    delivered: true,
    data: { identityHeld: false },
  } as never);
  vi.mocked(changePrivatePersonPhoto).mockResolvedValue("saved");
});

describe("saveOwnPhotoAction", () => {
  it.each([
    { delivered: false, identityHeld: false },
    { delivered: true, identityHeld: true },
  ])("refuses an undelivered or held capability", async ({ delivered, identityHeld }) => {
    vi.mocked(contextFor).mockResolvedValue({
      ok: true,
      db,
      delivered,
      data: { identityHeld },
    } as never);
    expect(await saveOwnPhotoAction("token", initial, new FormData())).toEqual({
      outcome: "invalid",
    });
    expect(changePrivatePersonPhoto).not.toHaveBeenCalled();
  });

  it("passes only the capability and file to the transaction-owned service", async () => {
    const form = new FormData();
    form.set("photo", new File(["image"], "private-name.jpg", { type: "image/jpeg" }));
    form.set("personId", "another-person");
    expect(await saveOwnPhotoAction("token", initial, form)).toEqual({ outcome: "saved" });
    expect(changePrivatePersonPhoto).toHaveBeenCalledWith(db, {
      actor: { kind: "readiness", token: "token" },
      file: {
        filename: "private-name.jpg",
        contentType: "image/jpeg",
        bytes: expect.any(ArrayBuffer),
      },
    });
  });

  it("passes a removal to the same service", async () => {
    const form = new FormData();
    form.set("remove", "1");
    expect(await saveOwnPhotoAction("token", initial, form)).toEqual({ outcome: "saved" });
    expect(changePrivatePersonPhoto).toHaveBeenCalledWith(db, {
      actor: { kind: "readiness", token: "token" },
      file: null,
    });
  });

  it("rejects an empty selection and reports failed saves", async () => {
    expect(await saveOwnPhotoAction("token", initial, new FormData())).toEqual({
      outcome: "invalid",
    });
    expect(changePrivatePersonPhoto).not.toHaveBeenCalled();
    vi.mocked(changePrivatePersonPhoto).mockResolvedValue("failed");
    const form = new FormData();
    form.set("remove", "1");
    expect(await saveOwnPhotoAction("token", initial, form)).toEqual({ outcome: "failed" });
  });
});
