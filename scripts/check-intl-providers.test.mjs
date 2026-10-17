import { describe, expect, it } from "vitest";
import {
  providedNamespaces,
  providerProblems,
  requiredNamespaces,
} from "./check-intl-providers.mjs";

describe("providedNamespaces", () => {
  it("reads an inline list, a module-scope list, and the error boundary's one", () => {
    expect([...providedNamespaces('<DiverIntlProvider namespaces={["party", "trip"]}>')]).toEqual([
      "party",
      "trip",
    ]);
    expect([
      ...providedNamespaces('const PAGE = ["ready"];\n<DiverIntlProvider namespaces={PAGE}>'),
    ]).toEqual(["ready"]);
    expect([...providedNamespaces("<ErrorBoundaryIntlProvider>")]).toEqual(["errorBoundary"]);
    expect(providedNamespaces("<div />")).toBeNull();
  });
});

describe("requiredNamespaces", () => {
  it("reads a named namespace, and a bare call's key heads", () => {
    expect([...requiredNamespaces('useTranslations("party")')]).toEqual(["party"]);
    expect([...requiredNamespaces('const t = useTranslations();\nt("trip.title")')]).toEqual([
      "trip",
    ]);
  });
});

describe("the app as it stands", () => {
  it("gives every client consumer of diver copy a provider carrying its namespaces", async () => {
    const { problems, consumers } = await providerProblems();
    expect(problems).toEqual([]);
    expect(consumers).toBeGreaterThan(5);
  });
});
