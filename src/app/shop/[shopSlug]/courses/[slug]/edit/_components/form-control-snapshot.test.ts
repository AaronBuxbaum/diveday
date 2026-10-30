// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { snapshotFormControls } from "./form-control-snapshot";

describe("snapshotFormControls", () => {
  it("records named controls in order, including duplicate names and disabled or unchecked controls", () => {
    const form = document.createElement("form");
    form.innerHTML = `
      <input name="faq" value="Question">
      <input name="faq" type="file">
      <input name="faq" type="checkbox" value="answer" checked>
      <input name="needsAnswer" type="checkbox" value="yes">
      <input name="days" type="radio" value="one">
      <input name="days" type="radio" value="two" checked>
      <input name="locked" value="kept" disabled>
      <input value="unnamed">
    `;
    expect(snapshotFormControls(form)).toEqual([
      { name: "faq", index: 0, value: "Question", checked: false },
      { name: "faq", index: 1, value: "answer", checked: true },
      { name: "needsAnswer", index: 0, value: "yes", checked: false },
      { name: "days", index: 0, value: "one", checked: false },
      { name: "days", index: 1, value: "two", checked: true },
      { name: "locked", index: 0, value: "kept", checked: false },
    ]);
  });
});
