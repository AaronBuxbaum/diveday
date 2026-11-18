// Orthographic miniature. X runs from stern to bow, Y is height above the
// waterline, and Z runs across the deck. The control and the scene use the
// same projection so both name markers follow their divers as the camera turns.
export type Point = [number, number, number];
export type Face = { points: Point[]; paint: string; line: number; center: Point; layer: number };
export const tau = 2 * Math.PI;
const cream = "#f8edcf";
const teal = "#204d50";
const varnish = "#bd8051";
const rubber = "#253d3d";
const metal = "#a8c1bc";
const bright = "#e1eee1";

export function shape(points: Point[], paint: string, layer = 0, line = 0): Face {
  const center: Point = [0, 0, 0];
  for (const [x, y, z] of points) {
    center[0] += x / points.length;
    center[1] += y / points.length;
    center[2] += z / points.length;
  }
  return { points, paint, line, center, layer };
}

export function rod(mesh: Face[], a: Point, b: Point, paint: string, weight: number, layer = 2) {
  mesh.push(shape([a, b], paint, layer, weight));
}

export function block(
  mesh: Face[],
  x: number,
  y: number,
  z: number,
  length: number,
  height: number,
  beam: number,
  colors: string[],
  layer = 2,
) {
  const a = x - length / 2,
    b = x + length / 2,
    c = z - beam / 2,
    d = z + beam / 2,
    h = y + height;
  mesh.push(
    shape(
      [
        [a, y, c],
        [b, y, c],
        [b, h, c],
        [a, h, c],
      ],
      colors[1],
      layer,
    ),
    shape(
      [
        [a, y, d],
        [b, y, d],
        [b, h, d],
        [a, h, d],
      ],
      colors[2],
      layer,
    ),
    shape(
      [
        [a, y, c],
        [a, y, d],
        [a, h, d],
        [a, h, c],
      ],
      colors[1],
      layer,
    ),
    shape(
      [
        [b, y, c],
        [b, y, d],
        [b, h, d],
        [b, h, c],
      ],
      colors[2],
      layer,
    ),
    shape(
      [
        [a, h, c],
        [a, h, d],
        [b, h, d],
        [b, h, c],
      ],
      colors[0],
      layer,
    ),
  );
}

export function cylinder(
  mesh: Face[],
  x: number,
  y: number,
  z: number,
  profile: number[][],
  paints: string[],
  layer = 2,
) {
  const sides = 8;
  for (let side = 0; side < sides; side++) {
    const a = (side * tau) / sides,
      b = ((side + 1) * tau) / sides;
    const point = (angle: number, [h, r]: number[]): Point => [
      x + Math.cos(angle) * r,
      y + h,
      z + Math.sin(angle) * r,
    ];
    const paint = paints[Math.floor((side * paints.length) / sides)];
    for (let ring = 1; ring < profile.length; ring++) {
      mesh.push(
        shape(
          [
            point(a, profile[ring - 1]),
            point(b, profile[ring - 1]),
            point(b, profile[ring]),
            point(a, profile[ring]),
          ],
          paint,
          layer,
        ),
      );
    }
  }
}

