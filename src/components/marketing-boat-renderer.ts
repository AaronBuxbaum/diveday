import {
  boatAt,
  diverHeadHeight,
  diverPositions,
  type Face,
  jetty,
  type Point,
  tau,
} from "./marketing-boat-model";

type ScreenPoint = { x: number; y: number };
type Project = (x: number, y: number, z: number) => ScreenPoint;
const noise = (n: number) => {
  const a = Math.sin(n * 128.7 + 42.6) * 43758.545;
  return a - Math.floor(a);
};
const ripples = Array.from({ length: 145 }, (_, i) => ({
  x: (noise(i) - 0.5) * 20,
  z: (noise(i + 182) - 0.5) * 17,
  span: 0.11 + noise(i + 378) * 0.55,
  phase: noise(i + 601) * tau,
}));
const reef = Array.from({ length: 26 }, (_, i) => ({
  x: 6 + 3 * Math.cos(i * 2.4) * noise(i),
  z: -3 + 3 * Math.sin(i * 2.4) * noise(i + 45),
  size: 0.25 + noise(i + 20) * 1.2,
}));

function stroke(
  ctx: CanvasRenderingContext2D,
  from: ScreenPoint,
  to: ScreenPoint,
  paint: string,
  weight: number,
) {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = paint;
  ctx.lineWidth = weight;
  ctx.stroke();
}

