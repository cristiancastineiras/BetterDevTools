/* oxlint-disable unicorn/consistent-function-scoping -- small helpers sit beside the one place that uses them */
import { formatUuid, parseUuid, uuidV4, uuidV7 } from '@betterdevtools/core';
import { createMemo, createSignal, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import IconButton from '../ui/IconButton.tsx';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import { ErrorText, Field, Hint, Output, Page, Pairs, Row, Section } from './kit.tsx';

const MAX_COUNT = 1000;

/** UUID v4 and v7 generator, and a reader for any UUID. */
export default function UuidTool() {
  const [version, setVersion] = createSignal<'v4' | 'v7'>('v7');
  const [count, setCount] = createSignal('5');
  const [upper, setUpper] = createSignal(false);
  const [hyphens, setHyphens] = createSignal(true);
  const [braces, setBraces] = createSignal(false);
  const [generated, setGenerated] = createSignal<string[]>([]);
  const [lookup, setLookup] = createSignal('');

  const amount = () => Math.min(MAX_COUNT, Math.max(1, Math.trunc(Number(count())) || 1));
  const generate = () => setGenerated(Array.from({ length: amount() }, () => (version() === 'v7' ? uuidV7() : uuidV4())));
  const shown = createMemo(() =>
    generated()
      .map((uuid) => formatUuid(uuid, { upper: upper(), hyphens: hyphens(), braces: braces() }))
      .join('\n'),
  );
  const info = createMemo(() => (lookup().trim() ? parseUuid(lookup()) : null));

  const toggle = (label: string, value: () => boolean, set: (next: boolean) => void) => (
    <IconButton icon="check" label={label} text={label} pressed={value()} onClick={() => set(!value())} />
  );

  return (
    <Page>
      <Row>
        <SegmentedControl
          label={t('toolbox.uuid.version')}
          value={version()}
          onChange={setVersion}
          options={[
            { value: 'v7', label: 'UUID v7', title: t('toolbox.uuid.v7') },
            { value: 'v4', label: 'UUID v4', title: t('toolbox.uuid.v4') },
          ]}
        />
        <Field
          label={t('toolbox.uuid.count', { max: MAX_COUNT })}
          value={count()}
          onInput={setCount}
          type="number"
          min={1}
          max={MAX_COUNT}
          class="w-24"
        />
        {toggle(t('toolbox.uuid.upper'), upper, setUpper)}
        {toggle(t('toolbox.uuid.hyphens'), hyphens, setHyphens)}
        {toggle(t('toolbox.uuid.braces'), braces, setBraces)}
        <IconButton icon="plus" variant="primary" label={t('toolbox.uuid.generate')} text={t('toolbox.uuid.generate')} onClick={generate} />
      </Row>
      <Output label={t('toolbox.uuid.generated')} text={shown()} rows={Math.min(12, Math.max(4, generated().length + 1))} />
      <Section title={t('toolbox.uuid.read')}>
        <Field label="UUID" value={lookup()} onInput={setLookup} placeholder="018f3c1e-7b3a-7c2e-9d1a-5f6b7c8d9e0f" />
        <Show when={info()}>
          {(parsed) => (
            <Show when={parsed().valid} fallback={<ErrorText>{t('toolbox.uuid.invalid')}</ErrorText>}>
              <Pairs
                label={t('toolbox.uuid.read')}
                rows={[
                  { name: t('toolbox.uuid.versionName'), value: String(parsed().version) },
                  { name: t('toolbox.uuid.variant'), value: parsed().variant ?? '' },
                  ...(parsed().time === undefined ? [] : [{ name: t('toolbox.uuid.time'), value: new Date(parsed().time!).toISOString() }]),
                ]}
              />
              <Show when={parsed().time === undefined}>
                <Hint>{t('toolbox.uuid.noTime')}</Hint>
              </Show>
            </Show>
          )}
        </Show>
      </Section>
    </Page>
  );
}
