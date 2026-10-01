/** Step-by-step instructions: their own chunk, loaded only on an exercise's page (and never by the Claude connector). */

let instructions: Record<string, string[]> | null = null;

export async function loadInstructions(id: string): Promise<string[]> {
  instructions ??= (await import('virtual:exercise-instructions')).default;
  return instructions[id] ?? [];
}
