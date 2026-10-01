/**
 * After adding or swapping an exercise, the screen it returns to scrolls that
 * exercise into view (the browser would otherwise restore the old position).
 */
let pending: string | null = null;

export function requestScrollTo(id: string | undefined) {
  pending = id ?? null;
}

/** Scroll to the element for the pending id, once, after the screen has drawn. */
export function scrollToPending(elementId: (id: string) => string) {
  const id = pending;
  pending = null;
  if (!id) return;
  setTimeout(() => {
    const el = document.getElementById(elementId(id));
    el?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, 60);
}
