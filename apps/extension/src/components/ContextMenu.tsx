import { createEffect, For } from 'solid-js';
import { t } from '../i18n/index.ts';
import { placeInWindow } from '../lib/place.ts';
import { contextMenu, setContextMenu, type MenuItem } from '../state/ui.ts';

/**
 * The panel's one context menu (a popover), opened with openContextMenu(). Arrow keys, Home and
 * End move; Escape or Tab close it and focus returns to where it was opened from.
 */
export default function ContextMenu() {
  let menu: HTMLDivElement | undefined;
  let returnFocusTo: Element | null = null;

  createEffect(contextMenu, (request) => {
    if (!request || !menu) return;
    returnFocusTo = document.activeElement;
    menu.showPopover();
    // open at the pointer, kept inside the panel
    placeInWindow(menu, request.x, request.y);
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  });

  function restoreFocus() {
    if (returnFocusTo instanceof HTMLElement) returnFocusTo.focus({ preventScroll: true });
  }

  function onToggle(event: ToggleEvent) {
    if (event.newState !== 'closed') return;
    if (menu?.contains(document.activeElement) || document.activeElement === document.body) restoreFocus();
    setContextMenu(null);
  }

  function run(item: MenuItem) {
    restoreFocus();
    menu?.hidePopover();
    item.run();
  }

  // keys handled here do not reach the list shortcuts underneath
  function onKeyDown(event: KeyboardEvent) {
    if (!menu) return;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current = items.findIndex((button) => button === document.activeElement);
    const target = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: items.length - 1 }[event.key];
    if (target !== undefined) {
      items[(target + items.length) % items.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      restoreFocus();
      menu.hidePopover();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      ref={(element) => (menu = element)}
      popover="auto"
      role="menu"
      tabindex="-1"
      aria-label={contextMenu()?.label ?? t('menu.requestActions')}
      class="fixed inset-auto m-0 max-h-[calc(var(--vh)*0.8)] max-w-[calc(var(--vw)-8px)] min-w-52 overflow-auto rounded-md border border-line bg-bg p-1 text-fg shadow-lg"
      onToggle={onToggle}
      onKeyDown={onKeyDown}
    >
      <For each={contextMenu()?.items ?? []} keyed={false}>
        {(item) => (
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="block w-full cursor-pointer rounded-sm px-2 py-1 text-start hover:bg-bg-3 focus:bg-sel focus:outline-none disabled:cursor-default disabled:opacity-50"
            disabled={Boolean(item().disabled)}
            onPointerMove={(event) => event.currentTarget.focus({ preventScroll: true })}
            onClick={() => run(item())}
          >
            {item().label}
          </button>
        )}
      </For>
    </div>
  );
}
