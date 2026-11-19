import { endpointLabel, formatBytes, percentile95, schemaToTs, type EndpointStats } from '@betterdevtools/core';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { currentModel } from '../../state/discovery.ts';
import CodeLines from '../ui/CodeLines.tsx';
import Icon from '../ui/Icon.tsx';
import MethodBadge, { StatusBadge } from '../ui/MethodBadge.tsx';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import { fieldClass, monoClass, sectionTitleClass } from '../ui/styles.ts';

type BodyView = 'schema' | 'types' | 'example';

/** The endpoint's key facts, then each part of it: parameters, request, every response. */
function EndpointDetail(props: { endpoint: EndpointStats }) {
  const model = () => currentModel()!;
  const statuses = createMemo(() => Object.keys(props.endpoint.statuses).sort());
  const [status, setStatus] = createSignal<string>('');
  const shownStatus = () => (status() && statuses().includes(status()) ? status() : (statuses().find((s) => s in props.endpoint.responses) ?? statuses()[0] ?? ''));
  const [view, setView] = createSignal<BodyView>('schema');

  const responseKey = () => {
    const wanted = shownStatus();
    return wanted in props.endpoint.responses ? wanted : `${wanted[0]}XX` in props.endpoint.responses ? `${wanted[0]}XX` : wanted;
  };
  const schema = createMemo(() => model().schemaOf(props.endpoint, responseKey()));
  const requestSchema = createMemo(() => model().schemaOf(props.endpoint, 'request'));
  const findings = createMemo(() => model().findingsOf(props.endpoint));
  const average = () => Math.round(props.endpoint.timing.n ? props.endpoint.timing.sum / props.endpoint.timing.n : 0);
  const incompleteTotal = () => Object.values(props.endpoint.incomplete).reduce((sum, count) => sum + count, 0);

  const bodyText = (kind: BodyView, value: ReturnType<typeof schema>, example: string | undefined): string => {
    if (kind === 'example') return example ?? t('discovery.noExample');
    if (!value) return t('discovery.noBody');
    return kind === 'types' ? schemaToTs(value) : JSON.stringify(value, null, 2);
  };

  return (
    <div class="flex flex-col gap-3 p-2">
      <header class="flex flex-wrap items-center gap-2">
        <MethodBadge method={props.endpoint.method} />
        <span class={[monoClass, 'min-w-0 font-medium [overflow-wrap:anywhere]']}>{props.endpoint.operation ?? props.endpoint.template}</span>
      </header>
      <p class="text-fg-2">
        {props.endpoint.origin} · {t('discovery.endpoint.calls', { count: formatNumber(props.endpoint.calls) })} ·{' '}
        {t('discovery.endpoint.timing', { avg: formatNumber(average()), p95: formatNumber(Math.round(percentile95(props.endpoint.timing))) })}
        <Show when={props.endpoint.size.max}> · {t('discovery.endpoint.size', { size: formatBytes(props.endpoint.size.max) })}</Show>
      </p>

      <Show when={incompleteTotal() > 0}>
        <p class="flex items-start gap-1 text-warn" role="note">
          <Icon name="warning" />
          <span>
            {t('discovery.endpoint.incomplete', {
              unavailable: props.endpoint.incomplete.unavailable + props.endpoint.incomplete.discarded,
              truncated: props.endpoint.incomplete.truncated,
              large: props.endpoint.incomplete.tooLarge,
            })}
          </span>
        </p>
      </Show>

      <Show when={props.endpoint.params.length}>
        <section>
          <h3 class={sectionTitleClass}>{t('discovery.endpoint.pathParams')}</h3>
          <ul class={[monoClass, 'flex flex-col gap-0.5']}>
            <For each={props.endpoint.params}>
              {(param) => (
                <li>
                  <span class="text-syn-prop">{param.name}</span> <span class="text-fg-2">{param.kind}</span> <span class="text-syn-str">{param.example}</span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={Object.keys(props.endpoint.query).length}>
        <section>
          <h3 class={sectionTitleClass}>{t('discovery.endpoint.query')}</h3>
          <ul class={[monoClass, 'flex flex-col gap-0.5']}>
            <For each={Object.entries(props.endpoint.query)}>
              {([name, param]) => (
                <li>
                  <span class="text-syn-prop">{name}</span> <span class="text-fg-2">{Object.keys(param.types).join(' | ')}</span>
                  <Show when={param.count < props.endpoint.calls}> <span class="text-warn">{t('discovery.endpoint.optional')}</span></Show>
                  <Show when={param.examples[0]}> <span class="text-syn-str">{param.examples[0]}</span></Show>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={Object.keys(props.endpoint.auth).length || Object.keys(props.endpoint.requestHeaders).length}>
        <section>
          <h3 class={sectionTitleClass}>{t('discovery.endpoint.headers')}</h3>
          <Show when={Object.keys(props.endpoint.auth).length}>
            <p>{t('discovery.endpoint.auth', { schemes: Object.keys(props.endpoint.auth).join(', ') })}</p>
          </Show>
          <p class={[monoClass, 'text-fg-2 [overflow-wrap:anywhere]']}>{Object.keys(props.endpoint.requestHeaders).join(', ')}</p>
        </section>
      </Show>

      <Show when={requestSchema() || Object.keys(props.endpoint.formFields).length}>
        <section class="flex flex-col gap-1">
          <h3 class={sectionTitleClass}>{t('discovery.endpoint.request')}</h3>
          <Show when={Object.keys(props.endpoint.formFields).length}>
            <p class={monoClass}>{Object.keys(props.endpoint.formFields).join(', ')}</p>
          </Show>
          <Show when={requestSchema()}>
            {(value) => <CodeLines text={schemaToTs(value())} lang="js" label={t('discovery.endpoint.request')} />}
          </Show>
          <Show when={props.endpoint.requestExample}>
            {(example) => <CodeLines text={example()} lang="json" label={t('discovery.endpoint.requestExample')} />}
          </Show>
        </section>
      </Show>

      <section class="flex flex-col gap-1">
        <h3 class={sectionTitleClass}>{t('discovery.endpoint.responses')}</h3>
        <div class="flex flex-wrap items-center gap-1">
          <For each={statuses()}>
            {(code) => (
              <button
                type="button"
                class={['cursor-pointer rounded-md border p-0.5', shownStatus() === code ? 'border-accent bg-sel' : 'border-transparent hover:bg-bg-3']}
                aria-pressed={shownStatus() === code ? 'true' : 'false'}
                aria-label={t('discovery.endpoint.statusCount', { status: code, count: props.endpoint.statuses[code] ?? 0 })}
                onClick={() => setStatus(code)}
              >
                <StatusBadge status={code === 'failed' ? 0 : Number(code)} error={code === 'failed' ? 'failed' : undefined} />
                <span class="ms-1 text-fg-2">×{props.endpoint.statuses[code]}</span>
              </button>
            )}
          </For>
        </div>
        <SegmentedControl
          label={t('discovery.endpoint.view')}
          value={view()}
          onChange={setView}
          options={[
            { value: 'schema', label: t('discovery.endpoint.viewSchema') },
            { value: 'types', label: t('discovery.endpoint.viewTypes') },
            { value: 'example', label: t('discovery.endpoint.viewExample') },
          ]}
        />
        <p class="text-fg-2">{t('discovery.inferredNote')}</p>
        <CodeLines
          text={bodyText(view(), schema(), props.endpoint.responseExamples[responseKey()]?.[0])}
          lang={view() === 'types' ? 'js' : 'json'}
          label={t('discovery.endpoint.responseBody', { status: shownStatus() })}
        />
      </section>

      <Show when={findings().length}>
        <section>
          <h3 class={sectionTitleClass}>{t('discovery.endpoint.findings')}</h3>
          <ul class="flex flex-col gap-0.5">
            <For each={findings().flatMap((entry) => entry.findings.slice(0, 15).map((finding) => ({ ...finding, status: entry.status })))}>
              {(finding) => (
                <li class="flex flex-wrap gap-x-2">
                  <span class={[badgeFor(finding.kind), 'rounded-sm px-1 text-small']}>{t(`discovery.finding.${finding.kind}`)}</span>
                  <span class={monoClass}>
                    {finding.status} {finding.path}
                  </span>
                  <span class="text-fg-2">{finding.detail}</span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={props.endpoint.validation.violations.length}>
        <section>
          <h3 class={sectionTitleClass}>{t('discovery.endpoint.violations')}</h3>
          <ul class="flex flex-col gap-0.5">
            <For each={props.endpoint.validation.violations}>
              {(violation) => (
                <li class="text-bad">
                  <span class={monoClass}>
                    {violation.status} {violation.path}
                  </span>{' '}
                  — {violation.message} ×{violation.count}
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}

const badgeFor = (kind: string) => (kind === 'type-conflict' ? 'bg-bad/15 text-bad' : kind === 'nullable' ? 'bg-warn/15 text-warn' : 'bg-bg-3 text-fg-2');

/** All discovered endpoints, with a filter, and the selected one's details beside it. */
export default function EndpointsTab() {
  const model = () => currentModel();
  const [query, setQuery] = createSignal('');
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  const [sortBy, setSortBy] = createSignal<'path' | 'calls'>('path');

  const rows = createMemo(() => {
    const list = model()?.endpoints() ?? [];
    const needle = query().trim().toLowerCase();
    const filtered = needle ? list.filter((endpoint) => endpointLabel(endpoint).toLowerCase().includes(needle) || endpoint.origin.toLowerCase().includes(needle)) : list;
    return filtered.toSorted((a, b) => (sortBy() === 'calls' ? b.calls - a.calls : a.template.localeCompare(b.template) || a.method.localeCompare(b.method)));
  });
  const selected = createMemo(() => {
    const found = rows().find((endpoint) => endpoint.key === selectedKey());
    return found ?? null;
  });

  return (
    <div class="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section class="flex min-h-0 flex-col border-line md:border-e" aria-label={t('discovery.tabs.endpoints')}>
        <div class="flex flex-wrap items-center gap-2 border-b border-line p-1">
          <input
            type="search"
            class={[fieldClass, 'min-w-40 flex-1']}
            aria-label={t('discovery.endpoints.filter')}
            placeholder={t('discovery.endpoints.filter')}
            value={query()}
            spellcheck={false}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <SegmentedControl
            label={t('discovery.endpoints.sort')}
            value={sortBy()}
            onChange={setSortBy}
            options={[
              { value: 'path', label: t('discovery.endpoints.sortPath') },
              { value: 'calls', label: t('discovery.endpoints.sortCalls') },
            ]}
          />
        </div>
        <Show when={rows().length} fallback={<p class="p-3 text-fg-2">{t('discovery.endpoints.none')}</p>}>
          <ul class="min-h-0 flex-1 overflow-auto" role="listbox" aria-label={t('discovery.tabs.endpoints')}>
            <For each={rows()} keyed={false}>
              {(endpoint) => (
                <li
                  role="option"
                  tabindex="0"
                  aria-selected={endpoint().key === selected()?.key ? 'true' : 'false'}
                  class={['flex cursor-pointer items-center gap-2 border-b border-bg-3 px-2 py-1 hover:bg-bg-3', { 'bg-sel': endpoint().key === selected()?.key }]}
                  onClick={() => setSelectedKey(endpoint().key)}
                  onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), setSelectedKey(endpoint().key))}
                >
                  <MethodBadge method={endpoint().method} />
                  <span class={[monoClass, 'min-w-0 flex-1 truncate']} title={`${endpoint().origin}${endpoint().template}`}>
                    {endpoint().operation ?? endpoint().template}
                  </span>
                  <span class="flex shrink-0 items-center gap-1">
                    <For each={Object.keys(endpoint().statuses).sort().slice(0, 3)}>
                      {(code) => <StatusBadge status={code === 'failed' ? 0 : Number(code)} error={code === 'failed' ? 'failed' : undefined} />}
                    </For>
                    <span class="w-16 text-end text-fg-2 tabular-nums">{t('discovery.endpoint.calls', { count: formatNumber(endpoint().calls) })}</span>
                    <Show when={endpoint().validation.failed > 0}>
                      <span class="text-bad" title={t('discovery.endpoint.violations')}>
                        <Icon name="warning" />
                      </span>
                    </Show>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
      <section class="min-h-0 overflow-auto" aria-label={t('discovery.endpoint.details')}>
        <Switch>
          <Match when={selected()}>{(endpoint) => <EndpointDetail endpoint={endpoint()} />}</Match>
          <Match when={true}>
            <p class="p-4 text-fg-2">{t('discovery.endpoints.pick')}</p>
          </Match>
        </Switch>
      </section>
    </div>
  );
}
