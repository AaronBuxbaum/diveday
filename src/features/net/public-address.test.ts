import type { LookupAddress } from "node:dns";
import { describe, expect, it, vi } from "vitest";
import {
  isPrivateAddressError,
  isUnsafeAddress,
  publicOnlyLookup,
  type ResolvedAddress,
} from "./public-address";

describe("isUnsafeAddress", () => {
  it.each([
    ["loopback", "127.0.0.1"],
    ["loopback, top of range", "127.255.255.254"],
    ["this network", "0.0.0.0"],
    ["private 10/8", "10.1.2.3"],
    ["private 172.16/12, bottom", "172.16.0.1"],
    ["private 172.16/12, top", "172.31.255.255"],
    ["private 192.168/16", "192.168.1.1"],
    ["link-local / cloud metadata", "169.254.169.254"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["TEST-NET-1", "192.0.2.1"],
    ["benchmarking", "198.18.0.1"],
    ["6to4 relay anycast", "192.88.99.1"],
    ["multicast", "224.0.0.1"],
    ["broadcast", "255.255.255.255"],
  ])("refuses IPv4 %s (%s)", (_label, address) => {
    expect(isUnsafeAddress(address)).toBe(true);
  });

  it.each([
    ["loopback", "::1"],
    ["unspecified", "::"],
    ["unique-local fc00::/7", "fc00::1"],
    ["unique-local fd00::/8", "fd12:3456:789a::1"],
    ["link-local", "fe80::1"],
    ["link-local with a zone", "fe80::1%eth0"],
    ["link-local, top of /10", "febf::1"],
    ["site-local", "fec0::1"],
    ["multicast", "ff02::1"],
    ["documentation", "2001:db8::1"],
    ["Teredo", "2001:0:4136:e378::1"],
    ["IETF protocol assignment (ORCHIDv2)", "2001:20::1"],
    ["benchmarking", "2001:2::1"],
    ["discard-only", "100::1"],
    ["IPv4-mapped loopback, dotted", "::ffff:127.0.0.1"],
    ["IPv4-mapped loopback, hex (how URL writes it)", "::ffff:7f00:1"],
    ["IPv4-mapped metadata", "::ffff:169.254.169.254"],
    ["IPv4-mapped private, fully expanded", "0:0:0:0:0:ffff:a00:1"],
    ["IPv4-translated loopback", "::ffff:0:127.0.0.1"],
    ["IPv4-compatible (deprecated)", "::127.0.0.1"],
    ["NAT64 of loopback", "64:ff9b::7f00:1"],
    ["6to4 of private", "2002:c0a8:101::1"],
    ["bracketed loopback", "[::1]"],
  ])("refuses IPv6 %s (%s)", (_label, address) => {
    expect(isUnsafeAddress(address)).toBe(true);
  });

  it.each([
    "not-an-ip",
    "",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "01.2.3.4",
    "::ffff:1.2.3.999",
    "1::2::3",
  ])("refuses %j, which is not an address it can judge", (address) => {
    expect(isUnsafeAddress(address)).toBe(true);
  });

  it.each([
    ["public IPv4", "93.184.216.34"],
    ["172.15 sits just below the private /12", "172.15.255.255"],
    ["172.32 sits just above it", "172.32.0.1"],
    ["public IPv6", "2606:2800:220:1:248:1893:25c8:1946"],
    ["IPv4-mapped public", "::ffff:93.184.216.34"],
    ["NAT64 of a public address", "64:ff9b::5db8:d822"],
    ["6to4 of a public address", "2002:5db8:d822::1"],
  ])("allows %s (%s)", (_label, address) => {
    expect(isUnsafeAddress(address)).toBe(false);
  });
});

type LookupResult = { error: NodeJS.ErrnoException | null; address: unknown; family?: number };

function runLookup(
  resolve: (hostname: string) => Promise<ResolvedAddress[]>,
  options: { all?: boolean; family?: number } = {},
): Promise<LookupResult> {
  const lookup = publicOnlyLookup(resolve);
  return new Promise((done) => {
    lookup("bucket.example", options, (error, address, family) => {
      done({ error, address, family });
    });
  });
}

describe("publicOnlyLookup", () => {
  it("hands back every public answer when the socket asks for all of them", async () => {
    const answers = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ];
    const result = await runLookup(async () => answers, { all: true });
    expect(result.error).toBeNull();
    expect(result.address as LookupAddress[]).toEqual(answers);
  });

  it("hands back the first answer as (address, family) without `all`", async () => {
    const result = await runLookup(async () => [{ address: "93.184.216.34", family: 4 }]);
    expect(result).toEqual({ error: null, address: "93.184.216.34", family: 4 });
  });

  it("keeps to the family the socket asked for", async () => {
    const result = await runLookup(
      async () => [
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        { address: "93.184.216.34", family: 4 },
      ],
      { family: 4 },
    );
    expect(result).toEqual({ error: null, address: "93.184.216.34", family: 4 });
  });

  it("refuses the name when any answer is private, so the client cannot fall back onto it", async () => {
    const result = await runLookup(
      async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
      { all: true },
    );
    expect(isPrivateAddressError(result.error)).toBe(true);
  });

  it("refuses an IPv4-mapped loopback answer to an AAAA query", async () => {
    const result = await runLookup(async () => [{ address: "::ffff:127.0.0.1", family: 6 }], {
      all: true,
    });
    expect(isPrivateAddressError(result.error)).toBe(true);
  });

  it("resolves afresh on every connection: a rebinding second answer is refused", async () => {
    const resolve = vi
      .fn<(hostname: string) => Promise<ResolvedAddress[]>>()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const lookup = publicOnlyLookup(resolve);
    const ask = () =>
      new Promise<NodeJS.ErrnoException | null>((done) => {
        lookup("bucket.example", { all: true }, (error) => done(error));
      });
    expect(await ask()).toBeNull();
    expect(isPrivateAddressError(await ask())).toBe(true);
  });

  it("fails, rather than allowing, when the resolver errors or finds nothing", async () => {
    const failed = await runLookup(async () => {
      throw new Error("NXDOMAIN");
    });
    expect(failed.error).toBeInstanceOf(Error);
    expect(isPrivateAddressError(failed.error)).toBe(false);

    const empty = await runLookup(async () => []);
    expect(empty.error?.code).toBe("ENOTFOUND");
  });
});
