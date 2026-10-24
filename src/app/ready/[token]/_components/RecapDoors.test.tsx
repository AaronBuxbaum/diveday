// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AfterStateProps } from "./AfterState";
import { noop, props, t } from "./after-state-test-fixtures";
import { Door, FieldGuideDoor, PhotoDoor, TipDoor } from "./RecapDoors";

afterEach(cleanup);

/** The photo door as `AfterState` renders it, inside the doors' list. */
function PhotoDoorOf({
  context,
  canShareWithBoat = true,
}: {
  context: AfterStateProps;
  canShareWithBoat?: boolean;
}) {
  return (
    <ul>
      <PhotoDoor
        t={context.t}
        shopName={context.shop.name}
        tripTitle={context.trip.title}
        photos={context.photos}
        maxPhotos={context.maxPhotos}
        canShareWithBoat={canShareWithBoat}
        notice={undefined}
        action={noop}
        unshareAction={noop}
      />
    </ul>
  );
}

/**
 * **A door shows only the controls that can do something** (2026-09-17 design
 * review). The photo door rested on three standing controls — "Add a photo", a
 * caption box and "Add to my recap" — and two of them could do nothing until a
 * file existed.
 *
 * The reveal is CSS rather than state, so this asserts the wiring the CSS needs
 * rather than a computed style jsdom does not produce: the file input carries
 * `required` (which is what makes `:valid` mean "a file is picked"), the
 * picker sits in the `peer`, and the caption and the submit sit in a `hidden`
 * sibling that the `peer-has-[input:valid]` variant opens. Doing it without
 * JavaScript is the point — this picker is deliberately built to work before it
 * hydrates.
 */
describe("the photo door's second and third controls", () => {
  const photoForm = (container: HTMLElement) =>
    [...container.querySelectorAll("form")].find((form) =>
      form.querySelector('input[type="file"]'),
    );

  it("hides the caption and the submit until a file is picked", () => {
    const { container } = render(<PhotoDoorOf context={props()} />);
    const form = photoForm(container);
    expect(form).toBeTruthy();

    const file = form?.querySelector('input[type="file"]');
    expect(file).toBeRequired();
    // The picker is the peer; the revealed block is its following sibling,
    // which is the shape `peer-has-*` compiles to (`~ *`).
    const peer = form?.querySelector(".peer");
    expect(peer?.contains(file ?? null)).toBe(true);

    const revealed = peer?.nextElementSibling;
    expect(revealed?.className).toContain("hidden");
    expect(revealed?.className).toContain("peer-has-[input:valid]:flex");
    expect(revealed?.querySelector('input[name="caption"]')).toBeTruthy();
    expect(revealed?.textContent).toContain("recap.addToMyRecap");
  });

  it("names the caption box by its own words, not only its placeholder", () => {
    render(<PhotoDoorOf context={props()} />);
    // `hidden: true` because the box rests collapsed until a file is picked.
    const caption = screen.getByRole("textbox", { name: "recap.captionLabel", hidden: true });
    expect(caption).toHaveAttribute("name", "caption");
  });

  it("leaves one standing control in the door", () => {
    const { container } = render(<PhotoDoorOf context={props()} />);
    const peer = photoForm(container)?.querySelector(".peer");
    // Everything else the form offers is behind the pick.
    expect(peer?.querySelectorAll("input")).toHaveLength(1);
    expect(peer?.textContent).toContain("recap.addAPhoto");
  });
});

/**
 * **The share tick is drawn on the readiness link only** (security review of
 * layer r5-4, F3): `/recap` is forwardable for 180 days, so a photo added there
 * stays on that diver's own recap.
 */
describe("the photo door's share tick", () => {
  it("is offered from the diver's readiness link", () => {
    const { container } = render(<PhotoDoorOf context={props()} canShareWithBoat />);
    expect(container.querySelector('input[name="shareWithBoat"]')).toBeTruthy();
  });

  it("is not offered from the recap link", () => {
    const { container } = render(<PhotoDoorOf context={props()} canShareWithBoat={false} />);
    expect(container.querySelector('input[name="shareWithBoat"]')).toBeNull();
    expect(container.querySelector('input[name="caption"]')).toBeTruthy();
  });
});

describe("a quiet door", () => {
  it("is a native disclosure, shut unless told otherwise", () => {
    render(
      <ul>
        <Door id="photos" summary="Your photos" open={false}>
          <p>inside</p>
        </Door>
      </ul>,
    );
    const details = document.getElementById("photos");
    expect(details?.tagName).toBe("DETAILS");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.closest("li")?.getAttribute("data-recap-door")).toBe("photos");
  });
});

describe("the photo door's limit", () => {
  it("offers no picker once the shop's limit is reached", () => {
    const photos = [{ id: "p1", imageUrl: "/blob/p1.jpg", caption: null }] as never;
    render(
      <ul>
        <PhotoDoor
          t={t}
          shopName="Blue Mantis Divers"
          tripTitle="Two-Tank"
          photos={photos}
          maxPhotos={1}
          canShareWithBoat
          notice={undefined}
          action={noop}
          unshareAction={noop}
        />
      </ul>,
    );
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText("recap.photoLimitReached")).toBeTruthy();
  });
});

describe("the tip door", () => {
  const tipDoor = (overrides: Partial<Parameters<typeof TipDoor>[0]> = {}) =>
    render(
      <ul>
        <TipDoor
          t={t}
          locale="en-US"
          shopName="Blue Mantis Divers"
          currency="usd"
          canTip={true}
          tip={null}
          tipPresets={[10, 20, 40]}
          notice={undefined}
          action={noop}
          {...overrides}
        />
      </ul>,
    );

  it("renders nothing when the shop cannot take a tip and none is on record", () => {
    const { container } = tipDoor({ canTip: false });
    expect(container.querySelector("li")).toBeNull();
  });

  it("keeps a paid tip's thanks after the shop disconnects its payments", () => {
    tipDoor({ canTip: false, tip: { status: "paid", amountCents: 2000 } as never });
    expect(screen.getByText("recap.tipPaid(Blue Mantis Divers)")).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
  });

  it("never re-offers the form while Stripe's return waits on the webhook", () => {
    tipDoor({ tipParam: "paid" });
    expect(screen.getByText("recap.tipConfirming")).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
  });
});

describe("the field guide door", () => {
  it("renders nothing at all when no site names a species", () => {
    const { container } = render(
      <ul>
        <FieldGuideDoor t={t} groups={[]} />
      </ul>,
    );
    expect(container.querySelector("li")).toBeNull();
  });
});
