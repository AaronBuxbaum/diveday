// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PhotoLightbox } from "./PhotoLightbox";

const words = { label: "Photo, enlarged", close: "Close", previous: "Previous", next: "Next" };
const photos = [
  { src: "/a.jpg", alt: "Mantis II" },
  { src: "/b.jpg", alt: "The reef" },
];

beforeEach(() => {
  // jsdom has no modal dialog; stand in for the two calls the component makes.
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});
afterEach(cleanup);

function lightbox(list = photos) {
  return render(
    <PhotoLightbox photos={list} words={words} sizes="100vw" thumbClassName="aspect-video" />,
  );
}

it("opens the tapped photo large and steps through the rest", () => {
  lightbox();
  fireEvent.click(screen.getByRole("button", { name: "The reef" }));
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  expect(screen.getAllByAltText("The reef")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByAltText("Mantis II")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByAltText("The reef")).toBeTruthy();
});

it("closes with the close button", () => {
  lightbox();
  fireEvent.click(screen.getByRole("button", { name: "Mantis II" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
});

it("offers no next or previous for a single photo", () => {
  lightbox([photos[0]]);
  fireEvent.click(screen.getByRole("button", { name: "Mantis II" }));
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
});

it("keeps only list items in the thumbnail list and the dialog beside it", () => {
  render(
    <PhotoLightbox
      photos={photos}
      words={words}
      sizes="100vw"
      thumbClassName="aspect-video"
      thumbnailList={{ label: "Shop photos", className: "", itemClassName: "" }}
    />,
  );
  const list = screen.getByRole("list", { name: "Shop photos" });
  expect(Array.from(list.children).map((child) => child.tagName)).toEqual(["LI", "LI"]);
  fireEvent.click(screen.getByRole("button", { name: "The reef" }));
  const dialog = screen.getByRole("dialog", { name: words.label });
  expect(list.contains(dialog)).toBe(false);
});
