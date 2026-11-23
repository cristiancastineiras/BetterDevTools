import { decodeText, ENCODINGS, encodeText, type Encoding } from '@betterdevtools/core';
import { createMemo, createSignal, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import SelectMenu from '../ui/SelectMenu.tsx';
import { CapturedPicker, ErrorText, Output, Page, Row, TextArea } from './kit.tsx';

const NAMES: Record<Encoding, string> = {
  base64: 'Base64',
  base64url: 'Base64 URL-safe',
  url: 'URL (component)',
  'url-form': 'URL (form, + for space)',
  html: 'HTML entities',
  hex: 'Hex',
  binary: 'Binary',
  unicode: 'Unicode escapes',
  rot13: 'ROT13',
};

/** Encode or decode text: Base64, URL, HTML, hex, binary, Unicode escapes and ROT13. */
export default function EncodeTool() {
  const [kind, setKind] = createSignal<Encoding>('base64');
  const [mode, setMode] = createSignal<'encode' | 'decode'>('encode');
  const [input, setInput] = createSignal('');

  const result = createMemo((): { text: string; error?: string } => {
    if (!input()) return { text: '' };
    try {
      return { text: mode() === 'encode' ? encodeText(kind(), input()) : decodeText(kind(), input()) };
    } catch (error) {
      return { text: '', error: error instanceof Error ? error.message : String(error) };
    }
  });

  return (
    <Page>
      <Row>
        <SelectMenu
          label={t('toolbox.encode.encoding')}
          value={kind()}
          onChange={(value) => setKind(value as Encoding)}
          options={ENCODINGS.map((value) => ({ value, label: NAMES[value] }))}
        />
        <SegmentedControl
          label={t('toolbox.encode.direction')}
          value={mode()}
          onChange={setMode}
          options={[
            { value: 'encode', label: t('toolbox.encode.encode') },
            { value: 'decode', label: t('toolbox.encode.decode') },
          ]}
        />
        <CapturedPicker onPick={setInput} />
      </Row>
      <TextArea label={t('toolbox.input')} value={input()} onInput={setInput} rows={8} />
      <Show when={result().error}>{(message) => <ErrorText>{message()}</ErrorText>}</Show>
      <Output label={t('toolbox.output')} text={result().text} rows={8} />
    </Page>
  );
}
