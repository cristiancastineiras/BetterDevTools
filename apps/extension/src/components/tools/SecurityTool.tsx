import { analyzeSecurity, type Finding, type FindingCategory, type Severity } from '@betterdevtools/core';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { bodiesVersion, captureLog, capturedCount } from '../../state/capture.ts';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import SelectMenu from '../ui/SelectMenu.tsx';
import { monoClass } from '../ui/styles.ts';
import { Hint, Page, Row } from './kit.tsx';
import RequestLinks from './RequestLinks.tsx';

const SEVERITIES: Severity[] = ['high', 'medium', 'low', 'info'];
const CATEGORIES: FindingCategory[] = ['cors', 'csp', 'cookies', 'headers', 'mixed-content', 'tls'];
const SEVERITY_CLASS: Record<Severity, string> = { high: 'text-bad', medium: 'text-warn', low: 'text-fg', info: 'text-fg-2' };

const describe = (finding: Finding, part: 'title' | 'why' | 'fix') =>
  t(`security.rules.${finding.code as 'csp-missing'}.${part}`, { subject: finding.subject, ...finding.params });

/** CORS, CSP, cookies, security headers, mixed content and certificate problems found in the captured traffic. */
export default function SecurityTool() {
  const [severity, setSeverity] = createSignal<Severity | 'all'>('all');
  const [category, setCategory] = createSignal<FindingCategory | 'all'>('all');

  const findings = createMemo(() => {
    bodiesVersion(); // recomputed whenever the capture changes
    capturedCount();
    return analyzeSecurity(captureLog.entries);
  });
  const shown = createMemo(() =>
    findings().filter((f) => (severity() === 'all' || f.severity === severity()) && (category() === 'all' || f.category === category())),
  );
  const counts = createMemo(
    () => Object.fromEntries(SEVERITIES.map((s) => [s, findings().filter((f) => f.severity === s).length])) as Record<Severity, number>,
  );

  return (
    <Page>
      <Hint>{t('security.intro')}</Hint>
      <Row>
        <SegmentedControl
          label={t('security.severity')}
          value={severity()}
          onChange={setSeverity}
          options={[
            { value: 'all', label: `${t('security.all')} (${formatNumber(findings().length)})` },
            ...SEVERITIES.map((value) => ({ value, label: `${t(`security.severities.${value}`)} (${formatNumber(counts()[value])})` })),
          ]}
        />
        <SelectMenu
          label={t('security.category')}
          value={category()}
          onChange={(value) => setCategory(value as FindingCategory | 'all')}
          options={[
            { value: 'all', label: t('security.all') },
            ...CATEGORIES.map((value) => ({ value, label: t(`security.categories.${value}`) })),
          ]}
        />
      </Row>
      <Show when={capturedCount()} fallback={<Hint>{t('security.noTraffic')}</Hint>}>
        <Show
          when={shown().length}
          fallback={
            <p class="text-ok" role="status">
              {t('security.clean')}
            </p>
          }
        >
          <ul class="flex flex-col gap-1" aria-label={t('security.findings')}>
            <For each={shown()}>
              {(finding) => (
                <li class="rounded-sm border border-line">
                  <details>
                    <summary class="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 p-1.5">
                      <span class={['font-semibold', SEVERITY_CLASS[finding.severity]]}>
                        {t(`security.severities.${finding.severity}`)}
                      </span>
                      <span class="font-medium">{describe(finding, 'title')}</span>
                      <span class={[monoClass, 'text-fg-2 [overflow-wrap:anywhere]']}>{finding.subject}</span>
                      <span class="ms-auto text-fg-2">{t('security.requests', { count: formatNumber(finding.count) })}</span>
                    </summary>
                    <div class="flex flex-col gap-1.5 border-t border-line p-2">
                      <p>{describe(finding, 'why')}</p>
                      <p>
                        <strong>{t('security.fix')}</strong> {describe(finding, 'fix')}
                      </p>
                      <RequestLinks ids={finding.requests} label={t('security.requestsLabel')} />
                    </div>
                  </details>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </Page>
  );
}
