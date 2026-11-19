import { coverageOf, type Coverage } from '@betterdevtools/core';
import { createMemo, For, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { currentModel } from '../../state/discovery.ts';
import { monoClass, sectionTitleClass } from '../ui/styles.ts';

function Meter(props: { label: string; value: number; of: number; percent?: number | undefined }) {
  const percent = () => props.percent ?? (props.of ? Math.round((props.value / props.of) * 100) : 0);
  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-baseline justify-between gap-2">
        <span>{props.label}</span>
        <span class="tabular-nums">
          {formatNumber(props.value)}
          <Show when={props.of}> / {formatNumber(props.of)}</Show>
          <span class="ms-1 text-fg-2">{percent()}%</span>
        </span>
      </div>
      <div class="h-1.5 rounded-full bg-bg-3" role="progressbar" aria-label={props.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent()}>
        <div class="h-1.5 rounded-full bg-accent" style={{ width: `${percent()}%` }} />
      </div>
    </div>
  );
}

function Issues(props: { title: string; hint: string; keys: string[] }) {
  return (
    <Show when={props.keys.length}>
      <section>
        <h3 class={sectionTitleClass}>
          {props.title} <span class="font-normal text-fg-2">({props.keys.length})</span>
        </h3>
        <p class="text-fg-2">{props.hint}</p>
        <ul class={[monoClass, 'mt-1 flex flex-col gap-0.5']}>
          <For each={props.keys.slice(0, 40)}>{(key) => <li class="[overflow-wrap:anywhere]">{key}</li>}</For>
        </ul>
      </section>
    </Show>
  );
}

/** How much of the traffic seen is described: not how much of the API exists, which nobody can know from traffic. */
export default function CoverageTab() {
  const coverage = createMemo<Coverage | null>(() => {
    const model = currentModel();
    return model ? coverageOf(model) : null;
  });

  return (
    <Show when={coverage()} fallback={null}>
      {(data) => (
        <div class="flex h-full min-h-0 flex-col gap-4 overflow-auto p-3">
          <p class="max-w-2xl text-fg-2">{t('discovery.coverage.hint')}</p>
          <section class="grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-2">
            <Meter label={t('discovery.coverage.schemas')} value={data().withSchema} of={data().endpoints} />
            <Meter label={t('discovery.coverage.examples')} value={data().withExamples} of={data().endpoints} />
            <Show when={data().frozen}>
              <Meter label={t('discovery.coverage.contract')} value={data().validated} of={data().frozen} />
            </Show>
            <Meter label={t('discovery.coverage.confidence')} value={data().endpoints - data().thin} of={data().endpoints} />
          </section>
          <Issues title={t('discovery.coverage.noSchema')} hint={t('discovery.coverage.noSchemaHint')} keys={data().noSchema} />
          <Issues title={t('discovery.coverage.inconsistent')} hint={t('discovery.coverage.inconsistentHint')} keys={data().inconsistentKeys} />
          <Issues title={t('discovery.coverage.erroring')} hint={t('discovery.coverage.erroringHint')} keys={data().erroring} />
          <Issues title={t('discovery.coverage.thin')} hint={t('discovery.coverage.thinHint')} keys={data().thinKeys} />
          <Issues title={t('discovery.coverage.unexercised')} hint={t('discovery.coverage.unexercisedHint')} keys={data().unexercised} />
        </div>
      )}
    </Show>
  );
}