function makeBoat() {
  const mesh: Face[] = [];
  const stations = [
    [-3.5, 1.19],
    [-2.95, 1.27],
    [-1.9, 1.3],
    [-0.8, 1.31],
    [0.4, 1.3],
    [1.5, 1.22],
    [2.35, 1.04],
    [3.05, 0.7],
    [3.65, 0.23],
    [3.82, 0.025],
  ];
  for (const sign of [-1, 1]) {
    for (let i = 1; i < stations.length; i++) {
      const [x0, w0] = stations[i - 1],
        [x1, w1] = stations[i];
      const edge = (x: number, w: number, h: number, f: number): Point => [
        x,
        h + 0.13 * Math.max(0, x - 1.4),
        sign * w * f,
      ];
      const strips: [number, number, string][] = [
        [-0.15, 0.77, ""],
        [0.13, 0.91, "#286867"],
        [0.21, 0.95, "#bd593b"],
        [0.28, 0.965, "#e4b18b"],
        [0.59, 1, "#f0dfb9"],
        [0.67, 1.008, teal],
        [0.71, 1, "#f9e8c8"],
      ];
      for (let j = 1; j < strips.length; j++) {
        const [h0, f0] = strips[j - 1],
          [h1, f1, paint] = strips[j];
        mesh.push(
          shape(
            [
              edge(x0, w0, h0, f0),
              edge(x1, w1, h0, f0),
              edge(x1, w1, h1, f1),
              edge(x0, w0, h1, f1),
            ],
            paint,
          ),
        );
      }
      const e0 = edge(x0, w0, 0.71, 1),
        e1 = edge(x1, w1, 0.71, 1);
      mesh.push(shape([e0, e1, [x1, e1[1], 0], [x0, e0[1], 0]], "#d3ae7d", 1));
      rod(mesh, e0, e1, cream, 0.045, 1);
      if (x0 > 1.4 || x1 < -2.8) {
        const top0 = edge(x0, w0, 1.05, 0.97),
          top1 = edge(x1, w1, 1.05, 0.97);
        rod(mesh, e0, top0, metal, 0.035);
        rod(mesh, top0, top1, bright, 0.043);
      }
    }
  }
  mesh.push(
    shape(
      [
        [-3.5, -0.1, -0.93],
        [-3.5, -0.1, 0.93],
        [-3.5, 0.7, 1.19],
        [-3.5, 0.7, -1.19],
      ],
      "#c4b391",
    ),
  );
  rod(mesh, [-3.51, 0.59, -1.18], [-3.51, 0.59, 1.18], teal, 0.105, 1);
  // Split the deck fittings into short timbers so the painter can order
  // them correctly from either side of the cabin.
  for (let x = -3.3; x < -0.28; x += 0.32)
    rod(mesh, [x, 0.714, -1.15], [x, 0.714, 1.15], "#b48c64", 0.018, 1);
  for (const sign of [-1, 1]) {
    const z = sign * 0.91;
    block(mesh, -1.65, 0.73, z, 2.8, 0.32, 0.36, ["#ae8058", "#77563f", "#9b6c47"]);
    for (let i = 0; i < 3; i++)
      block(mesh, -1.65, 1.05, z + (i - 1) * 0.11, 2.82, 0.06, 0.092, [
        "#dea872",
        varnish,
        "#ac724c",
      ]);
    for (let i = 0; i < 4; i++) {
      const x = -0.65 - i * 0.51,
        tankZ = sign * 1.08;
      cylinder(
        mesh,
        x,
        0.91,
        tankZ,
        [
          [0, 0.105],
          [0.08, 0.145],
          [0.65, 0.145],
          [0.72, 0.105],
          [0.75, 0.047],
        ],
        ["#8fa7a4", "#bbccc4", "#eff1d9", "#a7bab3", "#789798", "#688486"],
      );
      rod(mesh, [x, 1.66, tankZ], [x, 1.73, tankZ], rubber, 0.055);
      rod(mesh, [x - 0.056, 1.73, tankZ], [x + 0.055, 1.73, tankZ], metal, 0.046);
    }
    rod(mesh, [-2.49, 1.33, sign * 1.245], [-0.45, 1.33, sign * 1.245], teal, 0.065);
  }
  // Glass wheelhouse, window mullions, flying roof, antenna and beacon.
  block(mesh, 1.05, 0.76, 0, 2.16, 1.28, 1.83, [cream, "#bbae8e", "#eadcc1"]);
  for (const sign of [-1, 1]) {
    const z = sign * 0.921;
    for (let i = 0; i < 3; i++) {
      const x = 0.08 + i * 0.68;
      mesh.push(
        shape(
          [
            [x, 1.33, z],
            [x + 0.57, 1.33, z],
            [x + 0.57, 1.91, z],
            [x, 1.91, z],
          ],
          sign > 0 ? "#476e70" : "#345860",
          2.01,
        ),
      );
      rod(mesh, [x + 0.1, 1.37, z], [x + 0.42, 1.88, z], "#79999a", 0.038, 2.02);
    }
    for (const x of [-0.037, 2.137]) {
      mesh.push(
        shape(
          [
            [x, 1.33, sign * 0.07],
            [x, 1.33, sign * 0.82],
            [x, 1.9, sign * 0.82],
            [x, 1.9, sign * 0.07],
          ],
          "#456a70",
          2.01,
        ),
      );
    }
  }
  block(mesh, 1.04, 2.035, 0, 2.46, 0.095, 2.12, ["#fff3d5", "#77918a", teal], 3);
  block(mesh, 1.24, 2.135, 0.08, 0.73, 0.12, 0.6, ["#bad1c9", "#688c88", metal], 3);
  cylinder(
    mesh,
    0.48,
    2.13,
    0,
    [
      [0, 0.15],
      [0.06, 0.15],
      [0.07, 0.105],
      [0.19, 0.095],
      [0.22, 0.04],
    ],
    ["#d18645", "#ffb45b", "#ffd693", "#e6a058"],
    3,
  );
  rod(mesh, [1.9, 2.14, -0.66], [2.02, 2.89, -0.66], rubber, 0.024, 3);
  // A life ring hangs on each side of the wheelhouse.
  for (const sign of [-1, 1]) {
    const z = sign * 0.94;
    for (let i = 0; i < 20; i++) {
      const a = (i * tau) / 20,
        b = ((i + 1) * tau) / 20;
      rod(
        mesh,
        [0.42 + 0.22 * Math.cos(a), 1.31 + 0.22 * Math.sin(a), z],
        [0.42 + 0.22 * Math.cos(b), 1.31 + 0.22 * Math.sin(b), z],
        i % 5 < 2 ? cream : "#ce6139",
        0.085,
        2.02,
      );
    }
  }
  // Stern swim platform with a stainless boarding ladder.
  block(mesh, -3.72, 0.22, 0.25, 0.58, 0.095, 1.65, ["#c39465", varnish, "#986e4c"], 1);
  for (const z of [-0.05, 0.52]) {
    rod(mesh, [-3.49, 0.83, z], [-3.91, 0.68, z], bright, 0.052);
    rod(mesh, [-3.91, 0.68, z], [-4.1, -0.19, z], metal, 0.052);
  }
  for (let i = 0; i < 4; i++)
    rod(
      mesh,
      [-3.94 - i * 0.038, 0.53 - i * 0.16, -0.05],
      [-3.94 - i * 0.038, 0.53 - i * 0.16, 0.52],
      bright,
      0.04,
    );
  return mesh;
}

