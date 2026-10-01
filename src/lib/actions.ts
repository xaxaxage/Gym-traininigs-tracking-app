import type { Routine, Workout } from './types';
import { activeWorkout, deleteWorkout, finishedWorkouts, getData, getWorkout, putWorkout } from './store';
import { emptyWorkout, finishWorkout, fromRoutine, isStale } from './workout';
import { navigate } from './router';
import { getRest, stopRest } from './timer';
import { showToast } from './toast';

/** Things screens do that touch more than one part of the app. */

/** Start a workout (from a routine, or empty) and open it. */
export function startWorkout(routine?: Routine): Workout {
  const now = Date.now();
  const w = routine ? fromRoutine(routine, finishedWorkouts(getData()), now) : emptyWorkout(now);
  const saved = putWorkout(w);
  stopRest();
  navigate('/workout');
  return saved;
}

function stopRestFor(id: string) {
  if (getRest()?.workoutId === id) stopRest();
}

/** Finish a workout in progress and show its summary. Without anything done, it's discarded. */
export function finish(id: string = activeWorkout()?.id ?? ''): Workout | null {
  const w = getWorkout(id);
  if (!w || w.endedAt) return null;
  // A workout forgotten for hours ends at its last change, not now.
  const end = isStale(w) ? w.updatedAt : Date.now();
  const done = finishWorkout(w, end);
  stopRestFor(id);
  if (done.exercises.length === 0) {
    deleteWorkout(w.id);
    showToast('Nothing was logged, so the workout was discarded', undefined, { carry: true });
    navigate('/', { replace: true });
    return null;
  }
  const saved = putWorkout(done);
  navigate(`/summary/${saved.id}`, { replace: true });
  return saved;
}

export const finishActive = () => finish();

/** Throw away a workout in progress (with Undo). */
export function discard(id: string = activeWorkout()?.id ?? '', { undo = true } = {}) {
  const w = getWorkout(id);
  if (!w) return;
  deleteWorkout(w.id);
  stopRestFor(id);
  const restore = {
    label: 'Undo',
    run: () => {
      putWorkout(w);
      navigate(w.endedAt ? `/workout/${w.id}` : '/workout');
    },
  };
  showToast(w.endedAt ? 'Workout deleted' : 'Workout discarded', undo ? restore : undefined, { carry: true });
  navigate(w.endedAt ? '/history' : '/', { replace: true });
}

export const discardActive = (opts?: { undo?: boolean }) => discard(undefined, opts);
