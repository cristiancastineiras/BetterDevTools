import { parseUrlText, type UrlParam } from '@betterdevtools/core';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import { monoClass } from '../ui/styles.ts';
import { ErrorText, Field, Hint, Page, Pairs, RequestPicker, Row, Section } from './kit.tsx';

function ParamTable(props: { label: string; params: UrlParam[] }) {
  return (
    <div class="overflow-x-auto">
      <table class={[monoClass, 'w-full border-collapse']} aria-label={props.label}>
        <thead>
          <tr class="border-b border-line text-fg-2">
            <th scope="col" class="px-1 text-start">
              {t('toolbox.url.key')}
            </th>
            <th scope="col" class="px-1 text-start">
              {t('toolbox.url.value')}
            </th>
            <th scope="col" class="px-1 text-start">
              {t('toolbox.url.raw')}
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={props.params}>
            {(param) => (
              <tr class="border-b border-bg-3 align-top">
                <td class="px-1 [overflow-wrap:anywhere]">{param.key}</td>
                <td class="px-1 [overflow-wrap:anywhere]">{param.value}</td>
                <td class="px-1 text-fg-2 [overflow-wrap:anywhere]">{param.raw}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

/** A URL taken apart: components, decoded query and fragment parameters, path segments and warnings. */
export default function UrlTool() {
  const [input, setInput] = createSignal('');
  const parsed = createMemo(() => (input().trim() ? parseUrlText(input()) : undefined));

  return (
    <Page>
      <Row>
        <Field
          label="URL"
          value={input()}
          onInput={setInput}
          placeholder="https://user@example.com:8443/a/b%20c?x=1&y=2#section"
          class="min-w-72 flex-1"
        />
        <RequestPicker onPick={(request) => setInput(request.url)} />
      </Row>
      <Show when={input().trim()}>
        <Show when={parsed()} fallback={<ErrorText>{t('toolbox.url.invalid')}</ErrorText>}>
          {(url) => (
            <>
              <Show when={url().warnings.length}>
                <ul class="flex flex-col gap-0.5 text-warn" aria-label={t('toolbox.url.warnings')}>
                  <For each={url().warnings}>{(code) => <li>{t(`toolbox.url.warning.${code}`)}</li>}</For>
                </ul>
              </Show>
              <Pairs label={t('toolbox.url.parts')} rows={url().parts} />
              <Show when={url().segments.length}>
                <Section title={t('toolbox.url.segments')}>
                  <p class={monoClass}>
                    {url()
                      .segments.map((segment) => `/${segment}`)
                      .join('')}
                  </p>
                </Section>
              </Show>
              <Section title={t('toolbox.url.query')}>
                <Show when={url().query.length} fallback={<Hint>{t('toolbox.url.none')}</Hint>}>
                  <ParamTable label={t('toolbox.url.query')} params={url().query} />
                </Show>
              </Section>
              <Show when={url().hash.length}>
                <Section title={t('toolbox.url.hash')}>
                  <ParamTable label={t('toolbox.url.hash')} params={url().hash} />
                </Section>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </Page>
  );
}
