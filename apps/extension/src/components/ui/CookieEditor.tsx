import type { JSX } from '@solidjs/web';
import { For, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import IconButton from './IconButton.tsx';
import { fieldClass, monoClass } from './styles.ts';

export interface EditableCookie {
  name: string;
  value: string;
  /** Read-only details shown under the value (attributes, why it cannot be changed). */
  note?: string | undefined;
  /** Existing cookie: its name identifies it, so it cannot be edited. */
  fixedName?: boolean | undefined;
}

/**
 * Name/value rows for a list of cookies: an editable copy for Replay, or the browser jar.
 * Nothing here touches the browser: edits are reported through `onEdit`, and the jar passes
 * its own confirmed actions through `actions`.
 */
export default function CookieEditor(props: {
  rows: readonly EditableCookie[];
  label: string;
  reveal: boolean;
  onEdit: (index: number, field: 'name' | 'value', value: string) => void;
  onAdd?: (() => void) | undefined;
  onRemove?: ((index: number) => void) | undefined;
  /** Per-row buttons; without them each row gets a Remove button and the list an Add button. */
  actions?: ((index: number) => JSX.Element) | undefined;
  disabled?: boolean | undefined;
}) {
  const nameOrPlaceholder = (cookie: EditableCookie) => cookie.name || t('cookies.editor.cookie');

  return (
    <section aria-label={props.label} class="flex flex-col gap-1">
      <Show when={props.rows.length} fallback={<p class="text-fg-2">{t('cookies.editor.empty')}</p>}>
        <table class="w-full border-collapse">
          <thead class="text-fg-2">
            <tr>
              <th class="text-start font-semibold">{t('cookies.columns.name')}</th>
              <th class="text-start font-semibold">{t('cookies.columns.value')}</th>
              <th>
                <span class="sr-only">{t('cookies.editor.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows} keyed={false}>
              {(cookie, index) => (
                <tr class="align-top">
                  <td class="py-0.5 pe-1">
                    <input
                      class={[fieldClass, monoClass, 'w-full']}
                      aria-label={t('cookies.editor.name')}
                      value={cookie().name}
                      readonly={Boolean(cookie().fixedName)}
                      spellcheck={false}
                      disabled={Boolean(props.disabled)}
                      onInput={(event) => props.onEdit(index, 'name', event.currentTarget.value)}
                    />
                  </td>
                  <td class="py-0.5 pe-1">
                    <input
                      class={[fieldClass, monoClass, 'w-full']}
                      aria-label={t('cookies.editor.valueOf', { name: nameOrPlaceholder(cookie()) })}
                      type={props.reveal ? 'text' : 'password'}
                      autocomplete="off"
                      value={cookie().value}
                      spellcheck={false}
                      disabled={Boolean(props.disabled)}
                      onInput={(event) => props.onEdit(index, 'value', event.currentTarget.value)}
                    />
                    <Show when={cookie().note}>
                      <span class="block text-[11px] text-fg-2">{cookie().note}</span>
                    </Show>
                  </td>
                  <td class="py-0.5 whitespace-nowrap">
                    <Show
                      when={props.actions}
                      fallback={
                        <IconButton
                          icon="trash"
                          variant="ghost"
                          label={t('cookies.editor.remove', { name: nameOrPlaceholder(cookie()) })}
                          disabled={props.disabled}
                          onClick={() => props.onRemove?.(index)}
                        />
                      }
                    >
                      {(renderActions) => renderActions()(index)}
                    </Show>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
      <Show when={!props.actions}>
        <div>
          <IconButton
            icon="plus"
            label={t('cookies.editor.add')}
            text={t('cookies.editor.add')}
            disabled={props.disabled}
            onClick={() => props.onAdd?.()}
          />
        </div>
      </Show>
    </section>
  );
}
