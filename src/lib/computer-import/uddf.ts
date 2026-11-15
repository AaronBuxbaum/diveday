import { computerTime } from "./time";
import {
  type ComputerGas,
  type ComputerSample,
  finite,
  type ParsedComputerDive,
  refuse,
} from "./types";
import { child, descendants, value, type XmlNode } from "./xml";
export function parseUddf(root: XmlNode): ParsedComputerDive[] {
  const ids = new Map<string, XmlNode>();
  const visit = (node: XmlNode) => {
    const id = node.attrs.id;
    if (id) {
      if (ids.has(id)) refuse("invalid_reference");
      ids.set(id, node);
    }
    for (const n of node.children) visit(n);
  };
  visit(root);
  // Every IDREF must resolve within this document, never to a URL.
  const refs = (node: XmlNode) => {
    const ref = node.attrs.ref;
    if (ref && !ids.has(ref)) refuse("invalid_reference");
    for (const n of node.children) refs(n);
  };
  refs(root);
  const mixes = new Map<string, ComputerGas>();
  for (const mix of descendants(root, "mix")) {
    const id = mix.attrs.id;
    if (!id) refuse("invalid_reference");
    const oxygenFraction = finite(value(mix, "o2"), 0, 1);
    const heliumFraction = finite(value(mix, "he"), 0, 1);
    if ((oxygenFraction ?? 0) + (heliumFraction ?? 0) > 1.000001) refuse("invalid_value");
    mixes.set(id, { id, oxygenFraction, heliumFraction });
  }
  return descendants(root, "dive").map((node) => {
    const before = child(node, "informationbeforedive");
    const after = child(node, "informationafterdive");
    const rawTime = before && value(before, "datetime");
    if (!rawTime) refuse("invalid_value");
    const time = computerTime(rawTime);
    const samples: ComputerSample[] = descendants(node, "waypoint").map((point) => {
      const seconds = finite(value(point, "divetime"), 0, 604800);
      const depthMeters = finite(value(point, "depth"), 0, 2000);
      if (seconds === null || depthMeters === null) refuse("invalid_value");
      const kelvin = finite(value(point, "temperature"), 173.15, 373.15);
      return {
        seconds,
        depthMeters,
        ...(kelvin === null ? {} : { temperatureC: Math.round((kelvin - 273.15) * 1e6) / 1e6 }),
      };
    });
    const tanks = descendants(node, "tankdata").map((tank) => {
      const gasId = child(tank, "link")?.attrs.ref ?? null;
      if (gasId && !mixes.has(gasId)) refuse("invalid_reference");
      const volume = finite(value(tank, "tankvolume"), 0, 1);
      const start = finite(value(tank, "tankpressurebegin"), 0, 100_000_000);
      const end = finite(value(tank, "tankpressureend"), 0, 100_000_000);
      return {
        gasId,
        volumeLiters: volume === null ? null : volume * 1000,
        startPressureBar: start === null ? null : start / 100000,
        endPressureBar: end === null ? null : end / 100000,
      };
    });
    const used = new Set(tanks.flatMap((t) => (t.gasId ? [t.gasId] : [])));
    for (const sw of descendants(node, "switchmix")) {
      if (!sw.attrs.ref || !mixes.has(sw.attrs.ref)) refuse("invalid_reference");
      used.add(sw.attrs.ref);
    }
    const deviceId =
      before &&
      descendants(before, "link").find(
        (link) =>
          ids
            .get(link.attrs.ref ?? "")
            ?.name.split(":")
            .at(-1) === "divecomputer",
      )?.attrs.ref;
    const device = deviceId ? ids.get(deviceId) : undefined;
    return {
      sourceFormat: "uddf",
      sourceId: node.attrs.id ?? null,
      device: device ? (value(device, "name") ?? value(device, "model") ?? null) : null,
      ...time,
      durationSeconds: after ? finite(value(after, "diveduration"), 0, 604800) : null,
      maxDepthMeters: after ? finite(value(after, "greatestdepth"), 0, 2000) : null,
      samples,
      gases: [...used].map((id) => mixes.get(id) as ComputerGas),
      tanks,
      sourceUnits: { depth: "m", temperature: "K", pressure: "Pa" },
      warnings: time.offsetMinutes === null ? ["timezone_unknown"] : [],
    };
  });
}
