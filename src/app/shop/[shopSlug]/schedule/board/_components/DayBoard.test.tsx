// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { DayBoard, type DayCopy } from "./DayBoard";

afterEach(cleanup);
const copy: DayCopy = {
  day: "Day",
  week: "Week",
  chooseDay: "Choose a day",
  showDay: "Show day",
  empty: "No departures",
  review: "Schedules can change.",
  crew: "Crew",
  divers: "Divers",
  noCrew: "No crew",
  noDivers: "No divers",
  noBoat: "No boat",
  standingClash: "{name} is also on {departure}.",
  absent: "Marked absent",
  identityHeld: "Confirm identity",
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

it("labels the day picker and submits the chosen day", async () => {
  const user = userEvent.setup();
  render(<DayBoard shopSlug="reef" day="2035-08-04" rows={rows} copy={copy} />);
  const picker = screen.getByLabelText("Choose a day");
  await user.clear(picker);
  await user.type(picker, "2035-08-05");
  const form = picker.closest("form");
  if (!form) throw new Error("missing day form");
  const data = new FormData(form);
  expect(data.get("day")).toBe("2035-08-05");
  expect(data.get("view")).toBe("day");
});

it("shows a person's existing clash and roster without move controls", async () => {
  const user = userEvent.setup();
  const view = [
    { ...rows[0], collisions: [{ personId: "alice", otherTripId: "other", otherTitle: "Other" }] },
    rows[2],
  ];
  render(<DayBoard shopSlug="reef" day="2035-08-04" rows={view} copy={copy} />);
  expect(screen.getByText("Alice is also on Other.")).toBeVisible();
  const source = screen.getByRole("link", { name: "Source" }).closest("li");
  if (!source) throw new Error("missing source");
  await user.click(within(source).getByText("Crew (1)"));
  expect(within(source).getByText("Alice")).toBeVisible();
  expect(screen.queryByText("Move")).toBeNull();
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
