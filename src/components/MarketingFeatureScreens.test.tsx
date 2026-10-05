// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArrivalDeskFallback,
  BookingCardFallback,
  CoursePageFallback,
  GearRegisterFallback,
  OrdersLedgerFallback,
  ScheduleWeekFallback,
  SiteBriefingFallback,
  StorefrontFallback,
  WaiverSigningFallback,
} from "./MarketingFeatureScreens";

afterEach(cleanup);

const EVERY_MOCK = [
  ["BookingCardFallback", BookingCardFallback],
  ["StorefrontFallback", StorefrontFallback],
  ["WaiverSigningFallback", WaiverSigningFallback],
  ["ArrivalDeskFallback", ArrivalDeskFallback],
  ["SiteBriefingFallback", SiteBriefingFallback],
  ["GearRegisterFallback", GearRegisterFallback],
  ["CoursePageFallback", CoursePageFallback],
  ["OrdersLedgerFallback", OrdersLedgerFallback],
  ["ScheduleWeekFallback", ScheduleWeekFallback],
] as const;

type Mock = (typeof EVERY_MOCK)[number][1];

/** A mock's two parts: its app bar and the body under it. */
function barAndBody(Mock: Mock) {
  const { container } = render(<Mock locale="en-US" />);
  const [bar, body] = Array.from(container.firstElementChild?.children ?? []);
  return { bar, body };
}

/** The one horizontal inset an element's padding classes give it, in Tailwind steps. */
function insetOf(element: Element) {
  const steps = element.className
    .split(/\s+/)
    .map((token) => /^p[x]?-(\d+(?:\.\d+)?)$/.exec(token)?.[1])
    .filter(Boolean);
  expect(steps).toHaveLength(1);
  return steps[0];
}

/**
 * The same family as `MarketingScreenFallbacks.tsx`, and the same rule its
 * test states (K-51): the shop name in the bar and the body's first line start
 * on one 20px edge.
 */
describe("the feature screens' inset", () => {
  it.each(EVERY_MOCK)("%s starts its bar and its body on one 20px edge", (_name, Mock) => {
    const { bar, body } = barAndBody(Mock);
    expect(insetOf(bar)).toBe("5");
    expect(insetOf(body)).toBe("5");
  });
});

/** Every button these draw stands on the family's 44px rung (K-516). */
describe("the feature screens' buttons", () => {
  const everyButton = () =>
    EVERY_MOCK.flatMap(([, Mock]) => {
      const { container, unmount } = render(<Mock locale="en-US" />);
      const found = Array.from(container.querySelectorAll("button")).map((button) => ({
        className: button.className,
        disabled: button.disabled,
        type: button.getAttribute("type"),
      }));
      unmount();
      return found;
    });

  it("draws every button on the 44px rung", () => {
    for (const { className } of everyButton()) {
      const tokens = className.split(/\s+/);
      expect(tokens).toEqual(expect.arrayContaining(["min-h-11", "rounded-lg", "text-xs"]));
      expect(tokens).not.toContain("min-h-10");
    }
  });

  it("draws the primary button as the family's one primary button", () => {
    const primaries = everyButton().filter(({ className }) =>
      className.split(/\s+/).includes("bg-primary"),
    );
    expect(primaries.length).toBeGreaterThanOrEqual(5);
    for (const { className } of primaries) {
      expect(className.split(/\s+/)).toEqual(
        expect.arrayContaining([
          "inline-flex",
          "min-h-11",
          "items-center",
          "justify-center",
          "rounded-lg",
          "bg-primary",
          "px-3",
          "text-xs",
          "font-semibold",
          "text-primary-foreground",
        ]),
      );
    }
  });

  it("draws buttons that do nothing: disabled, and never a submit", () => {
    for (const { disabled, type } of everyButton()) {
      expect(disabled).toBe(true);
      expect(type).toBe("button");
    }
  });
});

/**
 * They render inside `MarketingMockup`'s `role="img"`, which names the whole
 * picture: nothing inside may take focus, name itself, or be a second image.
 */
