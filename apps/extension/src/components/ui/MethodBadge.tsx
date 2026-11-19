import { methodToken, statusToken } from '@betterdevtools/core';
import { t } from '../../i18n/index.ts';

/** Shared look of method and status badges: the colour pair comes from the HTTP tokens in app.css. */
export const BADGE_CLASS =
  'inline-block min-w-[2.6em] rounded-[3px] px-1 text-center font-mono text-small/4 font-semibold whitespace-nowrap';

export const badgeColors = (token: string) => ({ color: `var(--color-${token})`, background: `var(--color-${token}-bg)` });

/** The method is always written out: colour is never the only signal. */
export default function MethodBadge(props: { method: string }) {
  return (
    <span class={BADGE_CLASS} style={badgeColors(`m-${methodToken(props.method)}`)}>
      {props.method}
    </span>
  );
}

/** Status code (or "failed"/"cancelled") coloured by class: 2xx green, 4xx amber, 5xx red… */
export function StatusBadge(props: { status: number; error?: string | undefined; text?: string | undefined }) {
  const token = () => statusToken(props.status, props.error ?? '');
  const label = () =>
    props.status ? String(props.status) : token() === 'cancelled' ? 'cancelled' : token() === 'error' ? t('network.failed') : '—';
  return (
    <span class={BADGE_CLASS} style={badgeColors(`s-${token()}`)} title={props.error || props.text || undefined}>
      {label()}
      {props.text ? <span class="font-normal"> {props.text}</span> : null}
    </span>
  );
}
