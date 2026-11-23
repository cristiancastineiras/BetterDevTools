import { formatJson, queryJsonPath, type PathNode } from '@betterdevtools/core';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import CopyButton from '../ui/CopyButton.tsx';
import { monoClass } from '../ui/styles.ts';
import { CapturedPicker, ErrorText, Field, Hint, Page, Row, TextArea } from './kit.tsx';

const MAX_SHOWN = 200;
const MAX_VALUE_CHARS = 4000;

const pretty = (value: unknown): string => {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
};

/** JSONPath queries (RFC 9535) over pasted JSON or a captured response. */
export default function JsonPathTool() {
  const [input, setInput] = createSignal('');
  const [path, setPath] = createSignal('$');

  const outcome = createMemo((): { nodes: PathNode[] } | { error: string } | null => {
    if (!input().trim()) return null;
    let document: unknown;
    try {
      document = JSON.parse(input());
    } catch {
      const failed = formatJson(input());
      return { error: failed.ok ? '' : t('toolbox.format.jsonError', { message: failed.error, line: failed.line, column: failed.column }) };
    }
    const result = queryJsonPath(document, path());
    return result.ok ? { nodes: result.nodes } : { error: result.error };
  });

  return (
    <Page>
      <Row>
        <Field
          label={t('toolbox.jsonpath.path')}
          value={path()}
          onInput={setPath}
          placeholder="$.store.book[?@.price<10].title"
          class="min-w-72 flex-1"
        />
        <CapturedPicker onPick={setInput} />
      </Row>
      <TextArea label={t('toolbox.jsonpath.document')} value={input()} onInput={setInput} rows={10} />
      <Show when={outcome()}>
        {(result) => (
          <Show
            when={'nodes' in result() ? (result() as { nodes: PathNode[] }).nodes : null}
            fallback={<ErrorText>{(result() as { error: string }).error}</ErrorText>}
          >
            {(nodes) => (
              <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                  <span class="font-semibold">{t('toolbox.jsonpath.count', { count: formatNumber(nodes().length) })}</span>
                  <CopyButton
                    text={() =>
                      JSON.stringify(
                        nodes().map((node) => node.value),
                        null,
                        2,
                      )
                    }
                    label={t('toolbox.jsonpath.copyAll')}
                    disabled={!nodes().length}
                  />
                </div>
                <Show when={!nodes().length}>
                  <Hint>{t('toolbox.jsonpath.none')}</Hint>
                </Show>
                <ol class="flex flex-col gap-1" aria-label={t('toolbox.jsonpath.results')}>
                  <For each={nodes().slice(0, MAX_SHOWN)}>
                    {(node) => (
                      <li class="border-b border-bg-3 pb-1">
                        <div class={[monoClass, 'text-fg-2 [overflow-wrap:anywhere]']}>{node.path}</div>
                        <pre class={[monoClass, 'whitespace-pre-wrap [overflow-wrap:anywhere]']}>{pretty(node.value)}</pre>
                      </li>
                    )}
                  </For>
                </ol>
                <Show when={nodes().length > MAX_SHOWN}>
                  <Hint>{t('toolbox.jsonpath.capped', { shown: MAX_SHOWN, total: formatNumber(nodes().length) })}</Hint>
                </Show>
              </div>
            )}
          </Show>
        )}
      </Show>
    </Page>
  );
}
