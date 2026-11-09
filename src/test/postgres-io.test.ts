import { createServer, type Socket } from "node:net";
import { Pool as NativePool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminOperation, type FixturePool, fixturePool } from "./postgres-io";

const servers: { close: () => Promise<void>; errors: Error[] }[] = [];
const pools: FixturePool[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const managed of pools.splice(0)) {
    managed.cancel();
    await managed.close().catch(() => undefined);
  }
  for (const server of servers.splice(0)) {
    await server.close();
    expect(server.errors).toEqual([]);
  }
});

function packet(type: string, payload: Buffer) {
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

/** Minimal local protocol peer: never production, never a real database. */
async function peer(mode: "connect-stall" | "query-stall" | "drop-error" | "okay") {
  const sockets = new Set<Socket>();
  const errors: Error[] = [];
  let startup!: () => void;
  let queried!: () => void;
  const startupSeen = new Promise<void>((resolve) => {
    startup = resolve;
  });
  const querySeen = new Promise<void>((resolve) => {
    queried = resolve;
  });
  let closed!: () => void;
  const firstClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = createServer((socket) => {
    sockets.add(socket);
    // Intentional client cancellation can reset the protocol peer while it is
    // sending ReadyForQuery. Only those expected disconnects are non-failures.
    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "ECONNRESET" && error.code !== "EPIPE") errors.push(error);
    });
    socket.once("close", () => {
      sockets.delete(socket);
      closed();
    });
    let started = false;
    socket.on("data", (bytes) => {
      if (!started) {
        started = true;
        startup();
        if (mode === "connect-stall") return;
        socket.write(Buffer.concat([packet("R", Buffer.alloc(4)), packet("Z", Buffer.from("I"))]));
        return;
      }
      if (bytes[0] === 0x58) {
        socket.end();
        return;
      }
      if (bytes[0] !== 0x51) return;
      queried();
      if (mode === "query-stall") return;
      if (mode === "drop-error")
        socket.write(packet("E", Buffer.from("SERROR\0C42501\0Mdrop forbidden\0\0")));
      else socket.write(packet("C", Buffer.from("SELECT 0\0")));
      socket.write(packet("Z", Buffer.from("I")));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local peer port");
  const cleanup = {
    errors,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
  servers.push(cleanup);
  return {
    url: `postgres://fixture:fixture@127.0.0.1:${address.port}/postgres?sslmode=disable`,
    sockets,
    firstClosed,
    startupSeen,
    querySeen,
  };
}

const trackedCreate: typeof fixturePool = (...args) => {
  const managed = fixturePool(...args);
  pools.push(managed);
  return managed;
};

describe("bounded real-Postgres fixture I/O", () => {
  it("cancels a stalled admin connection and closes its real TCP socket", async () => {
    const server = await peer("connect-stall");
    vi.useFakeTimers();
    const pending = adminOperation(
      server.url,
      [],
      "connect probe",
      (pool) => pool.query("select 1"),
      { timeoutMs: 50, create: trackedCreate },
    );
    const rejected = expect(pending).rejects.toThrow(/connect probe exceeded/);
    await server.startupSeen;
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    await server.firstClosed;
    expect(server.sockets.size).toBe(0);
  });

  it("cancels a stalled pg_stat_activity query instead of only stopping its waiter", async () => {
    const server = await peer("query-stall");
    vi.useFakeTimers();
    const pending = adminOperation(
      server.url,
      [],
      "backend drain",
      (pool) => pool.query("select count(*) from pg_stat_activity"),
      { timeoutMs: 50, create: trackedCreate },
    ).catch((error) => error);
    await server.querySeen;
    await vi.advanceTimersByTimeAsync(50);
    const failure = await pending;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("backend drain exceeded");
    expect((failure as Error).cause).toBeInstanceOf(Error);
    await server.firstClosed;
    expect(server.sockets.size).toBe(0);
  });

  it("force-disposes and reports a checked-out client while settling pool shutdown", async () => {
    const server = await peer("okay");
    const managed = fixturePool(server.url, [], false, { closeMs: 25 });
    pools.push(managed);
    const client = await managed.pool.connect();
    vi.useFakeTimers();
    const rejected = expect(managed.close()).rejects.toThrow(
      /1 checked-out client\(s\) force-disposed/,
    );
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    await server.firstClosed;
    expect(server.sockets.size).toBe(0);
    expect(managed.pool.totalCount).toBe(0);
    expect(() => client.release()).not.toThrow();
  });

  it("preserves a DROP error and closes the admin connection", async () => {
    const server = await peer("drop-error");
    await expect(
      adminOperation(
        server.url,
        [],
        "scratch DROP",
        (pool) => pool.query('DROP DATABASE "fixture"'),
        { create: trackedCreate },
      ),
    ).rejects.toMatchObject({ message: "drop forbidden", code: "42501" });
    await server.firstClosed;
    expect(server.sockets.size).toBe(0);
  });

  it("completes healthy administrative work without idle errors or live sockets", async () => {
    const server = await peer("okay");
    const errors: Error[] = [];
    const result = await adminOperation(
      server.url,
      errors,
      "healthy probe",
      (pool) => pool.query("select 1"),
      { create: trackedCreate },
    );
    expect(result.rows).toEqual([]);
    await server.firstClosed;
    expect(server.sockets.size).toBe(0);
    expect(errors).toEqual([]);
  });

  it("keeps the original operation error when disposal also fails", async () => {
    const original = new Error("original admin failure");
    const disposal = new Error("disposal failure");
    const failure = await adminOperation(
      "unused",
      [],
      "error probe",
      async () => {
        throw original;
      },
      {
        create: () => ({
          pool: {} as NativePool,
          close: async () => {
            throw disposal;
          },
          cancel: () => undefined,
        }),
      },
    ).catch((error) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.cause).toBe(original);
    expect(failure.errors).toEqual([original, disposal]);
  });

  it("leaves deliberate subject query/lock budgets unchanged and closes a healthy pool", async () => {
    const server = await peer("okay");
    const errors: Error[] = [];
    const managed = fixturePool(server.url, errors, false, {
      makePool: (config) => {
        expect(config.query_timeout).toBeUndefined();
        expect(config.statement_timeout).toBeUndefined();
        // Use the installed pool; this also checks the public stream hook contract.
        return new NativePool(config);
      },
    });
    pools.push(managed);
    await managed.pool.query("select 1");
    await managed.close();
    await server.firstClosed;
    expect(errors).toEqual([]);
  });
});