function sea(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: number,
  t: number,
  project: Project,
  progress: number,
  yaw: number,
  reefMix: number,
  seafloor?: HTMLImageElement,
  harborWater?: HTMLImageElement,
) {
  const seaColor = ctx.createLinearGradient(0, 0, w * 0.62, h);
  seaColor.addColorStop(0, "#174b57");
  seaColor.addColorStop(0.36, "#287778");
  seaColor.addColorStop(0.76, "#63ae9e");
  seaColor.addColorStop(1, "#afd4b8");
  ctx.fillStyle = seaColor;
  ctx.fillRect(0, 0, w, h);
  if (reefMix < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - reefMix;
    const harbor = ctx.createLinearGradient(w * 0.8, 0, w * 0.1, h);
    harbor.addColorStop(0, "#d8ba85");
    harbor.addColorStop(0.35, "#9fae96");
    harbor.addColorStop(0.68, "#6f9692");
    harbor.addColorStop(1, "#466f77");
    ctx.fillStyle = harbor;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (harborWater && reefMix < 1) paintWater(harborWater, 0.87 * (1 - reefMix));
  if (seafloor && reefMix > 0) paintWater(seafloor, 0.87 * reefMix);
  function paintWater(texture: HTMLImageElement, opacity: number) {
    const imageScale = 1.24 * Math.max(w / texture.naturalWidth, h / texture.naturalHeight);
    const imageW = texture.naturalWidth * imageScale,
      imageH = texture.naturalHeight * imageScale;
    ctx.save();
    ctx.translate(w * (0.5 + 0.025 * Math.sin(yaw)) + 1.5 * Math.sin(t * 0.17), h * 0.5);
    ctx.rotate(0.095 * Math.sin(yaw));
    ctx.globalAlpha = opacity;
    ctx.drawImage(texture, -imageW / 2, -imageH / 2, imageW, imageH);
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = reefMix;
  for (const r of reef) {
    const p = project(r.x, -1.35, r.z);
    const radius = s * r.size;
    const shadow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
    shadow.addColorStop(0, "rgba(20,69,63,.16)");
    shadow.addColorStop(1, "rgba(27,87,80,0)");
    ctx.fillStyle = shadow;
    ctx.fillRect(p.x - radius, p.y - radius, 2 * radius, 2 * radius);
  }
  // A small shoal moves below the hull, at a different speed to the surface.
  for (let i = 0; i < 9; i++) {
    const x = 1.8 + Math.sin(t * 0.14) * 1.15 + noise(i + 94) * 2.25,
      z = 2.35 + noise(i + 81) * 1.6 + Math.sin(t * 0.4 + i) * 0.09;
    const p = project(x, -0.67, z),
      tail = project(x - 0.16, -0.67, z + 0.025 * Math.sin(t * 5 + i));
    stroke(ctx, p, tail, "rgba(19,78,77,.45)", s * 0.033);
    stroke(ctx, tail, project(x - 0.22, -0.67, z - 0.037), "rgba(21,80,76,.38)", s * 0.016);
  }
  if (reefMix > 0) reefRay(ctx, project, t, s);
  ctx.restore();
  for (const r of ripples) {
    const phase = t * 0.6 + r.phase;
    const x = r.x + 0.22 * Math.sin(phase),
      z = r.z + 0.06 * Math.sin(phase * 0.8);
    const p = project(x, 0, z),
      q = project(x + r.span, 0, z + 0.05);
    if (p.x < -s || p.x > w + s || p.y < -8 || p.y > h + 8) continue;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.quadraticCurveTo((p.x + q.x) * 0.5, (p.y + q.y) * 0.5 - 1.3, q.x, q.y);
    ctx.lineWidth = Math.max(0.7, s * 0.019);
    ctx.strokeStyle = `rgba(224,249,223,${0.17 + 0.13 * Math.sin(phase)})`;
    ctx.stroke();
  }
  // Expanding crests travel away from the transom as the boat gets underway.
  for (let i = 0; i < 8; i++) {
    const phase = (t * (0.23 + 0.14 * progress) + i / 8) % 1;
    const breadth = 0.65 + phase * (0.75 + 0.6 * progress),
      x = -3.4 - phase * (1.0 + 2.65 * progress);
    for (const sign of [-1, 1]) {
      const start = project(x + 0.23, 0, sign * breadth),
        mid = project(x - 0.15, 0, sign * breadth * 0.72),
        end = project(x - 0.18, 0, sign * 0.22);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = s * (0.018 + 0.036 * progress) * (1 - phase * 0.5);
      ctx.strokeStyle = `rgba(233,252,226,${(1 - phase) * (0.23 + 0.59 * progress)})`;
      ctx.stroke();
    }
  }
}

function paintFaces(ctx: CanvasRenderingContext2D, faces: Face[], project: Project, scale: number) {
  for (const face of faces) {
    ctx.beginPath();
    for (let i = 0; i < face.points.length; i++) {
      const p = project(...face.points[i]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    if (face.line) {
      ctx.strokeStyle = face.paint;
      ctx.lineWidth = Math.max(0.62, face.line * scale);
      ctx.stroke();
    } else {
      ctx.closePath();
      ctx.fillStyle = face.paint;
      ctx.fill();
      ctx.lineWidth = 0.45;
      ctx.strokeStyle = face.paint;
      ctx.stroke();
    }
  }
}

// A ray crosses the shallows independently of either diver's roll-call mark.
function reefRay(ctx: CanvasRenderingContext2D, project: Project, time: number, scale: number) {
  const phase = time * 0.19;
  const centerX = -0.8 + 1.7 * Math.sin(phase),
    centerZ = 2.56 + 0.38 * Math.cos(phase);
  const heading = Math.atan2(-0.38 * Math.sin(phase), 1.7 * Math.cos(phase));
  const point = (forward: number, side: number, lift = 0) =>
    project(
      centerX + forward * Math.cos(heading) - side * Math.sin(heading),
      -0.62 + lift,
      centerZ + forward * Math.sin(heading) + side * Math.cos(heading),
    );
  const wing = 0.14 * Math.sin(time * 2.15);
  const contour = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) =>
    ctx.bezierCurveTo(a.x, a.y, b.x, b.y, c.x, c.y);
  const nose = point(0.4, 0);
  ctx.beginPath();
  ctx.moveTo(nose.x, nose.y);
  for (const side of [-1, 1]) {
    const front = point(0.32, 0.1 * side),
      shoulder = point(0.2, 0.25 * side),
      tip = point(-0.14, 0.61 * side, wing);
    const trailing = point(-0.09, 0.3 * side),
      hip = point(-0.26, 0.13 * side),
      back = point(-0.24, 0);
    if (side < 0) {
      contour(front, shoulder, tip);
      contour(trailing, hip, back);
    } else {
      contour(hip, trailing, tip);
      contour(shoulder, front, nose);
    }
  }
  ctx.fillStyle = "rgba(24,70,77,.78)";
  ctx.fill();
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const spot = point(0.14 - 0.105 * (i % 3), side * (0.09 + 0.083 * Math.floor(i / 3)), 0.009);
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, Math.max(0.55, scale * 0.013), 0, tau);
      ctx.fillStyle = "rgba(191,221,198,.67)";
      ctx.fill();
    }
  }
  const tail = point(-0.95, 0.09 * Math.sin(time * 2)),
    bend = point(-0.58, -0.065 * Math.sin(time * 2)),
    base = point(-0.22, 0);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.quadraticCurveTo(bend.x, bend.y, tail.x, tail.y);
  ctx.lineWidth = scale * 0.027;
  ctx.strokeStyle = "rgba(27,74,78,.70)";
  ctx.stroke();
}

