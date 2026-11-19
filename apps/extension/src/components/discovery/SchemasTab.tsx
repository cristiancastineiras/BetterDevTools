import { endpointLabel, listComponents, schemaToTs } from '@betterdevtools/core';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import { currentModel } from '../../state/discovery.ts';
import CodeLines from '../ui/CodeLines.tsx';
import CopyButton from '../ui/CopyButton.tsx';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import { monoClass, sectionTitleClass } from '../ui/styles.ts';

/** Structures shared by endpoints: the inferred schema of each, as JSON Schema or TypeScript. */
export default function SchemasTab() {
  const components = createMemo(() => {
    const model = currentModel();
    return model ? listComponents(model) : [];
  });
  const [picked, setPicked] = createSignal<string | null>(null);
  const [view, setView] = createSignal<'schema' | 'types'>('schema');
  const selected = createMemo(() => components().find((component) => component.name === picked()) ?? components()[0] ?? null);
  const text = () => {
    const component = selected();
    if (!component) return '';
    return view() === 'types'
      ? `export interface ${component.name} ${schemaToTs(component.schema)}`
      : JSON.stringify(component.schema, null, 2);
  };
  const pick = (name: string) => setPicked(name);

  return (
    <Show when={components().length} fallback={<p class="p-4 text-fg-2">{t('discovery.schemas.none')}</p>}>
      <div class="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <ul class="min-h-0 overflow-auto border-line md:border-e" role="listbox" aria-label={t('discovery.tabs.schemas')}>
          <For each={components()}>
            {(component) => (
              <li
                role="option"
                tabindex="0"
                aria-selected={selected()?.name === component.name ? 'true' : 'false'}
                class={['cursor-pointer border-b border-bg-3 px-2 py-1 hover:bg-bg-3', { 'bg-sel': selected()?.name === component.name }]}
                onClick={() => pick(component.name)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  pick(component.name);
                }}
              >
                <span class={[monoClass, 'font-medium']}>{component.name}</span>
                <span class="block text-small text-fg-2">{t('discovery.schemas.usedBy', { count: component.usedBy.length })}</span>
              </li>
            )}
          </For>
        </ul>
        <Show when={selected()}>
          {(component) => (
            <section class="flex min-h-0 flex-col gap-1 overflow-auto p-2">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class={[sectionTitleClass, monoClass]}>{component().name}</h3>
                <SegmentedControl
                  label={t('discovery.endpoint.view')}
                  value={view()}
                  onChange={setView}
                  options={[
                    { value: 'schema', label: t('discovery.endpoint.viewSchema') },
                    { value: 'types', label: t('discovery.endpoint.viewTypes') },
                  ]}
                />
                <CopyButton text={text} label={t('discovery.schemas.copy')} />
              </div>
              <p class="text-fg-2">{t('discovery.inferredNote')}</p>
              <CodeLines text={text()} lang={view() === 'types' ? 'js' : 'json'} label={component().name} />
              <h4 class={sectionTitleClass}>{t('discovery.schemas.usedByList')}</h4>
              <ul class={[monoClass, 'flex flex-col gap-0.5']}>
                <For each={component().usedBy}>
                  {(key) => {
                    const endpoint = currentModel()?.state.endpoints[key];
                    return <li class="[overflow-wrap:anywhere]">{endpoint ? endpointLabel(endpoint) : key}</li>;
                  }}
                </For>
              </ul>
            </section>
          )}
        </Show>
      </div>
    </Show>
  );
}
