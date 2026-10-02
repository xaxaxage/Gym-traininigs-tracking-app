import type { ComponentType } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { LogType, Units } from '../lib/types';
import { prefFor, setPref, useData } from '../lib/store';
import { shortDate } from '../lib/dates';
import { exerciseById, useLibrary } from '../lib/library/load';
import { loadInstructions } from '../lib/library/instructions';
import { DATASET, EQUIPMENT_LABEL, LEVEL_LABEL, LOG_TYPE_LABEL, MUSCLE_LABEL, photoUrl, type Exercise } from '../lib/library/catalog';
import { exerciseSessions, progress, records, type Records, type Session } from '../lib/stats';
import { distanceUnit, fmtDistance, fmtDuration, fmtVolume, fmtWeight, fromKg, weightLabel } from '../lib/units';
import { fmtSet, plural } from '../lib/format';
import { motionOn } from '../lib/motion';
import { showToast } from '../lib/toast';
import { navigate } from '../lib/router';
import { ActionGroup, Loading, Sheet, SheetAction, TopBar } from '../components/Common';
import { Eye, EyeOff, More, Pencil, Star, Timer } from '../components/Icons';
import type { ChartProps } from '../components/ProgressChart';

const REST_CHOICES = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300];

/** An exercise: what it works and how, and your own history with it. */
export function ExerciseDetail({ id }: { id: string }) {
  const data = useData();
  const lib = useLibrary();
  const { units } = data.settings;
  const sessions = useMemo(() => exerciseSessions(data.workouts, id), [data.workouts, id]);
  const found = exerciseById(data, id);
  // An exercise no longer in the library (or a deleted custom one) still has its history.
  const fallback = sessions.length ? historyOnly(id, data.workouts) : undefined;
  const exercise = found ?? fallback;
  const pref = prefFor(id, data);
  const [menu, setMenu] = useState(false);
  const [restSheet, setRestSheet] = useState(false);

  if (!exercise) {
    if (lib.state === 'loading') return <Loading label="Loading exercise…" />;
    return (
      <main class="screen">
        <TopBar title="Exercise" />
        <div class="notice plain">That exercise isn't in the library anymore.</div>
      </main>
    );
  }

  const rest = pref.restSeconds;

  return (
    <>
      <main class="screen exercise-detail">
        <TopBar
          right={
            <div class="topbar-actions">
              <button
                type="button"
                class={`icon-btn${pref.favorite ? ' on' : ''}`}
                aria-pressed={pref.favorite}
                aria-label={pref.favorite ? 'Favorite. Remove from favorites' : 'Add to favorites'}
                onClick={() => setPref(id, { favorite: !pref.favorite })}
              >
                <Star filled={pref.favorite} />
              </button>
              <button type="button" class="icon-btn" aria-label="More" onClick={() => setMenu(true)}>
                <More />
              </button>
            </div>
          }
        />
        <header class="stack-8">
          <h1 class="page-title detail-title">{exercise.name}</h1>
          <ul class="tags" aria-label="About this exercise">
            <li>{EQUIPMENT_LABEL[exercise.equipment]}</li>
            {exercise.level && <li>{LEVEL_LABEL[exercise.level]}</li>}
            {exercise.mechanic && <li>{exercise.mechanic === 'compound' ? 'Compound' : 'Isolation'}</li>}
            <li>{LOG_TYPE_LABEL[exercise.logType]}</li>
            {exercise.custom && <li>Your exercise</li>}
            {pref.hidden && <li>Hidden</li>}
          </ul>
        </header>

        {exercise.images > 0 && <Photos id={exercise.id} name={exercise.name} count={exercise.images} />}

        <section class="page-section" aria-labelledby="muscles-title">
          <h2 id="muscles-title" class="sr-only">
            Muscles
          </h2>
          {exercise.primary.length > 0 ? (
            <div class="muscle-groups">
              <div>
                <h3 class="list-label">Works</h3>
                <ul class="tags strong">
                  {exercise.primary.map((m) => (
                    <li>{MUSCLE_LABEL[m]}</li>
                  ))}
                </ul>
              </div>
              {exercise.secondary.length > 0 && (
                <div>
                  <h3 class="list-label">Also</h3>
                  <ul class="tags">
                    {exercise.secondary.map((m) => (
                      <li>{MUSCLE_LABEL[m]}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p class="muted">No muscles set.</p>
          )}
        </section>
        <div class="group">
          <button type="button" class="setting setting-button" onClick={() => setRestSheet(true)}>
            <span class="setting-icon" aria-hidden="true">
              <Timer size={18} />
            </span>
            <span class="setting-label">Rest between sets</span>
            <span class="setting-value">{rest !== undefined ? fmtDuration(rest) : `Default · ${fmtDuration(data.settings.restSeconds)}`}</span>
          </button>
        </div>
        <History sessions={sessions} logType={exercise.logType} units={units} />

        {!exercise.custom && <Instructions id={exercise.id} />}

        {!exercise.custom && (
          <p class="field-hint">
            Description and photos from{' '}
            <a href={`https://github.com/${DATASET.repo}`} target="_blank" rel="noopener noreferrer">
              free-exercise-db
            </a>{' '}
            (public domain).
          </p>
        )}
      </main>

      <Sheet open={menu} onClose={() => setMenu(false)} title={exercise.name}>
        <ActionGroup>
        {exercise.custom && found && (
          <SheetAction icon={<Pencil />} label="Edit exercise" chevron onClick={() => (setMenu(false), navigate(`/exercise/${id}/edit`))} />
        )}
        <SheetAction icon={<Timer />} label="Rest time" onClick={() => (setMenu(false), setRestSheet(true))} />
        <SheetAction
          icon={pref.hidden ? <Eye /> : <EyeOff />}
          label={pref.hidden ? 'Show in the library again' : 'Hide from the library'}
          hint={pref.hidden ? undefined : "For exercises you never do. Your history stays, and Filters → Show hidden finds it."}
          onClick={() => {
            setPref(id, { hidden: !pref.hidden });
            setMenu(false);
            showToast(pref.hidden ? 'Shown in the library again' : 'Hidden from the library', { label: 'Undo', run: () => setPref(id, { hidden: pref.hidden }) });
          }}
        />
        </ActionGroup>
      </Sheet>

      <Sheet open={restSheet} onClose={() => setRestSheet(false)} title={`Rest after ${exercise.name}`}>
        <div class="rest-grid" role="radiogroup" aria-label="Rest time">
          <button type="button" role="radio" aria-checked={rest === undefined} class="pill rest-choice wide" onClick={() => (setPref(id, { restSeconds: undefined }), setRestSheet(false))}>
            Default ({fmtDuration(data.settings.restSeconds)})
          </button>
          {REST_CHOICES.map((s) => (
            <button type="button" role="radio" aria-checked={rest === s} class="pill rest-choice" onClick={() => (setPref(id, { restSeconds: s }), setRestSheet(false))}>
              {fmtDuration(s)}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

function historyOnly(id: string, workouts: { exercises: { exerciseId: string; name: string; logType: LogType }[] }[]): Exercise | undefined {
  for (const w of workouts) {
    const e = w.exercises.find((x) => x.exerciseId === id);
    if (e) return { id, name: e.name, primary: [], secondary: [], equipment: 'other', logType: e.logType, images: 0, aliases: [], custom: false };
  }
  return undefined;
}

/**
 * The dataset's two photos (start and end position). They load only here,
 * from the dataset's pinned commit; the service worker keeps the ones you've
 * seen for offline use. Everything works without them.
 */
function Photos({ id, name, count }: { id: string; name: string; count: number }) {
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [frame, setFrame] = useState(0);
  const flip = motionOn() && count > 1 && failed.size === 0;
  useEffect(() => {
    if (!flip) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % count), 1400);
    return () => clearInterval(t);
  }, [flip, count]);
  const frames = Array.from({ length: count }, (_, i) => i);
  if (failed.size === count) {
    return (
      <div class="photo-missing" role="note">
        Photos aren't available right now (they need a connection the first time).
      </div>
    );
  }
  return (
    <figure class={`photos${flip ? ' flipbook' : ''}`}>
      <div class="photo-frames">
        {frames.map((i) =>
          failed.has(i) ? null : (
            <img
              key={i}
              src={photoUrl(id, i)}
              alt={i === 0 ? `${name}: start position` : `${name}: end position`}
              loading="lazy"
              decoding="async"
              crossOrigin="anonymous"
              width={850}
              height={567}
              class={flip ? (i === frame ? 'shown' : 'behind') : ''}
              onError={() => setFailed((f) => new Set([...f, i]))}
            />
          ),
        )}
      </div>
      {flip && <figcaption class="field-hint">Start and end position, one after the other.</figcaption>}
    </figure>
  );
}

function Instructions({ id }: { id: string }) {
  const [steps, setSteps] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    loadInstructions(id)
      .then((s) => live && setSteps(s))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [id]);
  if (error) return <p class="field-hint">The instructions couldn't be loaded. Check your connection.</p>;
  if (!steps) return <Loading label="Loading instructions…" />;
  if (steps.length === 0) return null;
  return (
    <section class="page-section" aria-labelledby="how-title">
      <h2 id="how-title" class="section-title">
        How to do it
      </h2>
      <ol class="steps">
        {steps.map((s) => (
          <li>{s}</li>
        ))}
      </ol>
    </section>
  );
}

function History({ sessions, logType, units }: { sessions: Session[]; logType: LogType; units: Units }) {
  const r = useMemo(() => records(sessions), [sessions]);
  if (sessions.length === 0) {
    return (
      <section class="page-section" aria-labelledby="yours-title">
        <h2 id="yours-title" class="section-title">
          Your history
        </h2>
        <p class="notice info plain">Once you've done this exercise, your records, progress and recent sets show up here.</p>
      </section>
    );
  }
  const recent = [...sessions].reverse().slice(0, 6);
  return (
    <>
      <section class="card stack-12" aria-labelledby="records-title">
        <h2 id="records-title" class="section-title">
          Personal records
        </h2>
        <RecordTiles r={r} logType={logType} units={units} />
        {r.repsAtWeight.length > 1 && (logType === 'weight_reps' || logType === 'bodyweight') && (
          <div class="stack-4">
            <h3 class="list-label">Most reps at a weight</h3>
            <div class="table-wrap">
              <table class="data-table compact">
                <thead>
                  <tr>
                    <th scope="col">{logType === 'bodyweight' ? `Added (${units})` : `Weight (${units})`}</th>
                    <th scope="col">Reps</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {r.repsAtWeight.slice(0, 8).map((m) => (
                    <tr>
                      <td class="num">{fmtWeight(m.weight, units)}</td>
                      <td class="num">{m.value}</td>
                      <td>{shortDate(m.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {sessions.length >= 2 && <Progress sessions={sessions} logType={logType} units={units} />}

      <section class="page-section" aria-labelledby="recent-title">
        <h2 id="recent-title" class="section-title">
          Recent sets
        </h2>
        <ul class="list">
          {recent.map((s) => (
            <li>
              <a href={`#/workout/${s.workoutId}`} class="row">
                <span class="row-main">
                  <span class="row-title">{shortDate(s.date)}</span>
                  <span class="row-sub">{s.sets.map((x) => fmtSet(x, logType, units)).join(', ')}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function RecordTiles({ r, logType, units }: { r: Records; logType: LogType; units: Units }) {
  const tiles: { label: string; value: string; sub?: string }[] = [];
  const when = (d?: string) => (d ? shortDate(d) : undefined);
  if (logType === 'weight_reps') {
    if (r.bestE1rm) tiles.push({ label: 'Best est. 1-rep max', value: weightLabel(r.bestE1rm.value, units), sub: `${fmtWeight(r.bestE1rm.weight, units)} × ${r.bestE1rm.reps} · ${when(r.bestE1rm.date)}` });
    if (r.heaviest) tiles.push({ label: 'Heaviest weight', value: weightLabel(r.heaviest.value, units), sub: `× ${r.heaviest.reps} · ${when(r.heaviest.date)}` });
    if (r.bestVolume) tiles.push({ label: 'Most volume in a workout', value: fmtVolume(r.bestVolume.value, units), sub: when(r.bestVolume.date) });
    if (r.mostReps) tiles.push({ label: 'Most reps in a set', value: String(r.mostReps.value), sub: `at ${weightLabel(r.mostReps.weight, units)}` });
  } else if (logType === 'bodyweight') {
    if (r.mostReps) tiles.push({ label: 'Most reps in a set', value: String(r.mostReps.value), sub: when(r.mostReps.date) });
    if (r.heaviest) tiles.push({ label: 'Most added weight', value: `+${weightLabel(r.heaviest.value, units)}`, sub: `× ${r.heaviest.reps} · ${when(r.heaviest.date)}` });
    if (r.bestVolume) tiles.push({ label: 'Most added volume', value: fmtVolume(r.bestVolume.value, units), sub: when(r.bestVolume.date) });
  } else if (logType === 'duration') {
    if (r.longest) tiles.push({ label: 'Longest', value: fmtDuration(r.longest.value), sub: when(r.longest.date) });
  } else {
    const u = distanceUnit(logType, units);
    if (r.farthest) tiles.push({ label: 'Farthest', value: `${fmtDistance(r.farthest.value, logType, units)} ${u}`, sub: when(r.farthest.date) });
    if (logType === 'distance' && r.longest) tiles.push({ label: 'Longest', value: fmtDuration(r.longest.value), sub: when(r.longest.date) });
    if (logType === 'weight_distance' && r.heaviest) tiles.push({ label: 'Heaviest', value: weightLabel(r.heaviest.value, units), sub: when(r.heaviest.date) });
  }
  return (
    <dl class="record-tiles">
      {tiles.map((t) => (
        <div class="record-tile">
          <dt>{t.label}</dt>
          <dd>
            <span class="record-value">{t.value}</span>
            {t.sub && <span class="record-sub">{t.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type Range = 'all' | '1y' | '3m';
let Chart: ComponentType<ChartProps> | null = null;

/** Progress over time; the chart's code loads only when it's needed. */
function Progress({ sessions, logType, units }: { sessions: Session[]; logType: LogType; units: Units }) {
  const [ChartComponent, setChart] = useState(() => Chart);
  const [range, setRange] = useState<Range>('all');
  useEffect(() => {
    if (Chart) return;
    import('../components/ProgressChart').then((m) => {
      Chart = m.default;
      setChart(() => m.default);
    });
  }, []);
  const since = range === 'all' ? 0 : Date.now() - (range === '1y' ? 365 : 92) * 86_400_000;
  const points = progress(sessions).filter((p) => p.startedAt >= since);
  const kg = (v: number) => String(fromKg(v, units) >= 100 ? Math.round(fromKg(v, units)) : fromKg(v, units));
  let props: ChartProps;
  const base = { dates: points.map((p) => p.date), times: points.map((p) => p.startedAt) };
  if (logType === 'weight_reps') {
    props = {
      ...base,
      title: `Progress: best estimated 1-rep max and heaviest set per workout, in ${units}`,
      format: kg,
      series: [
        { key: 'e1rm', label: 'Best est. 1RM', color: 'series-1', values: points.map((p) => p.e1rm) },
        { key: 'top', label: 'Heaviest set', color: 'series-2', values: points.map((p) => p.top) },
      ],
    };
  } else if (logType === 'bodyweight') {
    props = { ...base, title: 'Progress: most reps in a set per workout', format: (v) => String(Math.round(v)), series: [{ key: 'reps', label: 'Most reps', color: 'series-1', values: points.map((p) => p.best) }] };
  } else if (logType === 'duration') {
    props = { ...base, title: 'Progress: longest set per workout', format: (v) => fmtDuration(v), series: [{ key: 'time', label: 'Longest', color: 'series-1', values: points.map((p) => p.best) }] };
  } else {
    const u = distanceUnit(logType, units);
    props = { ...base, title: `Progress: farthest set per workout, in ${u}`, format: (v) => fmtDistance(v, logType, units), series: [{ key: 'dist', label: `Farthest (${u})`, color: 'series-1', values: points.map((p) => p.best) }] };
  }
  return (
    <section class="card stack-12" aria-labelledby="progress-title">
      <div class="section-head">
        <h2 id="progress-title" class="section-title">
          Progress
        </h2>
        <div role="group" aria-label="Time range" class="segmented small">
          {(['3m', '1y', 'all'] as Range[]).map((r) => (
            <button type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
              {r === 'all' ? 'All' : r === '1y' ? '1 yr' : '3 mo'}
            </button>
          ))}
        </div>
      </div>
      <p class="field-hint">
        {logType === 'weight_reps'
          ? `Per workout, in ${units}. Estimated 1-rep max uses the Epley formula: weight × (1 + reps ÷ 30).`
          : plural(points.length, 'workout')}
      </p>
      {points.length < 2 ? (
        <p class="body-text">Not enough workouts in this period for a chart yet.</p>
      ) : ChartComponent ? (
        <ChartComponent {...props} />
      ) : (
        <Loading label="Loading chart…" />
      )}
    </section>
  );
}
