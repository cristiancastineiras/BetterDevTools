import { decodeJwt, verifyJwtHmac, type JwtVerification } from '@betterdevtools/core';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import DiffView from '../DiffView.tsx';
import JwtClaimList from '../ui/JwtClaimList.tsx';
import { Field, Hint, Page, Section, TextArea } from './kit.tsx';

const pretty = (token: string): string => {
  const result = decodeJwt(token);
  return result.ok ? JSON.stringify({ header: result.jwt.header, payload: result.jwt.payload }, null, 2) : '';
};

/** Decode a JWT locally, check an HMAC signature with a secret, and compare two tokens claim by claim. */
export default function JwtTool() {
  const [token, setToken] = createSignal('');
  const [other, setOther] = createSignal('');
  const [secret, setSecret] = createSignal('');
  const [verification, setVerification] = createSignal<JwtVerification | null>(null);

  const decoded = createMemo(() => (token().trim() ? decodeJwt(token()) : null));
  createEffect(
    () => ({ token: token(), secret: secret() }),
    (current) => {
      if (!current.secret || !decoded()?.ok) {
        setVerification(null);
        return;
      }
      let active = true;
      void verifyJwtHmac(current.token, current.secret).then((result) => active && setVerification(result));
      return () => {
        active = false;
      };
    },
  );

  return (
    <Page>
      <TextArea label="JWT" value={token()} onInput={setToken} rows={5} placeholder="eyJhbGciOiJIUzI1NiIs…" />
      <Show when={decoded()} fallback={<Hint>{t('toolbox.jwt.paste')}</Hint>}>
        {(result) => <JwtClaimList result={result()} token={token()} reveal />}
      </Show>
      <Show when={decoded()?.ok}>
        <Section title={t('toolbox.jwt.verify')}>
          <Field label={t('toolbox.jwt.secret')} value={secret()} onInput={setSecret} type="password" />
          <Show when={verification()} fallback={<Hint>{t('toolbox.jwt.verifyHint')}</Hint>}>
            {(check) => (
              <p role="status" class={check().status === 'valid' ? 'text-ok' : check().status === 'invalid' ? 'text-bad' : 'text-warn'}>
                {check().status === 'valid'
                  ? t('toolbox.jwt.valid')
                  : check().status === 'invalid'
                    ? t('toolbox.jwt.invalid')
                    : t('toolbox.jwt.unsupported', { reason: (check() as { reason: string }).reason })}
              </p>
            )}
          </Show>
        </Section>
      </Show>
      <Section title={t('toolbox.jwt.compare')}>
        <TextArea label={t('toolbox.jwt.other')} value={other()} onInput={setOther} rows={3} />
        <Show when={decoded()?.ok && other().trim()}>
          <Show when={decodeJwt(other()).ok} fallback={<Hint>{t('toolbox.jwt.otherInvalid')}</Hint>}>
            <DiffView
              before={pretty(token())}
              after={pretty(other())}
              beforeLabel={t('toolbox.jwt.first')}
              afterLabel={t('toolbox.jwt.second')}
            />
          </Show>
        </Show>
      </Section>
    </Page>
  );
}
