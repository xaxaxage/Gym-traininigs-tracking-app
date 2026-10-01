import { useEffect, useRef, useState } from 'preact/hooks';
import { shortDate } from '../lib/dates';

/**
 * A small line chart of progress over time, drawn as SVG (in its own chunk,
 * loaded only on an exercise's page). One y-axis; up to two series that
 * share it (e.g. best estimated 1-rep max and heaviest set, both weights).
 * A crosshair follows the finger or pointer, the arrow keys step through
 * the workouts, and the same numbers are available as a table.
 */

export interface Series {
  key: string;
  label: string;
  /** Token name, e.g. "series-1". */
  color: string;
  values: (number | undefined)[];
}

export interface ChartProps {
  /** One label per point, oldest first (dates as YYYY-MM-DD). */
  dates: string[];
  /** Time of each point (ms), for spacing them along the axis. */
  times: number[];
  series: Series[];
  /** Turns a value into text for ticks, labels and the tooltip. */
  format: (v: number) => string;
  title: string;
}

const H = 200;
const PAD = { top: 16, right: 56, bottom: 26, left: 40 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) {
    const v = max || 1;
    return [0, v / 2, v, (v * 3) / 2].map((x) => Math.round(x * 100) / 100);
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export default function ProgressChart({ dates, times, series, format, title }: ChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== undefined));
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const ticks = niceTicks(Math.max(0, lo - (hi - lo) * 0.15), hi);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const t0 = times[0];
  const t1 = times[times.length - 1];
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (t1 > t0 ? ((times[i] - t0) / (t1 - t0)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const nearest = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    return best;
  };

  const path = (values: (number | undefined)[]) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === undefined) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const lastIndex = (values: (number | undefined)[]) => {
    for (let i = values.length - 1; i >= 0; i--) if (values[i] !== undefined) return i;
    return -1;
  };

  // Year changes show the year on the axis.
  const axisDates = [0, Math.floor((dates.length - 1) / 2), dates.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const readout =
    active !== null ? `${shortDate(dates[active])}: ${series.map((s) => `${s.label} ${s.values[active] !== undefined ? format(s.values[active]!) : '–'}`).join(', ')}` : '';

  return (
    <figure class="chart">
      {series.length > 1 && (
        <ul class="chart-legend" aria-label="Legend">
          {series.map((s) => (
            <li>
              <span class="legend-key" style={{ background: `var(--${s.color})` }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={box}
        class="chart-box"
        tabIndex={0}
        role="group"
        aria-label={`${title}. Use the left and right arrow keys to step through the workouts.`}
        onPointerMove={(e) => setActive(nearest(e.clientX))}
        onPointerDown={(e) => setActive(nearest(e.clientX))}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const by = e.key === 'ArrowRight' ? 1 : -1;
            setActive((a) => Math.min(dates.length - 1, Math.max(0, (a ?? (by > 0 ? -1 : dates.length)) + by)));
          } else if (e.key === 'Escape') setActive(null);
        }}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} aria-hidden="true">
          {ticks.map((t) => (
            <g>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} class="chart-grid" />
              <text x={PAD.left - 6} y={y(t) + 4} class="chart-tick" text-anchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {axisDates.map((i) => (
            <text x={x(i)} y={H - 6} class="chart-tick" text-anchor={i === 0 && dates.length > 1 ? 'start' : i === dates.length - 1 && dates.length > 1 ? 'end' : 'middle'}>
              {shortDate(dates[i]).slice(4)}
            </text>
          ))}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} class="chart-crosshair" />}
          {series.map((s) => (
            <path d={path(s.values)} fill="none" stroke={`var(--${s.color})`} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          ))}
          {series.map((s) => {
            const i = lastIndex(s.values);
            if (i < 0) return null;
            return (
              <g>
                <circle cx={x(i)} cy={y(s.values[i]!)} r="5" fill={`var(--${s.color})`} stroke="var(--surface)" stroke-width="2" />
                <text x={x(i) + 9} y={y(s.values[i]!) + 4} class="chart-end">
                  {format(s.values[i]!)}
                </text>
              </g>
            );
          })}
          {active !== null &&
            series.map((s) =>
              s.values[active] !== undefined ? (
                <circle cx={x(active)} cy={y(s.values[active]!)} r="5" fill={`var(--${s.color})`} stroke="var(--surface)" stroke-width="2" />
              ) : null,
            )}
        </svg>
        {active !== null && (
          <div class="chart-tip" style={{ left: `${Math.min(Math.max(x(active), 70), width - 70)}px` }}>
            <span class="chart-tip-date">{shortDate(dates[active])}</span>
            {series.map((s) => (
              <span class="chart-tip-row">
                <span class="tip-key" style={{ background: `var(--${s.color})` }} aria-hidden="true" />
                <strong>{s.values[active] !== undefined ? format(s.values[active]!) : '–'}</strong> {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <p class="sr-only" aria-live="polite">
        {readout}
      </p>
      <button type="button" class="link-btn left" aria-expanded={table} onClick={() => setTable(!table)}>
        {table ? 'Hide the numbers' : 'Show the numbers'}
      </button>
      {table && (
        <div class="table-wrap">
          <table class="data-table">
            <caption class="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {series.map((s) => (
                  <th scope="col">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates
                .map((d, i) => ({ d, i }))
                .reverse()
                .map(({ d, i }) => (
                  <tr>
                    <th scope="row">{shortDate(d)}</th>
                    {series.map((s) => (
                      <td class="num">{s.values[i] !== undefined ? format(s.values[i]!) : '–'}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
