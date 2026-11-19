import {
  buildRequest,
  parseRows,
  rowsText,
  carriesCredentials,
  comparableText,
  envVars,
  formatBytes,
  headersText,
  METHODS,
  needsConfirmation,
  toCurl,
  type Draft,
} from '@betterdevtools/core';
import { createMemo, createSignal, For, Match, Show, snapshot, Switch } from 'solid-js';
import { formatNumber, t } from '../i18n/index.ts';
import { bodiesVersion, capturedCount, captureLog } from '../state/capture.ts';
import { preferences, updatePreferences } from '../state/preferences.ts';
import {
  canSendFromPage,
  cancelReplay,
  editReplayDraft,
  effectiveSendFrom,
  isSending,
  loadHistoryRecord,
  replayDraft,
  replayHistory,
  replayResult,
  replayTab,
  sendReplay,
  setReplayTab,
  type SendFrom,
} from '../state/replay.ts';
import { askConfirmation, secretsRevealed, showDialog, toggleSecrets } from '../state/ui.ts';
import { activeWorkspace, editWorkspace } from '../state/workspaces.ts';
import DiffView from './DiffView.tsx';
import Tabs from './Tabs.tsx';
import BodyEditor from './BodyEditor.tsx';
import CodeViewer from './ui/CodeViewer.tsx';
import KeyValueEditor from './ui/KeyValueEditor.tsx';
import SegmentedControl from './ui/SegmentedControl.tsx';
import UrlEditor, { type UrlEditorVariable } from './ui/UrlEditor.tsx';
import CookieEditor from './ui/CookieEditor.tsx';
import CopyButton from './ui/CopyButton.tsx';
import IconButton from './ui/IconButton.tsx';
import KeyValueSection from './ui/KeyValueSection.tsx';
import MethodBadge, { StatusBadge } from './ui/MethodBadge.tsx';
import SelectMenu from './ui/SelectMenu.tsx';
import { badgeClass, fieldClass, monoClass, sectionTitleClass } from './ui/styles.ts';

type ResultTab = 'response' | 'headers' | 'compare';
type TextField = 'query' | 'headers' | 'body';

/** Common header names and values offered while typing in the headers table. */
const HEADER_NAMES = [
  'Accept',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Language',
  'Content-Type',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'Pragma',
  'Prefer',
  'Range',
  'X-API-Key',
  'X-Forwarded-For',
  'X-Request-ID',
  'X-Requested-With',
];
const HEADER_VALUES: Record<string, string[]> = {
  accept: ['application/json', 'text/html', 'application/xml', '*/*'],
  'content-type': [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'text/plain',
    'text/html',
    'application/xml',
  ],
  'cache-control': ['no-cache', 'no-store', 'max-age=0'],
  authorization: ['Bearer ', 'Basic '],
};
const headerValues = (name: string) => HEADER_VALUES[name.trim().toLowerCase()] ?? [];

// table or bulk text, per list; kept here so the choice survives switching views
const [queryBulk, setQueryBulk] = createSignal(false);
const [headersBulk, setHeadersBulk] = createSignal(false);

const TEXTAREA_CLASS = [fieldClass, monoClass, 'h-full min-h-40 w-full resize-none'];

/** Ctrl/Cmd+Enter sends from any field of the editor. */
function isSendShortcut(event: KeyboardEvent) {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
}

/** What the confirmation lists as sent along: browser cookies, captured auth headers, edited cookies. */
function credentialList(draft: Draft): string {
  return [
    draft.credentials && t('replay.browserCookies'),
    ...(draft.credentials ? draft.credentialHeaders.map((header) => header.name) : []),
    draft.sendCookies && draft.cookies.length && t('replay.editedCookies', { count: draft.cookies.length }),
  ]
    .filter(Boolean)
    .join(', ');
}

const reveal = () => secretsRevealed('replay');

function setTextField(field: TextField, value: string) {
  editReplayDraft((draft) => {
    draft[field] = value;
  });
}

