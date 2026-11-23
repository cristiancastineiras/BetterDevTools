/* oxlint-disable unicorn/consistent-function-scoping -- small helpers sit beside the one place that uses them */
import {
  cacheAction,
  cacheEntries,
  idbRecords,
  idbWrite,
  sortJson,
  storageOverview,
  webStorageWrite,
  workerAction,
  type CacheEntry,
  type IdbRecord,
  type StorageOverview,
} from '@betterdevtools/core';
import { createMemo, createSignal, For, onSettled, Show } from 'solid-js';
import { formatBytes } from '@betterdevtools/core';
import { formatNumber, t } from '../../i18n/index.ts';
import { download, readFile } from '../../lib/io.ts';
import { attachedToDevtools } from '../../state/capture.ts';
import { askConfirmation, announce, reportError } from '../../state/ui.ts';
import { evalInInspectedPage, runPageJob } from '../../lib/devtools.ts';
import CookieJar from '../CookieJar.tsx';
import DiffView from '../DiffView.tsx';
import IconButton from '../ui/IconButton.tsx';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import { monoClass } from '../ui/styles.ts';
import { ErrorText, Field, Hint, Output, Page, Row, TextArea } from './kit.tsx';

type Area = 'local' | 'session' | 'idb' | 'cache' | 'workers' | 'cookies' | 'snapshots';

