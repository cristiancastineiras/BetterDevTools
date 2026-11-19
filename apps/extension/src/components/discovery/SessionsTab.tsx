import { For, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import {
  clearComparison,
  comparison,
  compareWithSaved,
  currentModel,
  deleteSavedSession,
  openSavedSession,
  savedSessions,
} from '../../state/discovery.ts';
import { askConfirmation } from '../../state/ui.ts';
import IconButton from '../ui/IconButton.tsx';
import { monoClass, sectionTitleClass } from '../ui/styles.ts';

async function remove(id: string, name: string) {
  const confirmed = await askConfirmation({
    title: t('discovery.sessions.deleteTitle'),
    details: [{ text: t('discovery.sessions.deleteDetail', { name }) }],
    confirmLabel: t('common.delete'),
  });
  if (confirmed) await deleteSavedSession(id);
}

/** Saved sessions (kept in this browser, scrubbed of credentials), and what changed against one. */
export default function SessionsTab() {
  const current = () => currentModel()?.state.id ?? null;

  return (
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <p class="max-w-2xl text-fg-2">{t('discovery.sessions.hint')}</p>
      <Show when={savedSessions().length} fallback={<p>{t('discovery.sessions.none')}</p>}>
        <ul class="flex flex-col">
          <For each={savedSessions()}>
            {(session) => (
              <li class="flex flex-wrap items-center gap-2 border-b border-bg-3 py-1">
                <div class="min-w-0 flex-1">
                  <p class="font-medium [overflow-wrap:anywhere]">
                    {session.name}
                    <Show when={session.id === current()}>
                      <span class="ms-1 text-accent">{t('discovery.sessions.current')}</span>
                    </Show>
                  </p>
                  <p class="text-fg-2">
                    {t('discovery.sessions.summary', { endpoints: formatNumber(session.endpoints), requests: formatNumber(session.seen), date: new Date(session.startedAt).toLocaleString() })}
                  </p>
                </div>
                <IconButton icon="export" label={t('discovery.sessions.open')} text={t('discovery.sessions.open')} disabled={session.id === current()} onClick={() => void openSavedSession(session.id)} />
                <IconButton
                  icon="replay"
                  label={t('discovery.sessions.compareHint')}
                  text={t('discovery.sessions.compare')}
                  disabled={!current() || session.id === current()}
                  onClick={() => void compareWithSaved(session.id)}
                />
                <IconButton icon="trash" variant="ghost" label={t('common.delete')} onClick={() => void remove(session.id, session.name)} />
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={comparison()}>
        {(result) => (
          <section class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <h3 class={sectionTitleClass}>{t('discovery.sessions.comparedTo', { name: result().name })}</h3>
              <IconButton icon="close" variant="ghost" label={t('common.close')} onClick={clearComparison} />
            </div>
            <Show
              when={result().diff.added.length || result().diff.removed.length || result().diff.changed.length}
              fallback={<p>{t('discovery.sessions.same')}</p>}
            >
              <Show when={result().diff.added.length}>
                <h4 class="font-semibold text-ok">{t('discovery.sessions.added', { count: result().diff.added.length })}</h4>
                <ul class={[monoClass, 'flex flex-col gap-0.5']}>
                  <For each={result().diff.added}>{(key) => <li class="[overflow-wrap:anywhere]">+ {key}</li>}</For>
                </ul>
              </Show>
              <Show when={result().diff.removed.length}>
                <h4 class="font-semibold text-bad">{t('discovery.sessions.removed', { count: result().diff.removed.length })}</h4>
                <ul class={[monoClass, 'flex flex-col gap-0.5']}>
                  <For each={result().diff.removed}>{(key) => <li class="[overflow-wrap:anywhere]">− {key}</li>}</For>
                </ul>
              </Show>
              <Show when={result().diff.changed.length}>
                <h4 class="font-semibold text-warn">{t('discovery.sessions.changed', { count: result().diff.changed.length })}</h4>
                <ul class="flex flex-col gap-2">
                  <For each={result().diff.changed}>
                    {(change) => (
                      <li>
                        <p class={[monoClass, '[overflow-wrap:anywhere]']}>{change.key}</p>
                        <Show when={change.statuses.added.length || change.statuses.removed.length}>
                          <p class="ms-4 text-fg-2">
                            {t('discovery.sessions.statuses', { added: change.statuses.added.join(', ') || '—', removed: change.statuses.removed.join(', ') || '—' })}
                          </p>
                        </Show>
                        <For each={change.schemas}>
                          {(schema) => (
                            <ul class="ms-4">
                              <For each={schema.changes.slice(0, 12)}>
                                {(item) => (
                                  <li>
                                    <span class={monoClass}>
                                      {schema.status} {item.path}
                                    </span>{' '}
                                    <span class="text-fg-2">
                                      {t(`discovery.sessions.change.${item.change}`)}: {item.detail}
                                    </span>
                                  </li>
                                )}
                              </For>
                            </ul>
                          )}
                        </For>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </section>
        )}
      </Show>
    </div>
  );
}
