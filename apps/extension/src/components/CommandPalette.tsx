import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import { t } from '../i18n/index.ts';
import { closeDialog, openDialog } from '../state/ui.ts';
import Modal from './ui/Modal.tsx';
import { fieldClass, monoClass } from './ui/styles.ts';

export interface Command {
  label: string;
  keys?: string | undefined;
  run: () => void;
  disabled?: boolean | undefined;
}

/** Ctrl+K: type to filter the commands, arrows to move, Enter to run. */
export default function CommandPalette(props: { commands: () => Command[] }) {
  const listId = createUniqueId();
  const isOpen = createMemo(() => openDialog()?.kind === 'palette');
  let input: HTMLInputElement | undefined;
  const [query, setQuery] = createSignal('');
  const [activeIndex, setActiveIndex] = createSignal(0);
  // the command list is read when the palette opens, so it reflects the state at that moment
  const [commands, setCommands] = createSignal<Command[]>([]);
  const matching = createMemo(() => {
    const text = query().trim().toLowerCase();
    return commands().filter((command) => !command.disabled && command.label.toLowerCase().includes(text));
  });
  const optionId = (index: number) => `${listId}-${index}`;

  function prepare() {
    setCommands(props.commands());
    setQuery('');
    setActiveIndex(0);
    if (input) input.value = '';
  }

  function run(command: Command | undefined) {
    if (!command) return;
    closeDialog();
    command.run();
  }

  function onKeyDown(event: KeyboardEvent) {
    const count = matching().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = count ? (activeIndex() + (event.key === 'ArrowDown' ? 1 : -1) + count) % count : 0;
      setActiveIndex(next);
      queueMicrotask(() => document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' }));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(matching()[activeIndex()]);
    }
  }

  return (
    <Modal
      open={isOpen()}
      onOpen={prepare}
      onDismiss={closeDialog}
      label={t('palette.label')}
      lightDismiss
      class="mx-auto mt-12 w-[32rem] max-w-[calc(var(--vw)-2rem)]"
    >
      <div class="flex flex-col gap-1 p-2">
        <input
          ref={(element) => (input = element)}
          class={[fieldClass, 'w-full']}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={matching().length ? optionId(activeIndex()) : undefined}
          aria-autocomplete="list"
          aria-label={t('palette.input')}
          placeholder={t('palette.placeholder')}
          autofocus
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} role="listbox" aria-label={t('app.commands')} class="max-h-80 overflow-auto">
          <For each={matching()} fallback={<li class="px-2 py-1 text-fg-2">{t('palette.empty')}</li>}>
            {(command, index) => (
              <li
                id={optionId(index())}
                role="option"
                aria-selected={index() === activeIndex() ? 'true' : 'false'}
                class={['flex cursor-pointer justify-between gap-4 rounded-sm px-2 py-1', { 'bg-sel': index() === activeIndex() }]}
                onPointerMove={() => setActiveIndex(index())}
                onClick={() => run(command)}
              >
                <span>{command.label}</span>
                <Show when={command.keys}>
                  <kbd class={[monoClass, 'text-fg-2']}>{command.keys}</kbd>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Modal>
  );
}
