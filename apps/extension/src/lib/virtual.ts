// Solid binding for @tanstack/virtual-core: renders only the rows in (and near) the viewport.
import {
  elementScroll,
  measureElement,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
  type VirtualItem,
  type VirtualizerOptions,
} from '@tanstack/virtual-core';
import { createEffect, createSignal, onSettled, untrack } from 'solid-js';

export interface VirtualListOptions {
  /** Number of rows; re-read reactively. */
  count: () => number;
  /** The scrolling container (available after mount). */
  scrollElement: () => HTMLElement | undefined;
  /** Row height in px, exact for fixed rows or a first guess for measured rows. */
  estimateSize: number;
  /** Measure rendered rows (rows with wrapping text have different heights). */
  measured?: boolean;
  /** Extra rows rendered above and below the viewport. */
  overscan?: number;
  /** Space above the first row inside the scroll container (e.g. a sticky header). */
  paddingStart?: number;
}

export interface VirtualList {
  items: () => VirtualItem[];
  totalSize: () => number;
  scrollToIndex: (index: number, align?: 'auto' | 'center' | 'start') => void;
  /** Ref callback for measured rows; each row element needs `data-index`. */
  measure: (element: HTMLElement) => void;
}

export function createVirtualList(options: VirtualListOptions): VirtualList {
  // virtual-core notifies on scroll and on size changes; the version signal makes reads reactive.
  // ownedWrite: the library may notify while Solid runs an effect (e.g. a count change).
  const [version, setVersion] = createSignal(0, { ownedWrite: true });
  const notify = () => setVersion((v) => v + 1);

  const settings = (count: number): VirtualizerOptions<HTMLElement, HTMLElement> => ({
    count,
    getScrollElement: () => options.scrollElement() ?? null,
    estimateSize: () => options.estimateSize,
    overscan: options.overscan ?? 10,
    paddingStart: options.paddingStart ?? 0,
    scrollPaddingStart: options.paddingStart ?? 0,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...(options.measured ? { measureElement } : {}),
    onChange: notify,
  });

  const virtualizer = new Virtualizer(settings(untrack(options.count)));

  createEffect(options.count, (count) => {
    virtualizer.setOptions(settings(count));
    virtualizer._willUpdate();
    notify();
  });

  onSettled(() => {
    const unmount = virtualizer._didMount();
    virtualizer._willUpdate();
    notify();
    return unmount;
  });

  return {
    items: () => {
      version();
      return virtualizer.getVirtualItems();
    },
    totalSize: () => {
      version();
      return virtualizer.getTotalSize();
    },
    scrollToIndex: (index, align = 'auto') => virtualizer.scrollToIndex(index, { align }),
    measure: (element) => queueMicrotask(() => virtualizer.measureElement(element)),
  };
}
