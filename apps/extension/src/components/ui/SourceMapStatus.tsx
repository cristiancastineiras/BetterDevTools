import { findSourceMapRef, originalPosition, parseSourceMap, type Header, type SourceMap } from '@betterdevtools/core';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import { requestOrigin } from '../../lib/devtools.ts';
import { fetchCapped } from '../../lib/io.ts';
import CodeLines from './CodeLines.tsx';
import Icon from './Icon.tsx';
import IconButton from './IconButton.tsx';
import SelectMenu from './SelectMenu.tsx';
import { monoClass } from './styles.ts';

/** Source maps and original sources larger than this are refused. */
const MAX_DOWNLOAD_BYTES = 10 << 20;

type StatusKey = 'none' | 'invalid' | 'embedded' | 'found' | 'loaded' | 'unavailable';

const sourceLanguage = (url: string) => (/\.(css|scss|less)$/i.test(url) ? 'css' : 'js');

/**
 * Source map state of a script or stylesheet. External maps are only downloaded when the user
 * clicks "Load source map"; picking a position in the Raw view shows where it came from.
 */
export default function SourceMapStatus(props: {
  code: string;
  headers: Header[];
  /** URL of the script or stylesheet, to resolve relative map and source URLs. */
  url: string;
  /** Generated 0-based position picked in the Raw view. */
  position: { line: number; column: number } | null;
}) {
  const reference = createMemo(() => findSourceMapRef(props.code, props.headers, props.url));
  // Everything below resets when another body (another reference) is shown.
  const [parsedMap, setParsedMap] = createSignal(() => {
    const ref = reference();
    return ref.kind === 'inline' ? parseSourceMap(ref.json, null) : null;
  });
  const [downloadError, setDownloadError] = createSignal(() => {
    void reference();
    return '';
  });
  const [downloadedSources, setDownloadedSources] = createSignal<Record<number, string>>(() => {
    void reference();
    return {};
  });
  const [isDownloading, setIsDownloading] = createSignal(false);
  let downloadController: AbortController | null = null;

  // switching to another body cancels a download still running for this one
  createEffect(reference, () => () => downloadController?.abort());

  const sourceMap = createMemo<SourceMap | null>(() => {
    const result = parsedMap();
    return result?.ok ? result.map : null;
  });
  const externalUrl = createMemo(() => {
    const ref = reference();
    return ref.kind === 'external' ? ref.url : null;
  });
  const statusKey = createMemo<StatusKey>(() => {
    const ref = reference();
    if (ref.kind === 'none') return 'none';
    if (ref.kind === 'invalid' || parsedMap()?.ok === false) return 'invalid';
    if (ref.kind === 'inline') return 'embedded';
    if (downloadError()) return 'unavailable';
    return sourceMap() ? 'loaded' : 'found';
  });
  const problem = createMemo(() => {
    const ref = reference();
    const result = parsedMap();
    if (ref.kind === 'invalid') return ref.error;
    if (result && !result.ok) return result.error;
    return downloadError();
  });
  const mapped = createMemo(() => {
    const map = sourceMap();
    return map && props.position ? originalPosition(map, props.position.line, props.position.column) : null;
  });
  // the original source shown below: the one the picked position maps to, or the first
  const [chosenSource, setChosenSource] = createSignal(() => {
    void reference();
    return String(mapped()?.source ?? 0);
  });
  const sourceIndex = createMemo(() => Number(chosenSource()));
  const sourceName = () => sourceMap()?.sources[sourceIndex()] ?? '';
  const sourceContent = createMemo(() => {
    const map = sourceMap();
    const index = sourceIndex();
    return map ? (map.sourcesContent[index] ?? downloadedSources()[index] ?? null) : null;
  });

  async function download(url: string, onText: (text: string) => void) {
    downloadController?.abort();
    const controller = new AbortController();
    downloadController = controller;
    setIsDownloading(true);
    setDownloadError('');
    try {
      await requestOrigin(url); // only this origin; refused or unanswered means a plain CORS fetch
      onText(await fetchCapped(url, MAX_DOWNLOAD_BYTES, controller.signal));
    } catch (error) {
      if (!controller.signal.aborted)
        setDownloadError(t('sourcemap.fetchFailed', { url, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      if (downloadController === controller) setIsDownloading(false);
    }
  }

  function loadMap() {
    const url = externalUrl();
    if (url) void download(url, (text) => setParsedMap(parseSourceMap(text, url)));
  }

  function loadSource() {
    const index = sourceIndex();
    const url = sourceName();
    if (url) void download(url, (text) => setDownloadedSources((previous) => ({ ...previous, [index]: text })));
  }

  return (
    <section aria-label={t('sourcemap.label')} class="flex flex-col gap-1 border-y border-line py-1">
      <div class="flex flex-wrap items-center gap-2">
        <Icon name="sourcemap" />
        <span>
          {t('sourcemap.label')}: <strong data-testid="sourcemap-status">{t(`sourcemap.states.${statusKey()}`)}</strong>
        </span>
        <Show when={externalUrl()}>
          {(url) => (
            <>
              <Show when={!sourceMap()}>
                <IconButton
                  icon="export"
                  label={t('sourcemap.loadFrom', { url: url() })}
                  text={t('sourcemap.load')}
                  busy={isDownloading()}
                  onClick={loadMap}
                />
              </Show>
              <span class={[monoClass, 'min-w-0 truncate text-fg-2']} title={url()}>
                {url()}
              </span>
            </>
          )}
        </Show>
      </div>
      <Show when={problem()}>
        <p class="flex items-center gap-1 text-warn">
          <Icon name="warning" />
          {problem()}
        </p>
      </Show>
      <Show when={sourceMap()}>
        {(map) => (
          <>
            <p class="text-fg-2">{t('sourcemap.disclaimer')}</p>
            <Show when={props.position}>
              {(position) => (
                <p class={monoClass} role="status">
                  {(() => {
                    const generated = `${position().line + 1}:${position().column + 1}`;
                    const original = mapped();
                    if (!original) return t('sourcemap.unmapped', { generated });
                    const where = `${map().sources[original.source] ?? ''}:${original.line + 1}:${original.column + 1}`;
                    return t('sourcemap.mapped', { generated, original: original.name ? `${where} (${original.name})` : where });
                  })()}
                </p>
              )}
            </Show>
            <div class="flex items-center gap-2">
              <span>{t('sourcemap.originalSource')}</span>
              <SelectMenu
                label={t('sourcemap.originalSource')}
                value={chosenSource()}
                onChange={setChosenSource}
                options={map().sources.map((source, index) => ({
                  value: String(index),
                  label: source,
                  description: map().sourcesContent[index] ? t('sourcemap.embeddedTag') : undefined,
                }))}
              />
            </div>
            <Show
              when={sourceContent()}
              fallback={
                <p class="flex items-center gap-2 text-fg-2">
                  {t('sourcemap.notEmbedded')}
                  <IconButton
                    icon="export"
                    label={t('sourcemap.loadSourceFrom', { url: sourceName() })}
                    text={t('sourcemap.loadSource')}
                    busy={isDownloading()}
                    onClick={loadSource}
                  />
                </p>
              }
            >
              {(content) => (
                <CodeLines
                  text={content()}
                  lang={sourceLanguage(sourceName())}
                  label={t('sourcemap.originalSourceOf', { source: sourceName() })}
                  highlightLine={mapped()?.source === sourceIndex() ? mapped()?.line : undefined}
                />
              )}
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}
