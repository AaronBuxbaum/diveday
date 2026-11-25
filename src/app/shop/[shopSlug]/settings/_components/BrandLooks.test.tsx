// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BRAND_DISPLAY_FONT_CODES, BRAND_LOOKS, DIVEDAY_BRAND_COLOR } from "@/lib/brand";
import { BrandColorField } from "./BrandColorField";
import { BrandLooks } from "./BrandLooks";

afterEach(cleanup);

it("a look fills the colour field and the face the way Save will store them", () => {
  render(
    <form>
      <BrandLooks
        legend="Start from a look"
        names={{ harbor: "Harbor", reef: "Reef", deep: "Deep", kelp: "Kelp" }}
      />
      <BrandColorField
        initial={null}
        label="Brand color"
        pickerLabel="Pick"
        placeholder={DIVEDAY_BRAND_COLOR}
      />
      <select name="brandDisplayFont" defaultValue="">
        <option value="">DiveDay’s own</option>
        {BRAND_DISPLAY_FONT_CODES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </form>,
  );
  const reef = BRAND_LOOKS.find((look) => look.code === "reef");
  if (!reef) throw new Error("no reef look");
  fireEvent.click(screen.getByRole("button", { name: "Reef" }));
  expect((screen.getByRole("textbox", { name: "Brand color" }) as HTMLInputElement).value).toBe(
    reef.color,
  );
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(reef.font);
});
