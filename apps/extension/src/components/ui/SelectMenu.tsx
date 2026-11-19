import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import { listboxKey, type ListOption } from '../../lib/listbox.ts';
import { uiZoom } from '../../lib/place.ts';
import Icon from './Icon.tsx';
import { buttonClass } from './styles.ts';

/**
 * Accessible replacement for <select>: a button that opens a popover listbox. Arrow keys,
 * Home/End, typeahead, Enter/Space to choose and Escape to close; focus returns to the button.
 */
export default function SelectMenu(props: {
  value: string;
  options: ListOption[];
  /** Accessible name; the button announces "<label>: <selected option>". */
  label: string;
  disabled?: boolean | undefined;
  onChange: (value: string) => void;
  /** Extra classes for the trigger button (e.g. a width). */
  class?: string | undefined;
}) {
  const listId = createUniqueId();
  let trigger!: HTMLButtonElement;
  let listbox!: HTMLDivElement;
  const [isOpen, setIsOpen] = createSignal(false);
  const [activeIndex, setActiveIndexSignal] = createSignal(-1);
  // keyboard handlers need the index right away, before the signal flushes
  let currentIndex = -1;
  let typedText = '';
  let typedTimer: ReturnType<typeof setTimeout> | undefined;
  const selected = createMemo(() => props.options.find((option) => option.value === props.value));
  const optionId = (index: number) => `${listId}-option-${index}`;

  function setActiveIndex(index: number) {
    currentIndex = index;
    setActiveIndexSignal(index);
    queueMicrotask(() => document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' }));
  }

  // Positioned from script: CSS anchor positioning is not available in Firefox.
  function placeBelowTrigger(event: ToggleEvent) {
    if (event.newState !== 'open') return;
    const box = trigger.getBoundingClientRect();
    listbox.style.minWidth = `${box.width / uiZoom()}px`;
    listbox.style.left = `${box.left / uiZoom()}px`;
    listbox.style.top = `${(box.bottom + 2) / uiZoom()}px`;
  }

  function onToggle(event: ToggleEvent) {
    const opened = event.newState === 'open';
    setIsOpen(opened);
    if (opened) {
      // flip above the button or shift left when the list would leave the panel
      const anchor = trigger.getBoundingClientRect();
      const list = listbox.getBoundingClientRect();
      if (list.bottom > innerHeight - 4 && anchor.top > innerHeight - anchor.bottom)
        listbox.style.top = `${Math.max(4, anchor.top - list.height - 2) / uiZoom()}px`;
      if (list.right > innerWidth - 4) listbox.style.left = `${Math.max(4, innerWidth - list.width - 4) / uiZoom()}px`;
      setActiveIndex(
        Math.max(
          0,
          props.options.findIndex((option) => option.value === props.value),
        ),
      );
      listbox.focus({ preventScroll: true });
    } else if (listbox.contains(document.activeElement) || document.activeElement === document.body) {
      trigger.focus();
    }
  }

  function choose(index: number) {
    const option = props.options[index];
    if (!option || option.disabled) return;
    setIsOpen(false);
    listbox.hidePopover();
    if (option.value !== props.value) props.onChange(option.value);
  }

  function onListKeyDown(event: KeyboardEvent) {
    if (event.key === 'Tab') {
      listbox.hidePopover();
      return;
    }
    event.stopPropagation(); // list keys never reach the panel's shortcuts
    if (event.key === 'Escape') {
      event.preventDefault();
      listbox.hidePopover();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(currentIndex);
    } else {
      const next = listboxKey(event.key, currentIndex, props.options, typedText);
      if (!next) return;
      event.preventDefault();
      setActiveIndex(next.index);
      typedText = next.typed;
      clearTimeout(typedTimer);
      typedTimer = setTimeout(() => (typedText = ''), 600);
    }
  }

  function onTriggerKeyDown(event: KeyboardEvent) {
    // the DOM state, not the signal: the signal follows the asynchronous toggle event
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !listbox.matches(':popover-open')) {
      event.preventDefault();
      listbox.showPopover();
    }
  }

  return (
    <>
      <button
        ref={(element) => (trigger = element)}
        type="button"
        class={[buttonClass(), 'max-w-80 min-w-28 justify-between', props.class]}
        popovertarget={`${listId}-list`}
        aria-haspopup="listbox"
        aria-expanded={isOpen() ? 'true' : 'false'}
        aria-controls={`${listId}-list`}
        aria-label={`${props.label}: ${selected()?.label ?? t('common.none')}`}
        title={props.label}
        disabled={Boolean(props.disabled)}
        onKeyDown={onTriggerKeyDown}
      >
        <span class="min-w-0 flex-1 truncate text-left">{selected()?.label ?? t('common.choose')}</span>
        <Icon name="chevron-down" />
      </button>
      <div
        ref={(element) => (listbox = element)}
        id={`${listId}-list`}
        popover="auto"
        role="listbox"
        aria-label={props.label}
        tabindex="-1"
        aria-activedescendant={isOpen() && activeIndex() >= 0 ? optionId(activeIndex()) : undefined}
        class="fixed inset-auto m-0 max-h-[min(18rem,calc(var(--vh)*0.6))] max-w-[calc(var(--vw)-8px)] overflow-auto rounded-md border border-line bg-bg p-0.5 text-fg shadow-lg"
        onKeyDown={onListKeyDown}
        onBeforeToggle={placeBelowTrigger}
        onToggle={onToggle}
      >
        <For each={props.options} keyed={false}>
          {(option, index) => (
            <div
              id={optionId(index)}
              role="option"
              aria-selected={option().value === props.value ? 'true' : 'false'}
              aria-disabled={option().disabled ? 'true' : undefined}
              class={[
                'flex cursor-pointer items-start gap-1.5 rounded-sm py-0.5 ps-1 pe-2',
                { 'bg-sel': index === activeIndex(), 'cursor-default opacity-50': Boolean(option().disabled) },
              ]}
              onClick={() => choose(index)}
              onPointerMove={() => !option().disabled && setActiveIndex(index)}
            >
              <span class="inline-flex w-4 shrink-0">
                <Show when={option().value === props.value}>
                  <Icon name="check" />
                </Show>
              </span>
              <span class="min-w-0">
                <span class="block truncate">{option().label}</span>
                <Show when={option().description}>
                  <span class="block text-small text-fg-2">{option().description}</span>
                </Show>
              </span>
            </div>
          )}
        </For>
      </div>
    </>
  );
}
