import {
  createWorkspace,
  duplicateNode,
  duplicateWorkspace,
  findNode,
  folderPaths,
  insertNode,
  moveNode,
  newId,
  removeNode,
  workspaceFile,
  type FolderNode,
  type RequestNode,
  type TreeNode,
} from '@betterdevtools/core';
import { createMemo, createSignal, createUniqueId, For, Match, onSettled, Show, snapshot, Switch } from 'solid-js';
import { t } from '../i18n/index.ts';
import { download } from '../lib/io.ts';
import { openSavedRequest } from '../state/replay.ts';
import { askConfirmation, openContextMenu, type MenuItem } from '../state/ui.ts';
import { activeWorkspace, addWorkspace, deleteWorkspace, editWorkspace, selectWorkspace, workspaces } from '../state/workspaces.ts';
import Icon from './ui/Icon.tsx';
import IconButton from './ui/IconButton.tsx';
import MethodBadge from './ui/MethodBadge.tsx';
import SelectMenu from './ui/SelectMenu.tsx';
import { buttonClass, fieldClass, monoClass, sectionTitleClass } from './ui/styles.ts';

const MAX_NAME_LENGTH = 200;
const INDENT_PX = 16;

/** Inline rename field: Enter or leaving the field commits, Escape cancels. */
function RenameInput(props: { value: string; onCommit: (name: string) => void; onCancel: () => void }) {
  let input: HTMLInputElement | undefined;
  let finished = false; // Enter and the blur that follows must not commit twice

  onSettled(() => {
    input?.focus();
    input?.select();
  });

  function commit(name: string) {
    if (finished) return;
    finished = true;
    props.onCommit(name);
  }

  return (
    <input
      ref={(element) => (input = element)}
      class={[fieldClass, 'min-w-0 flex-1']}
      aria-label={t('collections.newName')}
      value={props.value}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit(event.currentTarget.value);
        if (event.key === 'Escape') {
          event.stopPropagation();
          finished = true;
          props.onCancel();
        }
      }}
      onBlur={(event) => commit(event.currentTarget.value)}
    />
  );
}

interface TreeHandlers {
  renamingId: () => string | null;
  rename: (id: string, name: string) => void;
  cancelRename: () => void;
  openNodeMenu: (event: MouseEvent, node: TreeNode) => void;
}

