import { tokenize, type Lang } from '@betterdevtools/core';
import { createMemo, For } from 'solid-js';
import { TOKEN_CLASS } from './CodeLines.tsx';
import { fieldClass, monoClass } from './styles.ts';

/** Above this size the text is shown without colours: tokenizing on every key would stall the panel. */
const HIGHLIGHT_MAX_CHARS = 200_000;

/**
 * A text editor with syntax colours: a transparent <textarea> typed into, over a coloured copy of
 * the same text that follows its scroll. Both use the same font, padding and line height, so the
 * coloured text sits exactly under what is typed.
 */
export default function CodeEditor(props: {
  value: string;
  lang: Lang;
  label: string;
  onInput: (value: string) => void;
  onKeyDown?: ((event: KeyboardEvent) => void) | undefined;
  placeholder?: string | undefined;
  class?: string | undefined;
}) {
  let mirror: HTMLPreElement | undefined;
  const coloured = () => props.lang !== 'plain' && props.value.length <= HIGHLIGHT_MAX_CHARS;
  const tokens = createMemo(() => (coloured() ? tokenize(props.value, props.lang) : []));
  const syncScroll = (area: HTMLTextAreaElement) => {
    if (!mirror) return;
    mirror.scrollTop = area.scrollTop;
    mirror.scrollLeft = area.scrollLeft;
  };

  return (
    <div class={[fieldClass, 'relative min-h-24 overflow-hidden p-0', props.class]}>
      <pre
        ref={(element) => (mirror = element)}
        aria-hidden="true"
        class={[monoClass, 'pointer-events-none absolute inset-0 m-0 overflow-hidden px-1.5 py-1 whitespace-pre']}
      >
        <For each={tokens()}>{([kind, text]) => <span class={TOKEN_CLASS[kind]}>{text}</span>}</For>
        {/* a final newline needs a character after it, or the mirror is one line shorter */}
        {props.value.endsWith('\n') ? ' ' : ''}
      </pre>
      <textarea
        aria-label={props.label}
        wrap="off"
        spellcheck={false}
        placeholder={props.placeholder}
        class={[
          monoClass,
          'relative block h-full min-h-24 w-full resize-none overflow-auto bg-transparent px-1.5 py-1 whitespace-pre caret-fg outline-none placeholder:text-fg-2',
          { 'text-transparent': coloured() },
        ]}
        value={props.value}
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
          syncScroll(event.currentTarget);
        }}
        onScroll={(event) => syncScroll(event.currentTarget)}
        onKeyDown={props.onKeyDown}
      />
    </div>
  );
}
