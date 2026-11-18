import {
  DEFAULT_EXPORT,
  exportChunks,
  formatBytes,
  FORMATS,
  type Captured,
  type ExportFormat,
  type ExportOptions,
} from '@betterdevtools/core';
import { createMemo, createSignal, createStore, createUniqueId, Show, snapshot } from 'solid-js';
import { formatNumber, t } from '../i18n/index.ts';
import { extensionVersion } from '../lib/devtools.ts';
import { download, yieldToMain } from '../lib/io.ts';
import { bodiesVersion, capturedCount, captureLog, selectedCount, selectedRequests, visibleRequests } from '../state/capture.ts';
import { announce, closeDialog, openDialog, reportError, type ExportScope } from '../state/ui.ts';
import Modal from './ui/Modal.tsx';
import SelectMenu from './ui/SelectMenu.tsx';
import { buttonClass, fieldClass, monoClass } from './ui/styles.ts';

const FILE_TYPES: Record<ExportFormat, { extension: string; mime: string }> = {
  har: { extension: 'har', mime: 'application/json' },
  json: { extension: 'json', mime: 'application/json' },
  ndjson: { extension: 'ndjson', mime: 'application/x-ndjson' },
  csv: { extension: 'csv', mime: 'text/csv' },
  toon: { extension: 'toon', mime: 'text/plain' },
};
/** Strings are moved into Blob parts past this size, so the JS heap never holds the whole file. */
const BLOB_PART_CHARS = 4 << 20;
/** The export yields to the browser (and shows progress) every this many requests. */
const ENTRIES_PER_SLICE = 250;
const ESTIMATE_SAMPLE = 25;
const PREVIEW_CHARS = 4000;

const bodyOf = (id: number) => captureLog.body(id);

/** One "which requests" radio button. */
function ScopeOption(props: { group: string; checked: boolean; label: string; onSelect: () => void }) {
  return (
    <label class="flex cursor-pointer items-center gap-1">
      <input type="radio" name={props.group} checked={props.checked} onChange={() => props.onSelect()} />
      {props.label}
    </label>
  );
}