describe("the feature screens inside their picture", () => {
  it.each(EVERY_MOCK)("%s holds nothing a reader can reach or that names itself", (_n, Mock) => {
    const { container } = render(<Mock locale="es-ES" />);
    expect(
      container.querySelectorAll("a, input, label, legend, select, textarea, details, summary"),
    ).toHaveLength(0);
    expect(container.querySelectorAll("[aria-label], [role='img'], [tabindex]")).toHaveLength(0);
  });
});

describe("the feature screens' words", () => {
  it.each([
    [
      "BookingCardFallback",
      BookingCardFallback,
      ["Grab a spot", "Number of divers", "Book and pay"],
    ],
    [
      "StorefrontFallback",
      StorefrontFallback,
      ["Next boat with space", "Book this boat", "Since 1987"],
    ],
    [
      "WaiverSigningFallback",
      WaiverSigningFallback,
      ["A quick step before the dock", "Your signature", "Sign waiver"],
    ],
    ["ArrivalDeskFallback", ArrivalDeskFallback, ["Same person", "Check in", "Checked in"]],
    [
      "SiteBriefingFallback",
      SiteBriefingFallback,
      ["The day", "Seen here this month", "The route"],
    ],
    [
      "GearRegisterFallback",
      GearRegisterFallback,
      ["All (37)", "Needs service", "On the wall · 37"],
    ],
    [
      "CoursePageFallback",
      CoursePageFallback,
      ["How the course runs", "Next date", "Book this date"],
    ],
    ["OrdersLedgerFallback", OrdersLedgerFallback, ["Money", "New order", "Partly refunded"]],
    ["ScheduleWeekFallback", ScheduleWeekFallback, ["Afternoon Two-Tank", "nobody yet", "Add"]],
  ] as const)("%s speaks English", (_name, Mock, words) => {
    render(<Mock locale="en-US" />);
    for (const word of words) expect(screen.getAllByText(word).length).toBeGreaterThan(0);
  });

  it.each([
    [
      "BookingCardFallback",
      BookingCardFallback,
      ["Reserva tu plaza", "Número de buceadores", "Reservar y pagar"],
    ],
    [
      "StorefrontFallback",
      StorefrontFallback,
      ["Próxima salida con plazas", "Reservar esta salida", "Desde 1987"],
    ],
    [
      "WaiverSigningFallback",
      WaiverSigningFallback,
      ["Un paso rápido antes del muelle", "Tu firma", "Firmar exención"],
    ],
    ["ArrivalDeskFallback", ArrivalDeskFallback, ["Misma persona", "Registrar", "Registrado"]],
    ["SiteBriefingFallback", SiteBriefingFallback, ["El día", "Visto aquí este mes", "La ruta"]],
    [
      "GearRegisterFallback",
      GearRegisterFallback,
      ["Todo (37)", "Necesita mantenimiento", "En la pared · 37"],
    ],
    [
      "CoursePageFallback",
      CoursePageFallback,
      ["Cómo se desarrolla el curso", "Próxima fecha", "Reservar esta fecha"],
    ],
    [
      "OrdersLedgerFallback",
      OrdersLedgerFallback,
      ["Dinero", "Nuevo pedido", "Reembolsado en parte"],
    ],
    [
      "ScheduleWeekFallback",
      ScheduleWeekFallback,
      ["Dos tanques de tarde", "nadie todavía", "Añadir"],
    ],
  ] as const)("%s speaks Spanish", (_name, Mock, words) => {
    render(<Mock locale="es-ES" />);
    for (const word of words) expect(screen.getAllByText(word).length).toBeGreaterThan(0);
  });

  it("puts an Add on each day of the week board", () => {
    render(<ScheduleWeekFallback locale="en-US" />);
    expect(screen.getAllByText("Add")).toHaveLength(2);
  });

  /**
   * The release and the medical form stay English in every language
   * (H-01/H-03), and the real page tells a reader in another language so
   * before they sign. The mock does both.
   */
  it("keeps the medical question English in Spanish, under the page's own notice", () => {
    render(<WaiverSigningFallback locale="es-ES" />);
    expect(screen.getByText("I am over 45 years of age.")).toBeInTheDocument();
    expect(screen.getByText(/solo están disponibles en inglés/)).toBeInTheDocument();
  });

  it("says nothing about English to a reader already reading it", () => {
    render(<WaiverSigningFallback locale="en-US" />);
    expect(screen.queryByText(/only available in English/)).toBeNull();
  });
});
