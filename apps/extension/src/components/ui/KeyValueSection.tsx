import { REDACTED } from '@betterdevtools/core';
import type { JSX } from '@solidjs/web';
import { createSignal, createUniqueId, For, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import CopyButton from './CopyButton.tsx';
import Icon from './Icon.tsx';

export interface Row {
  name: string;
  value: string;
  /** Short meaningful label shown before the value (e.g. an auth scheme). */
  tag?: string | undefined;
}

/**
 * One accordion section listing name/value rows (headers, general info, auth, JWT claims,
 * query, form fields). The name column has the same width in every section; the per-row copy
 * buttons are always laid out and only fade in, so copying never moves anything.
 */
export default function KeyValueSection(props: {
  title: string;
  rows: Row[];
  /** Rows whose value is masked until secrets are revealed. */
  secret?: ((row: Row) => boolean) | undefined;
  reveal?: boolean | undefined;
  empty?: string | undefined;
  copy?: boolean | undefined;
  /**
   * Set by "expand all / collapse all". A new object resets the section even when the value is
   * unchanged, so sections the user toggled by hand follow the next click too.
   */
  expansion?: { open: boolean } | undefined;
  /** Extra content under the rows (e.g. decoded tokens). */
  children?: JSX.Element;
}) {
  const contentId = createUniqueId();
  // follows `expansion` whenever it changes; the header toggles it in between
  const [isOpen, setIsOpen] = createSignal(() => props.expansion?.open ?? true);
  const showCopy = () => props.copy ?? true;
  const isHidden = (row: Row) => !props.reveal && (props.secret?.(row) ?? false);
  const allText = () => props.rows.map((row) => `${row.name}: ${isHidden(row) ? REDACTED : row.value}`).join('\n');

  return (
    <section class="@container mb-1.5" aria-label={props.title}>
      <div class="flex min-h-7 items-center gap-1 border-b border-line">
        <h3 class="min-w-0 flex-1">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center gap-1 rounded-sm py-0.5 text-left font-semibold hover:bg-bg-3"
            aria-expanded={isOpen() ? 'true' : 'false'}
            aria-controls={contentId}
            onClick={() => setIsOpen(!isOpen())}
          >
            <Icon name={isOpen() ? 'chevron-down' : 'chevron-right'} />
            <span class="truncate">{props.title}</span>
            <span class="rounded-full bg-bg-3 px-1.5 text-small font-normal text-fg-2">{props.rows.length}</span>
          </button>
        </h3>
        <Show when={showCopy() && props.rows.length}>
          <CopyButton text={allText} label={t('detail.copySection', { title: props.title })} />
        </Show>
      </div>
      <div id={contentId} hidden={!isOpen()}>
        <Show when={props.rows.length} fallback={<p class="py-1 text-fg-2">{props.empty ?? t('common.none')}</p>}>
          <dl>
            <For each={props.rows} keyed={false}>
              {(row) => (
                <div class="group grid min-h-6 grid-cols-[minmax(120px,180px)_minmax(0,1fr)_26px] gap-x-2.5 border-b border-bg-3 @max-[360px]:grid-cols-[minmax(0,1fr)_26px]">
                  <dt class="py-0.5 font-mono text-code break-all text-fg-2 @max-[360px]:col-span-full @max-[360px]:pb-0">{row().name}</dt>
                  <dd class="py-0.5 font-mono text-code [overflow-wrap:anywhere]">
                    <Show when={row().tag}>
                      <span class="me-1.5 rounded-sm border border-line px-1 font-sans text-small">{row().tag}</span>
                    </Show>
                    <Show when={isHidden(row())} fallback={row().value}>
                      <span class="text-fg-2">{t('common.hidden')}</span>
                    </Show>
                  </dd>
                  <Show when={showCopy()}>
                    <dd class="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                      <CopyButton
                        text={() => row().value}
                        label={t('detail.copyRow', { name: row().name })}
                        disabled={isHidden(row())}
                        reason={t('common.copyNeedsSecrets')}
                      />
                    </dd>
                  </Show>
                </div>
              )}
            </For>
          </dl>
        </Show>
        {props.children}
      </div>
    </section>
  );
}
