import {
  cookiesOf,
  DEFAULT_REDACT,
  detectAuth,
  exportCookies,
  isSecretCookie,
  makeBody,
  type Captured,
  type CookieExportFormat,
} from '@betterdevtools/core';
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { formatNumber, t } from '../i18n/index.ts';
import { download } from '../lib/io.ts';
import { curlOf, harEntryOf, saveToCollection } from '../state/actions.ts';
import { bodiesVersion, captureLog, clearSelection, filterText, setActiveRequestId } from '../state/capture.ts';
import { preferences } from '../state/preferences.ts';
import { openReplay } from '../state/replay.ts';
import {
  announce,
  askConfirmation,
  copyToClipboard,
  hideSecrets,
  openContextMenu,
  secretsRevealed,
  showDialog,
  toggleSecrets,
} from '../state/ui.ts';
import CookieJar from './CookieJar.tsx';
import Tabs from './Tabs.tsx';
import AuthPanel from './ui/AuthPanel.tsx';
import CodeViewer from './ui/CodeViewer.tsx';
import CookieTable from './ui/CookieTable.tsx';
import CopyButton from './ui/CopyButton.tsx';
import IconButton from './ui/IconButton.tsx';
import KeyValueSection, { type Row } from './ui/KeyValueSection.tsx';
import MethodBadge, { StatusBadge } from './ui/MethodBadge.tsx';
import SelectMenu from './ui/SelectMenu.tsx';
import { monoClass, sectionTitleClass } from './ui/styles.ts';

type DetailTab = 'headers' | 'payload' | 'response' | 'cookies' | 'timing';

/** Header names whose values are masked until secrets are shown. */
const SECRET_HEADERS = new Set([...DEFAULT_REDACT.headers, 'cookie', 'set-cookie']);
const isSecretHeader = (row: Row) => SECRET_HEADERS.has(row.name.toLowerCase());

const COOKIE_FILE: Record<CookieExportFormat, { extension: string; mime: string }> = {
  json: { extension: 'json', mime: 'application/json' },
  csv: { extension: 'csv', mime: 'text/csv' },
  netscape: { extension: 'txt', mime: 'text/plain' },
};

/** First free-text term of the filter (no `field:` prefix, not negated), to prefill the body search. */
function freeTextTerm(filter: string): string {
  return filter.split(/\s+/).find((term) => term && !term.startsWith('-') && !term.includes(':')) ?? '';
}

/** When the filter also searches bodies, the response opens with the same text highlighted. */
function bodySearchText(): string {
  return preferences.searchBodies ? freeTextTerm(filterText()) : '';
}

