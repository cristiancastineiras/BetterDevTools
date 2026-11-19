import type { DiscoveryExportFormat } from '@betterdevtools/core';
import { createMemo, createSignal, Match, onSettled, Show, Switch } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { attachedToDevtools, capturedCount, isRecording } from '../../state/capture.ts';
import {
  analyzeCapturedTraffic,
  closeSession,
  currentModel,
  discoveryStatus,
  elapsedMs,
  exportSession,
  loadSavedList,
  pauseRecording,
  resumeRecording,
  startRecording,
  stopAndAnalyze,
} from '../../state/discovery.ts';
import Tabs from '../Tabs.tsx';
import Icon from '../ui/Icon.tsx';
import IconButton from '../ui/IconButton.tsx';
import SelectMenu from '../ui/SelectMenu.tsx';
import { fieldClass, sectionTitleClass } from '../ui/styles.ts';
import ContractsTab from './ContractsTab.tsx';
import CoverageTab from './CoverageTab.tsx';
import EndpointsTab from './EndpointsTab.tsx';
import GraphTab from './GraphTab.tsx';
import ScenariosTab from './ScenariosTab.tsx';
import SchemasTab from './SchemasTab.tsx';
import SessionsTab from './SessionsTab.tsx';

type DiscoveryTab = 'endpoints' | 'schemas' | 'contracts' | 'dependencies' | 'coverage' | 'scenarios' | 'sessions';

const EXPORT_FORMATS: DiscoveryExportFormat[] = ['package', 'openapi-yaml', 'openapi-json', 'schemas', 'typescript', 'markdown', 'report', 'graph'];

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

function Tile(props: { value: number; label: string }) {
  return (
    <div class="flex min-w-24 flex-col rounded-md border border-line bg-bg-2 px-3 py-1.5">
      <span class="text-base font-semibold tabular-nums">{formatNumber(props.value)}</span>
      <span class="text-fg-2">{props.label}</span>
    </div>
  );
}

/**
 * API AutoDiscovery: press Start, use the app, and the endpoints, schemas, contracts and
 * dependencies of its API are mapped from the traffic, with nothing to import or configure.
 */
