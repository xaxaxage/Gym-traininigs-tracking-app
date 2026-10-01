/** When and from which commit this build was made, e.g. "2026-09-24 18:05 · 1a2b3c4". */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** The shared Claude connector's host, e.g. "gym.xaxaxage.vercel.app" (see src/lib/connector.ts). */
  readonly VITE_CONNECTOR_HOST?: string;
}

/** Every exercise in the library, without instructions (built by plugins/exercise-library.ts). */
declare module 'virtual:exercise-library' {
  const exercises: import('./lib/library/catalog').CompactExercise[];
  export default exercises;
}

/** Step-by-step instructions by exercise id. */
declare module 'virtual:exercise-instructions' {
  const instructions: Record<string, string[]>;
  export default instructions;
}
