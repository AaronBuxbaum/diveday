import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { notificationGreeting } from "./greeting";

describe("notificationGreeting", () => {
  it("translates the same first name for plain text and HTML", () => {
    const greeting = notificationGreeting(diverTranslator("en-US"), "Ana Ruiz");
    expect(greeting).toEqual({ text: "Hi Ana,", html: "Hi Ana," });
  });

  it("uses the recipient's locale and localized fallback", () => {
    const t = diverTranslator("es-ES");
    expect(notificationGreeting(t, "Ana Ruiz")).toEqual({
      text: "Hola, Ana:",
      html: "Hola, Ana:",
    });
    expect(notificationGreeting(t, null)).toEqual({
      text: "Hola, amigo:",
      html: "Hola, amigo:",
    });
    expect(notificationGreeting(t, "  ")).toEqual({
      text: "Hola, amigo:",
      html: "Hola, amigo:",
    });
  });

  it("escapes a hostile name only in the HTML greeting", () => {
    expect(notificationGreeting(diverTranslator("en-US"), "<Ana&>")).toEqual({
      text: "Hi <Ana&>,",
      html: "Hi &lt;Ana&amp;&gt;,",
    });
  });
});