export const diverPositions: [Point, Point] = [
  [-2.67, 0.72, 0.2],
  [-0.95, 0.72, -0.25],
];
export const diverHeadHeight = 1.69;
const neoprene = ["#314449", "#46585c", "#203236", "#17292e"];
const harness = ["#2d3537", "#485458", "#39454a", "#252c32"];

function placeDiver(faces: Face[], index: number) {
  const [x, y, z] = diverPositions[index];
  const angle = index === 0 ? 0.02 : 0.54;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  return faces.map((face) =>
    shape(
      face.points.map(
        ([dx, dy, dz]): Point => [x + dx * cosine + dz * sine, y + dy, z - dx * sine + dz * cosine],
      ),
      face.paint,
      face.layer,
      face.line,
    ),
  );
}

// Rounded cross-sections keep the shoulders, mask and tank readable in profile.
function rounded(
  mesh: Face[],
  center: Point,
  profile: number[][],
  breadth: number,
  paints: string[],
) {
  const rings: Face[] = [];
  cylinder(rings, 0, 0, 0, profile, paints);
  const [x, y, z] = center;
  for (const ring of rings) {
    mesh.push(
      shape(
        ring.points.map(([dx, dy, dz]): Point => [x + dx, y + dy, z + dz * breadth]),
        ring.paint,
        2,
      ),
    );
  }
}

