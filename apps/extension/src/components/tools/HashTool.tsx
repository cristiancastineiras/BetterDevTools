import { bytesToBase64, hashAll, hmac, HASHES, toHex, type HashName, type HashRow } from '@betterdevtools/core';
import { createEffect, createSignal, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import SelectMenu from '../ui/SelectMenu.tsx';
import { CapturedPicker, Field, Hint, Output, Page, Pairs, Row, Section, TextArea } from './kit.tsx';

const encoder = new TextEncoder();

/** MD5, SHA-1/256/384/512 and CRC32 of a text, and HMAC with a key. Everything is computed locally. */
export default function HashTool() {
  const [input, setInput] = createSignal('');
  const [rows, setRows] = createSignal<HashRow[]>([]);
  const [key, setKey] = createSignal('');
  const [algorithm, setAlgorithm] = createSignal<HashName>('sha256');
  const [encoding, setEncoding] = createSignal<'hex' | 'base64'>('hex');
  const [mac, setMac] = createSignal('');

  createEffect(
    () => input(),
    (text) => {
      let current = true;
      void hashAll(text).then((result) => current && setRows(result));
      return () => {
        current = false;
      };
    },
  );
  createEffect(
    () => ({ key: key(), algorithm: algorithm(), encoding: encoding(), text: input() }),
    ({ key: secret, algorithm: name, encoding: format, text }) => {
      if (!secret) {
        setMac('');
        return;
      }
      let current = true;
      void hmac(name, encoder.encode(secret), encoder.encode(text)).then(
        (digest) => current && setMac(format === 'hex' ? toHex(digest) : bytesToBase64(digest)),
      );
      return () => {
        current = false;
      };
    },
  );

  return (
    <Page>
      <Row>
        <CapturedPicker onPick={setInput} />
      </Row>
      <TextArea label={t('toolbox.input')} value={input()} onInput={setInput} rows={6} />
      <Section title={t('toolbox.hash.checksums')}>
        <Pairs label={t('toolbox.hash.checksums')} rows={rows().map((row) => ({ name: row.name, value: row.hex }))} />
        <Hint>{t('toolbox.hash.weak')}</Hint>
      </Section>
      <Section title="HMAC">
        <Row>
          <Field label={t('toolbox.hash.key')} value={key()} onInput={setKey} type="password" class="min-w-56" />
          <SelectMenu
            label={t('toolbox.hash.algorithm')}
            value={algorithm()}
            onChange={(value) => setAlgorithm(value as HashName)}
            options={HASHES.map((value) => ({ value, label: value.toUpperCase() }))}
          />
          <SegmentedControl
            label={t('toolbox.hash.encoding')}
            value={encoding()}
            onChange={setEncoding}
            options={[
              { value: 'hex', label: 'Hex' },
              { value: 'base64', label: 'Base64' },
            ]}
          />
        </Row>
        <Show when={key()} fallback={<Hint>{t('toolbox.hash.keyHint')}</Hint>}>
          <Output label="HMAC" text={mac()} rows={2} />
        </Show>
      </Section>
    </Page>
  );
}
