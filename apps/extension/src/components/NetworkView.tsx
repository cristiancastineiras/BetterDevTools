import { createUniqueId, Show } from 'solid-js';
import { t } from '../i18n/index.ts';
import { cacheDisabled, openRequestMenu, toggleDisableCache, toggleRecordingWithNotice } from '../state/actions.ts';
import { activeRequest, attachedToDevtools, clearRequests, filterText, isRecording, refilter, selectedCount, setFilter } from '../state/capture.ts';
import { preferences, updatePreferences } from '../state/preferences.ts';
import { showDialog } from '../state/ui.ts';
import RequestDetail from './RequestDetail.tsx';
import RequestList, { openColumnsMenu } from './RequestList.tsx';
import SplitView from './SplitView.tsx';
import Icon from './ui/Icon.tsx';
import IconButton from './ui/IconButton.tsx';
import { fieldClass, monoClass, sectionTitleClass } from './ui/styles.ts';

/** Filter keys listed in the help popover (the syntax itself is not translated). */
const FILTER_EXAMPLES =
  'method:get,post · status:404 · status:5xx · status:>=400 · domain:example.com · mime:json · type:fetch · size:>10k · ' +
  'duration:>500ms · priority:high · initiator:script · source:import · is:error · is:redirect · body:token';

function toggleSearchBodies() {
  updatePreferences((draft) => {
    draft.searchBodies = !draft.searchBodies;
  });
  refilter();
}

/** Network view: toolbar with the filter, the request list and, when a request is open, its details. */
export default function NetworkView(props: { onFilterInput: (input: HTMLInputElement) => void; onImport: () => void }) {
  const helpId = createUniqueId();

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex flex-wrap items-center gap-1 border-b border-line p-1">
        <IconButton
          icon={isRecording() ? 'record' : 'pause'}
          label={isRecording() ? t('network.pauseRecording') : t('network.resumeRecording')}
          text={isRecording() ? t('network.record') : t('network.paused')}
          variant="record"
          pressed={isRecording()}
          onClick={toggleRecordingWithNotice}
        />
        <IconButton icon="clear" label={t('network.clear')} onClick={clearRequests} />
        <span class="relative flex min-w-48 flex-1 items-center">
          <span class="pointer-events-none absolute start-1.5 inline-flex text-fg-2">
            <Icon name="filter" />
          </span>
          <input
            ref={props.onFilterInput}
            class={[fieldClass, monoClass, 'w-full ps-7']}
            type="search"
            autocomplete="off"
            spellcheck={false}
            aria-label={t('network.filterLabel')}
            aria-describedby={helpId}
            placeholder={t('network.filterPlaceholder')}
            value={filterText()}
            onInput={(event) => setFilter(event.currentTarget.value)}
          />
        </span>
        <IconButton
          icon="search"
          label={t('network.searchBodies')}
          text={t('network.searchBodiesShort')}
          pressed={preferences.searchBodies}
          onClick={toggleSearchBodies}
        />
        <IconButton
          icon="cache-off"
          label={t('network.disableCache')}
          text={t('network.noCache')}
          pressed={cacheDisabled()}
          disabled={!attachedToDevtools}
          onClick={() => void toggleDisableCache()}
        />
        <IconButton icon="columns" label={t('network.columnsMenu')} onClick={openColumnsMenu} />
        <IconButton icon="help" label={t('network.filterHelp')} popovertarget={helpId} />
        <div id={helpId} popover="auto" class="fixed m-auto max-h-[calc(var(--vh)-1rem)] max-w-[min(32rem,calc(var(--vw)-1rem))] overflow-auto rounded-md border border-line bg-bg p-3 text-fg shadow-lg">
          <p class={sectionTitleClass}>{t('network.filterHelpTitle')}</p>
          <p>{t('network.filterHelpText')}</p>
          <p class={[monoClass, 'mt-1']}>{FILTER_EXAMPLES}</p>
        </div>
        <IconButton icon="import" label={t('network.importLabel')} text={t('common.import')} onClick={() => props.onImport()} />
        <IconButton
          icon="export"
          label={t('network.exportLabel')}
          text={t('common.export')}
          onClick={() => showDialog({ kind: 'export', scope: selectedCount() ? 'selected' : 'filtered' })}
        />
        <IconButton icon="more" label={t('network.actions')} disabled={!selectedCount() && !activeRequest()} onClick={openRequestMenu} />
      </div>
      <SplitView
        label={t('network.resizeDetail')}
        fraction={preferences.detailFraction}
        onResize={(fraction) =>
          updatePreferences((draft) => {
            draft.detailFraction = fraction;
          })
        }
        showSecond={activeRequest() !== null}
        first={<RequestList onRowMenu={openRequestMenu} />}
        second={<Show when={activeRequest()}>{(request) => <RequestDetail request={request()} />}</Show>}
      />
    </div>
  );
}