function hose(mesh: Face[], bends: Point[], color: string, thickness: number) {
  for (let i = 1; i < bends.length; i++) rod(mesh, bends[i - 1], bends[i], color, thickness);
}

function makeDiver(index: number) {
  const mesh: Face[] = [];
  const isPriya = index === 0;
  const accent = isPriya ? "#21c7ae" : "#577fe1",
    skin = isPriya
      ? ["#b97b55", "#d89971", "#d39069", "#a9694d"]
      : ["#784b38", "#9b674d", "#945f49", "#674237"];
  // Neoprene boots, articulated knees and a tapered full-length wetsuit.
  for (const side of [-1, 1]) {
    const z = side * 0.114;
    rod(mesh, [0.02, 0.14, z], [-0.036, 0.47, z], neoprene[2], 0.137);
    rod(mesh, [-0.036, 0.47, z], [0.02, 0.77, z * 0.84], neoprene[0], 0.19);
    rod(mesh, [-0.094, 0.44, z], [-0.102, 0.53, z], neoprene[1], 0.098);
    block(mesh, -0.055, 0.025, z, 0.277, 0.106, 0.15, ["#35484a", "#1d2d30", "#25373b"]);
    rod(mesh, [-0.114, 0.12, z], [-0.032, 0.18, z], neoprene[2], 0.117);
  }
  rounded(
    mesh,
    [0.015, 0.68, 0],
    [
      [0, 0.11],
      [0.12, 0.144],
      [0.39, 0.174],
      [0.51, 0.148],
      [0.55, 0.09],
    ],
    1.47,
    neoprene,
  );
  // Buoyancy compensator with two air cells, shoulder straps and a waist buckle.
  for (const side of [-1, 1]) {
    rounded(
      mesh,
      [0.045, 0.76, side * 0.165],
      [
        [0, 0.05],
        [0.05, 0.096],
        [0.34, 0.105],
        [0.44, 0.056],
      ],
      0.8,
      harness,
    );
    hose(
      mesh,
      [
        [0.04, 1.215, side * 0.14],
        [-0.1, 1.18, side * 0.148],
        [-0.159, 1.04, side * 0.142],
        [-0.13, 0.89, side * 0.13],
      ],
      harness[2],
      0.083,
    );
    rod(mesh, [-0.164, 1.1, side * 0.15], [-0.169, 1.05, side * 0.146], accent, 0.049);
  }
  block(mesh, -0.12, 0.814, 0, 0.08, 0.071, 0.31, [harness[1], harness[3], harness[2]]);
  block(mesh, -0.17, 0.823, 0, 0.024, 0.046, 0.068, [bright, metal, metal]);
  // Cylinder on the backplate, black retaining bands and a compact first stage.
  cylinder(
    mesh,
    0.235,
    0.66,
    0,
    [
      [0, 0.09],
      [0.04, 0.134],
      [0.52, 0.134],
      [0.59, 0.103],
      [0.62, 0.046],
    ],
    ["#96b0b3", "#d3e2dd", "#edf1df", "#b7c9c9", "#79939a"],
  );
  for (const h of [0.78, 1.06])
    cylinder(
      mesh,
      0.235,
      h,
      0,
      [
        [0, 0.139],
        [0.055, 0.139],
      ],
      harness,
    );
  rod(mesh, [0.235, 1.275, 0], [0.235, 1.36, 0], metal, 0.069);
  rod(mesh, [0.235, 1.33, -0.069], [0.235, 1.33, 0.061], rubber, 0.057);
  hose(
    mesh,
    [
      [0.235, 1.3, 0.04],
      [0.2, 1.33, 0.16],
      [0.056, 1.3, 0.228],
      [-0.07, 1.18, 0.228],
      [-0.13, 1.01, 0.22],
    ],
    "#d5b335",
    0.036,
  );
  rod(mesh, [-0.135, 1.019, 0.217], [-0.164, 1.016, 0.227], rubber, 0.092);
  hose(
    mesh,
    [
      [0.226, 1.3, -0.044],
      [0.12, 1.29, -0.196],
      [-0.055, 1.19, -0.216],
      [-0.12, 1.04, -0.207],
    ],
    rubber,
    0.047,
  );
  // The mask is on the forehead so the crew can see the diver's face.
  rounded(
    mesh,
    [0, 1.2, 0],
    [
      [0, 0.075],
      [0.087, 0.086],
      [0.105, 0.066],
    ],
    1,
    skin,
  );
  rounded(
    mesh,
    [-0.026, 1.27, 0],
    [
      [0, 0.071],
      [0.061, 0.128],
      [0.18, 0.149],
      [0.272, 0.134],
      [0.307, 0.075],
    ],
    0.91,
    skin,
  );
  rounded(
    mesh,
    [-0.004, 1.48, 0],
    [
      [0, 0.14],
      [0.057, 0.147],
      [0.108, 0.116],
      [0.135, 0.045],
      [0.141, 0.01],
    ],
    0.96,
    ["#332b2a", "#493b32", "#3d302b", "#2a2828"],
  );
  if (isPriya)
    rounded(
      mesh,
      [0.143, 1.48, -0.002],
      [
        [0, 0.053],
        [0.05, 0.093],
        [0.112, 0.073],
        [0.14, 0.014],
      ],
      0.93,
      ["#372c26", "#514236", "#392f2b"],
    );
  for (const side of [-1, 1]) {
    rod(mesh, [-0.15, 1.42, side * 0.056], [-0.158, 1.42, side * 0.064], "#45322c", 0.02);
    rod(mesh, [0.115, 1.495, side * 0.09], [-0.12, 1.51, side * 0.113], rubber, 0.045);
    const lens: Point[] = [
      [-0.16, 1.48, side * 0.018],
      [-0.151, 1.484, side * 0.107],
      [-0.143, 1.55, side * 0.129],
      [-0.15, 1.565, side * 0.034],
    ];
    mesh.push(shape(lens, "#8ed9df", 2));
    hose(mesh, [...lens, lens[0]], accent, 0.022);
    rod(mesh, [-0.156, 1.5, side * 0.058], [-0.153, 1.544, side * 0.087], "#dcf7ef", 0.015);
  }
  rod(mesh, [-0.151, 1.515, -0.025], [-0.151, 1.515, 0.025], rubber, 0.027);
  rod(mesh, [-0.159, 1.415, 0], [-0.174, 1.383, 0], skin[1], 0.035);
  // On the near side the relaxed glove grips both fins by their heel straps.
  rod(mesh, [0, 1.14, 0.194], [-0.045, 0.956, 0.267], neoprene[0], 0.13);
  rod(mesh, [-0.045, 0.956, 0.267], [-0.143, 0.849, 0.3], neoprene[2], 0.103);
  rod(mesh, [-0.143, 0.849, 0.3], [-0.157, 0.804, 0.31], skin[1], 0.085);
  rod(mesh, [0, 1.14, 0.199], [-0.018, 1.071, 0.23], accent, 0.102);
  if (isPriya) addFins(mesh);
  return placeDiver(mesh, index);
}

