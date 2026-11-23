import { convertBase, convertCase, textStats } from '@betterdevtools/core';
import { createMemo, createSignal, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import { ErrorText, Field, Page, Pairs, Row, Section, TextArea } from './kit.tsx';

/** The small converters of a developer's day: number bases, naming styles and text statistics. */
export default function TextTool() {
  const [number, setNumber] = createSignal('255');
  const [base, setBase] = createSignal<'2' | '8' | '10' | '16'>('10');
  const [words, setWords] = createSignal('');
  const [text, setText] = createSignal('');

  const converted = createMemo(() => (number().trim() ? convertBase(number(), Number(base()) as 2 | 8 | 10 | 16) : undefined));
  const stats = createMemo(() => textStats(text()));

  return (
    <Page>
      <Section title={t('toolbox.text.base')}>
        <Row>
          <Field label={t('toolbox.text.number')} value={number()} onInput={setNumber} class="min-w-56" />
          <SegmentedControl
            label={t('toolbox.text.fromBase')}
            value={base()}
            onChange={setBase}
            options={[
              { value: '2', label: 'BIN' },
              { value: '8', label: 'OCT' },
              { value: '10', label: 'DEC' },
              { value: '16', label: 'HEX' },
            ]}
          />
        </Row>
        <Show when={number().trim()}>
          <Show when={converted()} fallback={<ErrorText>{t('toolbox.text.notNumber')}</ErrorText>}>
            {(result) => (
              <Pairs
                label={t('toolbox.text.base')}
                rows={[
                  { name: 'BIN', value: result()['2'] },
                  { name: 'OCT', value: result()['8'] },
                  { name: 'DEC', value: result()['10'] },
                  { name: 'HEX', value: result()['16'] },
                ]}
              />
            )}
          </Show>
        </Show>
      </Section>
      <Section title={t('toolbox.text.case')}>
        <Field
          label={t('toolbox.text.words')}
          value={words()}
          onInput={setWords}
          placeholder="helloWorld, hello-world, HTTP server…"
          mono={false}
        />
        <Show when={words().trim()}>
          <Pairs label={t('toolbox.text.case')} rows={convertCase(words())} />
        </Show>
      </Section>
      <Section title={t('toolbox.text.stats')}>
        <TextArea label={t('toolbox.input')} value={text()} onInput={setText} rows={5} mono={false} />
        <Pairs
          label={t('toolbox.text.stats')}
          rows={[
            { name: t('toolbox.text.characters'), value: formatNumber(stats().characters) },
            { name: t('toolbox.text.charactersNoSpaces'), value: formatNumber(stats().charactersNoSpaces) },
            { name: t('toolbox.text.wordCount'), value: formatNumber(stats().words) },
            { name: t('toolbox.text.lines'), value: formatNumber(stats().lines) },
            { name: t('toolbox.text.bytes'), value: formatNumber(stats().bytes) },
          ]}
        />
      </Section>
    </Page>
  );
}
