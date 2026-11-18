import type { AuthItem } from '@betterdevtools/core';
import { createMemo, For, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import JwtClaimList from './JwtClaimList.tsx';
import KeyValueSection from './KeyValueSection.tsx';

/** "Bearer · JWT", "Basic · user ada", "Digest · response"… shown before the masked value. */
function schemeTag(item: AuthItem): string {
  return [
    item.customScheme ?? item.scheme,
    item.scheme === 'Bearer' && item.jwt?.ok ? 'JWT' : '',
    item.basicUser !== undefined ? t('auth.user', { name: item.basicUser }) : '',
    item.source === 'response' ? t('auth.response') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Authentication material of a request and its response; values stay masked until revealed. */
export default function AuthPanel(props: { items: AuthItem[]; reveal: boolean; expansion?: { open: boolean } | undefined }) {
  const rows = createMemo(() =>
    props.items.map((item) => ({
      name: item.cookieName ? `${item.header} (${item.cookieName})` : item.header,
      value: item.value,
      tag: schemeTag(item),
    })),
  );
  // tokens that look like JWTs get a decoded view (Bearer values lose their scheme prefix)
  const decodableTokens = createMemo(() =>
    props.items.flatMap((item) =>
      item.jwt ? [{ item, token: item.scheme === 'Bearer' ? item.value.replace(/^bearer\s+/i, '') : item.value }] : [],
    ),
  );

  return (
    <KeyValueSection
      title={t('auth.title')}
      rows={rows()}
      // challenges (WWW-Authenticate) are not secrets; everything else is
      secret={(row) => !/authenticate$/i.test(row.name)}
      reveal={props.reveal}
      empty={t('auth.none')}
      expansion={props.expansion}
    >
      <For each={decodableTokens()} keyed={false}>
        {(entry) => (
          <details class="my-1 border-s-2 border-line ps-2">
            <summary class="cursor-pointer py-0.5 hover:text-accent">
              {t('auth.decodedFrom', {
                source: entry().item.cookieName ? t('auth.cookie', { name: entry().item.cookieName ?? '' }) : entry().item.header,
              })}
            </summary>
            <Show when={entry().item.jwt}>{(jwt) => <JwtClaimList result={jwt()} token={entry().token} reveal={props.reveal} />}</Show>
          </details>
        )}
      </For>
    </KeyValueSection>
  );
}
