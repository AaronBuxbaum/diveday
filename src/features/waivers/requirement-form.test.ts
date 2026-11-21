import { describe, expect, it } from "vitest";
import { readRequiredSpecialties } from "./requirement-form";

function form(values: string[]) {
  const data = new FormData();
  for (const value of values) data.append("specialty", value);
  return data;
}

describe("readRequiredSpecialties", () => {
  it("reads every ticked card, in the order posted", () => {
    expect(readRequiredSpecialties(form(["deep", "night"]))).toEqual(["deep", "night"]);
  });

  it("reads nothing ticked as asking for no specialty, not as a refusal", () => {
    expect(readRequiredSpecialties(form([]))).toEqual([]);
  });

  it("refuses the whole post when any value is not a specialty", () => {
    expect(readRequiredSpecialties(form(["deep", "instructor"]))).toBeNull();
    expect(readRequiredSpecialties(form([""]))).toBeNull();
  });
});
