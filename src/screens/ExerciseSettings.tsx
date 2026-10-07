import { useData } from '../lib/store';
import { plural } from '../lib/format';
import { ChevronRight } from '../components/Icons';

/** Which exercises to pick from, and the AI that adds your own. */
export function ExerciseSettings() {
  const data = useData();
  return (
    <div class="group">
      <a class="setting" href="#/exercises">
        <span class="setting-label">
          Exercise list
          <span class="muted">{plural(data.customExercises.length, 'own exercise')}</span>
        </span>
        <ChevronRight size={18} />
      </a>
    </div>
  );
}
