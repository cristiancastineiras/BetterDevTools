import { createMemo, createSignal, createUniqueId, For } from 'solid-js';
import { placeInWindow, uiZoom } from '../../lib/place.ts';
import { fieldClass, monoClass } from './styles.ts';

const MAX_SUGGESTIONS = 8;

/**
 * A text field with a custom list of suggestions (a combobox): free text is always allowed, the
 * list only helps. Arrow keys move, Enter or a click picks, Escape closes.
 */
export default function SuggestInput(props: {
  value: string;
  onInput: (value: string) => void;
  suggestions: readonly string[];
  label: string;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  class?: string | undefined;
  onKeyDown?: ((event: KeyboardEvent) => void) | undefined;
}) {
  const listId = createUniqueId();
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;
  const [isOpen, setIsOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);

  const matches = createMemo(() => {
    const typed = props.value.trim().toLowerCase();
    const found = props.suggestions.filter((name) => name.toLowerCase() !== typed && name.toLowerCase().includes(typed));
    return found.sort((a, b) => Number(b.toLowerCase().startsWith(typed)) - Number(a.toLowerCase().startsWith(typed))).slice(0, MAX_SUGGESTIONS);
  });

  function open() {
    if (!matches().length || props.disabled) return close();
    setIsOpen(true);
    if (!list.matches(':popover-open')) list.showPopover();
    const box = input.getBoundingClientRect();
    list.style.minWidth = `${box.width / uiZoom()}px`;
    placeInWindow(list, box.left, box.bottom + 2);
  }

  function close() {
    setIsOpen(false);
    if (list?.matches(':popover-open')) list.hidePopover();
  }

  function choose(name: string) {
    props.onInput(name);
    close();
  }

  function onKeyDown(event: KeyboardEvent) {
    const shown = isOpen() && matches().length > 0;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!shown) {
        setActive(0);
        open();
      } else {
        setActive((active() + (event.key === 'ArrowDown' ? 1 : -1) + matches().length) % matches().length);
      }
    } else if (event.key === 'Enter' && shown) {
      event.preventDefault();
      choose(matches()[active()] ?? matches()[0]!);
    } else if (event.key === 'Escape' && shown) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else {
      props.onKeyDown?.(event);
    }
  }

  return (
    <>
      <input
        ref={(element) => (input = element)}
        class={[fieldClass, monoClass, props.class]}
        role="combobox"
        aria-label={props.label}
        aria-expanded={isOpen() ? 'true' : 'false'}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={isOpen() ? `${listId}-${active()}` : undefined}
        autocomplete="off"
        spellcheck={false}
        placeholder={props.placeholder}
        disabled={Boolean(props.disabled)}
        value={props.value}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
          setActive(0);
          queueMicrotask(open);
        }}
        onFocus={() => queueMicrotask(open)}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      <div
        ref={(element) => (list = element)}
        id={listId}
        popover="manual"
        role="listbox"
        aria-label={props.label}
        class="fixed inset-auto m-0 max-h-[min(14rem,calc(var(--vh)*0.5))] max-w-[calc(var(--vw)-8px)] overflow-auto rounded-md border border-line bg-bg p-0.5 text-fg shadow-lg"
      >
        <For each={matches()} keyed={false}>
          {(name, index) => (
            <div
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active() ? 'true' : 'false'}
              class={['cursor-pointer truncate rounded-sm px-2 py-0.5', monoClass, { 'bg-sel': index === active() }]}
              // mousedown, not click: the field must keep focus, or its blur closes the list first
              onMouseDown={(event) => {
                event.preventDefault();
                choose(name());
              }}
              onPointerMove={() => setActive(index)}
            >
              {name()}
            </div>
          )}
        </For>
      </div>
    </>
  );
}
