import {
  BODY_TYPE_INFO,
  BODY_TYPES,
  bodyTypeOf,
  getHeader,
  graphqlBody,
  graphqlParts,
  isTextBody,
  multipartBody,
  multipartBoundary,
  multipartRows,
  newBoundary,
  setHeader,
  urlencodedBody,
  urlencodedRows,
  type BodyTypeId,
  type Row,
} from '@betterdevtools/core';
import { createEffect, createMemo, createSignal, Match, Show, snapshot, Switch } from 'solid-js';
import { t } from '../i18n/index.ts';
import { editReplayDraft, replayDraft, replayVersion } from '../state/replay.ts';
import CodeEditor from './ui/CodeEditor.tsx';
import IconButton from './ui/IconButton.tsx';
import KeyValueEditor from './ui/KeyValueEditor.tsx';
import SelectMenu from './ui/SelectMenu.tsx';

const TYPE_NAMES: Record<BodyTypeId, string> = {
  none: '',
  json: 'JSON',
  text: 'Text',
  javascript: 'JavaScript',
  html: 'HTML',
  xml: 'XML',
  urlencoded: 'x-www-form-urlencoded',
  multipart: 'form-data',
  graphql: 'GraphQL',
};
const JSON_LIMIT_CHARS = 200_000;

/**
 * The Body tab of Replay: pick the body type (JSON, text, XML, form fields, GraphQL…) and edit it
 * the way that type is edited. Like Postman, choosing a type also sets the Content-Type header.
 */
