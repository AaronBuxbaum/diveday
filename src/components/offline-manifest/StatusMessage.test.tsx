// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusMessage } from "./StatusMessage";

describe("StatusMessage", () => {
  it.each([
    [
      "en-US",
      "Review the listed marks.\nDiver record 00000001 · After dive 1 · mark kept\nChecklist item 0ad5b8cd · Pre-departure · mark kept",
    ],
    [
      "es-ES",
      "Revisa las marcas indicadas.\nRegistro de buceador 00000001 · Después de la inmersión 1 · marca conservada\nElemento de lista 0ad5b8cd · Antes de la salida · marca conservada",
    ],
  ])("keeps every %s loss record on an explicit accessible line", (_locale, message) => {
    const { container } = render(
      <p role="status" aria-live="polite">
        <StatusMessage message={message} />
      </p>,
    );

    const status = container.querySelector('[role="status"]');
    if (!status) throw new Error("Status region was not rendered");
    expect(status.querySelectorAll("br")).toHaveLength(2);
    expect(status).toHaveTextContent(message.replaceAll("\n", ""));
    expect(status).toHaveTextContent("00000001");
    expect(status).toHaveTextContent("0ad5b8cd");
  });
});