function wavingArm(index: number, time: number, confirmed: number) {
  const mesh: Face[] = [];
  const reach = 1 - confirmed;
  const wave = reach * Math.sin(time * 3.4 + index) * 0.085;
  const elbow: Point = [-0.049, 1.02 + 0.12 * reach, 0.28 + 0.092 * reach];
  const wrist: Point = [-0.1 + wave, 0.83 + 0.57 * reach, 0.302 + 0.1 * reach + wave * 0.45];
  rod(mesh, [0, 1.144, 0.196], elbow, neoprene[0], 0.135);
  rod(mesh, elbow, wrist, neoprene[2], 0.098);
  rod(
    mesh,
    [0, 1.146, 0.2],
    [-0.018, 1.115 + 0.034 * reach, 0.24],
    index === 0 ? "#21c7ae" : "#577fe1",
    0.107,
  );
  rod(
    mesh,
    wrist,
    [wrist[0] - 0.016, wrist[1] - 0.055 + 0.151 * reach, wrist[2] + 0.01],
    index === 0 ? "#cb8e68" : "#905c43",
    0.085,
  );
  return placeDiver(
    mesh.map((f) =>
      shape(
        f.points.map(([x, y, z]): Point => [x, y, -z]),
        f.paint,
        f.layer,
        f.line,
      ),
    ),
    index,
  );
}

