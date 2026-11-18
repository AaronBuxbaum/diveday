// Orthographic miniature. X runs from stern to bow, Y is height above the
// waterline, and Z runs across the deck. The control and the scene use the
// same projection so both name markers follow their divers as the camera turns.
type Point = [number, number, number];
type Face = { points: Point[]; paint: string; line: number; center: Point; layer: number };
const tau = 2 * Math.PI;
const cream = "#f8edcf";
const teal = "#204d50";
const varnish = "#bd8051";
const rubber = "#253d3d";
const metal = "#a8c1bc";
const bright = "#e1eee1";

function shape(points: Point[], paint: string, layer = 0, line = 0): Face {
  const center: Point = [0, 0, 0];
  for (const [x, y, z] of points) {
    center[0] += x / points.length;
    center[1] += y / points.length;
    center[2] += z / points.length;
  }
  return { points, paint, line, center, layer };
}

function rod(mesh: Face[], a: Point, b: Point, paint: string, weight: number, layer = 2) {
  mesh.push(shape([a, b], paint, layer, weight));
}

function block(
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

function cylinder(
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

const diverPositions: [Point, Point] = [
  [-2.67, 0.72, 0.2],
  [-0.95, 0.72, -0.25],
];
const diverHeadHeight = 1.69;
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
const boat = [...makeBoat(), ...makeDiver(0), ...makeDiver(1)];

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
  seafloor?: HTMLImageElement,
) {
  const seaColor = ctx.createLinearGradient(0, 0, w * 0.62, h);
  seaColor.addColorStop(0, "#174b57");
  seaColor.addColorStop(0.36, "#287778");
  seaColor.addColorStop(0.76, "#63ae9e");
  seaColor.addColorStop(1, "#afd4b8");
  ctx.fillStyle = seaColor;
  ctx.fillRect(0, 0, w, h);
  if (seafloor) {
    const imageScale = 1.24 * Math.max(w / seafloor.naturalWidth, h / seafloor.naturalHeight);
    const imageW = seafloor.naturalWidth * imageScale,
      imageH = seafloor.naturalHeight * imageScale;
    ctx.save();
    ctx.translate(w * (0.5 + 0.025 * Math.sin(yaw)) + 1.5 * Math.sin(t * 0.17), h * 0.5);
    ctx.rotate(0.095 * Math.sin(yaw));
    ctx.globalAlpha = 0.87;
    ctx.drawImage(seafloor, -imageW / 2, -imageH / 2, imageW, imageH);
    ctx.restore();
  }
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

export function drawBoatScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  yaw: number,
  time: number,
  confirmed: readonly [number, number],
  seafloor?: HTMLImageElement,
  focus: readonly [number, number] = [0, 0],
): [ScreenPoint, ScreenPoint] {
  const progress = (confirmed[0] + confirmed[1]) / 2;
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
  sea(ctx, width, height, s, time, project, progress, yaw, seafloor);
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
    project(x + progress * 0.22, y + bob + z * roll + x * pitch, z - y * roll);
  const pieces = [
    ...boat,
    ...wavingArm(0, time, confirmed[0]),
    ...wavingArm(1, time, confirmed[1]),
  ];
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
  const depth = (p: Point) => (cx * p[0] + cz * p[2]) * up + p[1] * down;
  // Window panes only render on the two visible sides of the wheelhouse.
  const visible = pieces.filter((f) => {
    if (f.layer !== 2.01 && f.layer !== 2.02) return true;
    const [x, , z] = f.center;
    return Math.abs(z) > 0.9 ? z * cz > 0 : (x - 1.05) * cx > 0;
  });
  visible.sort((a, b) => a.layer - b.layer || depth(a.center) - depth(b.center));
  for (const face of visible) {
    ctx.beginPath();
    for (let i = 0; i < face.points.length; i++) {
      const p = aboard(...face.points[i]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    if (face.line) {
      ctx.strokeStyle = face.paint;
      ctx.lineWidth = Math.max(0.62, face.line * s);
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
  const anchor = ([x, y, z]: Point) => aboard(x, y + diverHeadHeight, z);
  return [anchor(diverPositions[0]), anchor(diverPositions[1])];
}
