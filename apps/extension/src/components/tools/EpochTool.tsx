import { epochRows, inZone, parseInstant, relativeTime, type EpochUnit } from '@betterdevtools/core';
import { createMemo, createSignal, onSettled, Show } from 'solid-js';
import { locale, t } from '../../i18n/index.ts';
import IconButton from '../ui/IconButton.tsx';
import SelectMenu from '../ui/SelectMenu.tsx';
import { fieldClass } from '../ui/styles.ts';
import { ErrorText, Field, Page, Pairs, Row } from './kit.tsx';

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const ZONES: string[] = (() => {
  try {
    return ['UTC', ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC')];
  } catch {
    return ['UTC', LOCAL_ZONE]; // an engine without supportedValuesOf: the two zones everyone has
  }
})();

/** Unix timestamps (seconds to nanoseconds) and dates, in any time zone. */
export default function EpochTool() {
  const [input, setInput] = createSignal('');
  const [unit, setUnit] = createSignal<EpochUnit | 'auto'>('auto');
  const [zone, setZone] = createSignal(LOCAL_ZONE);
  const [now, setNow] = createSignal(Date.now());

  onSettled(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  });

  const instant = createMemo(() =>
    input().trim()
      ? parseInstant(input(), now(), unit() === 'auto' ? undefined : (unit() as EpochUnit))
      : { ms: now(), unit: 'date' as const },
  );
  const rows = createMemo(() => {
    const parsed = instant();
    if (!parsed || !Number.isFinite(parsed.ms) || Math.abs(parsed.ms) > 8.64e15) return null;
    const units = epochRows(parsed.ms);
    const date = new Date(parsed.ms);
    const local = inZone(parsed.ms, LOCAL_ZONE);
    const chosen = inZone(parsed.ms, zone());
    return [
      { name: t('toolbox.epoch.seconds'), value: units.s },
      { name: t('toolbox.epoch.milliseconds'), value: units.ms },
      { name: t('toolbox.epoch.microseconds'), value: units.us },
      { name: t('toolbox.epoch.nanoseconds'), value: units.ns },
      { name: 'ISO 8601 (UTC)', value: date.toISOString() },
      { name: 'RFC 2822 (UTC)', value: date.toUTCString() },
      { name: `${t('toolbox.epoch.local')} (${LOCAL_ZONE})`, value: `${local.text} ${local.offset}` },
      { name: zone(), value: `${chosen.text} ${chosen.offset}` },
      { name: t('toolbox.epoch.relative'), value: relativeTime(parsed.ms, now(), locale()) },
    ];
  });

  return (
    <Page>
      <Row>
        <Field
          label={t('toolbox.epoch.input')}
          value={input()}
          onInput={setInput}
          placeholder={t('toolbox.epoch.placeholder')}
          class="min-w-64 flex-1"
        />
        <SelectMenu
          label={t('toolbox.epoch.unit')}
          value={unit()}
          onChange={(value) => setUnit(value as EpochUnit | 'auto')}
          options={[
            { value: 'auto', label: t('toolbox.epoch.auto') },
            { value: 's', label: t('toolbox.epoch.seconds') },
            { value: 'ms', label: t('toolbox.epoch.milliseconds') },
            { value: 'us', label: t('toolbox.epoch.microseconds') },
            { value: 'ns', label: t('toolbox.epoch.nanoseconds') },
          ]}
        />
        <SelectMenu
          label={t('toolbox.epoch.zone')}
          value={zone()}
          onChange={setZone}
          options={ZONES.map((value) => ({ value, label: value }))}
        />
        <label class="flex flex-col gap-0.5">
          <span class="text-fg-2">{t('toolbox.epoch.pick')}</span>
          <input
            type="datetime-local"
            step="1"
            class={fieldClass}
            onInput={(event) => {
              const picked = event.currentTarget.valueAsNumber;
              if (!Number.isNaN(picked)) setInput(new Date(event.currentTarget.value).toISOString());
            }}
          />
        </label>
        <IconButton icon="replay" label={t('toolbox.epoch.now')} text={t('toolbox.epoch.now')} onClick={() => setInput('')} />
      </Row>
      <Show when={rows()} fallback={<ErrorText>{t('toolbox.epoch.invalid')}</ErrorText>}>
        {(table) => (
          <>
            <Show when={input().trim() === ''}>
              <p class="text-fg-2" role="status">
                {t('toolbox.epoch.live')}
              </p>
            </Show>
            <Pairs label={t('toolbox.epoch.results')} rows={table()} />
          </>
        )}
      </Show>
    </Page>
  );
}