// Open-heel pockets and broad, channeled blades spread out below the hand.
function addFins(mesh: Face[]) {
  for (const offset of [-1, 1]) {
    const p = (h: number, halfWidth: number): Point => [
      -0.155 + 0.23 * (0.8 - h) * offset + halfWidth,
      h,
      0.315 + (0.8 - h) * 0.24 + offset * 0.012,
    ];
    const outline = [
      p(0.6, -0.054),
      p(0.51, -0.065),
      p(0.16, -0.108),
      p(0.115, -0.095),
      p(0.134, 0),
      p(0.115, 0.095),
      p(0.16, 0.108),
      p(0.51, 0.065),
      p(0.6, 0.054),
    ];
    mesh.push(shape(outline, "#f4cf37", 2));
    rod(mesh, outline[1], outline[2], "#ac8628", 0.019);
    rod(mesh, outline[6], outline[7], "#ac8628", 0.019);
    for (const sign of [-1, 1])
      rod(mesh, p(0.45, 0.026 * sign), p(0.17, 0.056 * sign), "#ffe978", 0.019);
    mesh.push(
      shape(
        [p(0.68, -0.044), p(0.52, -0.056), p(0.48, 0), p(0.52, 0.056), p(0.68, 0.044)],
        rubber,
        2,
      ),
    );
    hose(
      mesh,
      [p(0.65, -0.047), p(0.76, -0.043), p(0.8, 0), p(0.76, 0.043), p(0.65, 0.047)],
      rubber,
      0.025,
    );
  }
}
export const dockPaint = {
  cream,
  teal,
  varnish,
  rubber,
  metal,
  bright,
  shade: "#195052",
  canvas: "#cf9d69",
  shirt: "#6bafa0",
  skin: "#a87555",
  lens: "#8ac2c4",
};
const priya = makeDiver(0);
const boat = [...makeBoat(), ...makeDiver(1)];
export function priyaPosition(boarding: number): Point {
  // Turn along the pier, cross the boarding boards, then step into the stern.
  const start: Point = [-2.23, 0.67, -2.38],
    foot: Point = [-3.24, 0.67, -1.79],
    gate: Point = [-3.24, 0.72, -0.8];
  const [from, to, amount]: [Point, Point, number] =
    boarding < 0.32
      ? [start, foot, boarding / 0.32]
      : boarding < 0.68
        ? [foot, gate, (boarding - 0.32) / 0.36]
        : [gate, diverPositions[0], (boarding - 0.68) / 0.32];
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount + 0.03 * Math.abs(Math.sin(boarding * 4 * Math.PI)),
    from[2] + (to[2] - from[2]) * amount,
  ];
}
function moveToDock(mesh: Face[], position: Point) {
  const offset = position.map((v, i) => v - diverPositions[0][i]);
  const move = ([x, y, z]: Point): Point => [x + offset[0], y + offset[1], z + offset[2]];
  return mesh.map((f) => ({ ...f, center: move(f.center), points: f.points.map(move) }));
}
const priyaOnDock = moveToDock(priya, priyaPosition(0));
export function priyaAt(time: number, confirmed: number, boarding: number) {
  const arm = wavingArm(0, time, boarding < 1 ? 0.72 : confirmed);
  if (boarding === 1) return [...priya, ...arm];
  const position = priyaPosition(boarding);
  return [
    ...(boarding === 0 ? priyaOnDock : moveToDock(priya, position)),
    ...moveToDock(arm, position),
  ];
}

