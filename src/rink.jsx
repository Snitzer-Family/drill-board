// Rink markings, with yFix roundness correction for fill-mode stretch.

/* ---------------- rink markings ---------------- */

export function RinkMarkings({ yFix = 1 }) {
  const dots = [];
  [[45, 20.5], [45, 64.5], [155, 20.5], [155, 64.5]].forEach(([x, y]) =>
    dots.push(
      <g key={`fo${x}-${y}`}>
        <ellipse cx={x} cy={y} rx={15} ry={15 * yFix} fill="none" stroke="#d7263d" strokeWidth={0.4} opacity={0.8} />
        <ellipse cx={x} cy={y} rx={1} ry={yFix} fill="#d7263d" />
      </g>
    ));
  [[80, 20.5], [80, 64.5], [120, 20.5], [120, 64.5]].forEach(([x, y]) =>
    dots.push(<ellipse key={`nz${x}-${y}`} cx={x} cy={y} rx={1} ry={yFix} fill="#d7263d" />));
  const cr = 6 / Math.max(0.2, yFix); // crease depth corrected to stay semicircular
  return (
    <g clipPath="url(#boards)">
      <rect x={0} y={0} width={200} height={85} fill="#f5fafd" />
      {/* keep the goalie crease; the goal itself is shown by the net sprite */}
      <path d={`M 17 36.5 A ${cr} 6 0 0 1 17 48.5 Z`} fill="#d3e9f7" stroke="#d7263d" strokeWidth={0.3} />
      <path d={`M 183 36.5 A ${cr} 6 0 0 0 183 48.5 Z`} fill="#d3e9f7" stroke="#d7263d" strokeWidth={0.3} />
      <line x1={17} y1={0} x2={17} y2={85} stroke="#d7263d" strokeWidth={0.4} />
      <line x1={183} y1={0} x2={183} y2={85} stroke="#d7263d" strokeWidth={0.4} />
      <line x1={75} y1={0} x2={75} y2={85} stroke="#1f4fa3" strokeWidth={1} />
      <line x1={125} y1={0} x2={125} y2={85} stroke="#1f4fa3" strokeWidth={1} />
      <line x1={100} y1={0} x2={100} y2={85} stroke="#d7263d" strokeWidth={1} />
      <line x1={100} y1={0} x2={100} y2={85} stroke="#fff" strokeWidth={0.25} strokeDasharray="1.6 1.6" />
      <ellipse cx={100} cy={42.5} rx={15} ry={15 * yFix} fill="none" stroke="#1f4fa3" strokeWidth={0.4} />
      <ellipse cx={100} cy={42.5} rx={0.9} ry={0.9 * yFix} fill="#1f4fa3" />
      {dots}
      <rect x={0.5} y={0.5} width={199} height={84} rx={27.5} ry={27.5 * yFix} fill="none" stroke="#31404e" strokeWidth={1} />
    </g>
  );
}