/** Export of captured requests as HAR, JSON, NDJSON, CSV or TOON, redacted by default. */
export default function ExportDialog() {
  const titleId = createUniqueId();
  const request = createMemo(() => {
    const dialog = openDialog();
    return dialog?.kind === 'export' ? dialog : null;
  });
  const [scope, setScope] = createSignal<ExportScope>('filtered');
  const [options, setOptions] = createStore<ExportOptions>({ ...DEFAULT_EXPORT });
  const [extraSecretNames, setExtraSecretNames] = createSignal('');
  const [maxBodyKB, setMaxBodyKB] = createSignal(0);
  const [plainTextAcknowledged, setPlainTextAcknowledged] = createSignal(false);
  const [progress, setProgress] = createSignal<number | null>(null);
  let exportController: AbortController | null = null;

  // the request lists (and the previews derived from them) are only computed while the dialog is open
  const requests = createMemo<Captured[]>(() => {
    if (!request()) return [];
    capturedCount();
    if (scope() === 'selected') {
      selectedCount();
      return selectedRequests();
    }
    return scope() === 'filtered' ? visibleRequests() : captureLog.entries;
  });

  const exportOptions = createMemo<ExportOptions>(() => ({
    format: options.format,
    request: options.request,
    response: options.response,
    bodies: options.bodies,
    timings: options.timings,
    meta: options.meta,
    redact: options.redact,
    maxBodyChars: Math.max(0, maxBodyKB()) * 1024,
    extraSecrets: extraSecretNames().split(','),
    creatorVersion: extensionVersion(),
  }));

  const preview = createMemo(() =>
    request() ? [...exportChunks(requests().slice(0, 2), bodyOf, exportOptions())].join('').slice(0, PREVIEW_CHARS) : '',
  );
  // size estimate from a sample, scaled to the whole list
  const estimatedBytes = createMemo(() => {
    const list = requests();
    const sample = list.slice(0, ESTIMATE_SAMPLE);
    if (!sample.length) return 0;
    return Math.round((new Blob([...exportChunks(sample, bodyOf, exportOptions())]).size / sample.length) * list.length);
  });
  const incompleteBodies = createMemo(() => {
    if (!request() || !options.bodies || options.response !== 'full' || options.format === 'csv') return null;
    bodiesVersion();
    const counts = { truncated: 0, missing: 0 };
    const cut = maxBodyKB() * 1024;
    for (const captured of requests()) {
      const body = captureLog.body(captured.id);
      if (body.state === 'truncated' || (cut > 0 && body.text.length > cut)) counts.truncated++;
      else if (body.state === 'unavailable' || body.state === 'discarded') counts.missing++;
    }
    return counts.truncated || counts.missing ? counts : null;
  });
  const canExport = () => requests().length > 0 && (options.redact || plainTextAcknowledged());

  function prepare() {
    setScope(request()?.scope ?? 'filtered');
    setPlainTextAcknowledged(false);
  }

  async function runExport() {
    const list = requests().slice(); // capture keeps running: export a stable snapshot
    const frozenOptions = { ...snapshot(exportOptions()) };
    const controller = new AbortController();
    exportController = controller;
    setProgress(0);
    try {
      const parts: Blob[] = [];
      let pending: string[] = [];
      let pendingChars = 0;
      let written = 0;
      for (const chunk of exportChunks(list, bodyOf, frozenOptions)) {
        pending.push(chunk);
        pendingChars += chunk.length;
        if (pendingChars > BLOB_PART_CHARS) {
          parts.push(new Blob(pending));
          pending = [];
          pendingChars = 0;
        }
        if (++written % ENTRIES_PER_SLICE === 0) {
          setProgress(Math.min(written, list.length));
          await yieldToMain();
          controller.signal.throwIfAborted();
        }
      }
      parts.push(new Blob(pending));
      const fileType = FILE_TYPES[frozenOptions.format];
      const file = new Blob(parts, { type: fileType.mime });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      download(`betterdevtools-${stamp}.${fileType.extension}`, file);
      announce(
        t('status.exported', {
          count: formatNumber(list.length),
          format: t(`export.formats.${frozenOptions.format}`),
          size: formatBytes(file.size),
        }),
      );
      closeDialog();
    } catch (error) {
      if (controller.signal.aborted) announce(t('status.exportCancelled'));
      else reportError(t('status.exportFailed'), error);
    } finally {
      setProgress(null);
      exportController = null;
    }
  }

  function onDismiss() {
    exportController?.abort();
    closeDialog();
  }

  return (
    <Modal open={request() !== null} onOpen={prepare} onDismiss={onDismiss} labelledBy={titleId}>
      <form
        class="flex w-[40rem] max-w-full flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void runExport();
        }}
      >
        <h2 id={titleId} class="text-sm font-semibold">
          {t('export.title')}
        </h2>
        <fieldset class="flex flex-wrap gap-3">
          <legend class="text-fg-2">{t('export.requests')}</legend>
          <ScopeOption
            group={`${titleId}-scope`}
            checked={scope() === 'selected'}
            label={t('export.selected', { count: selectedCount() || (selectedRequests().length ? 1 : 0) })}
            onSelect={() => setScope('selected')}
          />
          <ScopeOption
            group={`${titleId}-scope`}
            checked={scope() === 'filtered'}
            label={t('export.filtered', { count: formatNumber(visibleRequests().length) })}
            onSelect={() => setScope('filtered')}
          />
          <ScopeOption
            group={`${titleId}-scope`}
            checked={scope() === 'all'}
            label={t('export.all', { count: formatNumber(capturedCount()) })}
            onSelect={() => setScope('all')}
          />
        </fieldset>
        <div class="flex items-center gap-2">
          <span class="text-fg-2">{t('export.format')}</span>
          <SelectMenu
            label={t('export.format')}
            value={options.format}
            options={FORMATS.map((format) => ({
              value: format,
              label: t(`export.formats.${format}`),
              description: t(`export.formatNotes.${format}`),
            }))}
            onChange={(value) =>
              setOptions((draft) => {
                draft.format = FORMATS.find((format) => format === value) ?? draft.format;
              })
            }
          />
        </div>
        <Show when={options.format !== 'csv'}>
          <fieldset class="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <legend class="text-fg-2">{t('export.content')}</legend>
            <span class="flex items-center gap-1">
              {t('export.request')}
              <SelectMenu
                label={t('export.requestContent')}
                value={options.request}
                options={[
                  { value: 'full', label: t('export.complete') },
                  { value: 'summary', label: t('export.methodAndUrl') },
                ]}
                onChange={(value) =>
                  setOptions((draft) => {
                    draft.request = value === 'summary' ? 'summary' : 'full';
                  })
                }
              />
            </span>
            <span class="flex items-center gap-1">
              {t('export.response')}
              <SelectMenu
                label={t('export.responseContent')}
                value={options.response}
                options={[
                  { value: 'full', label: t('export.complete') },
                  { value: 'summary', label: t('export.statusAndType') },
                ]}
                onChange={(value) =>
                  setOptions((draft) => {
                    draft.response = value === 'summary' ? 'summary' : 'full';
                  })
                }
              />
            </span>
            <label class="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={options.bodies}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setOptions((draft) => {
                    draft.bodies = checked;
                  });
                }}
              />
              {t('export.bodies')}
            </label>
            <label class={['flex items-center gap-1', { 'opacity-50': options.format === 'har' }]}>
              <input
                type="checkbox"
                checked={options.timings}
                disabled={options.format === 'har'}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setOptions((draft) => {
                    draft.timings = checked;
                  });
                }}
              />
              {t('export.timings')}
            </label>
            <label class="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={options.meta}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setOptions((draft) => {
                    draft.meta = checked;
                  });
                }}
              />
              {t('export.metadata')}
            </label>
            <label class="flex items-center gap-1">
              {t('export.cutBodies')}
              <input
                class={[fieldClass, 'w-20']}
                type="number"
                min="0"
                value={maxBodyKB()}
                onInput={(event) => setMaxBodyKB(Number(event.currentTarget.value) || 0)}
              />
              {t('export.cutUnit')}
            </label>
          </fieldset>
        </Show>
        <fieldset class="flex flex-col gap-1">
          <legend class="text-fg-2">{t('export.privacy')}</legend>
          <label class="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={options.redact}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setOptions((draft) => {
                  draft.redact = checked;
                });
              }}
            />
            {t('export.redact')}
          </label>
          <Show
            when={options.redact}
            fallback={
              <label class="flex cursor-pointer items-center gap-1 text-warn">
                <input
                  type="checkbox"
                  checked={plainTextAcknowledged()}
                  onChange={(event) => setPlainTextAcknowledged(event.currentTarget.checked)}
                />
                {t('export.acknowledge')}
              </label>
            }
          >
            <label class="flex flex-wrap items-center gap-1">
              {t('export.alsoRedact')}
              <input
                class={[fieldClass, 'w-64']}
                value={extraSecretNames()}
                placeholder="x-session, otp"
                onInput={(event) => setExtraSecretNames(event.currentTarget.value)}
              />
            </label>
          </Show>
        </fieldset>
        <p>
          {t('export.summary', { count: formatNumber(requests().length), size: formatBytes(estimatedBytes()) })}
          <Show when={incompleteBodies()}>
            {(counts) => (
              <>
                {' · '}
                <span class="text-warn" role="note">
                  {t('export.incomplete', { truncated: counts().truncated, missing: counts().missing })}
                </span>
              </>
            )}
          </Show>
        </p>
        <details>
          <summary class="cursor-pointer">{t('export.preview')}</summary>
          <pre class={[monoClass, 'mt-1 max-h-60 overflow-auto rounded-sm border border-line bg-bg-2 p-2']} tabindex="0">
            {preview()}
          </pre>
        </details>
        <Show when={progress() !== null}>
          <progress class="w-full accent-accent" max={requests().length} value={progress() ?? 0} aria-label={t('export.progress')} />
        </Show>
        <div class="flex justify-end gap-2">
          <Show
            when={progress() !== null}
            fallback={
              <>
                <button type="button" class={buttonClass()} onClick={closeDialog}>
                  {t('common.close')}
                </button>
                <button type="submit" class={buttonClass('primary')} disabled={!canExport()}>
                  {t('export.submit', { count: formatNumber(requests().length) })}
                </button>
              </>
            }
          >
            <button type="button" class={buttonClass()} onClick={() => exportController?.abort()}>
              {t('export.cancel')}
            </button>
          </Show>
        </div>
      </form>
    </Modal>
  );
}
