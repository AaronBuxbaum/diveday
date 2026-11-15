import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseComputerFile } from "./index";

const source = () => readFileSync(`${import.meta.dirname}/fixtures/si.uddf`, "utf8");
const parse = (xml: string) => parseComputerFile(new TextEncoder().encode(xml));
const withTank = () =>
  source().replace(
    "<equipment>",
    '<equipment><tank id="tank1"><tankvolume>0.015</tankvolume></tank><tank id="tank2"><tankvolume>0.007</tankvolume></tank>',
  );

describe("UDDF tank definition and gas references", () => {
  it("resolves tank and mix references regardless of order and inherits SI tank volume", () => {
    const xml = withTank().replace(
      '<tankdata><link ref="air"/><tankvolume>0.012</tankvolume>',
      '<tankdata><link ref="tank1"/><link ref="air"/>',
    );
    expect(parse(xml)[0]?.tanks[0]).toEqual({
      gasId: "air",
      volumeLiters: 15,
      startPressureBar: 200,
      endPressureBar: 50,
    });
    expect(
      parse(
        xml.replace('<link ref="tank1"/><link ref="air"/>', '<link ref="air"/><link ref="tank1"/>'),
      )[0]?.tanks[0]?.volumeLiters,
    ).toBe(15);
  });
  it("keeps a local tank volume and separate tanks with their own gas and pressure", () => {
    const xml = withTank()
      .replace('<tankdata><link ref="air"/>', '<tankdata><link ref="tank1"/><link ref="air"/>')
      .replace(
        "</tankdata>",
        '</tankdata><tankdata><link ref="ean"/><link ref="tank2"/><tankpressurebegin>18000000</tankpressurebegin></tankdata>',
      );
    expect(parse(xml)[0]?.tanks).toEqual([
      { gasId: "air", volumeLiters: 12, startPressureBar: 200, endPressureBar: 50 },
      { gasId: "ean", volumeLiters: 7, startPressureBar: 180, endPressureBar: null },
    ]);
  });
  it("keeps missing gas unknown when a tank alone is referenced", () => {
    const xml = withTank().replace(
      '<tankdata><link ref="air"/><tankvolume>0.012</tankvolume>',
      '<tankdata><link ref="tank1"/>',
    );
    expect(parse(xml)[0]?.tanks[0]?.gasId).toBeNull();
    expect(parse(xml)[0]?.tanks[0]?.volumeLiters).toBe(15);
  });
  it("refuses ambiguous or wrong-kind tank references", () => {
    for (const links of [
      '<link ref="tank1"/><link ref="tank2"/>',
      '<link ref="air"/><link ref="ean"/>',
      '<link ref="computer"/>',
    ]) {
      const xml = withTank().replace('<tankdata><link ref="air"/>', `<tankdata>${links}`);
      expect(() => parse(xml)).toThrow("invalid_reference");
    }
  });
});
