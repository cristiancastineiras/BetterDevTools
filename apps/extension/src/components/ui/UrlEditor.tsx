import { createEffect, createSignal, onSettled, Show } from 'solid-js';
import type { UrlEditorHandle, UrlEditorVariable } from '../../lib/url-editor.ts';
import { fieldClass, monoClass } from './styles.ts';

export type { UrlEditorVariable };

/**
 * The URL field of Replay: a one-line CodeMirror editor that colours the URL as it is typed, marks
 * unknown {{variables}} and offers the environment's variables after "{{". Enter (and Ctrl+Enter)
 * send. The editor code is loaded the first time this field appears; until then the text is shown
 * as plain text in the same box.
 */
export default function UrlEditor(props: {
  value: string;
  onInput: (value: string) => void;
  /** Enter or Ctrl+Enter: send the request. */
  onSubmit: () => void;
  label: string;
  placeholder?: string | undefined;
  /** The active environment's variables. */
  variables: () => readonly UrlEditorVariable[];
}) {
  let host: HTMLDivElement | undefined;
  let editor: UrlEditorHandle | undefined;
  const [ready, setReady] = createSignal(false);

  onSettled(() => {
    const target = host;
    if (!target) return;
    let gone = false;
    void import('../../lib/url-editor.ts').then(({ createUrlEditor }) => {
      if (gone) return;
      editor = createUrlEditor(target, {
        value: props.value,
        label: props.label,
        placeholder: props.placeholder ?? '',
        variables: props.variables(),
        onInput: (value) => props.onInput(value),
        onSubmit: () => props.onSubmit(),
      });
      setReady(true);
    });
    return () => {
      gone = true;
      editor?.destroy();
      editor = undefined;
    };
  });

  createEffect(
    () => props.value,
    (value) => editor?.setValue(value),
  );
  createEffect(
    () => props.variables(),
    (list) => editor?.setVariables(list),
  );
  createEffect(
    () => `${props.label}\n${props.placeholder ?? ''}`,
    () => editor?.setText(props.label, props.placeholder ?? ''),
  );

  return (
    <div
      class={[
        fieldClass,
        monoClass,
        'relative flex min-w-0 flex-1 items-center p-0 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
      ]}
    >
      <Show when={!ready()}>
        <span class="truncate px-1.5 whitespace-pre text-fg-2" aria-hidden="true">
          {props.value || props.placeholder}
        </span>
      </Show>
      <div ref={(element) => (host = element)} class="min-w-0 flex-1" />
    </div>
  );
}
