import type { LookupAddress } from "node:dns";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPrivateAddressError, type ResolvedAddress } from "./public-address";
import { fetchOverNode, publicOnlyFetch } from "./public-fetch";

/**
 * Every test here points at a real HTTP server on 127.0.0.1, so "refused"
 * means the server saw nothing — not that a mock was skipped. The positive
 * path goes through `fetchOverNode` with a lookup that answers 127.0.0.1 for
 * any name, standing in for a public answer the test cannot make for real.
 */

type Seen = { method?: string; url?: string; headers: IncomingMessage["headers"]; body: string };

let server: Server;
let port: number;
let seen: Seen[];
let reply: (request: IncomingMessage, response: import("node:http").ServerResponse) => void;

beforeEach(async () => {
  seen = [];
  reply = (_request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "x-test": "yes" });
    response.end("hello");
  };
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      reply(request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A socket resolver that answers 127.0.0.1 for every name, in either callback shape. */
const toLoopback: LookupFunction = (_hostname, options, callback) => {
  const answer: LookupAddress = { address: "127.0.0.1", family: 4 };
  if (options.all) callback(null, [answer]);
  else callback(null, answer.address, answer.family);
};

describe("fetchOverNode — the transport", () => {
  it("sends method, headers and body with a Content-Length, and returns a readable Response", async () => {
    const send = fetchOverNode(toLoopback);
    const response = await send(`http://bucket.example:${port}/shop-backups/a%20b.zip`, {
      method: "PUT",
      headers: { "content-type": "application/zip", authorization: "AWS4-HMAC-SHA256 x" },
      body: new TextEncoder().encode("zip-bytes"),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-test")).toBe("yes");
    expect(await response.text()).toBe("hello");

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "PUT",
      url: "/shop-backups/a%20b.zip",
      body: "zip-bytes",
    });
    expect(seen[0]?.headers["content-length"]).toBe("9");
    expect(seen[0]?.headers["transfer-encoding"]).toBeUndefined();
    expect(seen[0]?.headers.host).toBe(`bucket.example:${port}`);
    expect(seen[0]?.headers.authorization).toBe("AWS4-HMAC-SHA256 x");
  });

  it("never follows a redirect: the 3xx is the response, and its target is never asked", async () => {
    reply = (request, response) => {
      if (request.url === "/start") {
        response.writeHead(307, { location: `http://127.0.0.1:${port}/internal` });
        response.end();
        return;
      }
      response.writeHead(200);
      response.end("internal");
    };
    const response = await fetchOverNode(toLoopback)(`http://bucket.example:${port}/start`, {
      method: "PUT",
      body: "x",
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/internal");
    expect(seen.map((request) => request.url)).toEqual(["/start"]);
  });

  it("hands back a bodiless status without failing to build the Response", async () => {
    reply = (_request, response) => {
      response.writeHead(204);
      response.end();
    };
    const response = await fetchOverNode(toLoopback)(`http://bucket.example:${port}/`);
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("honours an abort signal", async () => {
    reply = () => {
      // Never answers.
    };
    const controller = new AbortController();
    const pending = fetchOverNode(toLoopback)(`http://bucket.example:${port}/`, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow();
  });

  it("gives up on a server that sends headers and then stalls the body", async () => {
    reply = (_request, response) => {
      response.writeHead(200, { "content-type": "image/jpeg", "content-length": "1000" });
      response.write("x");
      // ...and nothing more, ever.
    };
    const response = await fetchOverNode(toLoopback, { idleTimeoutMs: 100 })(
      `http://bucket.example:${port}/`,
    );
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();
  });

  it("gives up on a server that accepts the connection and never answers", async () => {
    reply = () => {
      // Never answers.
    };
    await expect(
      fetchOverNode(toLoopback, { idleTimeoutMs: 100 })(`http://bucket.example:${port}/`),
    ).rejects.toThrow("idle");
  });

  it("refuses a Request object and a non-http scheme rather than guessing", async () => {
    const send = fetchOverNode(toLoopback);
    await expect(send(new Request(`http://bucket.example:${port}/`))).rejects.toThrow(TypeError);
    await expect(send("file:///etc/passwd")).rejects.toThrow(TypeError);
    expect(seen).toHaveLength(0);
  });
});

describe("publicOnlyFetch — refused at the connection", () => {
  it("refuses a name that resolves to loopback; the server sees nothing", async () => {
    const resolve = vi.fn(
      async (): Promise<ResolvedAddress[]> => [{ address: "127.0.0.1", family: 4 }],
    );
    const error = await publicOnlyFetch({ resolve })(`http://bucket.example:${port}/`).catch(
      (caught: unknown) => caught,
    );
    expect(isPrivateAddressError(error)).toBe(true);
    // The transport resolved the name itself, as the socket's resolver: the
    // answer it checked is the answer the socket would have used.
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith("bucket.example");
    expect(seen).toHaveLength(0);
  });

  it("refuses a mixed answer: one private address spoils the name", async () => {
    const resolve = async (): Promise<ResolvedAddress[]> => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    const error = await publicOnlyFetch({ resolve })(`http://bucket.example:${port}/`).catch(
      (caught: unknown) => caught,
    );
    expect(isPrivateAddressError(error)).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("refuses an IPv4-mapped IPv6 loopback answer", async () => {
    const resolve = async (): Promise<ResolvedAddress[]> => [
      { address: "::ffff:127.0.0.1", family: 6 },
    ];
    const error = await publicOnlyFetch({ resolve })(`http://bucket.example:${port}/`).catch(
      (caught: unknown) => caught,
    );
    expect(isPrivateAddressError(error)).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it.each([
    ["IPv4 loopback", "127.0.0.1"],
    ["IPv6 loopback", "[::1]"],
    ["IPv4-mapped loopback", "[::ffff:127.0.0.1]"],
    ["link-local metadata", "169.254.169.254"],
  ])(
    "refuses a literal %s host, which Node would connect to without any lookup",
    async (_label, host) => {
      const resolve = vi.fn(async (): Promise<ResolvedAddress[]> => []);
      const error = await publicOnlyFetch({ resolve })(`http://${host}:${port}/`).catch(
        (caught: unknown) => caught,
      );
      expect(isPrivateAddressError(error)).toBe(true);
      expect(resolve).not.toHaveBeenCalled();
      expect(seen).toHaveLength(0);
    },
  );

  it("refuses localhost through the real system resolver", async () => {
    const error = await publicOnlyFetch()(`http://localhost:${port}/`).catch(
      (caught: unknown) => caught,
    );
    expect(isPrivateAddressError(error)).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("refuses over https the same way, before any handshake", async () => {
    const resolve = async (): Promise<ResolvedAddress[]> => [{ address: "10.0.0.5", family: 4 }];
    const error = await publicOnlyFetch({ resolve })(`https://bucket.example/`).catch(
      (caught: unknown) => caught,
    );
    expect(isPrivateAddressError(error)).toBe(true);
  });
});
