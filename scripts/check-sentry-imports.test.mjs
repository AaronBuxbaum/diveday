import { describe, expect, it } from "vitest";

import { runGuard } from "./guard-fixture.mjs";

const GUARD = "check-sentry-imports.mjs";

describe("check-sentry-imports", () => {
  it("refuses a namespace import in a route", () => {
    const result = runGuard(GUARD, {
      "src/app/api/cron/x/route.ts": 'import * as Sentry from "@sentry/nextjs";\nexport {};\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'src/app/api/cron/x/route.ts:1: import * as Sentry from "@sentry/nextjs"',
    );
  });

  it("refuses named and default value imports", () => {
    const result = runGuard(GUARD, {
      "src/app/a.ts": 'import { captureException } from "@sentry/nextjs";\n',
      "src/app/b.tsx": '// one\nimport Sentry from "@sentry/nextjs";\n',
      "src/app/c.ts": 'import { type Breadcrumb, captureMessage } from "@sentry/nextjs";\n',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/app/a.ts:1");
    expect(result.stderr).toContain("src/app/b.tsx:2");
    expect(result.stderr).toContain("src/app/c.ts:1");
  });

  it("leaves type imports, dynamic imports, tests and other trees alone", () => {
    const result = runGuard(GUARD, {
      "src/app/observability.ts": 'import type * as Sentry from "@sentry/nextjs";\n',
      "src/app/types.ts": 'import { type Breadcrumb, type ErrorEvent } from "@sentry/nextjs";\n',
      "src/app/global-error.tsx":
        'export function report(e: unknown) {\n  import("@sentry/nextjs").then(({ captureException }) => captureException(e));\n}\n',
      "src/app/api/cron/x/route.test.ts": 'import * as Sentry from "@sentry/nextjs";\n',
      "src/lib/rate-limit.ts": 'import * as Sentry from "@sentry/nextjs";\n',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no route under src/app imports the Sentry SDK statically");
  });
});
