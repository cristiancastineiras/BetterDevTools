import {
  analyzePerformance,
  rate,
  waterfall,
  type MetricName,
  type PageMetrics,
  type PerfFinding,
  type Rating,
} from '@betterdevtools/core';
import { createMemo, createSignal, For, onSettled, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { installPerfCollector, readPerf, reloadInspectedPage } from '../../lib/devtools.ts';
import { attachedToDevtools, bodiesVersion, captureLog, capturedCount } from '../../state/capture.ts';
import { activeTool, showInNetwork } from '../../state/toolbox.ts';
import { currentView } from '../../state/ui.ts';
import IconButton from '../ui/IconButton.tsx';
import { monoClass } from '../ui/styles.ts';
import { ErrorText, Hint, Page, Row, Section } from './kit.tsx';
import RequestLinks from './RequestLinks.tsx';

const POLL_MS = 2000;
const RATING_CLASS: Record<Rating, string> = { good: 'text-ok', 'needs-improvement': 'text-warn', poor: 'text-bad' };
const PHASE_CLASS: Record<string, string> = {
  blocked: 'bg-fg-2/40',
  dns: 'bg-warn/60',
  connect: 'bg-warn',
  ssl: 'bg-bad/60',
  send: 'bg-accent/50',
  wait: 'bg-accent',
  receive: 'bg-ok',
};
const METRICS: { name: MetricName; unit: 'ms' | '' }[] = [
  { name: 'lcp', unit: 'ms' },
  { name: 'inp', unit: 'ms' },
  { name: 'cls', unit: '' },
  { name: 'fcp', unit: 'ms' },
  { name: 'ttfb', unit: 'ms' },
];
const WATERFALL_ROWS = 300;

function metricValue(page: PageMetrics | undefined, name: MetricName): number | undefined {
  if (!page) return undefined;
  if (name === 'lcp') return page.lcp?.value;
  if (name === 'inp') return page.inp?.value;
  return page[name];
}

/** Core Web Vitals, what slows the page down and a waterfall: a small Lighthouse over the captured traffic. */
export default function PerformanceTool() {
  const [page, setPage] = createSignal<PageMetrics | undefined>();
  const [problem, setProblem] = createSignal('');

  async function refresh() {
    try {
      const reply = (await readPerf()) as PageMetrics | null;
      if (reply) setPage(reply);
      else await installPerfCollector(); // a new page: start observing, read on the next round
      setProblem('');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  onSettled(() => {
    if (!attachedToDevtools) return;
    void refresh();
    const timer = setInterval(() => {
      if (currentView() === 'toolbox' && activeTool() === 'performance') void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  });

  const findings = createMemo((): PerfFinding[] => {
    bodiesVersion();
    capturedCount();
    return analyzePerformance(captureLog.entries, page());
  });
  const rows = createMemo(() => {
    bodiesVersion();
    return waterfall(captureLog.entries, WATERFALL_ROWS);
  });
  const span = createMemo(() => Math.max(1, ...rows().map((row) => row.start + row.total)));

  return (
    <Page>
      <Hint>{t('perf.intro')}</Hint>
      <Row>
        <IconButton
          icon="replay"
          label={t('perf.refresh')}
          text={t('perf.refresh')}
          disabled={!attachedToDevtools}
          onClick={() => void refresh()}
        />
        <IconButton
          icon="replay"
          label={t('perf.reloadHint')}
          text={t('perf.reload')}
          disabled={!attachedToDevtools}
          onClick={() => reloadInspectedPage(false)}
        />
      </Row>
      <Show when={problem()}>
        <ErrorText>{t('realtime.problem', { reason: problem() })}</ErrorText>
      </Show>
      <Show when={attachedToDevtools} fallback={<Hint>{t('perf.notAttached')}</Hint>}>
        <ul class="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2" aria-label={t('perf.vitals')}>
          <For each={METRICS}>
            {(metric) => {
              const value = () => metricValue(page(), metric.name);
              return (
                <li class="flex flex-col rounded-sm border border-line p-2">
                  <span class="font-semibold">{t(`perf.metrics.${metric.name}`)}</span>
                  <Show
                    when={value() !== undefined}
                    fallback={<span class="text-fg-2">{t(metric.name === 'inp' ? 'perf.needsInteraction' : 'perf.notYet')}</span>}
                  >
                    <span class={['text-[1.4em]', RATING_CLASS[rate(metric.name, value()!)]]}>
                      {metric.name === 'cls' ? value()!.toFixed(3) : `${formatNumber(Math.round(value()!))} ms`}
                    </span>
                    <span class={RATING_CLASS[rate(metric.name, value()!)]}>{t(`perf.ratings.${rate(metric.name, value()!)}`)}</span>
                  </Show>
                  <Show when={metric.name === 'lcp' && page()?.lcp?.element}>
                    <span class={[monoClass, 'text-fg-2 [overflow-wrap:anywhere]']}>{page()?.lcp?.element}</span>
                  </Show>
                  <Show when={metric.name === 'inp' && page()?.inp?.target}>
                    <span class={[monoClass, 'text-fg-2 [overflow-wrap:anywhere]']}>{page()?.inp?.target}</span>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
        <Show when={page()?.domContentLoaded !== undefined || page()?.load !== undefined}>
          <p class="text-fg-2">
            {t('perf.timeline', {
              dcl: formatNumber(Math.round(page()?.domContentLoaded ?? 0)),
              load: formatNumber(Math.round(page()?.load ?? 0)),
            })}
          </p>
        </Show>
      </Show>

      <Section title={t('perf.findings')}>
        <Show when={capturedCount() || page()} fallback={<Hint>{t('perf.noTraffic')}</Hint>}>
          <Show
            when={findings().length}
            fallback={
              <p class="text-ok" role="status">
                {t('perf.clean')}
              </p>
            }
          >
            <ul class="flex flex-col gap-1" aria-label={t('perf.findings')}>
              <For each={findings().slice(0, 100)}>
                {(finding) => (
                  <li class="rounded-sm border border-line">
                    <details>
                      <summary class="flex cursor-pointer flex-wrap items-baseline gap-x-2 p-1.5">
                        <span
                          class={[
                            'font-semibold',
                            finding.severity === 'high' ? 'text-bad' : finding.severity === 'medium' ? 'text-warn' : '',
                          ]}
                        >
                          {t(`security.severities.${finding.severity}`)}
                        </span>
                        <span class="font-medium">
                          {t(`perf.rules.${finding.code}.title`, { subject: finding.subject, ...finding.params })}
                        </span>
                        <span class={[monoClass, 'min-w-0 truncate text-fg-2']}>{finding.subject}</span>
                      </summary>
                      <div class="flex flex-col gap-1.5 border-t border-line p-2">
                        <p>{t(`perf.rules.${finding.code}.fix`, { subject: finding.subject, ...finding.params })}</p>
                        <Show when={finding.requests.length}>
                          <RequestLinks ids={finding.requests} label={t('security.requestsLabel')} />
                        </Show>
                      </div>
                    </details>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Section>

      <Section title={t('perf.waterfall')}>
        <Show when={rows().length} fallback={<Hint>{t('perf.noTraffic')}</Hint>}>
          <p class="flex flex-wrap gap-x-3 text-fg-2" aria-hidden="true">
            <For each={Object.keys(PHASE_CLASS)}>
              {(name) => (
                <span class="inline-flex items-center gap-1">
                  <span class={['inline-block size-2 rounded-xs', PHASE_CLASS[name]]} />
                  {name}
                </span>
              )}
            </For>
          </p>
          <div class="max-h-96 overflow-auto rounded-sm border border-line" role="region" tabindex="0" aria-label={t('perf.waterfall')}>
            <For each={rows()}>
              {(row) => (
                <button
                  type="button"
                  class="grid w-full cursor-pointer grid-cols-[minmax(8rem,16rem)_1fr_5rem] items-center gap-2 border-b border-bg-3 px-1 text-start hover:bg-bg-2"
                  onClick={() => showInNetwork(row.id)}
                  title={row.url}
                >
                  <span class={[monoClass, 'truncate']}>{row.label}</span>
                  <span class="relative block h-3" aria-hidden="true">
                    <For each={row.phases}>
                      {(phase, index) => (
                        <span
                          class={['absolute top-0 block h-3', PHASE_CLASS[phase.name]]}
                          style={{
                            left: `${((row.start + row.phases.slice(0, index()).reduce((sum, p) => sum + p.ms, 0)) / span()) * 100}%`,
                            width: `${Math.max(0.3, (phase.ms / span()) * 100)}%`,
                          }}
                        />
                      )}
                    </For>
                  </span>
                  <span class={[monoClass, 'text-end text-fg-2']}>{formatNumber(Math.round(row.total))} ms</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Section>
    </Page>
  );
}
