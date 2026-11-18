import { createMemo, createSignal, createStore, Show, snapshot } from 'solid-js';
import { t } from '../i18n/index.ts';
import { cookieJar, cookieUrl, type StoreCookie } from '../lib/devtools.ts';
import { askConfirmation } from '../state/ui.ts';
import CookieEditor, { type EditableCookie } from './ui/CookieEditor.tsx';
import Icon from './ui/Icon.tsx';
import IconButton from './ui/IconButton.tsx';

/** "domain .example.com/ · Secure · HttpOnly · expires …" for a stored cookie. */
function describeCookie(cookie: StoreCookie): string {
  return [
    `${cookie.hostOnly ? cookie.domain : t('jar.domain', { domain: cookie.domain })}${cookie.path}`,
    cookie.secure && 'Secure',
    cookie.httpOnly && 'HttpOnly',
    cookie.sameSite && cookie.sameSite !== 'unspecified' && `SameSite=${cookie.sameSite}`,
    cookie.session
      ? t('jar.session')
      : cookie.expirationDate && t('jar.expires', { date: new Date(cookie.expirationDate * 1000).toISOString() }),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Everything needed to write the cookie back exactly as it was (for undo). */
function restorableCopy(cookie: StoreCookie) {
  return {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    storeId: cookie.storeId,
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    ...(cookie.session ? {} : { expirationDate: cookie.expirationDate }),
  };
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface UndoStep {
  label: string;
  restore: () => Promise<void>;
}

/**
 * The browser's real cookies for one URL (not the captured ones). Nothing changes without a
 * confirmation that explains the effect, and every applied change can be undone.
 */
export default function CookieJar(props: { url: string; reveal: boolean }) {
  // the pane stays mounted while moving through requests: another URL starts over, unloaded
  const [storedCookies, setStoredCookies] = createSignal<StoreCookie[]>(() => {
    void props.url;
    return [];
  });
  const [rows, setRows] = createStore<EditableCookie[]>([]);
  const [loadState, setLoadState] = createSignal<'idle' | 'loading' | 'ready'>(() => {
    void props.url;
    return 'idle' as const;
  });
  const [message, setMessage] = createSignal(() => {
    void props.url;
    return '';
  });
  const [undoSteps, setUndoSteps] = createSignal<UndoStep[]>(() => {
    void props.url;
    return [];
  });
  const host = createMemo(() => URL.parse(props.url)?.host ?? props.url);

  async function load() {
    setLoadState('loading');
    setMessage('');
    const result = await cookieJar.open(props.url);
    if ('unavailable' in result) {
      setMessage(t('jar.unavailable', { reason: result.unavailable }));
      setLoadState('idle');
      return;
    }
    setStoredCookies(result.cookies);
    setRows(() =>
      result.cookies.map((cookie) => ({ name: cookie.name, value: cookie.value, note: describeCookie(cookie), fixedName: true })),
    );
    setLoadState('ready');
  }

  /** Every change goes through here: explain, confirm, apply, record how to undo it, reload. */
  async function applyChange(title: string, effect: string, change: () => Promise<UndoStep>) {
    const confirmed = await askConfirmation({
      title,
      details: [{ text: effect }, { text: t('jar.storageNote') }],
      confirmLabel: t('jar.applyChange'),
    });
    if (!confirmed) return;
    try {
      const undo = await change();
      setUndoSteps((steps) => [...steps, undo]);
      setMessage('');
    } catch (error) {
      setMessage(t('jar.notApplied', { error: errorText(error) }));
    }
    await load();
  }

  function saveRow(index: number) {
    const row = snapshot(rows)[index];
    if (!row) return;
    // rows start as the stored cookies, in the same order; rows added by the user come after
    const original = storedCookies()[index];
    if (original) {
      void applyChange(
        t('jar.updateTitle', { name: original.name }),
        t('jar.updateEffect', { details: describeCookie(original) }),
        async () => {
          await cookieJar.set({ ...restorableCopy(original), value: row.value });
          return {
            label: t('jar.undoUpdate', { name: original.name }),
            restore: async () => void (await cookieJar.set(restorableCopy(original))),
          };
        },
      );
      return;
    }
    const name = row.name.trim();
    if (!name) {
      setMessage(t('jar.needsName'));
      return;
    }
    const url = props.url;
    void applyChange(t('jar.createTitle', { name }), t('jar.createEffect', { host: host() }), async () => {
      const created = await cookieJar.set({ url, name, value: row.value, path: '/' });
      return {
        label: t('jar.undoCreate', { name: created.name }),
        restore: () => cookieJar.remove(cookieUrl(created), created.name, created.storeId),
      };
    });
  }

  function deleteRow(index: number) {
    const original = storedCookies()[index];
    if (!original) {
      // a row the user added and never applied: nothing to confirm
      setRows((list) => void list.splice(index, 1));
      return;
    }
    void applyChange(
      t('jar.deleteTitle', { name: original.name }),
      t('jar.deleteEffect', { details: describeCookie(original) }),
      async () => {
        await cookieJar.remove(cookieUrl(original), original.name, original.storeId);
        return {
          label: t('jar.undoDelete', { name: original.name }),
          restore: async () => void (await cookieJar.set(restorableCopy(original))),
        };
      },
    );
  }

  function deleteAll() {
    const cookies = storedCookies();
    void applyChange(t('jar.deleteAllTitle', { count: cookies.length, host: host() }), t('jar.deleteAllEffect'), async () => {
      for (const cookie of cookies) await cookieJar.remove(cookieUrl(cookie), cookie.name, cookie.storeId);
      return {
        label: t('jar.undoDeleteAll', { count: cookies.length }),
        restore: async () => void (await Promise.all(cookies.map((cookie) => cookieJar.set(restorableCopy(cookie))))),
      };
    });
  }

  async function undoLastChange() {
    const steps = undoSteps();
    const last = steps.at(-1);
    if (!last) return;
    setUndoSteps(steps.slice(0, -1));
    try {
      await last.restore();
      setMessage(t('jar.undid', { what: last.label }));
    } catch (error) {
      setMessage(t('jar.undoFailed', { error: errorText(error) }));
    }
    await load();
  }

  return (
    <section aria-label={t('jar.region')} class="flex flex-col gap-2 border-t border-line pt-2">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-semibold">{t('jar.title', { host: host() })}</h3>
        <Show
          when={loadState() === 'ready'}
          fallback={
            <IconButton
              icon="cookie"
              label={t('jar.manageLabel', { host: host() })}
              text={t('jar.manage')}
              busy={loadState() === 'loading'}
              onClick={() => void load()}
            />
          }
        >
          <IconButton
            icon="plus"
            label={t('jar.addLabel')}
            text={t('common.add')}
            onClick={() => setRows((list) => void list.push({ name: '', value: '' }))}
          />
          <IconButton
            icon="trash"
            label={t('jar.deleteAllLabel', { host: host() })}
            text={t('jar.deleteAll')}
            disabled={!storedCookies().length}
            onClick={deleteAll}
          />
          <IconButton
            icon="undo"
            label={undoSteps().length ? t('jar.undoLabel', { what: undoSteps().at(-1)?.label ?? '' }) : t('jar.nothingToUndo')}
            text={t('jar.undo')}
            disabled={!undoSteps().length}
            onClick={() => void undoLastChange()}
          />
        </Show>
      </div>
      <p class="flex items-start gap-1 text-fg-2">
        <Icon name="warning" />
        {t('jar.warning')}
      </p>
      <Show when={message()}>
        <p class="text-warn" role="status">
          {message()}
        </p>
      </Show>
      <Show when={loadState() === 'ready'}>
        <CookieEditor
          label={t('jar.title', { host: host() })}
          rows={rows}
          reveal={props.reveal}
          onEdit={(index, field, value) =>
            setRows((list) => {
              if (list[index]) list[index][field] = value;
            })
          }
          actions={(index) => (
            <>
              <IconButton
                icon="save"
                variant="ghost"
                label={t('jar.apply', { name: rows[index]?.name || t('cookies.editor.cookie') })}
                onClick={() => saveRow(index)}
              />
              <IconButton
                icon="trash"
                variant="ghost"
                label={t('jar.deleteOne', { name: rows[index]?.name || t('cookies.editor.cookie') })}
                onClick={() => deleteRow(index)}
              />
            </>
          )}
        />
      </Show>
    </section>
  );
}