export function drawBoatScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  yaw: number,
  time: number,
  confirmed: readonly [number, number],
  seafloor?: HTMLImageElement,
  focus: readonly [number, number] = [0, 0],
  reefMix = 1,
  harborWater?: HTMLImageElement,
): [ScreenPoint, ScreenPoint] {
  const underway = Math.sin(Math.PI * reefMix);
  const heading = 2.24 + yaw;
  const cx = Math.cos(heading),
    cz = Math.sin(heading);
  const elevation = 0.54,
    up = Math.cos(elevation),
    down = Math.sin(elevation);
  const zoom = 1 + 1.45 * (focus[0] + focus[1]);
  const s = Math.min(width / 10.5, height / 7.05) * zoom;
  const targetX = diverPositions[0][0] * focus[0] + diverPositions[1][0] * focus[1];
  const targetZ = diverPositions[0][2] * focus[0] + diverPositions[1][2] * focus[1];
  const targetY = 1.32 * (focus[0] + focus[1]);
  const ox = width * 0.5 - s * (-cz * targetX + cx * targetZ),
    oy = height * 0.57 - s * ((cx * targetX + cz * targetZ) * down - targetY * up);
  const project: Project = (x, y, z) => ({
    x: ox + s * (-cz * x + cx * z),
    y: oy + s * ((cx * x + cz * z) * down - y * up),
  });
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  sea(ctx, width, height, s, time, project, underway, yaw, reefMix, seafloor, harborWater);
  const depth = (p: Point) => (cx * p[0] + cz * p[2]) * up + p[1] * down;
  const byDepth = (a: Face, b: Face) => a.layer - b.layer || depth(a.center) - depth(b.center);
  const dockProject: Project = (x, y, z) => project(x - reefMix * 11, y, z - reefMix * 1.9);
  function drawJetty() {
    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - reefMix) * 2);
    paintFaces(ctx, jetty.slice().sort(byDepth), dockProject, s);
    ctx.restore();
  }
  if (reefMix < 1) {
    const shadow = [
      dockProject(-5.72, -0.03, -1.35),
      dockProject(5.84, -0.03, -1.35),
      dockProject(5.84, -0.03, -3.78),
      dockProject(-5.72, -0.03, -3.78),
    ];
    ctx.beginPath();
    shadow.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = `rgba(36,58,54,${0.24 * (1 - reefMix)})`;
    ctx.fill();
    if (cz >= 0) drawJetty();
  }
  const shadowCenter = project(-0.04, -0.12, 0.28);
  const direction = Math.atan2(cx * down, -cz);
  ctx.save();
  ctx.translate(shadowCenter.x, shadowCenter.y);
  ctx.rotate(direction);
  ctx.scale(3.85 * s, 1.22 * s * down);
  const haze = ctx.createRadialGradient(0, 0, 0.45, 0, 0, 1.22);
  haze.addColorStop(0, "rgba(2,45,49,.55)");
  haze.addColorStop(1, "rgba(9,65,62,0)");
  ctx.fillStyle = haze;
  ctx.fillRect(-1.24, -1.24, 2.48, 2.48);
  ctx.restore();
  const bob = 0.05 * Math.sin(time * 1.34);
  const roll = 0.028 * Math.sin(time * 1.23 + 0.6);
  const pitch = 0.014 * Math.sin(time * 0.94);
  const aboard: Project = (x, y, z) =>
    project(x + underway * 0.22, y + bob + z * roll + x * pitch, z - y * roll);
  const pieces = boatAt(time, confirmed);
  // Window panes only render on the two visible sides of the wheelhouse.
  const visible = pieces.filter((f) => {
    if (f.layer !== 2.01 && f.layer !== 2.02) return true;
    const [x, , z] = f.center;
    return Math.abs(z) > 0.9 ? z * cz > 0 : (x - 1.05) * cx > 0;
  });
  visible.sort(byDepth);
  paintFaces(ctx, visible, aboard, s);
  if (reefMix < 1 && cz < 0) drawJetty();
  if (reefMix < 0.025) {
    ctx.save();
    ctx.globalAlpha = 1 - reefMix / 0.025;
    for (const [boatX, dockX] of [
      [-3.18, -3.2],
      [2.89, 2.45],
    ]) {
      const start = aboard(boatX, 0.7, boatX < 0 ? -1.12 : -0.7),
        end = dockProject(dockX, 0.8, -1.87);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo((start.x + end.x) / 2, (start.y + end.y) / 2 + s * 0.09, end.x, end.y);
      ctx.strokeStyle = "#e5dbb3";
      ctx.lineWidth = s * 0.03;
      ctx.stroke();
    }
    ctx.restore();
  }
  const anchor = ([x, y, z]: Point) => aboard(x, y + diverHeadHeight, z);
  return [anchor(diverPositions[0]), anchor(diverPositions[1])];
}
