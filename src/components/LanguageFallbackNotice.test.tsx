// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { languageEndonym, languageNameIn } from "@/i18n/language-labels";
import { diverTranslator } from "@/i18n/messages";
import { unsupportedLanguage } from "@/i18n/negotiate";
import { LanguageFallbackNotice } from "./LanguageFallbackNotice";

afterEach(cleanup);

/**
 * The notice a diver gets when DiveDay carries none of the languages their
 * device asked for (review finding I18N-L1). Rendered here the way the public
 * shop shell assembles it — header value in, endonym resolved, translator bound
 * to the locale the page is actually rendering in — because the failure this
 * guards against is not "the component throws" but "the sentence reads wrong":
 * the reader's own language missing from it, or the shop's name missing, leaves
 * a line that explains nothing to the one person it exists for.
 */
function noticeFor(acceptLanguage: string, shownLocale: "en-US" | "es-ES") {
  const unsupported = unsupportedLanguage(acceptLanguage);
  if (!unsupported) throw new Error(`expected ${acceptLanguage} to be unsupported`);
  return {
    requested: languageEndonym(unsupported.language) ?? unsupported.tag,
    shown: languageNameIn(shownLocale.split("-")[0], shownLocale) ?? shownLocale,
  };
}

describe("LanguageFallbackNotice", () => {
  it("names the reader's own language, the one they are getting, and whose shop it is", () => {
    render(
      <LanguageFallbackNotice
        fallback={noticeFor("de-DE,de;q=0.9", "en-US")}
        shopName="Blue Mantis Divers"
        t={diverTranslator("en-US")}
      />,
    );

    // "Deutsch", not "German": the endonym is the one token a reader who cannot
    // read the surrounding English sentence can still recognise.
    expect(
      screen.getByText(
        "DiveDay isn’t in Deutsch yet. This page is in English, the language Blue Mantis Divers works in.",
      ),
    ).toBeInTheDocument();
  });

  it("speaks the shop's language when that is what the diver is being shown", () => {
    // A Cozumel shop renders Spanish for everyone; a French visitor is told so
    // in Spanish, because Spanish is all there is to tell them in.
    render(
      <LanguageFallbackNotice
        fallback={noticeFor("fr-CA", "es-ES")}
        shopName="Centro Azul"
        t={diverTranslator("es-ES")}
      />,
    );

    expect(screen.getByText(/français/)).toBeInTheDocument();
    expect(screen.getByText(/español/)).toBeInTheDocument();
    expect(screen.getByText(/Centro Azul/)).toBeInTheDocument();
  });

  it("shows the raw tag rather than nothing when CLDR has no name for the language", () => {
    render(
      <LanguageFallbackNotice
        fallback={noticeFor("qtz", "en-US")}
        shopName="Blue Mantis Divers"
        t={diverTranslator("en-US")}
      />,
    );

    expect(screen.getByText(/qtz/)).toBeInTheDocument();
  });

  it("offers no language choice — there is no second bundle to switch to", () => {
    // The guard on the thing this must never become. DiveDay has no switcher
    // and no `[locale]` route by design (ADR 20260729-diver-copy-localization);
    // a control here would promise a choice that does not exist.
    const { container } = render(
      <LanguageFallbackNotice
        fallback={noticeFor("de-DE", "en-US")}
        shopName="Blue Mantis Divers"
        t={diverTranslator("en-US")}
      />,
    );

    expect(container.querySelectorAll("a, button, select, input")).toHaveLength(0);
  });
});