/** Everything about one captured request: headers, payload, response, cookies and timing. */
export default function RequestDetail(props: { request: Captured }) {
  const [tab, setTab] = createSignal<DetailTab>('headers');
  const harRequest = createMemo(() => props.request.har.request);
  const harResponse = createMemo(() => props.request.har.response);
  const responseBody = createMemo(() => {
    bodiesVersion(); // bodies can be truncated or discarded later by the memory budget
    return captureLog.body(props.request.id);
  });
  const requestBody = createMemo(() => {
    const postData = harRequest().postData;
    return postData?.text === undefined ? null : makeBody(postData.text, undefined, harRequest().bodySize);
  });
  const reveal = () => secretsRevealed(props.request.id);
  // secrets stay visible only while their request is on screen: moving to another one hides them
  createEffect(() => props.request.id, hideSecrets);
  const authItems = createMemo(() => detectAuth(harRequest().headers, harResponse().headers));
  const cookies = createMemo(() => cookiesOf(props.request.har));
  const allCookies = createMemo(() => [...cookies().request, ...cookies().response]);
  const secretCookieCount = createMemo(() => allCookies().filter(isSecretCookie).length);

  // "Expand all / collapse all" for the accordion sections of the Headers tab
  const [expansion, setExpansion] = createSignal({ open: true });

  const generalRows = createMemo<Row[]>(() => {
    const request = props.request;
    const response = harResponse();
    const source = request.source === 'live' ? 'live' : request.source === 'backfill' ? 'backfill' : 'import';
    return [
      { name: t('detail.fields.url'), value: request.url },
      { name: t('detail.fields.status'), value: `${request.status || '—'} ${response.statusText}`.trim() },
      ...(request.error ? [{ name: t('detail.fields.error'), value: request.error }] : []),
      ...(request.redirect ? [{ name: t('detail.fields.redirect'), value: request.redirect }] : []),
      { name: t('detail.fields.protocol'), value: response.httpVersion || '—' },
      {
        name: t('detail.fields.remote'),
        value: typeof request.har.serverIPAddress === 'string' && request.har.serverIPAddress ? request.har.serverIPAddress : '—',
      },
      { name: t('detail.fields.type'), value: [request.type, request.mime].filter(Boolean).join(' · ') || '—' },
      { name: t('detail.fields.initiator'), value: request.initiator || '—' },
      { name: t('detail.fields.priority'), value: request.priority || t('detail.priorityUnknown') },
      { name: t('detail.fields.source'), value: t(`detail.sources.${source}`) },
      { name: t('detail.fields.started'), value: request.har.startedDateTime },
    ];
  });

  const timings = createMemo(() =>
    Object.entries(props.request.har.timings).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] >= 0 && !entry[0].startsWith('_'),
    ),
  );
  const timingTotal = createMemo(() =>
    Math.max(
      1,
      timings().reduce((sum, [, ms]) => sum + ms, 0),
    ),
  );

  function openMoreMenu(event: MouseEvent) {
    openContextMenu(event, t('menu.moreRequestActions'), [
      { label: t('menu.copyHar'), run: () => void copyToClipboard(harEntryOf(props.request), 'HAR') },
      {
        label: t('menu.exportThis'),
        run: () => {
          clearSelection(); // with nothing selected, "selected" means the request shown here
          showDialog({ kind: 'export', scope: 'selected' });
        },
      },
    ]);
  }

  // ----------------------------------------------------------------------- cookie export

  const [cookieFormat, setCookieFormat] = createSignal<CookieExportFormat>('json');
  const [includeCookieValues, setIncludeCookieValues] = createSignal(false);

  async function exportRequestCookies() {
    const format = cookieFormat();
    const includeValues = includeCookieValues();
    const list = allCookies();
    // a Netscape jar can be fed to curl/wget, and values may be credentials: both ask first
    if (format === 'netscape' || includeValues) {
      const details = [
        ...(includeValues ? [{ text: t('cookies.confirmValues', { count: secretCookieCount() }), warning: true }] : []),
        ...(format === 'netscape' ? [{ text: t('cookies.confirmNetscape') }] : []),
      ];
      const confirmed = await askConfirmation({
        title: includeValues ? t('cookies.confirmTitleValues') : t('cookies.confirmTitle'),
        details,
        confirmLabel: t('common.export'),
      });
      if (!confirmed) return;
    }
    const host = URL.parse(props.request.url)?.hostname ?? '';
    const file = COOKIE_FILE[format];
    download(
      `cookies-${host || 'request'}.${file.extension}`,
      new Blob([exportCookies(list, format, { redact: !includeValues, host })], { type: file.mime }),
    );
    announce(t('status.cookiesExported', { count: list.length }));
  }

  return (
    <article aria-label={t('detail.label')} class="flex h-full min-h-0 flex-col">
      <div class="flex flex-wrap items-center gap-1 border-b border-line p-1">
        <MethodBadge method={props.request.method} />
        <StatusBadge status={props.request.status} error={props.request.error} />
        <span class={[monoClass, 'min-w-0 flex-1 truncate']} title={props.request.url}>
          {props.request.url}
        </span>
        <IconButton
          icon="replay"
          variant="primary"
          label={t('detail.replayHint')}
          text={t('detail.replay')}
          onClick={() => openReplay(props.request)}
        />
        <IconButton icon="save" label={t('detail.save')} onClick={() => saveToCollection(props.request)} />
        <CopyButton text={() => props.request.url} label={t('detail.copyUrl')} />
        <CopyButton text={() => curlOf(props.request)} label={t('detail.copyCurl')} />
        <IconButton
          icon={reveal() ? 'eye-off' : 'eye'}
          label={reveal() ? t('common.hideSecrets') : t('common.showSecrets')}
          pressed={reveal()}
          onClick={() => toggleSecrets(props.request.id)}
        />
        <IconButton icon="more" label={t('menu.moreRequestActions')} onClick={openMoreMenu} />
        <IconButton icon="close" label={t('detail.close')} onClick={() => setActiveRequestId(null)} />
      </div>

      <div class="min-h-0 flex-1">
        <Tabs
          label={t('detail.tabs.label')}
          value={tab()}
          onChange={setTab}
          panelClass={tab() === 'response' ? 'flex flex-col overflow-hidden p-2' : 'overflow-auto p-2'}
          tabs={[
            { id: 'headers', label: t('detail.tabs.headers') },
            { id: 'payload', label: t('detail.tabs.payload') },
            { id: 'response', label: t('detail.tabs.response') },
            {
              id: 'cookies',
              label: allCookies().length ? `${t('detail.tabs.cookies')} (${allCookies().length})` : t('detail.tabs.cookies'),
            },
            { id: 'timing', label: t('detail.tabs.timing') },
          ]}
        >
          <Switch>
            <Match when={tab() === 'headers'}>
              <div class="flex justify-end">
                <IconButton
                  icon={expansion().open ? 'collapse' : 'expand'}
                  variant="ghost"
                  label={expansion().open ? t('detail.collapseAll') : t('detail.expandAll')}
                  text={expansion().open ? t('detail.collapseAll') : t('detail.expandAll')}
                  onClick={() => setExpansion({ open: !expansion().open })}
                />
              </div>
              <KeyValueSection title={t('detail.general')} rows={generalRows()} expansion={expansion()} />
              <AuthPanel items={authItems()} reveal={reveal()} expansion={expansion()} />
              <KeyValueSection
                title={t('detail.responseHeaders')}
                rows={harResponse().headers}
                secret={isSecretHeader}
                reveal={reveal()}
                expansion={expansion()}
              />
              <KeyValueSection
                title={t('detail.requestHeaders')}
                rows={harRequest().headers}
                secret={isSecretHeader}
                reveal={reveal()}
                expansion={expansion()}
              />
            </Match>

            <Match when={tab() === 'payload'}>
              <Show when={harRequest().queryString.length}>
                <KeyValueSection title={t('detail.queryString')} rows={harRequest().queryString} />
              </Show>
              <Show
                when={requestBody()}
                fallback={
                  <Show when={!harRequest().queryString.length}>
                    <p class="text-fg-2">{t('detail.noPayload')}</p>
                  </Show>
                }
              >
                {(body) => (
                  <CodeViewer
                    body={body()}
                    mime={harRequest().postData?.mimeType ?? ''}
                    url={props.request.url}
                    headers={harRequest().headers}
                    label={t('detail.requestBody')}
                  />
                )}
              </Show>
            </Match>

            <Match when={tab() === 'response'}>
              <CodeViewer
                body={responseBody()}
                mime={harResponse().content.mimeType}
                url={props.request.url}
                headers={harResponse().headers}
                label={t('detail.responseBody')}
                initialQuery={bodySearchText()}
                fill
              />
            </Match>

            <Match when={tab() === 'cookies'}>
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <SelectMenu
                  label={t('cookies.exportFormat')}
                  value={cookieFormat()}
                  onChange={(value) => setCookieFormat(value as CookieExportFormat)}
                  options={[
                    { value: 'json', label: t('cookies.formats.json') },
                    { value: 'csv', label: t('cookies.formats.csv') },
                    { value: 'netscape', label: t('cookies.formats.netscape'), description: t('cookies.netscapeHint') },
                  ]}
                />
                <label class="flex cursor-pointer items-center gap-1">
                  <input
                    type="checkbox"
                    checked={includeCookieValues()}
                    onChange={(event) => setIncludeCookieValues(event.currentTarget.checked)}
                  />
                  {t('cookies.includeValues')}
                </label>
                <IconButton
                  icon="export"
                  label={t('cookies.exportLabel')}
                  text={t('cookies.exportButton')}
                  disabled={!allCookies().length}
                  onClick={() => void exportRequestCookies()}
                />
                <IconButton
                  icon="cookie"
                  label={t('cookies.editCopyLabel')}
                  text={t('cookies.editCopy')}
                  disabled={!cookies().request.length}
                  onClick={() => openReplay(props.request, 'cookies')}
                />
                <span class="text-fg-2" role="note">
                  {allCookies().length
                    ? t('cookies.secretCount', { secret: secretCookieCount(), total: allCookies().length })
                    : t('cookies.noCookies')}
                </span>
              </div>
              <CookieTable title={t('cookies.request')} cookies={cookies().request} reveal={reveal()} />
              <CookieTable title={t('cookies.response')} cookies={cookies().response} reveal={reveal()} />
              <CookieJar url={props.request.url} reveal={reveal()} />
            </Match>

            <Match when={tab() === 'timing'}>
              <h3 class={sectionTitleClass}>{t('detail.timingTotal', { ms: formatNumber(Math.round(props.request.duration)) })}</h3>
              <dl class="grid grid-cols-[90px_1fr_80px] items-center gap-1">
                <For each={timings()}>
                  {([phase, ms]) => (
                    <>
                      <dt class="text-fg-2">{phase}</dt>
                      <dd class="h-3 rounded-sm bg-bg-3">
                        <div class="h-3 rounded-sm bg-accent" style={{ width: `${(ms / timingTotal()) * 100}%` }} />
                      </dd>
                      <dd class={[monoClass, 'text-end']}>{ms.toFixed(1)} ms</dd>
                    </>
                  )}
                </For>
              </dl>
            </Match>
          </Switch>
        </Tabs>
      </div>
    </article>
  );
}
