/** Shared by the app's sync engine and the Claude connector. */

/** Resolves true as soon as one relay accepted the event, false when every one refused or timed out. */
export function firstAccepted(sent: Promise<unknown>[]): Promise<boolean> {
  return new Promise((resolve) => {
    let left = sent.length;
    if (left === 0) resolve(false);
    for (const p of sent) p.then(() => resolve(true), () => --left === 0 && resolve(false));
  });
}
