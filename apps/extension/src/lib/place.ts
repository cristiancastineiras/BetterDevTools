// The interface is scaled with CSS zoom (see app.css). Zoom multiplies `left`/`top`/`width` of an
// element, but pointer positions, getBoundingClientRect() and innerWidth are already in window
// pixels, so every value written back into a style has to be divided by the zoom first.

/** The current interface zoom (1 = no zoom). */
export const uiZoom = (): number => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;

/**
 * Puts a fixed-position element at window pixel (x, y), moved if needed so it stays fully inside
 * the window. Call after the element is shown, so its size is known.
 */
export function placeInWindow(element: HTMLElement, x: number, y: number): void {
  const zoom = uiZoom();
  const margin = 4;
  const box = element.getBoundingClientRect();
  element.style.left = `${Math.max(margin, Math.min(x, innerWidth - box.width - margin)) / zoom}px`;
  element.style.top = `${Math.max(margin, Math.min(y, innerHeight - box.height - margin)) / zoom}px`;
}
