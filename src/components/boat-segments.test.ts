import { describe, expect, it } from "vitest";
import { BOAT_SEGMENT_TRACK_CLASS, boatSegmentClass } from "./boat-segments";

describe("the boat's segmented control", () => {
  it("keeps one row and scrolls inside its own track rather than wrapping", () => {
    expect(BOAT_SEGMENT_TRACK_CLASS).toContain("grid-flow-col");
    expect(BOAT_SEGMENT_TRACK_CLASS).toContain("overflow-x-auto");
    expect(BOAT_SEGMENT_TRACK_CLASS).not.toMatch(/flex-wrap|grid-cols-3/);
    expect(BOAT_SEGMENT_TRACK_CLASS).toContain("print:hidden");
  });

  it("marks the selected segment with Boat mode's action color, not a shadow alone", () => {
    expect(boatSegmentClass(true)).toContain("bg-primary text-primary-foreground");
    expect(boatSegmentClass(false)).not.toContain("bg-primary");
  });

  it("keeps the full keyboard focus ring inside the scrolling track", () => {
    expect(boatSegmentClass(false)).toContain("focus-visible:focus-ring-inset");
    expect(boatSegmentClass(true)).toContain("focus-visible:focus-ring-inset");
  });

  it("gives every segment the rail's 56px target", () => {
    expect(boatSegmentClass(false)).toContain("min-h-14");
    expect(boatSegmentClass(true)).toContain("min-h-14");
  });
});