// The jetty stays in harbor coordinates. During the trip transition it slips
// astern while the camera continues to track the boat and its name markers.
function makeJetty() {
  const mesh: Face[] = [];
  const planks = ["#c89d70", "#b78d65", "#d3ad80", "#bd986e", "#c6a780"];
  const edge = -1.63,
    back = -3.85,
    height = 0.67;
  block(
    mesh,
    0,
    0.41,
    (edge + back) / 2,
    11.5,
    0.24,
    edge - back,
    ["#9e7554", "#715742", "#806348"],
    0,
  );
  for (let i = 0; i < 40; i++) {
    const x = -5.75 + i * 0.2875,
      end = x + 0.277;
    mesh.push(
      shape(
        [
          [x, height, edge],
          [end, height, edge],
          [end, height, back],
          [x, height, back],
        ],
        planks[i % planks.length],
        1,
      ),
    );
    // Weather checks along individual boards.
    const grainZ = back + 0.18 + (i % 4) * 0.31;
    rod(
      mesh,
      [x + 0.07, height + 0.003, grainZ],
      [x + 0.076, height + 0.003, grainZ + 0.58],
      "#a4805d",
      0.012,
      1.1,
    );
  }
  for (const x of [-5.45, -2.8, 0.4, 3.05, 5.45]) {
    for (const z of [edge + 0.045, back + 0.06]) {
      const top = z > -2 ? 0.9 : 0.74;
      cylinder(
        mesh,
        x,
        -0.19,
        z,
        [
          [0, 0.13],
          [0.3, 0.14],
          [top + 0.19, 0.145],
          [top + 0.2, 0.02],
        ],
        ["#795a44", "#976e4e", "#b1875e", "#926f53"],
        1.3,
      );
    }
  }
  for (const x of [-3.2, 2.45]) {
    const z = edge - 0.24;
    block(mesh, x, height, z, 0.29, 0.036, 0.13, [metal, "#647c7a", rubber], 2);
    rod(mesh, [x, height + 0.04, z], [x, height + 0.13, z], rubber, 0.095, 2);
    rod(mesh, [x - 0.18, height + 0.13, z], [x + 0.18, height + 0.13, z], metal, 0.058, 2);
  }
  // A flaked dock line, coiled flat beside the stern cleat.
  for (let i = 0; i < 64; i++) {
    const loop = (step: number): Point => {
      const angle = step * 0.33,
        radius = 0.105 + 0.0037 * step;
      return [
        -3.43 + Math.cos(angle) * radius,
        height + 0.035,
        -2.48 + Math.sin(angle) * radius * 0.82,
      ];
    };
    rod(mesh, loop(i), loop(i + 1), "#eee1b9", 0.038, 2);
  }
  // One ring buoy hangs on the outside of the farther dock rail.
  const ringX = -4.35,
    ringZ = back + 0.09;
  rod(mesh, [ringX, height, ringZ - 0.04], [ringX, 1.73, ringZ - 0.04], "#786c5b", 0.09, 2);
  for (let i = 0; i < 32; i++) {
    const point = (n: number): Point => [
      ringX + 0.26 * Math.cos((tau * n) / 32),
      1.39 + 0.26 * Math.sin((tau * n) / 32),
      ringZ + 0.025,
    ];
    rod(mesh, point(i), point(i + 1), i % 8 < 2 ? "#f8ecd5" : "#cc6241", 0.1, 2.1);
  }
  return mesh;
}
export const jetty = makeJetty();

export function boatAt(time: number, confirmed: readonly [number, number]) {
  const pieces = [...boat, ...wavingArm(1, time, confirmed[1])];
  // The triangular pennant flexes between its stitched panels in the breeze.
  const flagPoint = (u: number, v: number): Point => [
    2.01 - u * 0.75,
    2.86 - v * 0.34 * (1 - u) - 0.1 * u,
    -0.66 + u * 0.12 * Math.sin(time * 3.8 - u * 6),
  ];
  for (let i = 0; i < 4; i++) {
    const u = i / 4,
      v = (i + 1) / 4;
    pieces.push(
      shape(
        [flagPoint(u, 0), flagPoint(v, 0), flagPoint(v, 1), flagPoint(u, 1)],
        i === 1 ? cream : "#d56c40",
        3.1,
      ),
    );
  }
  return pieces;
}
