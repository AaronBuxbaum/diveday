// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { snapshotFormControls } from "./form-control-snapshot";

describe("snapshotFormControls", () => {
  it("records repeated, disabled and unchecked named controls in order, excluding files", () => {
    const form = document.createElement("form");
    form.innerHTML = `
      <input name="faq" value="Question">
      <input name="faq" type="file">
      <input name="faq" type="checkbox" value="answer" checked>
      <input name="required" type="checkbox" value="yes">
      <input name="courseDays" type="radio" value="one">
      <input name="courseDays" type="radio" value="two" checked>
      <input name="locked" value="kept" disabled>
      <input value="unnamed">
    `;
    expect(snapshotFormControls(form)).toEqual([
      { name: "faq", index: 0, value: "Question", checked: false },
      { name: "faq", index: 1, value: "answer", checked: true },
      { name: "required", index: 0, value: "yes", checked: false },
      { name: "courseDays", index: 0, value: "one", checked: false },
      { name: "courseDays", index: 1, value: "two", checked: true },
      { name: "locked", index: 0, value: "kept", checked: false },
    ]);
  });
});
