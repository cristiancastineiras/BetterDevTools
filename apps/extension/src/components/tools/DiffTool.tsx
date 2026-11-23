/* oxlint-disable unicorn/consistent-function-scoping -- small helpers sit beside the one place that uses them */
import { sortJson } from '@betterdevtools/core';
import { createMemo, createSignal, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import DiffView from '../DiffView.tsx';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import { CapturedPicker, ErrorText, Hint, Page, Row, TextArea } from './kit.tsx';

type Mode = 'text' | 'json' | 'lines';

/** Two texts side by side: plain, JSON with the keys sorted so only real differences show, or sorted lines (headers). */
export default function DiffTool() {
  const [left, setLeft] = createSignal('');
  const [right, setRight] = createSignal('');
  const [mode, setMode] = createSignal<Mode>('text');

  const prepared = createMemo((): { before: string; after: string } | { error: string } => {
    if (mode() === 'text') return { before: left(), after: right() };
    if (mode() === 'lines') {
      const sorted = (text: string) => text.split(/\r?\n/).filter(Boolean).toSorted().join('\n');
      return { before: sorted(left()), after: sorted(right()) };
    }
    const normalise = (text: string): string | { error: string } => {
      if (!text.trim()) return '';
      const result = sortJson(text);
      return result.ok
        ? result.output
        : { error: t('toolbox.format.jsonError', { message: result.error, line: result.line, column: result.column }) };
    };
    const [before, after] = [normalise(left()), normalise(right())];
    return typeof before !== 'string' ? before : typeof after !== 'string' ? after : { before, after };
  });

  return (
    <Page>
      <Row>
        <SegmentedControl
          label={t('toolbox.diff.mode')}
          value={mode()}
          onChange={setMode}
          options={[
            { value: 'text', label: t('toolbox.diff.text') },
            { value: 'json', label: 'JSON', title: t('toolbox.diff.jsonHint') },
            { value: 'lines', label: t('toolbox.diff.lines'), title: t('toolbox.diff.linesHint') },
          ]}
        />
      </Row>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="flex flex-col gap-1">
          <CapturedPicker label={t('toolbox.diff.fromCaptureA')} onPick={setLeft} />
          <TextArea label={t('toolbox.diff.a')} value={left()} onInput={setLeft} rows={8} />
        </div>
        <div class="flex flex-col gap-1">
          <CapturedPicker label={t('toolbox.diff.fromCaptureB')} onPick={setRight} />
          <TextArea label={t('toolbox.diff.b')} value={right()} onInput={setRight} rows={8} />
        </div>
      </div>
      <Show when={left() || right()} fallback={<Hint>{t('toolbox.diff.empty')}</Hint>}>
        {(() => {
          const result = prepared();
          return 'error' in result ? (
            <ErrorText>{result.error}</ErrorText>
          ) : (
            <DiffView before={result.before} after={result.after} beforeLabel="A" afterLabel="B" />
          );
        })()}
      </Show>
    </Page>
  );
}
