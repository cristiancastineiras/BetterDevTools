import { comparableText, headersText } from '@betterdevtools/core';
import { createMemo, createUniqueId, Show } from 'solid-js';
import { t } from '../i18n/index.ts';
import { captureLog } from '../state/capture.ts';
import { closeDialog, openDialog } from '../state/ui.ts';
import DiffView from './DiffView.tsx';
import Modal from './ui/Modal.tsx';
import { buttonClass, monoClass, sectionTitleClass } from './ui/styles.ts';

/** Side-by-side diff of two selected requests: headers and bodies. */
export default function CompareDialog() {
  const titleId = createUniqueId();
  const pair = createMemo(() => {
    const dialog = openDialog();
    return dialog?.kind === 'compare' ? dialog : null;
  });

  return (
    <Modal open={pair() !== null} onDismiss={closeDialog} labelledBy={titleId} class="w-[60rem] max-w-[calc(100vw-2rem)]">
      <Show when={pair()}>
        {(requests) => {
          const first = () => requests().first;
          const second = () => requests().second;
          const diffLabels = { beforeLabel: t('compare.first'), afterLabel: t('compare.second') };
          return (
            <form method="dialog" class="flex flex-col gap-2 p-4">
              <h2 id={titleId} class="text-sm font-semibold">
                {t('compare.title')}
              </h2>
              <p class={monoClass}>
                <span class="text-bad">
                  − {first().method} {first().url} → {first().status}
                </span>
                <br />
                <span class="text-ok">
                  + {second().method} {second().url} → {second().status}
                </span>
              </p>
              <h3 class={sectionTitleClass}>{t('compare.requestHeaders')}</h3>
              <DiffView
                before={headersText(first().har.request.headers, true)}
                after={headersText(second().har.request.headers, true)}
                {...diffLabels}
              />
              <h3 class={sectionTitleClass}>{t('compare.requestBody')}</h3>
              <DiffView
                before={first().har.request.postData?.text ?? ''}
                after={second().har.request.postData?.text ?? ''}
                {...diffLabels}
              />
              <h3 class={sectionTitleClass}>{t('compare.responseHeaders')}</h3>
              <DiffView
                before={headersText(first().har.response.headers, true)}
                after={headersText(second().har.response.headers, true)}
                {...diffLabels}
              />
              <h3 class={sectionTitleClass}>{t('compare.responseBody')}</h3>
              <DiffView
                before={comparableText(captureLog.body(first().id), first().mime)}
                after={comparableText(captureLog.body(second().id), second().mime)}
                {...diffLabels}
              />
              <div class="flex justify-end">
                <button class={buttonClass()}>{t('common.close')}</button>
              </div>
            </form>
          );
        }}
      </Show>
    </Modal>
  );
}
