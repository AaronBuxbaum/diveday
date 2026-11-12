// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DayBoard, type DayCopy } from "./DayBoard";

vi.mock("../day-actions", () => ({ moveDayPersonAction: vi.fn() }));
afterEach(cleanup);
const copy: DayCopy = {
  day: "Day",
  week: "Week",
  chooseDay: "Choose a day",
  showDay: "Show day",
  empty: "No departures",
  crew: "Crew",
  divers: "Divers",
  noCrew: "No crew",
  noDivers: "No divers",
  move: "Move",
  moveTo: "Move to",
  choose: "Choose",
  submit: "Confirm move",
  cancel: "Cancel",
  previewClash: "Conflict",
  moved: "Moved",
  refused: "Refused",
  busy: "Busy",
  clash: "Clash",
  attention: "Check details",
  noBoat: "No boat",
  pending: "Moving",
  party: "Whole party",
  standingClash: "{name} is also on {departure}.",
  absent: "Marked absent",
  identityHeld: "Confirm identity",
  partyIdentityHeld: "Confirm party identities",
  hullClash: "{boat} is also on {departure}.",
  overCapacity: "Too many bookings",
  shore: "Shore",
  pool: "Pool",
};
const window = (start: string, end: string) => [
  { startsAt: new Date(`2035-08-04T${start}:00Z`), endsAt: new Date(`2035-08-04T${end}:00Z`) },
];
const rows = [
  {
    tripId: "source",
    title: "Source",
    proof: "proof-alpha",
    allWindows: window("08:00", "10:00"),
    boatName: "Alpha",
    diveMode: "boat" as const,
    capacity: 8,
    boatCapacity: 8,
    certifiedPassengers: null,
    certifiedTotalPersons: null,
    totalPersonNotice: null,
    totalPersonWarning: null,
    boatClashes: [],
    overSellableCapacity: false,
    time: "08:00",
    windows: window("08:00", "10:00"),
    crew: [{ id: "alice", name: "Alice" }],
    divers: [],
    collisions: [],
  },
  {
    tripId: "target",
    title: "Target",
    proof: "proof-beta",
    allWindows: window("12:00", "14:00"),
    boatName: "Beta",
    diveMode: "boat" as const,
    capacity: 8,
    boatCapacity: 8,
    certifiedPassengers: null,
    certifiedTotalPersons: null,
    totalPersonNotice: null,
    totalPersonWarning: null,
    boatClashes: [],
    overSellableCapacity: false,
    time: "12:00",
    windows: window("12:00", "14:00"),
    crew: [],
    divers: [],
    collisions: [],
  },
  {
    tripId: "other",
    title: "Other",
    proof: "proof-gamma",
    allWindows: window("13:00", "15:00"),
    boatName: "Gamma",
    diveMode: "boat" as const,
    capacity: 8,
    boatCapacity: 8,
    certifiedPassengers: null,
    certifiedTotalPersons: null,
    totalPersonNotice: null,
    totalPersonWarning: null,
    boatClashes: [],
    overSellableCapacity: false,
    time: "13:00",
    windows: window("13:00", "15:00"),
    crew: [{ id: "alice", name: "Alice" }],
    divers: [],
    collisions: [],
  },
];

it("warns before a conflicting move and cancel resets the choice", async () => {
  const user = userEvent.setup();
  render(<DayBoard shopSlug="reef" day="2035-08-04" rows={rows} copy={copy} />);
  const source = screen.getByRole("link", { name: "Source" }).closest("li");
  if (!source) throw new Error("missing source");
  await user.click(within(source).getByText("Crew (1)"));
  await user.click(within(source).getByText("Move"));
  const select = within(source).getByLabelText("Move to");
  await user.selectOptions(select, "target");
  expect(within(source).getByRole("alert")).toHaveTextContent("Conflict");
  expect(within(source).getByRole("button", { name: "Confirm move" })).toBeDisabled();
  await user.click(within(source).getByRole("button", { name: "Cancel" }));
  await user.click(within(source).getByText("Move"));
  expect(select).toHaveValue("");
  expect(within(source).queryByRole("alert")).toBeNull();
});

it("warns when moving a diver would leave their crew role on the source", async () => {
  const user = userEvent.setup();
  const dual = [
    {
      ...rows[0],
      divers: [
        {
          tripId: "source",
          id: "seat",
          personId: "alice",
          name: "Alice",
          status: "booked" as const,
          identityHeld: false,
          partyLeadBookingId: null,
        },
      ],
    },
    { ...rows[1], windows: window("09:00", "11:00") },
  ];
  render(<DayBoard shopSlug="reef" day="2035-08-04" rows={dual} copy={copy} />);
  const source = screen.getByRole("link", { name: "Source" }).closest("li");
  if (!source) throw new Error("missing source");
  const diverSection = within(source).getByText("Divers (1)").closest("details");
  if (!diverSection) throw new Error("missing diver section");
  await user.click(within(source).getByText("Divers (1)"));
  await user.click(within(diverSection).getByLabelText("Move Alice"));
  await user.selectOptions(within(diverSection).getByLabelText("Move to"), "target");
  expect(within(diverSection).getByRole("alert")).toHaveTextContent("Conflict");
  expect(within(diverSection).getByRole("button", { name: "Confirm move" })).toBeDisabled();
});

it("shows hull and capacity warnings without opening rosters and labels shore sessions", () => {
  const view = [
    {
      ...rows[0],
      boatClashes: [{ otherTripId: "target", otherTitle: "Target", boatName: "Alpha" }],
      overSellableCapacity: true,
    },
    { ...rows[1], diveMode: "shore" as const, boatName: null },
  ];
  render(<DayBoard shopSlug="reef" day="2035-08-04" rows={view} copy={copy} />);
  expect(screen.getByText("Alpha is also on Target.")).toBeVisible();
  expect(screen.getByText("Too many bookings")).toBeVisible();
  const shore = screen.getByRole("link", { name: "Target" }).closest("li");
  if (!shore) throw new Error("missing shore session");
  expect(within(shore).getByText(/Shore/)).toBeVisible();
  expect(within(shore).queryByText(/No boat/)).toBeNull();
});
