import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { MEDIA_KEY_PREFIXES, storeStaffProfileImage } from "./index";

it("registers staff pictures and sends only re-encoded image bytes to its own namespace", async () => {
  expect(MEDIA_KEY_PREFIXES).toContain("staff-profiles");
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } })
    .png()
    .toBuffer();
  const provider = {
    upload: vi.fn().mockResolvedValue({
      status: "stored",
      url: "https://media.invalid/staff-profiles/random.jpg",
    }),
  };
  await expect(
    storeStaffProfileImage({ filename: "portrait.png", contentType: "image/png", bytes }, provider),
  ).resolves.toMatchObject({ status: "stored" });
  expect(provider.upload).toHaveBeenCalledWith(
    expect.objectContaining({
      keyPrefix: "staff-profiles",
      contentType: "image/jpeg",
      filename: "portrait.jpg",
    }),
  );
});
