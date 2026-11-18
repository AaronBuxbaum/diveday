import {
  block,
  cylinder,
  type Face,
  type Point,
  dockPaint as paint,
  rod,
  shape,
} from "./marketing-boat-model";

// The counter faces the boarding lane. The striped awning is cantilevered
// from its back edge, leaving the visitor and the presented card in view.
function makeCheckInDesk() {
  const mesh: Face[] = [];
  const x = -1.45,
    z = -3.15,
    floor = 0.67,
    top = 1.47;
  block(mesh, x, floor, z, 1.36, 0.75, 0.49, [paint.metal, paint.shade, paint.teal]);
  block(mesh, x, top - 0.066, z, 1.48, 0.066, 0.58, [paint.cream, paint.varnish, paint.canvas]);
  // A tablet on a stand and a card on the writing surface.
  block(mesh, x + 0.27, top, z, 0.19, 0.032, 0.14, [paint.metal, paint.rubber, paint.rubber]);
  rod(mesh, [x + 0.27, top + 0.03, z], [x + 0.27, top + 0.15, z - 0.05], paint.rubber, 0.036);
  const panel = (w: number, h: number, offset: number): Point[] => [
    [x + 0.27 - w, top + 0.19 - h, z + offset + h * 0.34],
    [x + 0.27 + w, top + 0.19 - h, z + offset + h * 0.34],
    [x + 0.27 + w, top + 0.19 + h, z + offset - h * 0.34],
    [x + 0.27 - w, top + 0.19 + h, z + offset - h * 0.34],
  ];
  mesh.push(
    shape(panel(0.19, 0.14, 0), paint.rubber, 2.1),
    shape(panel(0.165, 0.11, 0.008), paint.lens, 2.11),
  );
  block(mesh, x - 0.29, top + 0.003, z + 0.08, 0.245, 0.013, 0.15, [
    paint.teal,
    paint.rubber,
    paint.rubber,
  ]);
  rod(mesh, [x - 0.375, top + 0.021, z + 0.1], [x - 0.3, top + 0.021, z + 0.1], paint.cream, 0.018);

  // The boarding boards span the short gap from the pier to the aft deck.
  block(
    mesh,
    -3.24,
    0.65,
    -1.44,
    0.49,
    0.045,
    0.51,
    [paint.canvas, paint.varnish, paint.varnish],
    1.2,
  );
  for (const z of [-1.58, -1.45, -1.32])
    rod(mesh, [-3.47, 0.7, z], [-3.01, 0.7, z], paint.varnish, 0.017, 1.3);
  // Dock attendant, behind the counter and facing the boat.
  const headX = x - 0.46,
    headZ = z - 0.4;
  block(mesh, headX, 1.41, headZ, 0.34, 0.48, 0.23, [paint.shirt, paint.teal, paint.shirt]);
  cylinder(
    mesh,
    headX,
    1.89,
    headZ,
    [
      [0, 0.075],
      [0.065, 0.12],
      [0.22, 0.127],
      [0.26, 0.093],
    ],
    [paint.skin],
  );
  cylinder(
    mesh,
    headX,
    2.11,
    headZ,
    [
      [0, 0.164],
      [0.03, 0.159],
      [0.04, 0.12],
      [0.11, 0.096],
      [0.118, 0.015],
    ],
    [paint.canvas, paint.cream, paint.canvas],
    2.1,
  );
  // The attendant looks out from under the visor toward the boarding lane.
  for (const side of [-1, 1]) {
    const eyeX = headX - 0.025 + side * 0.048;
    rod(mesh, [eyeX, 2.05, headZ + 0.109], [eyeX + 0.013, 2.05, headZ + 0.11], paint.rubber, 0.018);
  }
  rod(
    mesh,
    [headX - 0.02, 2.04, headZ + 0.12],
    [headX - 0.026, 2.007, headZ + 0.14],
    paint.skin,
    0.026,
  );
  rod(
    mesh,
    [headX - 0.04, 1.98, headZ + 0.111],
    [headX - 0.006, 1.98, headZ + 0.114],
    paint.varnish,
    0.012,
  );
  block(mesh, headX + 0.078, 1.73, headZ + 0.12, 0.083, 0.049, 0.012, [
    paint.cream,
    paint.cream,
    paint.cream,
  ]);
  for (const side of [-1, 1]) {
    const elbow: Point = [headX + side * 0.21, 1.6, headZ + 0.09];
    rod(mesh, [headX + side * 0.13, 1.82, headZ], elbow, paint.shirt, 0.097);
    rod(mesh, elbow, [headX + side * 0.21, 1.49, headZ + 0.29], paint.skin, 0.071);
  }
  // Alternating fabric panels, a shallow pitched roof, and a scalloped valance.
  for (const side of [-1, 1])
    rod(
      mesh,
      [x + side * 0.73, floor, z - 0.52],
      [x + side * 0.73, 2.84, z - 0.52],
      paint.metal,
      0.052,
    );
  for (let i = 0; i < 7; i++) {
    const a = x - 0.87 + i * 0.248,
      b = a + 0.248,
      col = i % 2 ? paint.cream : paint.teal;
    mesh.push(
      shape(
        [
          [a, 2.84, z - 0.59],
          [b, 2.84, z - 0.59],
          [b, 2.71, z + 0.1],
          [a, 2.71, z + 0.1],
        ],
        col,
        3,
      ),
    );
    mesh.push(
      shape(
        [
          [a, 2.71, z + 0.1],
          [b, 2.71, z + 0.1],
          [b, 2.64, z + 0.1],
          [(a + b) / 2, 2.615, z + 0.1],
          [a, 2.64, z + 0.1],
        ],
        col,
        3,
      ),
    );
  }
  return mesh;
}

export const checkInDesk = makeCheckInDesk();
