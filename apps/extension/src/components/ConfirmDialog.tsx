import { createUniqueId, For, Show } from 'solid-js';
import { t } from '../i18n/index.ts';
import { confirmation, setConfirmation } from '../state/ui.ts';
import Modal from './ui/Modal.tsx';
import { buttonClass } from './ui/styles.ts';

function answer(returnValue: string) {
  const question = confirmation();
  setConfirmation(null);
  question?.resolve(returnValue === 'confirm');
}

/** The one confirmation dialog of the panel, answering askConfirmation() questions. */
export default function ConfirmDialog() {
  const titleId = createUniqueId();

  return (
    <Modal open={confirmation() !== null} onDismiss={answer} labelledBy={titleId}>
      <Show when={confirmation()}>
        {(question) => (
          <form method="dialog" class="flex max-w-md flex-col gap-3 p-4">
            <h2 id={titleId} class="text-sm font-semibold">
              {question().title}
            </h2>
            <For each={question().details}>{(detail) => <p class={{ 'text-warn': Boolean(detail.warning) }}>{detail.text}</p>}</For>
            <div class="flex justify-end gap-2">
              <button value="cancel" class={buttonClass()} autofocus>
                {t('common.cancel')}
              </button>
              <button value="confirm" class={buttonClass('primary')}>
                {question().confirmLabel}
              </button>
            </div>
          </form>
        )}
      </Show>
    </Modal>
  );
}
