import { CronError, describeCron, nextRuns, parseCron } from '@betterdevtools/core';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { locale, t } from '../../i18n/index.ts';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import SelectMenu from '../ui/SelectMenu.tsx';
import { monoClass } from '../ui/styles.ts';
import { ErrorText, Field, Hint, Page, Row } from './kit.tsx';

const PRESETS = [
  '* * * * *',
  '*/5 * * * *',
  '0 * * * *',
  '0 0 * * *',
  '0 9 * * 1-5',
  '0 0 * * 0',
  '0 0 1 * *',
  '0 0 1 1 *',
  '30 4 1,15 * 5',
];
const FIELD_NAMES = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'] as const;
const RUNS = 10;

/** Cron expressions: validation, a plain-language description and the next runs. */
export default function CronTool() {
  const [expression, setExpression] = createSignal('*/5 * * * *');
  const [zone, setZone] = createSignal<'local' | 'utc'>('local');

  const parsed = createMemo(() => {
    try {
      return { spec: parseCron(expression()) };
    } catch (error) {
      return { error: error instanceof CronError ? error.message : String(error) };
    }
  });
  const runs = createMemo(() => {
    const result = parsed();
    return 'spec' in result && result.spec ? nextRuns(result.spec, new Date(), RUNS, zone() === 'utc') : [];
  });
  const format = (date: Date) =>
    date.toLocaleString(locale(), { dateStyle: 'full', timeStyle: 'medium', ...(zone() === 'utc' ? { timeZone: 'UTC' } : {}) });
  const fields = () => expression().trim().split(/\s+/);

  return (
    <Page>
      <Row>
        <Field
          label={t('toolbox.cron.expression')}
          value={expression()}
          onInput={setExpression}
          placeholder="*/5 * * * *"
          class="min-w-64 flex-1"
        />
        <SelectMenu
          label={t('toolbox.cron.presets')}
          value=""
          onChange={setExpression}
          options={[
            { value: '', label: t('toolbox.cron.pickPreset'), disabled: true },
            ...PRESETS.map((value) => ({ value, label: value })),
          ]}
        />
        <SegmentedControl
          label={t('toolbox.cron.zone')}
          value={zone()}
          onChange={setZone}
          options={[
            { value: 'local', label: t('toolbox.epoch.local') },
            { value: 'utc', label: 'UTC' },
          ]}
        />
      </Row>
      <Show
        when={'spec' in parsed() ? (parsed() as { spec: Parameters<typeof describeCron>[0] }).spec : null}
        fallback={<ErrorText>{(parsed() as { error: string }).error}</ErrorText>}
      >
        {(spec) => (
          <>
            <p class="text-[1.15em] font-semibold" role="status">
              {describeCron(spec(), locale())}
            </p>
            <Show when={fields().length === 5}>
              <div class="flex flex-wrap gap-2" aria-label={t('toolbox.cron.fields')} role="group">
                <For each={FIELD_NAMES}>
                  {(name, index) => (
                    <div class="flex flex-col items-center rounded-sm border border-line px-2 py-1">
                      <span class={[monoClass, 'text-[1.2em]']}>{fields()[index()]}</span>
                      <span class="text-fg-2">{t(`toolbox.cron.${name}`)}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="flex flex-col gap-1">
              <h3 class="font-semibold">{t('toolbox.cron.next', { count: RUNS })}</h3>
              <Show when={runs().length} fallback={<Hint>{t('toolbox.cron.never')}</Hint>}>
                <ol class="flex flex-col gap-0.5">
                  <For each={runs()}>{(date) => <li class={monoClass}>{format(date)}</li>}</For>
                </ol>
              </Show>
            </div>
          </>
        )}
      </Show>
    </Page>
  );
}
