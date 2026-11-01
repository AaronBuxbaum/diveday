// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordConfirmForm } from "./PasswordConfirmForm";

afterEach(cleanup);

const action = vi.fn(async (_formData: FormData) => {});

function renderForm(errorField?: "password" | "confirm" | "form", errorText?: string) {
  return render(
    <PasswordConfirmForm
      action={action}
      passwordLabel="Password"
      confirmPasswordLabel="Confirm password"
      submitLabel="Continue"
      savingLabel="Saving"
      submitClassName="test-submit"
      errorField={errorField}
      errorText={errorText}
    />,
  );
}

describe("PasswordConfirmForm", () => {
  it("keeps the password fields, constraints, and labels together", () => {
    renderForm();

    const password = screen.getByLabelText("Password");
    const confirmPassword = screen.getByLabelText("Confirm password");
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("required");
    expect(password).toHaveAttribute("minlength", "8");
    expect(password).toHaveAttribute("maxlength", "72");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(confirmPassword).toHaveAttribute("name", "confirmPassword");
    expect(confirmPassword).toHaveAttribute("type", "password");
    expect(confirmPassword).toHaveAttribute("required");
    expect(confirmPassword).toHaveAttribute("minlength", "8");
    expect(confirmPassword).toHaveAttribute("maxlength", "72");
    expect(confirmPassword).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(document.querySelector("form")).toBeInTheDocument();
  });

  it.each([
    ["password", "Use a longer password"],
    ["confirm", "The passwords do not match"],
  ] as const)("shows a %s error beside its field", (field, message) => {
    renderForm(field, message);

    const input = screen.getByLabelText(field === "password" ? "Password" : "Confirm password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby");
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("alert")).not.toBeNull();
  });

  it("shows an unrecognized refusal beside the submit action", () => {
    renderForm("form", "Please try again");

    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Confirm password")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("alert")).toHaveTextContent("Please try again");
  });
});
