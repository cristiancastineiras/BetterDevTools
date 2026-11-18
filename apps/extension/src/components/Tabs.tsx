import type { JSX } from '@solidjs/web';
import { createUniqueId, For, Show } from 'solid-js';

/**
 * Tab strip with one panel. Arrow keys, Home and End move between tabs (and select them),
 * following the ARIA tabs pattern; `end` holds extra buttons on the right of the strip.
 */
export default function Tabs<T extends string>(props: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  end?: JSX.Element;
  /** Extra classes for the panel, e.g. to make it a flex column instead of a scroller. */
  panelClass?: string | undefined;
  children: JSX.Element;
}) {
  const idPrefix = createUniqueId();
  const tabId = (id: T) => `${idPrefix}-${id}`;

  function onKeyDown(event: KeyboardEvent) {
    const tabs = props.tabs;
    const current = tabs.findIndex((tab) => tab.id === props.value);
    const target = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const next = tabs[(target + tabs.length) % tabs.length]!.id;
    props.onChange(next);
    document.getElementById(tabId(next))?.focus();
  }

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex min-h-7 items-stretch border-b border-line bg-bg-2">
        <div role="tablist" aria-label={props.label} class="flex min-w-0 flex-wrap" onKeyDown={onKeyDown}>
          <For each={props.tabs}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                id={tabId(tab.id)}
                aria-selected={props.value === tab.id ? 'true' : 'false'}
                aria-controls={`${idPrefix}-panel`}
                tabindex={props.value === tab.id ? 0 : -1}
                class={[
                  'relative cursor-pointer px-3 py-1 whitespace-nowrap hover:bg-bg-3',
                  props.value === tab.id
                    ? 'text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent'
                    : 'text-fg-2',
                ]}
                onClick={() => props.onChange(tab.id)}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>
        <Show when={props.end}>
          <div class="ms-auto flex items-center gap-1 px-1">{props.end}</div>
        </Show>
      </div>
      <div
        role="tabpanel"
        id={`${idPrefix}-panel`}
        aria-labelledby={tabId(props.value)}
        class={['min-h-0 flex-1', props.panelClass ?? 'overflow-auto']}
        tabindex="0"
      >
        {props.children}
      </div>
    </div>
  );
}
