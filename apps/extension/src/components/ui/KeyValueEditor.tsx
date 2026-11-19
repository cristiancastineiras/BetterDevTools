import type { Row } from '@betterdevtools/core';
import { createEffect, createSignal, For } from 'solid-js';
import { t } from '../../i18n/index.ts';
import IconButton from './IconButton.tsx';
import SuggestInput from './SuggestInput.tsx';

/**
 * A Postman-style table of key/value rows, each one switched on or off. The text it edits stays
 * the source of truth: `toRows` reads it and `toText` writes it, so the same text can also be
 * edited in bulk. Rows the user adds but has not filled yet live only here until they have content.
 */
export default function KeyValueEditor(props: {
  text: string;
  onText: (text: string) => void;
  toRows: (text: string) => Row[];
  toText: (rows: Row[]) => string;
  label: string;
  keySuggestions?: readonly string[] | undefined;
  valueSuggestions?: ((key: string) => readonly string[]) | undefined;
  onKeyDown?: ((event: KeyboardEvent) => void) | undefined;
}) {
  const [rows, setRows] = createSignal<Row[]>(props.toRows(props.text), { ownedWrite: true });
  let emitted = props.text;

  // changes made elsewhere (bulk edit, another request opened) replace the rows
  createEffect(
    () => props.text,
    (text) => {
      if (text === emitted) return;
      emitted = text;
      setRows(props.toRows(text));
    },
  );

  function change(next: Row[]) {
    setRows(next);
    emitted = props.toText(next);
    props.onText(emitted);
  }
  const update = (index: number, patch: Partial<Row>) => change(rows().map((row, n) => (n === index ? { ...row, ...patch } : row)));

  // Enter inside the table must not submit the form (which would send the request): Ctrl+Enter does
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) event.preventDefault();
    props.onKeyDown?.(event);
  };

  return (
    <section aria-label={props.label} class="flex flex-col gap-1">
      <table class="w-full border-collapse">
        <thead class="text-fg-2">
          <tr>
            <th class="w-8 text-center font-semibold">
              <span class="sr-only">{t('replay.table.enabled')}</span>
            </th>
            <th class="text-start font-semibold">{t('replay.table.key')}</th>
            <th class="text-start font-semibold">{t('replay.table.value')}</th>
            <th class="w-8">
              <span class="sr-only">{t('replay.table.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()} keyed={false}>
            {(row, index) => (
              <tr class="align-top">
                <td class="py-0.5 text-center">
                  <input
                    type="checkbox"
                    class="cursor-pointer"
                    aria-label={t('replay.table.enableRow', { name: row().key || t('replay.table.key') })}
                    checked={row().enabled}
                    onChange={(event) => update(index, { enabled: event.currentTarget.checked })}
                  />
                </td>
                <td class="py-0.5 pe-1">
                  <Cell
                    suggestions={props.keySuggestions}
                    value={row().key}
                    label={t('replay.table.key')}
                    dim={!row().enabled}
                    onInput={(key) => update(index, { key })}
                    onKeyDown={onKeyDown}
                  />
                </td>
                <td class="py-0.5 pe-1">
                  <Cell
                    suggestions={props.valueSuggestions?.(row().key)}
                    value={row().value}
                    label={t('replay.table.valueOf', { name: row().key || t('replay.table.key') })}
                    dim={!row().enabled}
                    onInput={(value) => update(index, { value })}
                    onKeyDown={onKeyDown}
                  />
                </td>
                <td class="py-0.5">
                  <IconButton
                    icon="trash"
                    variant="ghost"
                    label={t('replay.table.remove', { name: row().key || t('replay.table.key') })}
                    onClick={() => change(rows().filter((_, n) => n !== index))}
                  />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <div>
        <IconButton
          icon="plus"
          label={t('replay.table.add')}
          text={t('replay.table.add')}
          onClick={() => change([...rows(), { enabled: true, key: '', value: '' }])}
        />
      </div>
    </section>
  );
}

/** A key or value cell: with suggestions a combobox, otherwise a plain field. */
function Cell(props: {
  value: string;
  label: string;
  dim: boolean;
  suggestions: readonly string[] | undefined;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  return (
    <SuggestInput
      class={props.dim ? 'w-full opacity-55' : 'w-full'}
      label={props.label}
      value={props.value}
      suggestions={props.suggestions ?? []}
      onInput={props.onInput}
      onKeyDown={props.onKeyDown}
    />
  );
}
