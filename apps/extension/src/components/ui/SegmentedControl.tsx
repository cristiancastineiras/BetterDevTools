import { For } from 'solid-js';

/** A radio group drawn as joined buttons; arrow keys move and select, wrapping at the ends. */
export default function SegmentedControl<T extends string>(props: {
  options: readonly { value: T; label: string; title?: string | undefined }[];
  value: T;
  label: string;
  onChange: (value: T) => void;
}) {
  let group!: HTMLDivElement;

  function onKeyDown(event: KeyboardEvent) {
    const options = props.options;
    const current = options.findIndex((o) => o.value === props.value);
    const target = {
      ArrowRight: current + 1,
      ArrowDown: current + 1,
      ArrowLeft: current - 1,
      ArrowUp: current - 1,
      Home: 0,
      End: options.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const option = options[(target + options.length) % options.length];
    if (!option) return;
    props.onChange(option.value);
    group.querySelector<HTMLElement>(`[data-value="${option.value}"]`)?.focus();
  }

  return (
    <div
      ref={(element) => (group = element)}
      role="radiogroup"
      aria-label={props.label}
      tabindex="-1"
      class="inline-flex overflow-hidden rounded-md border border-line"
      onKeyDown={onKeyDown}
    >
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            aria-checked={option.value === props.value ? 'true' : 'false'}
            tabindex={option.value === props.value ? 0 : -1}
            title={option.title}
            data-value={option.value}
            class={[
              'min-h-5.5 cursor-pointer px-2 not-first:border-s not-first:border-line motion-safe:transition-colors motion-safe:duration-100',
              option.value === props.value ? 'bg-sel text-fg' : 'text-fg-2 hover:bg-bg-3',
            ]}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
