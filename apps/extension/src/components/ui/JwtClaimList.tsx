import type { JwtInfo, JwtResult } from '@betterdevtools/core';
import { Show } from 'solid-js';
import { locale, t } from '../../i18n/index.ts';
import CopyButton from './CopyButton.tsx';
import Icon from './Icon.tsx';
import KeyValueSection, { type Row } from './KeyValueSection.tsx';

const RELATIVE_UNITS: [number, Intl.RelativeTimeFormatUnit][] = [
  [86_400_000, 'day'],
  [3_600_000, 'hour'],
  [60_000, 'minute'],
];

/** "2026-11-18T10:00:00.000Z (in 2 hours)" for a NumericDate claim, in the UI language. */
function describeTime(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  const difference = seconds * 1000 - Date.now();
  const [unitMs, unit] = RELATIVE_UNITS.find(([ms]) => Math.abs(difference) >= ms) ?? [1000, 'second'];
  const relative = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(Math.round(difference / unitMs), unit);
  return `${new Date(seconds * 1000).toISOString()} (${relative})`;
}

const showValue = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/** Registered claims first, in a fixed order, then the custom ones as they appear in the token. */
function claimRows(jwt: JwtInfo): Row[] {
  const rows: Row[] = [];
  const add = (name: string, value: string | undefined) => {
    if (value) rows.push({ name, value });
  };
  add(t('jwt.claimNames.iss'), jwt.iss);
  add(t('jwt.claimNames.sub'), jwt.sub);
  add(t('jwt.claimNames.aud'), jwt.aud.join(', '));
  add(t('jwt.claimNames.exp'), describeTime(jwt.exp));
  add(t('jwt.claimNames.nbf'), describeTime(jwt.nbf));
  add(t('jwt.claimNames.iat'), describeTime(jwt.iat));
  for (const [name, value] of jwt.custom) rows.push({ name, value: showValue(value) });
  return rows;
}

/**
 * A JWT decoded locally. It never says the token is valid: the signature is not checked, and
 * the full token can only be copied while secrets are shown.
 */
export default function JwtClaimList(props: { result: JwtResult; token: string; reveal: boolean }) {
  return (
    <div class="flex flex-col gap-1 py-1">
      <p class="flex items-start gap-1 text-fg-2">
        <Icon name="info" />
        {t('jwt.notice')}
      </p>
      <Show
        when={props.result.ok ? props.result.jwt : null}
        fallback={<p class="text-warn">{t('jwt.notDecodable', { error: props.result.ok ? '' : props.result.error })}</p>}
      >
        {(jwt) => (
          <>
            <p class={{ 'text-bad': jwt().state === 'expired' || jwt().state === 'not-yet-valid' }}>
              {t(`jwt.states.${jwt().state}`)} · {jwt().alg ? t('jwt.alg', { alg: jwt().alg ?? '' }) : t('jwt.algUnset')}
              {jwt().typ ? ` · typ ${jwt().typ}` : ''}
            </p>
            <KeyValueSection
              title={t('jwt.header')}
              rows={Object.entries(jwt().header).map(([name, value]) => ({ name, value: showValue(value) }))}
            />
            <KeyValueSection title={t('jwt.claims')} rows={claimRows(jwt())} empty={t('jwt.noClaims')} />
            <div class="flex flex-wrap items-center gap-2 text-fg-2">
              <span class="inline-flex items-center gap-1">
                {t('jwt.headerJson')} <CopyButton text={() => JSON.stringify(jwt().header, null, 2)} label={t('jwt.copyHeader')} />
              </span>
              <span class="inline-flex items-center gap-1">
                {t('jwt.payloadJson')} <CopyButton text={() => JSON.stringify(jwt().payload, null, 2)} label={t('jwt.copyPayload')} />
              </span>
              <span class="inline-flex items-center gap-1">
                {t('jwt.fullToken')}{' '}
                <CopyButton
                  text={() => props.token}
                  label={t('jwt.copyToken')}
                  disabled={!props.reveal}
                  reason={t('jwt.copyTokenNeedsSecrets')}
                />
              </span>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
