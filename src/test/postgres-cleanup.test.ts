import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { prepareScratchDatabase, type RunAdministrative } from "./postgres-cleanup";
import type { FixturePool } from "./postgres-io";

function administrative(query: ReturnType<typeof vi.fn>, labels: string[]): RunAdministrative {
  return (label, work) => {
    labels.push(label);
    return work({ query } as unknown as Pool, Date.now() + 10_000);
  };
}

describe("scratch database cleanup orchestration", () => {
  it("registers cleanup before a committed CREATE loses its reply, then attempts normal DROP", async () => {
    const lost = new Error("CREATE committed, acknowledgement lost");
    const hooks: (() => Promise<void>)[] = [];
    const labels: string[] = [];
    const query = vi.fn(async (text: string) => {
      if (text.startsWith("CREATE")) throw lost;
      return { rows: text.includes("pg_stat_activity") ? [{ attached: 0 }] : [] };
    });
    await expect(
      prepareScratchDatabase("fixture", [], [], administrative(query, labels), (hook) => {
        hooks.push(hook);
      }),
    ).rejects.toBe(lost);
    expect(hooks).toHaveLength(1);
    await hooks[0]();
    expect(labels).toEqual(["scratch database CREATE", "backend drain", "scratch database DROP"]);
    expect(query.mock.calls.at(-1)?.[0]).toBe('DROP DATABASE IF EXISTS "fixture"');
  });

  it("attempts FORCE DROP after a failed drain and preserves both failures", async () => {
    const drain = new Error("drain query failed");
    const drop = new Error("DROP failed");
    const hooks: (() => Promise<void>)[] = [];
    const labels: string[] = [];
    const query = vi.fn(async (text: string) => {
      if (text.includes("pg_stat_activity")) throw drain;
      if (text.startsWith("DROP")) throw drop;
      return { rows: [] };
    });
    await prepareScratchDatabase("fixture", [], [], administrative(query, labels), (hook) => {
      hooks.push(hook);
    });
    const failure = await hooks[0]().catch((error) => error);
    expect(query.mock.calls.at(-1)?.[0]).toBe('DROP DATABASE IF EXISTS "fixture" WITH (FORCE)');
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.cause).toBe(drain);
    expect(failure.errors).toEqual([drain, drop]);
  });

  it("still observes drain and drops after a reported pool leak instead of abandoning cleanup", async () => {
    const leak = new Error("checked-out client force-disposed");
    const hooks: (() => Promise<void>)[] = [];
    const labels: string[] = [];
    const query = vi.fn(async (text: string) => ({
      rows: text.includes("pg_stat_activity") ? [{ attached: 0 }] : [],
    }));
    const managed: FixturePool = {
      pool: {} as Pool,
      close: vi.fn().mockRejectedValue(leak),
      cancel: vi.fn(),
    };
    await prepareScratchDatabase(
      "fixture",
      [managed],
      [],
      administrative(query, labels),
      (hook) => {
        hooks.push(hook);
      },
    );
    const failure = await hooks[0]().catch((error) => error);
    expect(managed.close).toHaveBeenCalledOnce();
    expect(query.mock.calls.at(-1)?.[0]).toBe('DROP DATABASE IF EXISTS "fixture"');
    expect(failure.errors).toEqual([leak]);
  });
});
