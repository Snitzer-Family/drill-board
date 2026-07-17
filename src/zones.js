// Named ice areas — used for the toggleable overlay and to auto-name waypoints
// in presentation text. Rink coords: x 0..200, y 0..85 (goal lines x=17/183,
// blue lines x=75/125, end-zone dots x=45/155). This rink is intentionally not
// regulation, so zones are eyeballed to match the markings in rink.jsx.

function endZones(flip) {
  // mirror a left-end x-range to the right end when flip is true
  const mx = flip ? x => 200 - x : x => x;
  const Z = (name, x1, x2, y1, y2, spec, lbl) => {
    const ax = Math.min(mx(x1), mx(x2)), bx = Math.max(mx(x1), mx(x2));
    return {
      name, spec, x: ax, y: y1, w: bx - ax, h: y2 - y1,
      label: lbl && { x: flip ? 200 - lbl[0] : lbl[0], y: lbl[1] },
      test: (px, py) => px >= ax && px <= bx && py >= y1 && py <= y2,
    };
  };
  return [
    Z("Crease", 17, 23.5, 36.5, 48.5, 10, null),
    Z("Slot", 23.5, 50, 33, 52, 8, [37, 42.5]),
    Z("The house", 17, 55, 24, 61, 5, [50, 28]),
    Z("Behind the net", 3, 17, 27, 58, 7, [10, 42.5]),
    Z("Corner", 3, 29, 3, 14, 7, [15, 8]),
    Z("Corner", 3, 29, 71, 82, 7, [15, 77]),
    Z("Half wall", 26, 66, 3, 14, 4, [46, 8.5]),
    Z("Half wall", 26, 66, 71, 82, 4, [46, 76.5]),
    Z("Dot lane", 17, 72, 14.5, 26.5, 3, [63, 20.5]),
    Z("Dot lane", 17, 72, 58.5, 70.5, 3, [63, 64.5]),
    Z("The point", 66, 75, 16, 69, 4, [70.5, 42.5]),
  ];
}

export const ZONES = [
  ...endZones(false),
  ...endZones(true),
  { name: "Neutral zone", spec: 2, x: 75, y: 3, w: 50, h: 79,
    label: { x: 100, y: 11 }, test: px => px >= 75 && px <= 125 },
];

// most specific zone (highest spec) containing the point, or null
export function zoneAt(x, y) {
  let name = null, best = -1;
  for (const z of ZONES) if (z.spec > best && z.test(x, y)) { name = z.name; best = z.spec; }
  return name;
}
