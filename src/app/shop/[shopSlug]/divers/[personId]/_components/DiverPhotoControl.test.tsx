/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DiverPhotoControl } from "./DiverPhotoControl";
import { DiverRecordMenu } from "./DiverRecordMenu";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/",
}));

const copy = {
  add: "Add a photo",
  change: "Change photo",
  remove: "Remove photo",
  adding: "Adding photo",
  wrongTypeSuffix: "wrong type",
  tooBigSuffix: "too big",
  saved: "Photo saved",
  error: "Photo failed",
};

it("names the avatar picker according to whether a photo exists", () => {
  const { rerender } = render(
    <DiverPhotoControl name="Ada Diver" photoPath={null} action={vi.fn()} copy={copy} />,
  );
  expect(screen.getByLabelText("Add a photo")).toBeTruthy();
  rerender(
    <DiverPhotoControl name="Ada Diver" photoPath="/photo.jpg" action={vi.fn()} copy={copy} />,
  );
  expect(screen.getByLabelText("Change photo")).toBeTruthy();
});

it("confirms photo removal and reports the result in a toast", async () => {
  const action = vi.fn(async () => true);
  render(
    <DiverRecordMenu
      label="More"
      photo={{
        action,
        label: "Remove photo",
        confirm: "Remove this photo?",
        cancel: "Cancel",
        saved: "Photo removed",
        error: "Photo failed",
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
  const dialog = screen.getByRole("dialog", { name: "Remove this photo?" });
  expect(action).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Remove photo" }));
  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  expect((action.mock.calls[0] as unknown as [FormData])[0].get("remove")).toBe("1");
  expect(await screen.findByText("Photo removed")).toBeTruthy();
});