/** Folders and saved requests, nested; a request opens in Replay when clicked. */
function TreeList(props: { nodes: readonly TreeNode[]; depth: number; handlers: TreeHandlers }) {
  return (
    <ul class="flex flex-col">
      <For each={props.nodes} keyed={false}>
        {(node) => (
          <li>
            <div
              class="flex items-center gap-1 rounded-sm py-0.5 pe-1 hover:bg-bg-3"
              style={{ 'padding-inline-start': `${props.depth * INDENT_PX + 4}px` }}
            >
              <Switch>
                <Match when={props.handlers.renamingId() === node().id}>
                  <RenameInput
                    value={node().name}
                    onCommit={(name) => props.handlers.rename(node().id, name)}
                    onCancel={props.handlers.cancelRename}
                  />
                </Match>
                <Match when={node().kind === 'request' ? (node() as RequestNode) : null}>
                  {(request) => (
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 truncate text-start"
                      title={t('collections.openInReplay')}
                      onClick={() => openSavedRequest(snapshot(request()))}
                    >
                      <MethodBadge method={request().method} />
                      <span class="truncate">{request().name}</span>
                    </button>
                  )}
                </Match>
                <Match when={true}>
                  <span class="flex min-w-0 flex-1 items-center gap-1 truncate font-semibold">
                    <Icon name="chevron-down" />
                    {node().name}
                  </span>
                </Match>
              </Switch>
              <IconButton
                icon="more"
                variant="ghost"
                label={t('collections.actionsFor', { name: node().name })}
                onClick={(event) => props.handlers.openNodeMenu(event, node())}
              />
            </div>
            <Show when={node().kind === 'folder' ? (node() as FolderNode) : null}>
              {(folder) => (
                <Show
                  when={folder().children.length}
                  fallback={
                    <p class="text-fg-2" style={{ 'padding-inline-start': `${props.depth * INDENT_PX + 24}px` }}>
                      {t('collections.empty')}
                    </p>
                  }
                >
                  <TreeList nodes={folder().children} depth={props.depth + 1} handlers={props.handlers} />
                </Show>
              )}
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}

const newRequestNode = (): RequestNode => ({
  kind: 'request',
  id: newId(),
  name: t('collections.newRequestName'),
  method: 'GET',
  url: 'https://',
  query: '',
  headers: '',
  body: '',
});

const newFolderNode = (name: string): FolderNode => ({ kind: 'folder', id: newId(), name, children: [] });

async function confirmDeleteWorkspace() {
  const workspace = activeWorkspace();
  if (!workspace) return;
  const confirmed = await askConfirmation({
    title: t('common.pleaseConfirm'),
    details: [{ text: t('collections.confirmDeleteWorkspace', { name: workspace.name }), warning: true }],
    confirmLabel: t('common.delete'),
  });
  if (confirmed) await deleteWorkspace(workspace.id);
}

async function confirmDeleteEnvironment(id: string, name: string) {
  const confirmed = await askConfirmation({
    title: t('common.pleaseConfirm'),
    details: [{ text: t('collections.confirmDeleteEnv', { name }), warning: true }],
    confirmLabel: t('common.delete'),
  });
  if (!confirmed) return;
  editWorkspace((draft) => {
    draft.envs = draft.envs.filter((env) => env.id !== id);
    draft.activeEnvId = draft.envs[0]?.id ?? null;
  });
}

/** Edits one variable of the shown environment. */
function editVariable(environmentId: string, change: (vars: { key: string; value: string; secret: boolean }[]) => void, typing = false) {
  editWorkspace(
    (draft) => {
      const target = draft.envs.find((env) => env.id === environmentId);
      if (target) change(target.vars);
    },
    { typing },
  );
}

/** Collections view: workspaces, their request tree and their environments. */
export default function CollectionsView(props: { onImport: () => void }) {
  const collectionsTitleId = createUniqueId();
  const environmentsTitleId = createUniqueId();
  // id of the workspace, environment or tree node being renamed
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [exportSecrets, setExportSecrets] = createSignal(false);

  const environment = createMemo(() => {
    const workspace = activeWorkspace();
    return workspace?.envs.find((env) => env.id === workspace.activeEnvId) ?? null;
  });

  function rename(id: string, value: string) {
    const name = value.trim().slice(0, MAX_NAME_LENGTH);
    setRenamingId(null);
    if (!name) return;
    editWorkspace((workspace) => {
      if (workspace.id === id) workspace.name = name;
      else {
        const target = workspace.envs.find((env) => env.id === id) ?? findNode(workspace.collections, id);
        if (target) target.name = name;
      }
    });
  }

  async function exportWorkspace() {
    const workspace = activeWorkspace();
    if (!workspace) return;
    const includeSecrets = exportSecrets();
    if (includeSecrets) {
      const confirmed = await askConfirmation({
        title: t('common.pleaseConfirm'),
        details: [{ text: t('collections.confirmExportSecrets'), warning: true }],
        confirmLabel: t('common.export'),
      });
      if (!confirmed) return;
    }
    const copy = snapshot(workspace);
    const fileName = copy.name.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'workspace';
    download(`${fileName}.bdt-workspace.json`, new Blob([workspaceFile(copy, includeSecrets)], { type: 'application/json' }));
  }

  function openNodeMenu(event: MouseEvent, node: TreeNode) {
    const workspace = activeWorkspace();
    if (!workspace) return;
    const target = snapshot(node);
    const items: MenuItem[] = [
      ...(target.kind === 'request'
        ? [{ label: t('collections.openInReplay'), run: () => openSavedRequest(target) }]
        : [
            {
              label: t('collections.newRequest'),
              run: () => void editWorkspace((draft) => insertNode(draft, target.id, newRequestNode())),
            },
            {
              label: t('collections.newFolder'),
              run: () => void editWorkspace((draft) => insertNode(draft, target.id, newFolderNode(t('collections.newFolderName')))),
            },
          ]),
      { label: t('common.rename'), run: () => setRenamingId(target.id) },
      { label: t('common.duplicate'), run: () => void editWorkspace((draft) => duplicateNode(draft, target.id)) },
      { label: t('collections.moveUp'), run: () => void editWorkspace((draft) => moveNode(draft, target.id, { offset: -1 })) },
      { label: t('collections.moveDown'), run: () => void editWorkspace((draft) => moveNode(draft, target.id, { offset: 1 })) },
      ...folderPaths(workspace.collections)
        .filter((folder) => folder.id !== target.id)
        .map((folder) => ({
          label: t('collections.moveInto', { path: folder.path }),
          run: () => void editWorkspace((draft) => moveNode(draft, target.id, { parentId: folder.id })),
        })),
      {
        label: t('collections.deleteEllipsis'),
        run: () =>
          void askConfirmation({
            title: t('common.pleaseConfirm'),
            details: [
              {
                text:
                  target.kind === 'folder'
                    ? t('collections.confirmDeleteFolder', { name: target.name })
                    : t('collections.confirmDeleteNode', { name: target.name }),
                warning: true,
              },
            ],
            confirmLabel: t('common.delete'),
          }).then((confirmed) => confirmed && editWorkspace((draft) => void removeNode(draft, target.id))),
      },
    ];
    openContextMenu(event, t('collections.actionsFor', { name: target.name }), items);
  }

  const treeHandlers: TreeHandlers = {
    renamingId,
    rename,
    cancelRename: () => setRenamingId(null),
    openNodeMenu,
  };

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex flex-wrap items-center gap-1 border-b border-line p-1.5">
        <Show
          when={renamingId() !== null && renamingId() === activeWorkspace()?.id ? activeWorkspace() : null}
          fallback={
            <span class="flex items-center gap-1">
              {t('collections.workspace')}
              <SelectMenu
                label={t('collections.workspace')}
                value={activeWorkspace()?.id ?? ''}
                options={workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
                onChange={selectWorkspace}
              />
            </span>
          }
        >
          {(workspace) => (
            <RenameInput value={workspace().name} onCommit={(name) => rename(workspace().id, name)} onCancel={() => setRenamingId(null)} />
          )}
        </Show>
        <IconButton
          icon="plus"
          label={t('collections.newWorkspace')}
          text={t('common.new')}
          onClick={() => void addWorkspace(createWorkspace(t('collections.newWorkspace')))}
        />
        <Show when={activeWorkspace()}>
          {(workspace) => (
            <>
              <button type="button" class={buttonClass()} onClick={() => setRenamingId(workspace().id)}>
                {t('common.rename')}
              </button>
              <button type="button" class={buttonClass()} onClick={() => void addWorkspace(duplicateWorkspace(snapshot(workspace())))}>
                {t('common.duplicate')}
              </button>
              <button type="button" class={buttonClass()} onClick={() => void confirmDeleteWorkspace()}>
                {t('collections.deleteEllipsis')}
              </button>
              <span class="mx-1 h-5 border-s border-line" />
              <IconButton
                icon="export"
                label={t('collections.exportWorkspace')}
                text={t('common.export')}
                onClick={() => void exportWorkspace()}
              />
              <label class="flex items-center gap-1">
                <input type="checkbox" checked={exportSecrets()} onChange={(event) => setExportSecrets(event.currentTarget.checked)} />
                {t('collections.includeSecrets')}
              </label>
            </>
          )}
        </Show>
        <IconButton icon="import" label={t('collections.importLabel')} text={t('common.import')} onClick={() => props.onImport()} />
      </div>

      <Show when={activeWorkspace()}>
        {(workspace) => (
          <div class="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-[minmax(0,1fr)_24rem] md:overflow-hidden">
            <section aria-labelledby={collectionsTitleId} class="min-h-0 overflow-auto p-2">
              <div class="flex items-center gap-2">
                <h2 id={collectionsTitleId} class={sectionTitleClass}>
                  {t('collections.title')}
                </h2>
                <button
                  type="button"
                  class={buttonClass()}
                  onClick={() => editWorkspace((draft) => insertNode(draft, null, newFolderNode(t('collections.newCollectionName'))))}
                >
                  {t('collections.newCollection')}
                </button>
              </div>
              <Show when={workspace().collections.length} fallback={<p class="text-fg-2">{t('collections.noCollections')}</p>}>
                <TreeList nodes={workspace().collections} depth={0} handlers={treeHandlers} />
              </Show>
            </section>

            <section aria-labelledby={environmentsTitleId} class="min-h-0 overflow-auto border-line p-2 md:border-s">
              <h2 id={environmentsTitleId} class={sectionTitleClass}>
                {t('collections.environments')}
              </h2>
              <div class="flex flex-wrap items-center gap-1">
                <Show
                  when={renamingId() !== null && renamingId() === environment()?.id ? environment() : null}
                  fallback={
                    <SelectMenu
                      label={t('collections.activeEnvironment')}
                      value={workspace().activeEnvId ?? ''}
                      options={workspace().envs.map((env) => ({
                        value: env.id,
                        label: env.name,
                        description: t('replay.variables', { count: env.vars.length }),
                      }))}
                      onChange={(id) =>
                        editWorkspace((draft) => {
                          draft.activeEnvId = id;
                        })
                      }
                    />
                  }
                >
                  {(env) => (
                    <RenameInput value={env().name} onCommit={(name) => rename(env().id, name)} onCancel={() => setRenamingId(null)} />
                  )}
                </Show>
                <button
                  type="button"
                  class={buttonClass()}
                  onClick={() =>
                    editWorkspace((draft) => {
                      const id = newId();
                      draft.envs.push({ id, name: t('collections.newEnvironmentName'), vars: [] });
                      draft.activeEnvId = id;
                    })
                  }
                >
                  {t('common.new')}
                </button>
                <Show when={environment()}>
                  {(env) => (
                    <>
                      <button type="button" class={buttonClass()} onClick={() => setRenamingId(env().id)}>
                        {t('common.rename')}
                      </button>
                      <button
                        type="button"
                        class={buttonClass()}
                        disabled={workspace().envs.length < 2}
                        onClick={() => void confirmDeleteEnvironment(env().id, env().name)}
                      >
                        {t('collections.deleteEllipsis')}
                      </button>
                    </>
                  )}
                </Show>
              </div>
              <Show when={environment()}>
                {(env) => (
                  <>
                    <table class="mt-2 w-full border-separate border-spacing-y-1">
                      <thead class="text-fg-2">
                        <tr>
                          <th class="text-start font-semibold">{t('collections.variable')}</th>
                          <th class="text-start font-semibold">{t('collections.value')}</th>
                          <th class="font-semibold">{t('collections.secret')}</th>
                          <th>
                            <span class="sr-only">{t('collections.remove')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={env().vars} keyed={false}>
                          {(variable, index) => (
                            <tr>
                              <td>
                                <input
                                  class={[fieldClass, monoClass, 'w-full']}
                                  aria-label={t('collections.variableName')}
                                  value={variable().key}
                                  spellcheck={false}
                                  onInput={(event) => {
                                    const key = event.currentTarget.value;
                                    editVariable(env().id, (vars) => vars[index] && (vars[index].key = key), true);
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  class={[fieldClass, monoClass, 'w-full']}
                                  aria-label={t('collections.valueOf', { name: variable().key || t('collections.variableFallback') })}
                                  type={variable().secret ? 'password' : 'text'}
                                  autocomplete="off"
                                  value={variable().value}
                                  spellcheck={false}
                                  onInput={(event) => {
                                    const value = event.currentTarget.value;
                                    editVariable(env().id, (vars) => vars[index] && (vars[index].value = value), true);
                                  }}
                                />
                              </td>
                              <td class="text-center">
                                <input
                                  type="checkbox"
                                  aria-label={t('collections.secretOf', { name: variable().key || t('collections.variableFallback') })}
                                  checked={variable().secret}
                                  onChange={(event) => {
                                    const secret = event.currentTarget.checked;
                                    editVariable(env().id, (vars) => vars[index] && (vars[index].secret = secret));
                                  }}
                                />
                              </td>
                              <td>
                                <IconButton
                                  icon="trash"
                                  variant="ghost"
                                  label={t('collections.removeVariable', { name: variable().key || t('collections.variableFallback') })}
                                  onClick={() => editVariable(env().id, (vars) => void vars.splice(index, 1))}
                                />
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                    <button
                      type="button"
                      class={[buttonClass(), 'mt-1']}
                      onClick={() => editVariable(env().id, (vars) => void vars.push({ key: '', value: '', secret: false }))}
                    >
                      {t('collections.addVariable')}
                    </button>
                    <p class="mt-2 text-fg-2">{t('collections.envNote')}</p>
                  </>
                )}
              </Show>
            </section>
          </div>
        )}
      </Show>
    </div>
  );
}
