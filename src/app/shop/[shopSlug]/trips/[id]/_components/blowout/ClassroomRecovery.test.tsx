// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { escapeRegExp } from "@/lib/escape-regexp";
import { ClassroomRecovery } from "./ClassroomRecovery";

vi.mock("../../blowout-actions", () => ({
  createClassroomActivityAction: vi.fn(),
  transitionClassroomActivityAction: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("identifies classroom capacity by its full Field accessible name", () => {
  const t = staffTranslator("en-US");
  // This empty creation form reads only these page fields; trip/roster and
  // permissions are enforced by the containing page and are not rendered here.
  const page = {
    classroomActivities: [],
    classroomCoordinators: [],
    blowout: null,
  };
  render(
    <ClassroomRecovery
      page={page}
      shopSlug="blue-mantis"
      tripId="trip-classroom"
      locale="en-US"
      timezone="America/New_York"
      dateRequestsEnabled={false}
      contactEmail={null}
      contactPhone={null}
      t={t}
    />,
  );
  fireEvent.click(screen.getByText(t("blowout.classroom.add"), { exact: true }));
  const capacity = screen.getByRole("spinbutton", {
    name: new RegExp(
      `^${escapeRegExp(t("blowout.classroom.capacity"))}\\s*${escapeRegExp(t("blowout.classroom.capacityHint"))}$`,
    ),
  });
  expect(screen.queryByRole("spinbutton", { name: t("blowout.classroom.capacity") })).toBeNull();
  expect(capacity).toHaveAttribute("name", "capacity");
  expect(capacity).toBeRequired();
  expect(capacity).toHaveAttribute("min", "1");
  expect(capacity).toHaveAttribute("max", "500");
});

function preparedOffer() {
  const startsAt = new Date("2099-07-22T09:00:00Z");
  const endsAt = new Date("2099-07-22T10:00:00Z");
  // Only the read projection consumed by this component; no domain records are written.
  const page = {
    classroomCoordinators: [],
    classroomActivities: [
      {
        id: "classroom-id",
        title: "Photography ashore",
        startsAt,
        endsAt,
        location: "Shop classroom",
        capacity: 8,
        confirmed: 0,
        coordinatorName: "Dana",
        status: "scheduled",
        revision: 0,
        conflicts: [],
        participants: [],
        offers: [
          {
            blowoutDiverId: "diver-id",
            snapshot: {
              title: "Photography ashore",
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              location: "Shop classroom",
            },
          },
        ],
      },
    ],
    blowout: { divers: [{ id: "diver-id", fullName: "Recovery Diver" }] },
  } as unknown as React.ComponentProps<typeof ClassroomRecovery>["page"];
  render(
    <ClassroomRecovery
      page={page}
      shopSlug="blue-mantis"
      tripId="source-trip"
      locale="en-US"
      timezone="UTC"
      dateRequestsEnabled
      contactEmail="desk@example.com"
      contactPhone={null}
      t={staffTranslator("en-US")}
    />,
  );
  fireEvent.click(
    screen.getByText(staffTranslator("en-US")("blowout.classroom.divers"), { exact: true }),
  );
  return screen.getByRole("region", {
    name: staffTranslator("en-US")("blowout.classroom.offerCopy"),
  });
}
it("shows a portable canonical inquiry URL with its classroom context in prepared copy", () => {
  vi.stubEnv("APP_HOST", "https://booking.example.com");
  const copy = preparedOffer();
  const url =
    "https://booking.example.com/s/blue-mantis?recoveryActivity=classroom-id#classroom-request";
  expect(copy).toHaveTextContent(url);
  expect(screen.getByRole("link", { name: url })).toHaveAttribute("href", url);
});
it.each(["", "https://unsafe.example.com/embedded/path"])(
  "keeps contact fallback when canonical origin is unavailable: %s",
  (origin) => {
    vi.stubEnv("APP_HOST", origin);
    const copy = preparedOffer();
    expect(copy).toHaveTextContent("mailto:desk@example.com");
    expect(screen.getByRole("link", { name: "mailto:desk@example.com" })).toHaveAttribute(
      "href",
      "mailto:desk@example.com",
    );
  },
);
