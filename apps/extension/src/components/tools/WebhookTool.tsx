import { HASHES, verifyWebhook, WEBHOOK_PROVIDERS, type HashName, type WebhookProvider, type WebhookResult } from '@betterdevtools/core';
import { createEffect, createSignal, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import SelectMenu from '../ui/SelectMenu.tsx';
import { Field, Hint, Output, Page, Row, TextArea } from './kit.tsx';

const NAMES: Record<WebhookProvider, string> = { github: 'GitHub', stripe: 'Stripe', slack: 'Slack', generic: 'HMAC' };
const HEADERS: Record<Exclude<WebhookProvider, 'generic'>, string> = {
  github: 'X-Hub-Signature-256',
  stripe: 'Stripe-Signature',
  slack: 'X-Slack-Signature',
};
const headerName = (provider: WebhookProvider) => (provider === 'generic' ? t('toolbox.webhook.signature') : HEADERS[provider]);

/** Checks a webhook signature (GitHub, Stripe, Slack or a generic HMAC) against the signing secret, locally. */
export default function WebhookTool() {
  const [provider, setProvider] = createSignal<WebhookProvider>('github');
  const [secret, setSecret] = createSignal('');
  const [body, setBody] = createSignal('');
  const [header, setHeader] = createSignal('');
  const [timestamp, setTimestamp] = createSignal('');
  const [algorithm, setAlgorithm] = createSignal<HashName>('sha256');
  const [encoding, setEncoding] = createSignal<'hex' | 'base64'>('hex');
  const [result, setResult] = createSignal<WebhookResult | null>(null);

  createEffect(
    () => ({
      provider: provider(),
      secret: secret(),
      body: body(),
      header: header(),
      timestamp: timestamp(),
      algorithm: algorithm(),
      encoding: encoding(),
    }),
    (check) => {
      let active = true;
      void verifyWebhook(check).then((outcome) => active && setResult(outcome));
      return () => {
        active = false;
      };
    },
  );

  return (
    <Page>
      <Hint>{t('toolbox.webhook.intro')}</Hint>
      <Row>
        <SelectMenu
          label={t('toolbox.webhook.provider')}
          value={provider()}
          onChange={(value) => setProvider(value as WebhookProvider)}
          options={WEBHOOK_PROVIDERS.map((value) => ({ value, label: NAMES[value] }))}
        />
        <Field label={t('toolbox.webhook.secret')} value={secret()} onInput={setSecret} type="password" class="min-w-56 flex-1" />
        <Show when={provider() === 'generic'}>
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
        </Show>
      </Row>
      <Field label={`${t('toolbox.webhook.header')}: ${headerName(provider())}`} value={header()} onInput={setHeader} class="w-full" />
      <Show when={provider() === 'slack'}>
        <Field label="X-Slack-Request-Timestamp" value={timestamp()} onInput={setTimestamp} class="w-56" />
      </Show>
      <TextArea label={t('toolbox.webhook.body')} value={body()} onInput={setBody} rows={8} placeholder={t('toolbox.webhook.bodyHint')} />
      <Show when={result()}>
        {(outcome) => (
          <>
            <p
              role="status"
              class={outcome().ok ? (outcome().ok && (outcome() as { stale: boolean }).stale ? 'text-warn' : 'text-ok') : 'text-bad'}
            >
              {outcome().ok
                ? (outcome() as { stale: boolean }).stale
                  ? t('toolbox.webhook.stale')
                  : t('toolbox.webhook.valid')
                : t(`toolbox.webhook.${(outcome() as { reason: 'mismatch' | 'malformed' | 'missing' }).reason}`)}
            </p>
            <Show when={outcome().expected}>
              <Output label={t('toolbox.webhook.expected')} text={outcome().expected} rows={2} />
            </Show>
          </>
        )}
      </Show>
    </Page>
  );
}
