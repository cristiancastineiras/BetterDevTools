import { isSecretCookie, REDACTED, type CookieInfo } from '@betterdevtools/core';
import { createMemo, For, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import CopyButton from './CopyButton.tsx';
import Icon from './Icon.tsx';

/** Set-Cookie attributes as one line, e.g. "Secure HttpOnly SameSite=Lax". */
function flagsOf(cookie: CookieInfo): string {
  return [
    cookie.secure && 'Secure',
    cookie.httpOnly && 'HttpOnly',
    cookie.sameSite && `SameSite=${cookie.sameSite}`,
    cookie.partitioned && 'Partitioned',
    cookie.priority && `Priority=${cookie.priority}`,
  ]
    .filter(Boolean)
    .join(' ');
}

function expiryOf(cookie: CookieInfo): string {
  if (cookie.maxAge !== undefined) return `Max-Age=${cookie.maxAge}`;
  return cookie.expires ?? (cookie.source === 'response' ? t('cookies.session') : '');
}

const HEADER_CELL = 'pe-2 text-start font-semibold';
const CELL = 'border-t border-bg-3 py-0.5 pe-2 align-top';

/** Captured cookies of one request; Set-Cookie rows also show their attributes. */
export default function CookieTable(props: { title: string; cookies: CookieInfo[]; reveal: boolean }) {
  // request cookies are only name=value; the attribute columns appear when a Set-Cookie is listed
  const hasAttributes = createMemo(() => props.cookies.some((cookie) => cookie.source === 'response'));

  return (
    <section aria-label={props.title} class="mb-2">
      <div class="flex min-h-7 items-center gap-2">
        <h3 class="font-semibold">{props.title}</h3>
        <span class="rounded-full bg-bg-3 px-1.5 text-[11px] text-fg-2">{props.cookies.length}</span>
      </div>
      <Show when={props.cookies.length} fallback={<p class="py-1 text-fg-2">{t('common.none')}</p>}>
        <div class="overflow-x-auto" tabindex="0" role="region" aria-label={t('cookies.tableLabel', { title: props.title })}>
          <table class="w-full border-collapse font-mono text-[11.5px]">
            <thead class="font-sans text-fg-2">
              <tr>
                <th class={HEADER_CELL}>{t('cookies.columns.name')}</th>
                <th class={HEADER_CELL}>{t('cookies.columns.value')}</th>
                <Show when={hasAttributes()}>
                  <th class={HEADER_CELL}>{t('cookies.columns.domain')}</th>
                  <th class={HEADER_CELL}>{t('cookies.columns.path')}</th>
                  <th class={HEADER_CELL}>{t('cookies.columns.expires')}</th>
                  <th class={HEADER_CELL}>{t('cookies.columns.flags')}</th>
                </Show>
                <th>
                  <span class="sr-only">{t('cookies.columns.copy')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={props.cookies} keyed={false}>
                {(cookie) => (
                  <tr>
                    <td class={[CELL, 'whitespace-nowrap']}>
                      {cookie().name}
                      <Show when={isSecretCookie(cookie())}>
                        <span class="ms-1 inline-flex align-middle text-warn" title={t('cookies.looksSecret')}>
                          <Icon name="key" label={t('cookies.looksSecret')} />
                        </span>
                      </Show>
                    </td>
                    <td class={[CELL, 'break-all']}>
                      <Show when={props.reveal || !cookie().value} fallback={<span class="font-sans text-fg-2">{t('common.hidden')}</span>}>
                        {cookie().value}
                      </Show>
                    </td>
                    <Show when={hasAttributes()}>
                      <td class={CELL}>{cookie().domain ?? ''}</td>
                      <td class={CELL}>{cookie().path ?? ''}</td>
                      <td class={[CELL, 'whitespace-nowrap']}>{expiryOf(cookie())}</td>
                      <td class={CELL}>{flagsOf(cookie())}</td>
                    </Show>
                    <td class={CELL}>
                      <CopyButton
                        text={() => (props.reveal ? cookie().value : REDACTED)}
                        label={t('cookies.copyValue', { name: cookie().name })}
                        disabled={!props.reveal}
                        reason={t('cookies.copyNeedsSecrets')}
                      />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}
