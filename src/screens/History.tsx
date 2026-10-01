import { useMemo } from 'preact/hooks';
import type { Units, Workout } from '../lib/types';
import { activeWorkout, finishedWorkouts, useData } from '../lib/store';
import { addDays, addMonths, durationWords, fromKey, monthLabel, shortDate, todayKey, toKey } from '../lib/dates';
import { href, navigate } from '../lib/router';
import { workoutTotals } from '../lib/stats';
import { fmtVolume } from '../lib/units';
import { plural } from '../lib/format';
import { BottomNav, Empty, Segmented } from '../components/Common';
import { Calendar, ChevronLeft, ChevronRight, HistoryIcon } from '../components/Icons';

type View = 'list' | 'calendar';

/** Past workouts by date: a list grouped by month, or a month calendar. */
export function History({ view, month, day }: { view: View; month: string; day?: string }) {
  const data = useData();
  const { units } = data.settings;
  const done = useMemo(() => finishedWorkouts(data), [data.workouts]);
  const active = activeWorkout(data);
  // Workouts left open on another device (only the newest one is "in progress").
  const open = data.workouts.filter((w) => !w.endedAt && w !== active);
  const setView = (v: View) => navigate(href('/history', { view: v === 'calendar' ? 'calendar' : undefined, month: v === 'calendar' ? month : undefined }), { replace: true });

  return (
    <>
      <main class={`screen with-nav${active ? ' with-mini' : ''}`}>
        <header class="page-head">
          <div>
            <span class="eyebrow">{plural(done.length, 'workout')}</span>
            <h1 class="page-title">History</h1>
          </div>
        </header>
        <Segmented
          label="View"
          value={view}
          options={[
            { value: 'list', label: 'List' },
            { value: 'calendar', label: 'Calendar' },
          ]}
          onChange={setView}
        />

        {open.length > 0 && (
          <section class="stack-8" aria-label="Unfinished">
            <h2 class="list-label">Unfinished</h2>
            <ul class="list">
              {open.map((w) => (
                <WorkoutRow w={w} units={units} />
              ))}
            </ul>
          </section>
        )}

        {done.length === 0 ? (
          <div class="card">
            <Empty title="No workouts yet" icon={<HistoryIcon size={28} />}>
              <p class="body-text center">Finished workouts show up here, by date, with their sets and records.</p>
              <a href="#/" class="btn-primary">
                Start a workout
              </a>
            </Empty>
          </div>
        ) : view === 'list' ? (
          <ListView workouts={done} units={units} />
        ) : (
          <CalendarView workouts={done} month={month} day={day} units={units} />
        )}
      </main>
      <BottomNav current="history" />
    </>
  );
}

function WorkoutRow({ w, units }: { w: Workout; units: Units }) {
  const t = workoutTotals(w);
  return (
    <li>
      <a href={`#/workout/${w.id}`} class="row workout-row">
        <span class="date-badge" aria-hidden="true">
          <span class="date-day">{fromKey(w.date).getDate()}</span>
          <span class="date-wd">{shortDate(w.date).slice(0, 3)}</span>
        </span>
        <span class="row-main">
          <span class="row-title">{w.name}</span>
          <span class="row-sub num">
            <span class="sr-only">{shortDate(w.date)} · </span>
            {w.endedAt ? durationWords(t.duration) : 'not finished'} · {plural(t.sets, 'set')}
            {t.volume > 0 ? ` · ${fmtVolume(t.volume, units)}` : ''}
          </span>
        </span>
        <ChevronRight />
      </a>
    </li>
  );
}

function ListView({ workouts, units }: { workouts: Workout[]; units: Units }) {
  const groups: { month: string; items: Workout[] }[] = [];
  for (const w of workouts) {
    const m = w.date.slice(0, 7);
    if (groups.at(-1)?.month !== m) groups.push({ month: m, items: [] });
    groups.at(-1)!.items.push(w);
  }
  return (
    <>
      {groups.map((g) => (
        <section class="stack-8" aria-label={monthLabel(g.month)}>
          <h2 class="list-label">
            {monthLabel(g.month)} · {plural(g.items.length, 'workout')}
          </h2>
          <ul class="list">
            {g.items.map((w) => (
              <WorkoutRow w={w} units={units} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function CalendarView({ workouts, month, day, units }: { workouts: Workout[]; month: string; day?: string; units: Units }) {
  const today = todayKey();
  const first = `${month}-01`;
  const lead = (fromKey(first).getDay() + 6) % 7;
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const byDay = new Map<string, Workout[]>();
  for (const w of workouts) if (w.date.startsWith(month)) byDay.set(w.date, [...(byDay.get(w.date) ?? []), w]);
  const go = (m: string, d?: string) => navigate(href('/history', { view: 'calendar', month: m, day: d }), { replace: true });
  const selected = day && day.startsWith(month) ? day : undefined;
  const shown = selected ? byDay.get(selected) ?? [] : [...byDay.values()].flat();
  const thisMonth = today.slice(0, 7);

  return (
    <section class="stack-12" aria-label="Calendar">
      <div class="card calendar">
        <div class="calendar-head">
          <button type="button" class="icon-btn plain" aria-label="Previous month" onClick={() => go(addMonths(month, -1))}>
            <ChevronLeft />
          </button>
          <h2 class="section-title small" aria-live="polite">
            {monthLabel(month)}
          </h2>
          <button type="button" class="icon-btn plain" aria-label="Next month" disabled={month >= thisMonth} onClick={() => go(addMonths(month, 1))}>
            <ChevronRight />
          </button>
        </div>
        <div class="calendar-grid" role="grid" aria-label={monthLabel(month)}>
          <div role="row" class="calendar-row">
            {WEEKDAYS.map((d) => (
              <span role="columnheader" class="calendar-wd" aria-label={d}>
                {d.slice(0, 1)}
              </span>
            ))}
          </div>
          {Array.from({ length: Math.ceil((lead + daysInMonth) / 7) }, (_, week) => (
            <div role="row" class="calendar-row">
              {Array.from({ length: 7 }, (_, i) => {
                const n = week * 7 + i - lead + 1;
                if (n < 1 || n > daysInMonth) return <span role="gridcell" class="calendar-day empty" />;
                const key = toKey(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, n));
                const count = byDay.get(key)?.length ?? 0;
                return (
                  <span role="gridcell">
                    <button
                      type="button"
                      class={`calendar-day${count ? ' trained' : ''}${key === today ? ' today' : ''}${key === selected ? ' selected' : ''}`}
                      aria-label={`${shortDate(key)}${count ? `: ${plural(count, 'workout')}` : ''}`}
                      aria-pressed={key === selected}
                      disabled={key > today}
                      onClick={() => go(month, key === selected ? undefined : key)}
                    >
                      {n}
                    </button>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        <p class="muted small-text calendar-total">
          <Calendar size={16} /> {plural([...byDay.values()].flat().length, 'workout')} in {monthLabel(month).split(' ')[0]}
        </p>
      </div>
      <h2 class="list-label">{selected ? shortDate(selected) : monthLabel(month)}</h2>
      {shown.length ? (
        <ul class="list">
          {shown.map((w) => (
            <WorkoutRow w={w} units={units} />
          ))}
        </ul>
      ) : (
        <p class="list-empty card">{selected ? `No workout on ${shortDate(selected)}.` : 'No workouts this month.'}</p>
      )}
      {selected && selected < addDays(today, 1) && (
        <button type="button" class="link-btn left" onClick={() => go(month)}>
          Show the whole month
        </button>
      )}
    </section>
  );
}
