import QRCode from "qrcode";
import { openCourseFormQr } from "./course-forms-qr-helper";
import { expect, signedInAsOwner, test } from "./fixtures";
import { capture, installVisualBuildGuard, SURFACE_TIMEOUT_MS } from "./visual-harness";

installVisualBuildGuard();
// A real QR is a bearer credential. No failure trace or automatic screenshot may contain it.
test.use({ screenshot: "off", trace: "off" });
signedInAsOwner();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });

test("course-form QR handoff with a synthetic code (light)", async ({ page }) => {
  const { dialog } = await openCourseFormQr(page);
  const image = dialog.getByRole("img");
  // The visible code in captures is deliberately nonfunctional and contains no capability.
  const synthetic = await QRCode.toDataURL("https://example.test/synthetic", {
    margin: 4,
    width: 256,
  });
  await capture(page, "course-forms-qr-synthetic", "light", {
    beforeScreenshot: async () => {
      await image.evaluate((element, value) => element.setAttribute("src", value), synthetic);
      await expect(image).toHaveAttribute("src", synthetic);
    },
  });
});
