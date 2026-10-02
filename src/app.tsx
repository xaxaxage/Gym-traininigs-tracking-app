import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { activeWorkout, getData, getRoutine, getSaveError, getWorkout, useData } from './lib/store';
import { toastNavigated } from './lib/toast';
import { isMonthKey, todayKey } from './lib/dates';
import { goBack, takeScrollToTop, useRoute } from './lib/router';
import { ToastHost } from './components/Common';
import { ChevronLeft } from './components/Icons';
import { Train } from './screens/Train';
import { WorkoutScreen } from './screens/Workout';
import { Summary } from './screens/Summary';
import { RoutineEditor } from './screens/RoutineEditor';
import { Library, type PickTarget } from './screens/Library';
import { ExerciseDetail } from './screens/ExerciseDetail';
import { CustomExerciseEditor } from './screens/CustomExercise';
import { History } from './screens/History';
import { WorkoutView } from './screens/WorkoutView';
import { isSettingsPage, Settings } from './screens/Settings';

function Missing({ message, home = '/' }: { message: string; home?: string }) {
  return (
    <main class="screen missing">
      <header class="topbar">
        <button type="button" class="icon-btn ink" aria-label="Back" onClick={() => goBack(home)}>
          <ChevronLeft />
        </button>
        <span class="spacer-44" />
      </header>
      <div class="notice plain">
        <span>
          {message} <a href="#/">Go to Train</a>
        </span>
      </div>
    </main>
  );
}

function pickTarget(q: URLSearchParams): PickTarget | null {
  const to = q.get('to') ?? '';
  const swap = q.get('swap') ?? undefined;
  if (to === 'active') return { kind: 'workout', workoutId: activeWorkout()?.id ?? '', swap };
  const [kind, id] = to.split(':');
  if (kind === 'workout' && id) return { kind: 'workout', workoutId: id, swap };
  if (kind === 'routine' && id) return { kind: 'routine', routineId: id, swap };
  return null;
}

export function App() {
  const route = useRoute();
  useData();
  const saveError = getSaveError();
  useEffect(() => toastNavigated(), [route.path]);
  // A newly opened screen starts at the top; going back keeps the browser's restored position.
  useLayoutEffect(() => {
    if (takeScrollToTop()) window.scrollTo(0, 0);
  }, [route.raw]);

  // An app left open overnight should move on to the new day when it comes back.
  const [, setWake] = useState(0);
  useEffect(() => {
    const wake = () => document.visibilityState === 'visible' && setWake((n) => n + 1);
    document.addEventListener('visibilitychange', wake);
    return () => document.removeEventListener('visibilitychange', wake);
  }, []);

  const { segments, query } = route;
  let screen;
  let low = true;
  switch (segments[0] ?? '') {
    case '':
      screen = <Train />;
      low = false;
      break;
    case 'workout': {
      if (!segments[1]) {
        const active = activeWorkout();
        screen = active ? <WorkoutScreen workout={active} /> : <Missing message="There's no workout in progress." />;
      } else {
        const w = getWorkout(segments[1]);
        if (!w) screen = <Missing message="That workout was deleted." home="/history" />;
        else if (!w.endedAt) screen = <WorkoutScreen workout={w} />;
        else if (segments[2] === 'edit') screen = <WorkoutScreen workout={w} />;
        else screen = <WorkoutView workout={w} />;
      }
      break;
    }
    case 'summary': {
      const w = segments[1] ? getWorkout(segments[1]) : undefined;
      screen = w?.endedAt ? <Summary workout={w} /> : <Missing message="That workout was deleted." />;
      break;
    }
    case 'routine': {
      const r = segments[1] ? getRoutine(segments[1]) : undefined;
      screen = r ? <RoutineEditor routine={r} /> : <Missing message="That routine was deleted." />;
      break;
    }
    case 'exercises':
      if (segments[1] === 'pick') {
        const target = pickTarget(query);
        screen = target ? <Library pick={target} initialQuery={query.get('q') ?? ''} /> : <Missing message="Page not found." />;
      } else {
        screen = <Library initialQuery={query.get('q') ?? ''} />;
        low = false;
      }
      break;
    case 'exercise':
      if (segments[1] === 'new') screen = <CustomExerciseEditor initialName={query.get('name') ?? ''} pickTo={query.get('to') ?? ''} />;
      else if (segments[1] && segments[2] === 'edit') {
        const custom = getData().customExercises.find((c) => c.id === segments[1]);
        screen = custom ? <CustomExerciseEditor exercise={custom} /> : <Missing message="That exercise was deleted." />;
      } else if (segments[1]) screen = <ExerciseDetail id={segments[1]} />;
      else screen = <Missing message="Page not found." />;
      break;
    case 'history': {
      const month = query.get('month');
      screen = (
        <History
          view={query.get('view') === 'calendar' ? 'calendar' : 'list'}
          month={isMonthKey(month) ? month : todayKey().slice(0, 7)}
          day={query.get('day') ?? undefined}
        />
      );
      low = false;
      break;
    }
    case 'settings':
      if (!segments[1]) screen = <Settings />;
      else if (isSettingsPage(segments[1])) screen = <Settings page={segments[1]} />;
      else screen = <Missing message="Page not found." home="/settings" />;
      break;
    default:
      screen = <Missing message="Page not found." />;
  }

  return (
    <>
      <div key={route.path} class="screen-host">
        {screen}
      </div>
      {saveError && (
        <div class="save-error" role="alert">
          {saveError}
        </div>
      )}
      <ToastHost low={low} />
    </>
  );
}
