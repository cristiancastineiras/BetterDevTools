import { endpointLabel } from '@betterdevtools/core';
import { createSignal, For, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { currentModel, discoveryStatus, markScenario } from '../../state/discovery.ts';
import IconButton from '../ui/IconButton.tsx';
import { fieldClass, monoClass, sectionTitleClass } from '../ui/styles.ts';

const scenarios = () => currentModel()?.state.scenarios ?? [];

/**
 * The traffic grouped by what the user was doing: a scenario starts when the page navigates or when
 * the user marks one ("Login", "Create task"), so the map shows how the app really uses its API.
 */
export default function ScenariosTab() {
  const [name, setName] = createSignal('');
  const canMark = () => (discoveryStatus() === 'recording' || discoveryStatus() === 'paused') && name().trim() !== '';

  function mark(event: SubmitEvent) {
    event.preventDefault();
    if (!canMark()) return;
    markScenario(name());
    setName('');
  }

  return (
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <form class="flex flex-wrap items-center gap-2" onSubmit={mark}>
        <input
          class={[fieldClass, 'min-w-48 flex-1']}
          aria-label={t('discovery.scenarios.name')}
          placeholder={t('discovery.scenarios.placeholder')}
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <IconButton
          type="submit"
          icon="plus"
          label={t('discovery.scenarios.markHint')}
          text={t('discovery.scenarios.mark')}
          disabled={!canMark()}
        />
      </form>
      <p class="max-w-2xl text-fg-2">{t('discovery.scenarios.hint')}</p>
      <Show when={scenarios().length} fallback={<p class="text-fg-2">{t('discovery.scenarios.none')}</p>}>
        <ol class="flex flex-col gap-3">
          <For each={scenarios()}>
            {(scenario, index) => (
              <li>
                <h3 class={sectionTitleClass}>
                  {index() + 1}. {scenario.name}
                  <span class="ms-2 font-normal text-fg-2">{t('discovery.scenarios.calls', { count: formatNumber(scenario.calls) })}</span>
                </h3>
                <ul class={[monoClass, 'flex flex-col gap-0.5']}>
                  <For each={scenario.endpoints}>
                    {(key) => {
                      const endpoint = currentModel()?.state.endpoints[key];
                      return <li class="[overflow-wrap:anywhere]">{endpoint ? endpointLabel(endpoint) : key}</li>;
                    }}
                  </For>
                </ul>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  );
}