const PAGE_SIZE = 50;
const MAX_SNAPSHOT_RECORDS = 500;
const NOT_EDITABLE = /"\$(bytes|blob|map|set|truncated|number|bigint)"/;
const preview = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max)}…` : text);
const compact = (value: unknown) => JSON.stringify(value) ?? 'undefined';

interface Snapshot {
  takenAt: string;
  origin: string;
  local: Record<string, string>;
  session: Record<string, string>;
  indexedDB: Record<string, Record<string, IdbRecord[]>>;
  caches: Record<string, string[]>;
}

/** localStorage, sessionStorage, IndexedDB, Cache Storage, Service Workers and cookies of the inspected page. */
export default function StorageTool() {
  const [area, setArea] = createSignal<Area>('local');
  const [overview, setOverview] = createSignal<StorageOverview | undefined>();
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [search, setSearch] = createSignal('');

  async function refresh() {
    if (!attachedToDevtools) return;
    setLoading(true);
    try {
      setOverview(await runPageJob(storageOverview));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }
  /** Runs a change in the page, then reloads what is shown; failures reach the error banner. */
  async function change<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await work();
      await refresh();
      return result;
    } catch (cause) {
      reportError(t('storage.failed'), cause);
      return undefined;
    }
  }
  onSettled(() => void refresh());

  const matches = (text: string) => !search().trim() || text.toLowerCase().includes(search().trim().toLowerCase());

  // ---------------------------------------------------------------------------- Web Storage

  const [editing, setEditing] = createSignal<{ key: string; value: string; isNew: boolean } | null>(null);
  const entries = (which: 'local' | 'session') => (overview()?.[which] ?? []).filter(([key, value]) => matches(`${key} ${value}`));

  function WebStorage(props: { which: 'local' | 'session' }) {
    const save = () => {
      const draft = editing();
      if (!draft?.key) return;
      void change(() => runPageJob(webStorageWrite, props.which, 'set', draft.key, draft.value)).then(() => setEditing(null));
    };
    return (
      <>
        <Row>
          <IconButton
            icon="plus"
            label={t('storage.add')}
            text={t('storage.add')}
            onClick={() => setEditing({ key: '', value: '', isNew: true })}
          />
          <IconButton
            icon="trash"
            label={t('storage.clearAll')}
            text={t('storage.clearAll')}
            disabled={!entries(props.which).length}
            onClick={async () => {
              const ok = await askConfirmation({
                title: t('storage.clearTitle', { area: props.which }),
                details: [{ text: t('storage.clearDetails'), warning: true }],
                confirmLabel: t('storage.clearAll'),
              });
              if (ok) await change(() => runPageJob(webStorageWrite, props.which, 'clear', '', ''));
            }}
          />
        </Row>
        <Show when={editing()}>
          {(draft) => (
            <div class="flex flex-col gap-1 rounded-sm border border-line p-2">
              <Field label={t('storage.key')} value={draft().key} onInput={(key) => setEditing({ ...draft(), key })} class="w-full" />
              <TextArea label={t('storage.value')} value={draft().value} onInput={(value) => setEditing({ ...draft(), value })} rows={5} />
              <Row>
                <IconButton
                  icon="save"
                  variant="primary"
                  label={t('common.save')}
                  text={t('common.save')}
                  disabled={!draft().key}
                  onClick={save}
                />
                <IconButton icon="close" label={t('common.cancel')} text={t('common.cancel')} onClick={() => setEditing(null)} />
              </Row>
            </div>
          )}
        </Show>
        <Show when={entries(props.which).length} fallback={<Hint>{t('storage.empty')}</Hint>}>
          <div class="overflow-x-auto">
            <table class={[monoClass, 'w-full border-collapse']} aria-label={t(`storage.areas.${props.which}`)}>
              <thead>
                <tr class="border-b border-line text-fg-2">
                  <th scope="col" class="px-1 text-start">
                    {t('storage.key')}
                  </th>
                  <th scope="col" class="px-1 text-start">
                    {t('storage.value')}
                  </th>
                  <th scope="col" class="px-1">
                    <span class="sr-only">{t('storage.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={entries(props.which)}>
                  {([key, value]) => (
                    <tr class="border-b border-bg-3 align-top">
                      <td class="max-w-64 px-1 [overflow-wrap:anywhere]">{key}</td>
                      <td class="px-1 [overflow-wrap:anywhere]" title={value}>
                        {preview(value)}
                      </td>
                      <td class="px-1 whitespace-nowrap">
                        <IconButton
                          icon="search"
                          variant="ghost"
                          label={t('storage.edit', { name: key })}
                          onClick={() => setEditing({ key, value, isNew: false })}
                        />
                        <IconButton
                          icon="trash"
                          variant="ghost"
                          label={t('storage.delete', { name: key })}
                          onClick={() => void change(() => runPageJob(webStorageWrite, props.which, 'remove', key, ''))}
                        />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </>
    );
  }

  // ------------------------------------------------------------------------------ IndexedDB

  const [store, setStore] = createSignal<{ db: string; name: string; keyPath: string } | null>(null);
  const [records, setRecords] = createSignal<{ rows: IdbRecord[]; total: number; skip: number }>({ rows: [], total: 0, skip: 0 });
  const [recordEdit, setRecordEdit] = createSignal<{ key: string; value: string; isNew: boolean } | null>(null);

  // takes the store as an argument: a signal written a moment ago still reads as before (updates are batched)
  async function loadRecords(skip = 0, current = store()) {
    if (!current) return;
    try {
      const { records: rows, total } = await runPageJob(idbRecords, current.db, current.name, skip, PAGE_SIZE);
      setRecords({ rows, total, skip });
    } catch (cause) {
      reportError(t('storage.failed'), cause);
    }
  }
  async function writeRecord(op: 'put' | 'delete' | 'clear', key: unknown, value: unknown) {
    const current = store();
    if (!current) return;
    await change(() => runPageJob(idbWrite, current.db, current.name, op, key, value));
    await loadRecords(records().skip);
  }
  function saveRecord() {
    const draft = recordEdit();
    const current = store();
    if (!draft || !current) return;
    try {
      const value: unknown = JSON.parse(draft.value);
      const key: unknown = current.keyPath === 'null' ? JSON.parse(draft.key) : undefined;
      void writeRecord('put', key, value).then(() => setRecordEdit(null));
    } catch (cause) {
      reportError(t('storage.badJson'), cause);
    }
  }

  function IndexedDb() {
    return (
      <>
        <Show when={overview()?.databases.length} fallback={<Hint>{t('storage.noDatabases')}</Hint>}>
          <ul class="flex flex-col gap-1" aria-label={t('storage.databases')}>
            <For each={overview()?.databases ?? []}>
              {(db) => (
                <li class="rounded-sm border border-line p-1.5">
                  <p class="font-semibold">
                    {db.name} <span class="font-normal text-fg-2">v{db.version}</span>
                  </p>
                  <Show when={db.error}>
                    <ErrorText>{db.error}</ErrorText>
                  </Show>
                  <div class="mt-1 flex flex-wrap gap-1">
                    <For each={db.stores.filter((s) => matches(`${db.name} ${s.name}`))}>
                      {(s) => (
                        <IconButton
                          icon="search"
                          label={t('storage.openStore', { store: s.name })}
                          text={`${s.name} (${formatNumber(s.count)})`}
                          pressed={store()?.db === db.name && store()?.name === s.name}
                          onClick={() => {
                            const target = { db: db.name, name: s.name, keyPath: s.keyPath };
                            setStore(target);
                            setRecordEdit(null);
                            void loadRecords(0, target);
                          }}
                        />
                      )}
                    </For>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={store()}>
          {(current) => (
            <div class="flex flex-col gap-1">
              <h3 class="font-semibold">
                {current().db} / {current().name}{' '}
                <span class="font-normal text-fg-2">({t('storage.recordCount', { count: formatNumber(records().total) })})</span>
              </h3>
              <Row>
                <IconButton
                  icon="plus"
                  label={t('storage.addRecord')}
                  text={t('storage.addRecord')}
                  onClick={() => setRecordEdit({ key: '', value: '{}', isNew: true })}
                />
                <IconButton
                  icon="trash"
                  label={t('storage.clearStore')}
                  text={t('storage.clearStore')}
                  disabled={!records().total}
                  onClick={async () => {
                    const ok = await askConfirmation({
                      title: t('storage.clearTitle', { area: current().name }),
                      details: [{ text: t('storage.clearDetails'), warning: true }],
                      confirmLabel: t('storage.clearStore'),
                    });
                    if (ok) await writeRecord('clear', undefined, undefined);
                  }}
                />
                <IconButton
                  icon="previous"
                  label={t('storage.previousPage')}
                  disabled={records().skip === 0}
                  onClick={() => void loadRecords(Math.max(0, records().skip - PAGE_SIZE))}
                />
                <IconButton
                  icon="next"
                  label={t('storage.nextPage')}
                  disabled={records().skip + PAGE_SIZE >= records().total}
                  onClick={() => void loadRecords(records().skip + PAGE_SIZE)}
                />
                <span class="text-fg-2">
                  {t('storage.range', {
                    from: formatNumber(records().total ? records().skip + 1 : 0),
                    to: formatNumber(Math.min(records().total, records().skip + PAGE_SIZE)),
                    total: formatNumber(records().total),
                  })}
                </span>
              </Row>
              <Show when={recordEdit()}>
                {(draft) => (
                  <div class="flex flex-col gap-1 rounded-sm border border-line p-2">
                    <Show
                      when={current().keyPath === 'null'}
                      fallback={<Hint>{t('storage.keyInValue', { path: current().keyPath })}</Hint>}
                    >
                      <Field
                        label={t('storage.keyJson')}
                        value={draft().key}
                        onInput={(key) => setRecordEdit({ ...draft(), key })}
                        class="w-full"
                      />
                    </Show>
                    <TextArea
                      label={t('storage.valueJson')}
                      value={draft().value}
                      onInput={(value) => setRecordEdit({ ...draft(), value })}
                      rows={8}
                    />
                    <Row>
                      <IconButton icon="save" variant="primary" label={t('common.save')} text={t('common.save')} onClick={saveRecord} />
                      <IconButton icon="close" label={t('common.cancel')} text={t('common.cancel')} onClick={() => setRecordEdit(null)} />
                    </Row>
                  </div>
                )}
              </Show>
              <div class="overflow-x-auto">
                <table class={[monoClass, 'w-full border-collapse']} aria-label={t('storage.records')}>
                  <thead>
                    <tr class="border-b border-line text-fg-2">
                      <th scope="col" class="px-1 text-start">
                        {t('storage.key')}
                      </th>
                      <th scope="col" class="px-1 text-start">
                        {t('storage.value')}
                      </th>
                      <th scope="col" class="px-1">
                        <span class="sr-only">{t('storage.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={records().rows.filter((r) => matches(`${compact(r.key)} ${compact(r.value)}`))}>
                      {(record) => {
                        const text = compact(record.value);
                        const editable = !NOT_EDITABLE.test(text);
                        return (
                          <tr class="border-b border-bg-3 align-top">
                            <td class="max-w-48 px-1 [overflow-wrap:anywhere]">{compact(record.key)}</td>
                            <td class="px-1 [overflow-wrap:anywhere]" title={text}>
                              {preview(text)}
                            </td>
                            <td class="px-1 whitespace-nowrap">
                              <IconButton
                                icon="search"
                                variant="ghost"
                                label={editable ? t('storage.edit', { name: compact(record.key) }) : t('storage.notEditable')}
                                disabled={!editable}
                                onClick={() =>
                                  setRecordEdit({ key: compact(record.key), value: JSON.stringify(record.value, null, 2), isNew: false })
                                }
                              />
                              <IconButton
                                icon="trash"
                                variant="ghost"
                                label={t('storage.delete', { name: compact(record.key) })}
                                onClick={() => void writeRecord('delete', record.key, undefined)}
                              />
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
              <Hint>{t('storage.idbNote')}</Hint>
            </div>
          )}
        </Show>
      </>
    );
  }

  // ---------------------------------------------------------------------------- Cache Storage

  const [openCache, setOpenCache] = createSignal('');
  const [cacheRows, setCacheRows] = createSignal<CacheEntry[]>([]);
  const [cachePreview, setCachePreview] = createSignal('');

  async function loadCache(name: string) {
    setOpenCache(name);
    setCachePreview('');
    try {
      setCacheRows(await runPageJob(cacheEntries, name));
    } catch (cause) {
      reportError(t('storage.failed'), cause);
    }
  }

  function CacheStorage() {
    return (
      <>
        <Show when={overview()?.caches.length} fallback={<Hint>{t('storage.noCaches')}</Hint>}>
          <ul class="flex flex-wrap gap-1" aria-label={t('storage.cacheNames')}>
            <For each={(overview()?.caches ?? []).filter((c) => matches(c.name))}>
              {(cache) => (
                <li>
                  <IconButton
                    icon="search"
                    label={t('storage.openStore', { store: cache.name })}
                    text={`${cache.name} (${formatNumber(cache.count)})`}
                    pressed={openCache() === cache.name}
                    onClick={() => void loadCache(cache.name)}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={openCache()}>
          <Row>
            <IconButton
              icon="trash"
              label={t('storage.deleteCache')}
              text={t('storage.deleteCache')}
              onClick={async () => {
                const ok = await askConfirmation({
                  title: t('storage.deleteCacheTitle', { name: openCache() }),
                  details: [{ text: t('storage.clearDetails'), warning: true }],
                  confirmLabel: t('storage.deleteCache'),
                });
                if (ok) {
                  await change(() => runPageJob(cacheAction, openCache(), 'delete', ''));
                  setOpenCache('');
                }
              }}
            />
          </Row>
          <div class="overflow-x-auto">
            <table class={[monoClass, 'w-full border-collapse']} aria-label={t('storage.entries')}>
              <tbody>
                <For each={cacheRows().filter((row) => matches(row.url))}>
                  {(row) => (
                    <tr class="border-b border-bg-3 align-top">
                      <td class="px-1">{row.status}</td>
                      <td class="px-1">{row.method}</td>
                      <td class="px-1 [overflow-wrap:anywhere]">{row.url}</td>
                      <td class="px-1 text-fg-2">{row.contentType}</td>
                      <td class="px-1 whitespace-nowrap">
                        <IconButton
                          icon="eye"
                          variant="ghost"
                          label={t('storage.preview', { name: row.url })}
                          onClick={async () => setCachePreview(await runPageJob(cacheAction, openCache(), 'preview', row.url))}
                        />
                        <IconButton
                          icon="trash"
                          variant="ghost"
                          label={t('storage.delete', { name: row.url })}
                          onClick={async () => {
                            await change(() => runPageJob(cacheAction, openCache(), 'delete', row.url));
                            await loadCache(openCache());
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <Show when={cachePreview()}>
            <Output label={t('storage.previewLabel')} text={cachePreview()} rows={8} />
          </Show>
        </Show>
      </>
    );
  }

  // --------------------------------------------------------------------------------- cookies

  const [pageUrl, setPageUrl] = createSignal('');
  const [reveal, setReveal] = createSignal(false);
  createMemo(() => {
    if (area() === 'cookies') void evalInInspectedPage('location.href').then((url) => setPageUrl(String(url)));
  });

  // ------------------------------------------------------------------------------- snapshots

  const [saved, setSaved] = createSignal<Snapshot | undefined>();
  const [live, setLive] = createSignal<Snapshot | undefined>();

  async function takeSnapshot(): Promise<Snapshot> {
    const current = await runPageJob(storageOverview);
    const indexedDB: Snapshot['indexedDB'] = {};
    for (const db of current.databases) {
      indexedDB[db.name] = {};
      for (const s of db.stores)
        indexedDB[db.name]![s.name] = (await runPageJob(idbRecords, db.name, s.name, 0, MAX_SNAPSHOT_RECORDS)).records;
    }
    const caches: Snapshot['caches'] = {};
    for (const cache of current.caches) caches[cache.name] = (await runPageJob(cacheEntries, cache.name)).map((row) => row.url);
    return {
      takenAt: new Date().toISOString(),
      origin: current.origin,
      local: Object.fromEntries(current.local),
      session: Object.fromEntries(current.session),
      indexedDB,
      caches,
    };
  }
  const stable = (snapshot: Snapshot | undefined): string => {
    if (!snapshot) return '';
    const { takenAt: _takenAt, ...rest } = snapshot;
    const sorted = sortJson(JSON.stringify(rest));
    return sorted.ok ? sorted.output : '';
  };
  const guarded = async (work: () => Promise<void>) => {
    try {
      await work();
    } catch (cause) {
      reportError(t('storage.failed'), cause);
    }
  };

  function Snapshots() {
    return (
      <>
        <Hint>{t('storage.snapshotIntro')}</Hint>
        <Row>
          <IconButton
            icon="save"
            variant="primary"
            label={t('storage.snapshotTake')}
            text={t('storage.snapshotTake')}
            onClick={() =>
              void guarded(async () => {
                setSaved(await takeSnapshot());
                setLive(undefined);
                announce(t('storage.snapshotTaken'));
              })
            }
          />
          <IconButton
            icon="export"
            label={t('storage.snapshotExport')}
            text={t('storage.snapshotExport')}
            disabled={!saved()}
            onClick={() =>
              saved() &&
              download(
                `storage-${saved()!.takenAt.replace(/[:.]/g, '-')}.json`,
                new Blob([JSON.stringify(saved(), null, 2)], { type: 'application/json' }),
              )
            }
          />
          <label class="relative inline-flex">
            <IconButton
              icon="import"
              label={t('storage.snapshotImport')}
              text={t('storage.snapshotImport')}
              onClick={(event) => (event.currentTarget.nextElementSibling as HTMLInputElement | null)?.click()}
            />
            <input
              type="file"
              accept="application/json,.json"
              class="sr-only"
              tabindex="-1"
              aria-label={t('storage.snapshotImport')}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file)
                  void guarded(async () => {
                    setSaved(JSON.parse(await readFile(file, 50 * 1048576)) as Snapshot);
                    setLive(undefined);
                  });
              }}
            />
          </label>
          <IconButton
            icon="replay"
            label={t('storage.snapshotCompare')}
            text={t('storage.snapshotCompare')}
            disabled={!saved()}
            onClick={() =>
              void guarded(async () => {
                setLive(await takeSnapshot());
              })
            }
          />
          <IconButton
            icon="undo"
            label={t('storage.snapshotRestore')}
            text={t('storage.snapshotRestore')}
            disabled={!saved()}
            onClick={async () => {
              const snapshot = saved();
              if (!snapshot) return;
              const ok = await askConfirmation({
                title: t('storage.snapshotRestoreTitle'),
                details: [{ text: t('storage.snapshotRestoreDetails'), warning: true }],
                confirmLabel: t('storage.snapshotRestore'),
              });
              if (!ok) return;
              await change(async () => {
                for (const which of ['local', 'session'] as const) {
                  await runPageJob(webStorageWrite, which, 'clear', '', '');
                  for (const [key, value] of Object.entries(snapshot[which])) await runPageJob(webStorageWrite, which, 'set', key, value);
                }
              });
            }}
          />
        </Row>
        <Show when={saved()}>
          {(snapshot) => (
            <p class="text-fg-2" role="status">
              {t('storage.snapshotInfo', {
                time: snapshot().takenAt,
                origin: snapshot().origin,
                local: Object.keys(snapshot().local).length,
                session: Object.keys(snapshot().session).length,
              })}
            </p>
          )}
        </Show>
        <Show when={live()}>
          <DiffView
            before={stable(saved())}
            after={stable(live())}
            beforeLabel={t('storage.snapshotSaved')}
            afterLabel={t('storage.snapshotNow')}
          />
        </Show>
      </>
    );
  }

  const counts = createMemo(() => overview());
  return (
    <Page>
      <Show when={attachedToDevtools} fallback={<Hint>{t('storage.notAttached')}</Hint>}>
        <Row>
          <SegmentedControl
            label={t('storage.area')}
            value={area()}
            onChange={setArea}
            options={[
              { value: 'local', label: `localStorage (${counts()?.local.length ?? 0})` },
              { value: 'session', label: `sessionStorage (${counts()?.session.length ?? 0})` },
              { value: 'idb', label: `IndexedDB (${counts()?.databases.length ?? 0})` },
              { value: 'cache', label: `Cache (${counts()?.caches.length ?? 0})` },
              { value: 'workers', label: `Service Workers (${counts()?.workers.length ?? 0})` },
              { value: 'cookies', label: 'Cookies' },
              { value: 'snapshots', label: t('storage.snapshots') },
            ]}
          />
          <Show when={area() !== 'cookies' && area() !== 'snapshots' && area() !== 'workers'}>
            <Field label={t('storage.search')} value={search()} onInput={setSearch} class="w-56" />
          </Show>
          <IconButton
            icon="replay"
            label={t('storage.refresh')}
            text={t('storage.refresh')}
            busy={loading()}
            onClick={() => void refresh()}
          />
        </Row>
        <Show when={overview()}>
          {(current) => (
            <p class="text-fg-2">
              {current().origin} · {t('storage.usage', { usage: formatBytes(current().usage), quota: formatBytes(current().quota) })}
            </p>
          )}
        </Show>
        <Show when={error()}>
          <ErrorText>{t('realtime.problem', { reason: error() })}</ErrorText>
        </Show>
        <Show when={area() === 'local' || area() === 'session'}>
          <WebStorage which={area() as 'local' | 'session'} />
        </Show>
        <Show when={area() === 'idb'}>
          <IndexedDb />
        </Show>
        <Show when={area() === 'cache'}>
          <CacheStorage />
        </Show>
        <Show when={area() === 'workers'}>
          <Show when={overview()?.workers.length} fallback={<Hint>{t('storage.noWorkers')}</Hint>}>
            <ul class="flex flex-col gap-1" aria-label={t('storage.workers')}>
              <For each={overview()?.workers ?? []}>
                {(worker) => (
                  <li class="flex flex-wrap items-center gap-2 rounded-sm border border-line p-1.5">
                    <div class="min-w-0 flex-1">
                      <p class={[monoClass, '[overflow-wrap:anywhere]']}>{worker.scope}</p>
                      <p class="text-fg-2 [overflow-wrap:anywhere]">
                        {worker.script} · {worker.state}
                      </p>
                    </div>
                    <IconButton
                      icon="replay"
                      label={t('storage.workerUpdate', { scope: worker.scope })}
                      text={t('storage.update')}
                      onClick={() => void change(() => runPageJob(workerAction, worker.scope, 'update'))}
                    />
                    <IconButton
                      icon="trash"
                      label={t('storage.workerUnregister', { scope: worker.scope })}
                      text={t('storage.unregister')}
                      onClick={() => void change(() => runPageJob(workerAction, worker.scope, 'unregister'))}
                    />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
        <Show when={area() === 'cookies'}>
          <Row>
            <IconButton
              icon={reveal() ? 'eye-off' : 'eye'}
              label={reveal() ? t('common.hideSecrets') : t('common.showSecrets')}
              pressed={reveal()}
              onClick={() => setReveal(!reveal())}
            />
          </Row>
          <Show when={pageUrl()} fallback={<Hint>{t('storage.noUrl')}</Hint>}>
            <CookieJar url={pageUrl()} reveal={reveal()} />
          </Show>
        </Show>
        <Show when={area() === 'snapshots'}>
          <Snapshots />
        </Show>
      </Show>
    </Page>
  );
}
