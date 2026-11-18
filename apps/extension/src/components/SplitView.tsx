import type { JSX } from '@solidjs/web';
import { createSignal, onSettled, Show } from 'solid-js';

/** Below this width the panes are stacked (list above, details below). */
const STACK_BELOW_PX = 640;
const MIN_FRACTION = 0.2;
const MAX_FRACTION = 0.85;
const KEYBOARD_STEP = 0.02;

const clampFraction = (fraction: number) => Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, fraction));

/**
 * Two panes with a draggable separator. `fraction` is the share of the second pane; dragging
 * (or the arrow keys on the focused separator) changes it live and reports the final value
 * through `onResize` when the drag ends. Narrow panels stack the panes vertically.
 */
export default function SplitView(props: {
  first: JSX.Element;
  second: JSX.Element;
  /** Without a second pane the first one takes the whole space. */
  showSecond: boolean;
  fraction: number;
  onResize: (fraction: number) => void;
  /** Accessible name of the separator. */
  label: string;
}) {
  let container: HTMLDivElement | undefined;
  const [liveFraction, setLiveFraction] = createSignal(() => props.fraction);
  const [stacked, setStacked] = createSignal(false);

  onSettled(() => {
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setStacked((entry?.contentRect.width ?? Infinity) < STACK_BELOW_PX));
    observer.observe(container);
    return () => observer.disconnect();
  });

  /** Share of the second pane for a pointer position. */
  function fractionAt(event: PointerEvent): number {
    const box = container!.getBoundingClientRect();
    return stacked() ? (box.bottom - event.clientY) / box.height : (box.right - event.clientX) / box.width;
  }

  function startDrag(event: PointerEvent) {
    if (event.button !== 0 || !container) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    let latest = liveFraction();
    const onMove = (move: PointerEvent) => {
      latest = clampFraction(fractionAt(move));
      setLiveFraction(latest);
    };
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      props.onResize(latest);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('lostpointercapture', onEnd, { once: true });
  }

  function onKeyDown(event: KeyboardEvent) {
    // the second pane grows towards the start: Left/Up make it larger
    const step = { ArrowLeft: KEYBOARD_STEP, ArrowUp: KEYBOARD_STEP, ArrowRight: -KEYBOARD_STEP, ArrowDown: -KEYBOARD_STEP }[event.key];
    const target =
      event.key === 'Home' ? MAX_FRACTION : event.key === 'End' ? MIN_FRACTION : step === undefined ? undefined : liveFraction() + step;
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const next = clampFraction(target);
    setLiveFraction(next);
    props.onResize(next);
  }

  return (
    <div ref={(element) => (container = element)} class={['flex min-h-0 min-w-0 flex-1', stacked() ? 'flex-col' : 'flex-row']}>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">{props.first}</div>
      <Show when={props.showSecond}>
        <div
          role="separator"
          tabindex="0"
          aria-label={props.label}
          aria-orientation={stacked() ? 'horizontal' : 'vertical'}
          aria-valuemin={Math.round(MIN_FRACTION * 100)}
          aria-valuemax={Math.round(MAX_FRACTION * 100)}
          aria-valuenow={Math.round(liveFraction() * 100)}
          class={[
            'group relative z-10 flex shrink-0 touch-none items-center justify-center bg-line hover:bg-accent focus-visible:bg-accent',
            stacked()
              ? 'h-px cursor-row-resize before:absolute before:inset-x-0 before:-inset-y-1'
              : 'w-px cursor-col-resize before:absolute before:inset-y-0 before:-inset-x-1',
          ]}
          onPointerDown={startDrag}
          onKeyDown={onKeyDown}
        />
        <div class="flex min-h-0 min-w-0 flex-col" style={{ 'flex-basis': `${liveFraction() * 100}%` }}>
          {props.second}
        </div>
      </Show>
    </div>
  );
}
