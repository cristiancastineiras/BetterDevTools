import { CURL_TARGETS, curlToCode, parseCurl, type CurlTarget } from '@betterdevtools/core';
import { createMemo, createSignal, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import { curlOf } from '../../state/actions.ts';
import SelectMenu from '../ui/SelectMenu.tsx';
import { ErrorText, Output, Page, RequestPicker, Row, TextArea } from './kit.tsx';

const NAMES: Record<CurlTarget, string> = {
  fetch: 'JavaScript (fetch)',
  axios: 'JavaScript (axios)',
  python: 'Python (requests)',
  csharp: 'C# (HttpClient)',
  java: 'Java (HttpClient)',
};

/** Turns a cURL command into fetch, axios, Python, C# or Java code. */
export default function CurlTool() {
  const [command, setCommand] = createSignal('');
  const [target, setTarget] = createSignal<CurlTarget>('fetch');

  const result = createMemo((): { code: string; error?: string } | null => {
    if (!command().trim()) return null;
    const parsed = parseCurl(command());
    return parsed.ok ? { code: curlToCode(parsed.request, target()) } : { code: '', error: t('toolbox.curl.noUrl') };
  });

  return (
    <Page>
      <Row>
        <SelectMenu
          label={t('toolbox.curl.target')}
          value={target()}
          onChange={(value) => setTarget(value as CurlTarget)}
          options={CURL_TARGETS.map((value) => ({ value, label: NAMES[value] }))}
        />
        <RequestPicker onPick={(request) => setCommand(curlOf(request))} />
      </Row>
      <TextArea
        label={t('toolbox.curl.command')}
        value={command()}
        onInput={setCommand}
        rows={8}
        placeholder={"curl 'https://api.example.com/users' -H 'accept: application/json'"}
      />
      <Show when={result()?.error}>{(message) => <ErrorText>{message()}</ErrorText>}</Show>
      <Output label={t('toolbox.curl.code')} text={result()?.code ?? ''} rows={14} />
    </Page>
  );
}
