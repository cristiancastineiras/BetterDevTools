import { bodyText, type Captured } from '@betterdevtools/core';
import type { JSX } from '@solidjs/web';
import { createMemo, For, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import { captureLog, visibleRequests } from '../../state/capture.ts';
import CopyButton from '../ui/CopyButton.tsx';
import SelectMenu from '../ui/SelectMenu.tsx';
import { fieldClass, monoClass } from '../ui/styles.ts';

/** The scrolling page every tool sits in. */
export function Page(props: { children: JSX.Element }) {
  return <div class="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">{props.children}</div>;
}

export function Row(props: { children: JSX.Element; class?: string }) {
  return <div class={['flex flex-wrap items-end gap-2', props.class]}>{props.children}</div>;
}

export function Hint(props: { children: JSX.Element }) {
  return <p class="text-fg-2">{props.children}</p>;
}

export function ErrorText(props: { children: JSX.Element }) {
  return (
    <p role="alert" class="text-bad">
      {props.children}
    </p>
  );
}

export function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-1">
      <h3 class="font-semibold">{props.title}</h3>
      {props.children}
    </section>
  );
}

/** A multi-line input with a visible label. */
export function TextArea(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  rows?: number;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label class="flex flex-col gap-0.5">
      <span class="text-fg-2">{props.label}</span>
      <textarea
        class={[fieldClass, props.mono === false ? '' : monoClass, 'resize-y']}
        rows={props.rows ?? 6}
        spellcheck={false}
        autocomplete="off"
        placeholder={props.placeholder}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </label>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'number';
  class?: string;
  mono?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <label class="flex flex-col gap-0.5">
      <span class="text-fg-2">{props.label}</span>
      <input
        class={[fieldClass, props.mono === false ? '' : monoClass, props.class]}
        type={props.type ?? 'text'}
        spellcheck={false}
        autocomplete="off"
        placeholder={props.placeholder}
        min={props.min}
        max={props.max}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </label>
  );
}

/** A read-only result with a copy button; the label names the textarea for assistive technology. */
export function Output(props: { label: string; text: string; rows?: number }) {
  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center justify-between">
        <span class="text-fg-2">{props.label}</span>
        <CopyButton text={() => props.text} label={t('toolbox.copy', { what: props.label })} disabled={!props.text} />
      </div>
      <textarea
        class={[fieldClass, monoClass, 'resize-y']}
        rows={props.rows ?? 6}
        readonly
        spellcheck={false}
        aria-label={props.label}
        value={props.text}
      />
    </div>
  );
}

/** Rows of name → value with a copy button each (hashes, conversions, URL parts). */
export function Pairs(props: { label: string; rows: { name: string; value: string }[] }) {
  return (
    <div class="overflow-x-auto">
      <table class="w-full border-collapse" aria-label={props.label}>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr class="border-b border-bg-3">
                <th scope="row" class="w-32 py-0.5 pe-2 text-start font-medium text-fg-2">
                  {row.name}
                </th>
                <td class={[monoClass, 'py-0.5 [overflow-wrap:anywhere]']}>{row.value || '—'}</td>
                <td class="w-8 text-end">
                  <CopyButton text={row.value} label={t('toolbox.copy', { what: row.name })} disabled={!row.value} />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

/** Picks one of the requests captured in the Network view (the 100 most recent). */
export function RequestPicker(props: { label?: string; onPick: (request: Captured) => void }) {
  const options = createMemo(() =>
    visibleRequests()
      .slice(-100)
      .toReversed()
      .map((request) => ({ value: String(request.id), label: `${request.status || '—'} ${request.method} ${request.path}` })),
  );
  return (
    <Show when={options().length}>
      <SelectMenu
        label={props.label ?? t('toolbox.fromCapture')}
        value=""
        options={[{ value: '', label: t('toolbox.pickCapture'), disabled: true }, ...options()]}
        onChange={(id) => {
          const request = captureLog.get(Number(id));
          if (request) props.onPick(request);
        }}
        class="max-w-72"
      />
    </Show>
  );
}

/** Fills a tool's input with the response body of a captured request. */
export function CapturedPicker(props: { label?: string; onPick: (text: string) => void }) {
  return <RequestPicker label={props.label} onPick={(request) => props.onPick(bodyText(captureLog.body(request.id)))} />;
}
