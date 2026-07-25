// Rink markings, with yFix roundness correction for fill-mode stretch.

/* ---------------- rink markings ---------------- */

export function RinkMarkings({ yFix = 1 }) {
  const dots = [];
  // end-zone faceoff spots: regulation 20' from the goal line (x=31/169),
  // 44' apart (y=20.5/64.5), 15' circles with hash marks (2' long, ~5'7" apart)
  [[31, 20.5], [31, 64.5], [169, 20.5], [169, 64.5]].forEach(([x, y]) =>
    dots.push(
      <g key={`fo${x}-${y}`}>
        <ellipse cx={x} cy={y} rx={15} ry={15 * yFix} fill="none" stroke="#d7263d" strokeWidth={0.4} opacity={0.8} />
        <ellipse cx={x} cy={y} rx={1} ry={yFix} fill="#d7263d" />
        <path d={`M ${x - 2.8} ${y - 17 * yFix} V ${y - 15 * yFix} M ${x + 2.8} ${y - 17 * yFix} V ${y - 15 * yFix} M ${x - 2.8} ${y + 15 * yFix} V ${y + 17 * yFix} M ${x + 2.8} ${y + 15 * yFix} V ${y + 17 * yFix}`}
          stroke="#d7263d" strokeWidth={0.4} opacity={0.8} fill="none" />
      </g>
    ));
  [[80, 20.5], [80, 64.5], [120, 20.5], [120, 64.5]].forEach(([x, y]) =>
    dots.push(<ellipse key={`nz${x}-${y}`} cx={x} cy={y} rx={1} ry={yFix} fill="#d7263d" />));
  const cr = 6 / Math.max(0.2, yFix);   // crease arc depth corrected to stay round
  const rr = 10 / Math.max(0.2, yFix);  // referee crease radius, same correction
  return (
    <g clipPath="url(#boards)">
      <rect x={0} y={0} width={200} height={85} fill="#f5fafd" />
      {/* regulation goalie crease: 8' wide, 4.5' straight sides, 6' arc */}
      <path d={`M 11 38.5 L 15.5 38.5 A ${cr} 6 0 0 1 15.5 46.5 L 11 46.5 Z`} fill="#1f4fa3" stroke="#d7263d" strokeWidth={0.3} />
      <path d={`M 189 38.5 L 184.5 38.5 A ${cr} 6 0 0 0 184.5 46.5 L 189 46.5 Z`} fill="#1f4fa3" stroke="#d7263d" strokeWidth={0.3} />
      {/* referee crease: 10' semicircle at the scorekeeper's bench */}
      <path d={`M ${100 - rr} 85 A ${rr} 10 0 0 1 ${100 + rr} 85`} fill="none" stroke="#d7263d" strokeWidth={0.3} opacity={0.8} />
      <line x1={11} y1={0} x2={11} y2={85} stroke="#d7263d" strokeWidth={0.4} />
      <line x1={189} y1={0} x2={189} y2={85} stroke="#d7263d" strokeWidth={0.4} />
      <line x1={75} y1={0} x2={75} y2={85} stroke="#1f4fa3" strokeWidth={1} />
      <line x1={125} y1={0} x2={125} y2={85} stroke="#1f4fa3" strokeWidth={1} />
      <line x1={100} y1={0} x2={100} y2={85} stroke="#d7263d" strokeWidth={1} />
      <line x1={100} y1={0} x2={100} y2={85} stroke="#fff" strokeWidth={0.25} strokeDasharray="1.6 1.6" />
      <ellipse cx={100} cy={42.5} rx={15} ry={15 * yFix} fill="none" stroke="#1f4fa3" strokeWidth={0.4} />
      <ellipse cx={100} cy={42.5} rx={0.5} ry={0.5 * yFix} fill="#1f4fa3" />
      {dots}
      <rect x={0.5} y={0.5} width={199} height={84} rx={28} ry={28 * yFix} fill="none" stroke="#31404e" strokeWidth={1} />
    </g>
  );
}

