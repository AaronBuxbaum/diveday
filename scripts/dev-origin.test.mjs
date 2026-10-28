import { describe, expect, it } from "vitest";
import { applyDevOrigin } from "./dev-origin.mjs";

const DEV = "phase-development-server";

describe("the development canonical origin", () => {
  it("uses Next's bound port, including an automatically selected one", () => {
    const env = { PORT: "3001" };
    applyDevOrigin(DEV, env);
    expect(env.APP_HOST).toBe("http://localhost:3001");
  });

  it("uses an explicitly selected port and defaults only when Next has no port", () => {
    const selected = { PORT: "4321" };
    applyDevOrigin(DEV, selected);
    expect(selected.APP_HOST).toBe("http://localhost:4321");
    const empty = {};
    applyDevOrigin(DEV, empty);
    expect(empty.APP_HOST).toBe("http://localhost:3000");
  });

  it("preserves explicit origins, including a deliberately blank override", () => {
    for (const configured of ["https://preview.example.com", "http://127.0.0.1:4321", ""]) {
      const env = { APP_HOST: configured, PORT: "3001" };
      applyDevOrigin(DEV, env);
      expect(env.APP_HOST).toBe(configured);
    }
  });

  it("leaves production builds, servers and other phases alone", () => {
    for (const phase of ["phase-production-build", "phase-production-server", "phase-test"]) {
      const env = { PORT: "3001" };
      applyDevOrigin(phase, env);
      expect(env).toEqual({ PORT: "3001" });
    }
  });

  it("rejects invalid ports rather than producing a misleading local origin", () => {
    for (const port of ["0", "-1", "65536", "nope", "3000/path"]) {
      expect(() => applyDevOrigin(DEV, { PORT: port })).toThrow(/port/i);
    }
  });
});