export default function BodyEditor(props: { onKeyDown: (event: KeyboardEvent) => void }) {
  const [type, setType] = createSignal<BodyTypeId>('none');
  const [graphql, setGraphql] = createSignal({ query: '', variables: '' });
  // what each type held before another was picked, so switching back does not lose it
  let stash: Partial<Record<BodyTypeId, string>> = {};

  // a different request was opened: detect its type again
  createEffect(replayVersion, () => {
    const draft = snapshot(replayDraft);
    stash = {};
    setType(bodyTypeOf(draft.headers, draft.body));
    setGraphql(graphqlParts(draft.body));
  });

  const setBody = (body: string) =>
    editReplayDraft((draft) => {
      draft.body = body;
    });

  function switchTo(next: BodyTypeId) {
    const previous = type();
    if (next === previous) return;
    const draft = snapshot(replayDraft);
    stash[previous] = draft.body;
    const body = next === 'none' ? '' : isTextBody(previous) && isTextBody(next) ? draft.body : (stash[next] ?? '');
    let headers = draft.headers;
    const { contentType } = BODY_TYPE_INFO[next];
    if (next === 'none') headers = setHeader(headers, 'Content-Type', null);
    else if (next === 'multipart') headers = setHeader(headers, 'Content-Type', `multipart/form-data; boundary=${newBoundary()}`);
    else if (contentType) headers = setHeader(headers, 'Content-Type', contentType);
    editReplayDraft((target) => {
      target.body = body;
      target.headers = headers;
    });
    if (next === 'graphql') setGraphql(graphqlParts(body));
    setType(next);
  }

  // multipart bodies are tied to the boundary of the Content-Type header
  function boundary(): string {
    return multipartBoundary(getHeader(replayDraft.headers, 'content-type')) ?? newBoundary();
  }
  function writeMultipart(rows: Row[]) {
    const current = multipartBoundary(getHeader(replayDraft.headers, 'content-type'));
    const used = current ?? newBoundary();
    editReplayDraft((draft) => {
      draft.body = multipartBody(rows, used);
      if (!current) draft.headers = setHeader(draft.headers, 'Content-Type', `multipart/form-data; boundary=${used}`);
    });
    return multipartBody(rows, used);
  }

  const lang = createMemo(() => BODY_TYPE_INFO[type()].lang);
  const jsonProblem = createMemo(() => {
    const body = replayDraft.body;
    if (type() !== 'json' || !body.trim() || body.length > JSON_LIMIT_CHARS || /\{\{\s*[\w.-]+\s*\}\}/.test(body)) return false;
    try {
      JSON.parse(body);
      return false;
    } catch {
      return true;
    }
  });
  const variablesProblem = createMemo(() => graphqlBody(graphql().query, graphql().variables).invalidVariables);

  function formatJson() {
    try {
      setBody(JSON.stringify(JSON.parse(replayDraft.body), null, 2));
    } catch {
      /* not valid JSON: the warning under the editor says so */
    }
  }

  function editGraphql(patch: Partial<{ query: string; variables: string }>) {
    const next = { ...graphql(), ...patch };
    setGraphql(next);
    setBody(graphqlBody(next.query, next.variables).body);
  }

  return (
    <div class="flex h-full min-h-40 flex-col gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-fg-2">{t('replay.bodyEditor.type')}</span>
        <SelectMenu
          label={t('replay.bodyEditor.type')}
          value={type()}
          onChange={(value) => switchTo(BODY_TYPES.find((id) => id === value) ?? 'none')}
          options={BODY_TYPES.map((id) => ({
            value: id,
            label: id === 'none' ? t('common.none') : TYPE_NAMES[id],
            description: BODY_TYPE_INFO[id].contentType ?? undefined,
          }))}
        />
        <Show when={type() === 'json'}>
          <IconButton icon="expand" label={t('replay.bodyEditor.format')} text={t('replay.bodyEditor.format')} disabled={jsonProblem() || !replayDraft.body.trim()} onClick={formatJson} />
        </Show>
      </div>

      <div class="min-h-0 flex-1">
        <Switch>
          <Match when={type() === 'none'}>
            <p class="p-1 text-fg-2">{t('replay.bodyEditor.noneHint')}</p>
          </Match>
          <Match when={lang()}>
            {(language) => (
              <CodeEditor
                class="h-full"
                label={t('replay.bodyLabel')}
                lang={language()}
                value={replayDraft.body}
                onInput={setBody}
                onKeyDown={props.onKeyDown}
              />
            )}
          </Match>
          <Match when={type() === 'urlencoded'}>
            <KeyValueEditor
              label={t('replay.bodyLabel')}
              text={replayDraft.body}
              onText={setBody}
              toRows={urlencodedRows}
              toText={urlencodedBody}
              onKeyDown={props.onKeyDown}
            />
          </Match>
          <Match when={type() === 'multipart'}>
            <KeyValueEditor
              label={t('replay.bodyLabel')}
              text={replayDraft.body}
              onText={() => undefined}
              toRows={(text) => multipartRows(text, boundary())}
              toText={writeMultipart}
              onKeyDown={props.onKeyDown}
            />
            <p class="mt-1 text-fg-2">{t('replay.bodyEditor.multipartHint')}</p>
          </Match>
          <Match when={type() === 'graphql'}>
            <div class="grid h-full grid-rows-[minmax(0,2fr)_minmax(0,1fr)] gap-1">
              <CodeEditor
                label={t('replay.bodyEditor.graphqlQuery')}
                lang="js"
                value={graphql().query}
                onInput={(query) => editGraphql({ query })}
                onKeyDown={props.onKeyDown}
                placeholder="query { … }"
              />
              <CodeEditor
                label={t('replay.bodyEditor.graphqlVariables')}
                lang="json"
                value={graphql().variables}
                onInput={(variables) => editGraphql({ variables })}
                onKeyDown={props.onKeyDown}
                placeholder='{ "id": 1 }'
              />
            </div>
          </Match>
        </Switch>
      </div>

      <Show when={jsonProblem()}>
        <p class="text-warn" role="status">
          {t('replay.bodyEditor.invalidJson')}
        </p>
      </Show>
      <Show when={type() === 'graphql' && variablesProblem()}>
        <p class="text-warn" role="status">
          {t('replay.bodyEditor.invalidVariables')}
        </p>
      </Show>
    </div>
  );
}