export default function DiscoveryView() {
  const [tab, setTab] = createSignal<DiscoveryTab>('endpoints');
  const [nameDraft, setNameDraft] = createSignal('');
  const [exportFormat, setExportFormat] = createSignal<DiscoveryExportFormat>('package');
  onSettled(() => {
    void loadSavedList();
  });

  const model = () => currentModel();
  const live = () => discoveryStatus() === 'recording' || discoveryStatus() === 'paused';
  const endpointCount = createMemo(() => model()?.endpoints().length ?? 0);
  const overview = createMemo(() => {
    const current = model();
    if (!current) return null;
    const endpoints = current.endpoints();
    return {
      endpoints: endpoints.length,
      calls: current.state.seen - current.state.ignored,
      withSchema: endpoints.filter((endpoint) => Object.values(endpoint.responses).some((acc) => acc.n > 0)).length,
      origins: new Set(endpoints.map((endpoint) => endpoint.origin)).size,
      scenarios: current.state.scenarios.length,
      ignored: current.state.ignored,
    };
  });

  const statusLabel = () => t(`discovery.${discoveryStatus()}`);

  return (
    <div class="flex h-full min-h-0 flex-col">
      <header class="flex flex-col gap-2 border-b border-line p-2">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-sm font-semibold">{t('discovery.title')}</h2>
          <span
            class={[
              'inline-flex items-center gap-1 rounded-full border px-2 text-small font-semibold',
              discoveryStatus() === 'recording' ? 'border-bad bg-bad/10 text-bad' : 'border-line text-fg-2',
            ]}
            role="status"
          >
            <span class={['inline-block size-2 rounded-full', discoveryStatus() === 'recording' ? 'animate-pulse bg-bad' : 'bg-fg-2']} aria-hidden="true" />
            {statusLabel()}
          </span>
          <Show when={model()}>
            {(current) => (
              <span class="text-fg-2">
                {t('discovery.session')}: <span class="text-fg">{current().state.name}</span>
              </span>
            )}
          </Show>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Switch>
            <Match when={discoveryStatus() === 'recording'}>
              <IconButton icon="pause" label={t('discovery.pause')} text={t('discovery.pause')} onClick={pauseRecording} />
              <IconButton icon="search" variant="primary" label={t('discovery.stopHint')} text={t('discovery.stop')} onClick={stopAndAnalyze} />
            </Match>
            <Match when={discoveryStatus() === 'paused'}>
              <IconButton icon="record" variant="primary" label={t('discovery.resume')} text={t('discovery.resume')} onClick={resumeRecording} />
              <IconButton icon="search" label={t('discovery.stopHint')} text={t('discovery.stop')} onClick={stopAndAnalyze} />
            </Match>
            <Match when={true}>
              <input
                class={[fieldClass, 'w-52']}
                aria-label={t('discovery.sessionName')}
                placeholder={t('discovery.sessionName')}
                value={nameDraft()}
                onInput={(event) => setNameDraft(event.currentTarget.value)}
                onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), startRecording(nameDraft()))}
              />
              <IconButton
                icon="record"
                variant="primary"
                label={t('discovery.startHint')}
                text={discoveryStatus() === 'stopped' ? t('discovery.startNew') : t('discovery.start')}
                disabled={!attachedToDevtools}
                onClick={() => startRecording(nameDraft())}
              />
            </Match>
          </Switch>
          <IconButton
            icon="filter"
            label={t('discovery.analyzeCaptureHint')}
            text={t('discovery.analyzeCapture')}
            disabled={!capturedCount() || live()}
            onClick={analyzeCapturedTraffic}
          />
          <Show when={model() && !live()}>
            <IconButton icon="close" variant="ghost" label={t('discovery.closeSession')} text={t('discovery.closeSession')} onClick={closeSession} />
          </Show>

          <span class="ms-auto flex flex-wrap items-center gap-2">
            <SelectMenu
              label={t('discovery.export.format')}
              value={exportFormat()}
              onChange={(value) => setExportFormat(EXPORT_FORMATS.find((format) => format === value) ?? 'package')}
              options={EXPORT_FORMATS.map((format) => ({ value: format, label: t(`discovery.export.formats.${format}`) }))}
            />
            <IconButton
              icon="export"
              label={t('discovery.export.hint')}
              text={t('discovery.export.button')}
              disabled={!endpointCount()}
              onClick={() => exportSession(exportFormat())}
            />
          </span>
        </div>

        <Show when={model()}>
          <p class="flex flex-wrap gap-x-4 text-fg-2 tabular-nums">
            <span>
              {t('discovery.duration')}: <span class="text-fg">{formatDuration(elapsedMs())}</span>
            </span>
            <span>
              {t('discovery.requests')}: <span class="text-fg">{formatNumber(model()!.state.seen)}</span>
            </span>
          </p>
        </Show>
        <Show when={!attachedToDevtools}>
          <p class="flex items-center gap-1 text-warn" role="note">
            <Icon name="warning" /> {t('discovery.needsDevtools')}
          </p>
        </Show>
        <Show when={live() && !isRecording()}>
          <p class="flex items-center gap-1 text-warn" role="note">
            <Icon name="warning" /> {t('discovery.networkPaused')}
          </p>
        </Show>
      </header>

      <Show
        when={model()}
        fallback={
          <div class="flex flex-1 flex-col items-start gap-3 overflow-auto p-4">
            <h3 class={sectionTitleClass}>{t('discovery.emptyTitle')}</h3>
            <ol class="ms-5 flex max-w-2xl list-decimal flex-col gap-1">
              <li>{t('discovery.step1')}</li>
              <li>{t('discovery.step2')}</li>
              <li>{t('discovery.step3')}</li>
            </ol>
            <p class="max-w-2xl text-fg-2">{t('discovery.tagline')}</p>
            <p class="max-w-2xl text-fg-2">{t('discovery.privacy')}</p>
            <div class="w-full border-t border-line pt-2">
              <h3 class={sectionTitleClass}>{t('discovery.tabs.sessions')}</h3>
              <SessionsTab />
            </div>
          </div>
        }
      >
        <Show when={overview()}>
          {(data) => (
            <section class="flex flex-wrap gap-2 border-b border-line p-2" aria-label={t('discovery.overview.label')}>
              <Tile value={data().endpoints} label={t('discovery.overview.endpoints')} />
              <Tile value={data().calls} label={t('discovery.overview.calls')} />
              <Tile value={data().withSchema} label={t('discovery.overview.schemas')} />
              <Tile value={data().origins} label={t('discovery.overview.origins')} />
              <Tile value={data().scenarios} label={t('discovery.overview.scenarios')} />
              <Tile value={data().ignored} label={t('discovery.overview.ignored')} />
            </section>
          )}
        </Show>
        <div class="min-h-0 flex-1">
          <Tabs
            label={t('discovery.tabs.label')}
            value={tab()}
            onChange={setTab}
            panelClass="overflow-hidden"
            tabs={[
              { id: 'endpoints', label: t('discovery.tabs.endpoints') },
              { id: 'schemas', label: t('discovery.tabs.schemas') },
              { id: 'contracts', label: t('discovery.tabs.contracts') },
              { id: 'dependencies', label: t('discovery.tabs.dependencies') },
              { id: 'coverage', label: t('discovery.tabs.coverage') },
              { id: 'scenarios', label: t('discovery.tabs.scenarios') },
              { id: 'sessions', label: t('discovery.tabs.sessions') },
            ]}
          >
            <Switch>
              <Match when={tab() === 'endpoints'}>
                <EndpointsTab />
              </Match>
              <Match when={tab() === 'schemas'}>
                <SchemasTab />
              </Match>
              <Match when={tab() === 'contracts'}>
                <ContractsTab />
              </Match>
              <Match when={tab() === 'dependencies'}>
                <GraphTab />
              </Match>
              <Match when={tab() === 'coverage'}>
                <CoverageTab />
              </Match>
              <Match when={tab() === 'scenarios'}>
                <ScenariosTab />
              </Match>
              <Match when={tab() === 'sessions'}>
                <SessionsTab />
              </Match>
            </Switch>
          </Tabs>
        </div>
      </Show>
    </div>
  );
}
