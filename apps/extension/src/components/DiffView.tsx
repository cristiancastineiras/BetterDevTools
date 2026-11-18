import { diffLines } from '@betterdevtools/core';
import { createMemo, For, Show } from 'solid-js';
import { t } from '../i18n/index.ts';
import { monoClass } from './ui/styles.ts';

/** Line diff of two texts: removed lines in red with "−", added in green with "+". */
export default function DiffView(props: { before: string; after: string; beforeLabel: string; afterLabel: string }) {
  // null when the texts are too large to diff line by line
  const lines = createMemo(() => diffLines(props.before, props.after));
  const addedCount = createMemo(() => lines()?.filter((line) => line.op === '+').length ?? 0);
  const removedCount = createMemo(() => lines()?.filter((line) => line.op === '-').length ?? 0);
  const summary = () => {
    if (!lines()) return t('diff.tooLarge');
    if (!addedCount() && !removedCount()) return t('diff.identical');
    return t('diff.counts', { removed: removedCount(), added: addedCount() });
  };

  return (
    <div class="flex flex-col gap-1">
      <p class="text-fg-2">
        <span class="text-bad">− {props.beforeLabel}</span> · <span class="text-ok">+ {props.afterLabel}</span> · {summary()}
      </p>
      <Show when={addedCount() || removedCount() ? lines() : null}>
        {(diff) => (
          <pre class={[monoClass, 'max-h-[60vh] overflow-auto rounded-sm border border-line p-1']} tabindex="0">
            <For each={diff()} keyed={false}>
              {(line) => (
                <div class={line().op === '+' ? 'bg-ok/15' : line().op === '-' ? 'bg-bad/15' : 'text-fg-2'}>
                  <span aria-hidden="true">{line().op === '=' ? ' ' : line().op} </span>
                  <span class="sr-only">{line().op === '+' ? t('diff.added') : line().op === '-' ? t('diff.removed') : ''}</span>
                  {line().text}
                </div>
              )}
            </For>
          </pre>
        )}
      </Show>
    </div>
  );
}
