/** Tiny trend line. Decorative: the numbers are always printed next to it (and in `summary` for assistive tech). */
export function Sparkline({ values, summary }: { values: number[]; summary: string }) {
  const w = 96;
  const h = 32;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={summary}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.length > 0 && <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r="2.6" fill="currentColor" />}
    </svg>
  );
}