function saveDraft() {
  const { method, url, query, headers, body } = snapshot(replayDraft);
  showDialog({ kind: 'save', request: { method, url, query, headers, body } });
}

/**
 * Replay: edit a captured (or saved) request, send it, and compare the live response with the
 * captured one. Mutating methods and anything with credentials ask for confirmation first.
 */
export default function ReplayView() {
  const [resultTab, setResultTab] = createSignal<ResultTab>('response');

  const built = createMemo(() => buildRequest(replayDraft, envVars(activeWorkspace())));
  const buildError = () => {
    const result = built();
    return 'error' in result ? result.error : '';
  };
  const targetHost = createMemo(() => {
    const result = built();
    return 'request' in result ? (URL.parse(result.request.url)?.host ?? '') : '';
  });
  const method = createMemo(() => replayDraft.method.toUpperCase());
  const sendFrom = createMemo(() => effectiveSendFrom(replayDraft));
  // a captured request may use a method outside the usual list (PROPFIND…): keep it selectable
  const methodOptions = createMemo(() => [...new Set([...METHODS, method()])].map((name) => ({ value: name, label: name })));
  // the captured request this draft came from, while it is still in the capture
  const sourceRequest = createMemo(() => {
    capturedCount();
    const id = replayDraft.sourceId;
    return id === null ? null : (captureLog.get(id) ?? null);
  });

  /** The active environment's variables, for colouring and completion in the URL field. */
  const environmentVariables = createMemo<UrlEditorVariable[]>(() => {
    const workspace = activeWorkspace();
    const environment = workspace?.envs.find((env) => env.id === workspace.activeEnvId);
    return (environment?.vars ?? [])
      .filter((variable) => variable.key)
      .map((variable) => ({ name: variable.key, value: variable.value, secret: variable.secret }));
  });

  async function send() {
    if (isSending() || buildError()) return;
    const draft = snapshot(replayDraft);
    const methodName = draft.method.toUpperCase();
    const credentialed = carriesCredentials(draft);
    if (!needsConfirmation(methodName) && !credentialed) {
      await sendReplay(false);
      return;
    }
    const origin = sendFrom() === 'page' ? t('replay.confirmFromPage') : t('replay.confirmFromExtension');
    const confirmed = await askConfirmation({
      title: t('replay.confirmTitle', { method: methodName }),
      details: [
        ...(needsConfirmation(methodName)
          ? [{ text: t('replay.confirmMutation', { method: methodName, host: targetHost() }), warning: true }]
          : []),
        {
          text: `${t('replay.confirmFrom', { origin })} ${credentialed ? t('replay.confirmWith', { list: credentialList(draft) }) : t('replay.confirmWithout')}`,
        },
      ],
      confirmLabel: t('replay.confirmSend', { method: methodName }),
    });
    if (confirmed) await sendReplay(true);
  }

  function onFieldKeyDown(event: KeyboardEvent) {
    if (!isSendShortcut(event)) return;
    event.preventDefault();
    void send();
  }

  function curlCommand(): string {
    const result = built();
    if ('error' in result) throw new Error(result.error);
    return toCurl(result.request);
  }

  const textArea = (field: TextField, label: string) => (
    <textarea
      aria-label={label}
      class={TEXTAREA_CLASS}
      value={replayDraft[field]}
      spellcheck={false}
      onInput={(event) => setTextField(field, event.currentTarget.value)}
      onKeyDown={onFieldKeyDown}
    />
  );

  /** A list of lines (query or headers) as a table with on/off rows, or as bulk text. */
  const listEditor = (
    field: 'query' | 'headers',
    separator: ':' | '=',
    bulk: () => boolean,
    setBulk: (value: boolean) => void,
    label: string,
    keySuggestions?: readonly string[],
    valueSuggestions?: (key: string) => readonly string[],
  ) => (
    <div class="flex h-full min-h-40 flex-col gap-1">
      <SegmentedControl
        label={t('replay.table.mode')}
        value={bulk() ? 'bulk' : 'table'}
        onChange={(mode) => setBulk(mode === 'bulk')}
        options={[
          { value: 'table', label: t('replay.table.tableMode') },
          { value: 'bulk', label: t('replay.table.bulkMode'), title: t('replay.table.bulkHint') },
        ]}
      />
      <div class="min-h-0 flex-1 overflow-auto">
        <Show
          when={bulk()}
          fallback={
            <KeyValueEditor
              label={label}
              text={replayDraft[field]}
              onText={(text) => setTextField(field, text)}
              toRows={(text) => parseRows(text, separator)}
              toText={(rows) => rowsText(rows, separator)}
              keySuggestions={keySuggestions}
              valueSuggestions={valueSuggestions}
              onKeyDown={onFieldKeyDown}
            />
          }
        >
          {textArea(field, label)}
        </Show>
      </div>
    </div>
  );

  return (
    <div class="grid h-full min-h-0 grid-cols-1 overflow-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_15rem] lg:overflow-hidden">
      <form
        aria-label={t('replay.editorLabel')}
        class="flex min-h-96 flex-col gap-1 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div class="flex gap-1">
          <SelectMenu
            label={t('replay.method')}
            class="min-w-24 font-mono font-semibold"
            value={method()}
            options={methodOptions()}
            onChange={(value) =>
              editReplayDraft((draft) => {
                draft.method = value;
              })
            }
          />
          <UrlEditor
            label={t('replay.url')}
            value={replayDraft.url}
            placeholder={t('replay.urlPlaceholder')}
            variables={environmentVariables}
            onInput={(url) =>
              editReplayDraft((draft) => {
                draft.url = url;
              })
            }
            onSubmit={() => void send()}
          />
          <Show
            when={isSending()}
            fallback={
              <IconButton
                type="submit"
                icon="send"
                variant="primary"
                label={t('replay.sendHint')}
                text={t('replay.send')}
                disabled={Boolean(buildError())}
              />
            }
          >
            <IconButton icon="close" label={t('replay.cancelHint')} text={t('replay.cancel')} onClick={cancelReplay} />
          </Show>
        </div>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="flex items-center gap-1">
            {t('replay.sendFrom')}
            <SelectMenu
              label={t('replay.sendFrom')}
              value={sendFrom()}
              disabled={!canSendFromPage}
              options={[
                { value: 'page', label: t('replay.sendFromPage'), description: t('replay.sendFromPageHint') },
                { value: 'extension', label: t('replay.sendFromExtension'), description: t('replay.sendFromExtensionHint') },
              ]}
              onChange={(value) =>
                updatePreferences((draft) => {
                  draft.sendFrom = value as SendFrom;
                })
              }
            />
          </span>
          <Show when={!canSendFromPage}>
            <span class="text-fg-2">{t('replay.sendFromNeedsDevtools')}</span>
          </Show>
          <Show when={canSendFromPage && sendFrom() !== preferences.sendFrom}>
            <span class="text-fg-2">{t('replay.cookiesForceExtension')}</span>
          </Show>
          <Show when={activeWorkspace()}>
            {(workspace) => (
              <span class="ms-auto flex items-center gap-1">
                {t('replay.environment')}
                <SelectMenu
                  label={t('replay.environment')}
                  value={workspace().activeEnvId ?? ''}
                  options={workspace().envs.map((environment) => ({
                    value: environment.id,
                    label: environment.name,
                    description: t('replay.variables', { count: environment.vars.length }),
                  }))}
                  onChange={(id) =>
                    editWorkspace((target) => {
                      target.activeEnvId = id;
                    })
                  }
                />
              </span>
            )}
          </Show>
        </div>

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label class="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={replayDraft.credentials}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                editReplayDraft((draft) => {
                  draft.credentials = checked;
                });
              }}
            />
            {t('replay.includeCredentials')}
          </label>
          <span class="text-fg-2">
            {replayDraft.credentials
              ? replayDraft.credentialHeaders.length
                ? t('replay.sendsCookiesAnd', { headers: replayDraft.credentialHeaders.map((header) => header.name).join(', ') })
                : t('replay.sendsCookies')
              : t('replay.noCredentials')}
          </span>
        </div>

        <div class="min-h-40 flex-1">
          <Tabs
            label={t('replay.tabs.label')}
            value={replayTab()}
            onChange={setReplayTab}
            tabs={[
              { id: 'query', label: t('replay.tabs.query') },
              { id: 'headers', label: t('replay.tabs.headers') },
              { id: 'body', label: t('replay.tabs.body') },
              {
                id: 'cookies',
                label: replayDraft.cookies.length
                  ? `${t('replay.tabs.cookies')} (${replayDraft.cookies.length})`
                  : t('replay.tabs.cookies'),
              },
            ]}
          >
            <Switch>
              <Match when={replayTab() === 'query'}>{listEditor('query', '=', queryBulk, setQueryBulk, t('replay.queryLabel'))}</Match>
              <Match when={replayTab() === 'headers'}>
                {listEditor('headers', ':', headersBulk, setHeadersBulk, t('replay.headersLabel'), HEADER_NAMES, headerValues)}
              </Match>
              <Match when={replayTab() === 'body'}>
                <BodyEditor onKeyDown={onFieldKeyDown} />
              </Match>
              <Match when={replayTab() === 'cookies'}>
                <div class="flex flex-col gap-2 p-1">
                  <p class="text-fg-2">{t('replay.cookiesIntro')}</p>
                  <label class="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={replayDraft.sendCookies}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        editReplayDraft((draft) => {
                          draft.sendCookies = checked;
                        });
                      }}
                    />
                    {t('replay.sendCookies')}
                  </label>
                  <Show when={replayDraft.sendCookies}>
                    <p class="text-fg-2">{t('replay.sendCookiesHint')}</p>
                  </Show>
                  <CookieEditor
                    label={t('replay.cookiesLabel')}
                    rows={replayDraft.cookies}
                    reveal={reveal()}
                    onEdit={(index, field, value) =>
                      editReplayDraft((draft) => {
                        if (draft.cookies[index]) draft.cookies[index][field] = value;
                      })
                    }
                    onAdd={() => editReplayDraft((draft) => void draft.cookies.push({ name: '', value: '' }))}
                    onRemove={(index) => editReplayDraft((draft) => void draft.cookies.splice(index, 1))}
                  />
                </div>
              </Match>
            </Switch>
          </Tabs>
        </div>

        <p class="text-fg-2">{t('replay.syntaxHint')}</p>
        <Show when={buildError()}>
          <p class="text-bad" role="alert">
            {buildError()}
          </p>
        </Show>
        <div class="flex flex-wrap items-center gap-1">
          <span class="inline-flex items-center gap-1">
            {t('replay.copyCurlText')}
            <CopyButton text={curlCommand} label={t('replay.copyCurl')} disabled={Boolean(buildError())} />
          </span>
          <IconButton icon="save" label={t('detail.save')} text={t('replay.save')} onClick={saveDraft} />
          <IconButton
            icon={reveal() ? 'eye-off' : 'eye'}
            label={
              preferences.revealSecrets ? t('common.secretsAlwaysShown') : reveal() ? t('common.hideSecrets') : t('common.showSecrets')
            }
            pressed={reveal()}
            disabled={preferences.revealSecrets}
            onClick={() => toggleSecrets('replay')}
          />
        </div>
      </form>

      <section aria-label={t('replay.resultLabel')} class="flex min-h-80 flex-col border-line lg:border-s">
        <Show when={replayResult()} fallback={<p class="p-4 text-fg-2">{t('replay.empty')}</p>}>
          {(result) => (
            <>
              <div class="flex flex-wrap items-center gap-2 border-b border-line p-1.5">
                <span class={[badgeClass, 'text-accent']}>{t('replay.replayResponse')}</span>
                <MethodBadge method={method()} />
                <Show
                  when={result().error}
                  fallback={
                    <>
                      <StatusBadge status={result().status} text={result().statusText} />
                      <span>{formatNumber(result().timeMs)} ms</span>
                      <span>{formatBytes(result().body.size)}</span>
                    </>
                  }
                >
                  <StatusBadge status={0} error={result().error} />
                  <span class="text-bad">{result().error}</span>
                </Show>
                <Show when={result().redirected}>
                  <span class="text-warn">{t('replay.redirected', { url: result().url })}</span>
                </Show>
              </div>
              <div class="min-h-0 flex-1">
                <Tabs
                  label={t('replay.resultTabs.label')}
                  value={resultTab()}
                  onChange={setResultTab}
                  panelClass={resultTab() === 'response' ? 'flex flex-col overflow-hidden p-2' : 'overflow-auto p-2'}
                  tabs={[
                    { id: 'response' as const, label: t('replay.resultTabs.response') },
                    { id: 'headers' as const, label: t('replay.resultTabs.headers') },
                    ...(sourceRequest() ? [{ id: 'compare' as const, label: t('replay.resultTabs.compare') }] : []),
                  ]}
                >
                  <Switch>
                    <Match when={resultTab() === 'response'}>
                      <CodeViewer
                        body={result().body}
                        mime={result().mime}
                        url={result().url}
                        headers={result().headers}
                        label={t('replay.responseBody')}
                        fill
                      />
                    </Match>
                    <Match when={resultTab() === 'headers'}>
                      <KeyValueSection title={t('replay.responseHeaders')} rows={result().headers} />
                    </Match>
                    <Match when={resultTab() === 'compare' ? sourceRequest() : null}>
                      {(source) => {
                        const capturedBody = () => {
                          bodiesVersion();
                          return captureLog.body(source().id);
                        };
                        return (
                          <>
                            <KeyValueSection
                              title={t('replay.comparison')}
                              copy={false}
                              rows={[
                                {
                                  name: t('detail.fields.status'),
                                  value: t('replay.compareStatus', {
                                    captured: source().status,
                                    replay: result().status || t('replay.error'),
                                  }),
                                },
                                {
                                  name: t('network.columns.time'),
                                  value: t('replay.compareTime', { captured: Math.round(source().duration), replay: result().timeMs }),
                                },
                                { name: t('replay.capturedBody'), value: t(`viewer.states.${capturedBody().state}`) },
                              ]}
                            />
                            <h3 class={sectionTitleClass}>{t('replay.body')}</h3>
                            <DiffView
                              before={comparableText(capturedBody(), source().mime)}
                              after={comparableText(result().body, result().mime)}
                              beforeLabel={t('replay.capturedBody')}
                              afterLabel={t('replay.replayResponse')}
                            />
                            <h3 class={sectionTitleClass}>{t('detail.responseHeaders')}</h3>
                            <DiffView
                              before={headersText(source().har.response.headers, true)}
                              after={headersText(result().headers, true)}
                              beforeLabel={t('replay.capturedBody')}
                              afterLabel={t('replay.replayResponse')}
                            />
                          </>
                        );
                      }}
                    </Match>
                  </Switch>
                </Tabs>
              </div>
            </>
          )}
        </Show>
      </section>

      <aside aria-label={t('replay.historyLabel')} class="min-h-0 overflow-auto border-line lg:border-s">
        <h2 class={[sectionTitleClass, 'px-2']}>{t('replay.history')}</h2>
        <ul>
          <For each={replayHistory()} fallback={<li class="px-2 text-fg-2">{t('replay.noHistory')}</li>}>
            {(record) => (
              <li>
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-1 px-2 py-0.5 text-start hover:bg-bg-3"
                  title={record.draft.url}
                  onClick={() => loadHistoryRecord(record)}
                >
                  <StatusBadge status={record.result.status} error={record.result.error} />
                  <MethodBadge method={record.draft.method} />
                  <span class={[monoClass, 'min-w-0 flex-1 truncate']}>{URL.parse(record.draft.url)?.pathname ?? record.draft.url}</span>
                  <span class="text-fg-2">{new Date(record.at).toLocaleTimeString()}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </aside>
    </div>
  );
}
