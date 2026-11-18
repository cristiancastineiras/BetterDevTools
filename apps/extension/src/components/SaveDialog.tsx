import { folderPaths, insertNode, newId } from '@betterdevtools/core';
import { createMemo, createSignal, createUniqueId, Show } from 'solid-js';
import { t } from '../i18n/index.ts';
import { announce, closeDialog, openDialog } from '../state/ui.ts';
import { activeWorkspace, editWorkspace } from '../state/workspaces.ts';
import Modal from './ui/Modal.tsx';
import SelectMenu from './ui/SelectMenu.tsx';
import { buttonClass, fieldClass } from './ui/styles.ts';

const MAX_NAME_LENGTH = 200;

/** Saves a request (method, URL, query, headers, body; never credentials) into a collection folder. */
export default function SaveDialog() {
  const titleId = createUniqueId();
  const request = createMemo(() => {
    const dialog = openDialog();
    return dialog?.kind === 'save' ? dialog.request : null;
  });
  const [name, setName] = createSignal('');
  const [folderId, setFolderId] = createSignal('');
  const folders = createMemo(() => {
    const workspace = activeWorkspace();
    return workspace ? folderPaths(workspace.collections) : [];
  });

  function prepare() {
    const saved = request();
    if (!saved) return;
    setName(`${saved.method} ${URL.parse(saved.url)?.pathname ?? saved.url}`.slice(0, MAX_NAME_LENGTH));
    // keep the folder chosen last time when it still exists
    const available = folders();
    setFolderId((previous) => (available.some((folder) => folder.id === previous) ? previous : (available[0]?.id ?? '')));
  }

  function save() {
    const saved = request();
    if (!saved) return;
    const finalName = name().trim() || t('save.untitled');
    const added = editWorkspace((workspace) =>
      insertNode(workspace, folderId(), { kind: 'request', id: newId(), name: finalName, ...saved }),
    );
    if (added) announce(t('status.savedRequest', { name: finalName }));
    closeDialog();
  }

  return (
    <Modal open={request() !== null} onOpen={prepare} onDismiss={closeDialog} labelledBy={titleId}>
      <form
        class="flex w-96 max-w-full flex-col gap-2 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h2 id={titleId} class="text-sm font-semibold">
          {t('save.title')}
        </h2>
        <label class="flex flex-col gap-1">
          {t('save.name')}
          <input class={fieldClass} value={name()} maxlength={MAX_NAME_LENGTH} onInput={(event) => setName(event.currentTarget.value)} />
        </label>
        <span class="flex flex-col gap-1">
          {t('save.folder')}
          <SelectMenu
            label={t('save.folder')}
            value={folderId()}
            disabled={!folders().length}
            options={folders().map((folder) => ({ value: folder.id, label: folder.path }))}
            onChange={setFolderId}
          />
        </span>
        <Show when={!folders().length}>
          <p class="text-warn">{t('save.noFolders')}</p>
        </Show>
        <p class="text-fg-2">{t('save.note')}</p>
        <div class="flex justify-end gap-2">
          <button type="button" class={buttonClass()} onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="submit" class={buttonClass('primary')} disabled={!folders().length}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
