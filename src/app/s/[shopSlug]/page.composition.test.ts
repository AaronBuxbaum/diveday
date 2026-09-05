import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The public schedule's identity band has one next-departure surface. The
 * route source is the useful assertion here: rendering the server page needs
 * a live shop and schedule, while the regression is the JSX order and the
 * accidental reintroduction of the old two-column card slot.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

function positionOf(marker: string): number {
  return SOURCE.indexOf(marker);
}

function countOf(marker: string): number {
  return SOURCE.split(marker).length - 1;
}

describe("the public schedule identity composition", () => {
  it("puts one next-boat surface directly after the shop identity", () => {
    const hero = positionOf("<ShopfrontHero");
    const nextBoat = positionOf("<NextBoatCard");
    const schedule = positionOf('<div className={isEmbed ? undefined : "mt-10"}>');
    const weekLedger = positionOf("<WeekLedger");

    for (const marker of [hero, nextBoat, schedule, weekLedger]) {
      expect(marker).toBeGreaterThan(-1);
    }
    expect(hero).toBeLessThan(nextBoat);
    expect(nextBoat).toBeLessThan(schedule);
    expect(nextBoat).toBeLessThan(weekLedger);
    expect(countOf("<NextBoatCard")).toBe(1);
    expect(SOURCE).not.toContain("lg:grid-cols-[minmax(0,1fr)_20rem]");
  });
});

/**
 * **The boat that is out** — ADR 20260904-reef-all-the-way-down, Budget rule
 * 4, slice 16c.
 */
describe("the live boat panel's place", () => {
  it("sits in the identity band, above the next departure", () => {
    const live = positionOf("<LiveBoatPanel");
    const hero = positionOf("<ShopfrontHero");
    const nextBoat = positionOf("<NextBoatCard");
    expect(live).toBeGreaterThan(hero);
    expect(live).toBeLessThan(nextBoat);
    expect(countOf("<LiveBoatPanel")).toBe(1);
  });

  it("is never rendered inside the frame", () => {
    // `?embed=1` is a window onto the schedule (issue #805); a live panel
    // would spend a third of a widget on a fact the host page did not ask for.
    expect(positionOf("<LiveBoatPanel")).toBeGreaterThan(positionOf("{isEmbed ? null : ("));
    expect(SOURCE).toContain("isEmbed ? null : liveShopStage(");
  });
});
