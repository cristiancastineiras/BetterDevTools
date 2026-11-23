import type { JSX } from '@solidjs/web';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { t } from '../i18n/index.ts';
import { activeTool, setActiveTool, type ToolId } from '../state/toolbox.ts';
import CronTool from './tools/CronTool.tsx';
import CurlTool from './tools/CurlTool.tsx';
import DiffTool from './tools/DiffTool.tsx';
import EncodeTool from './tools/EncodeTool.tsx';
import EpochTool from './tools/EpochTool.tsx';
import FormatTool from './tools/FormatTool.tsx';
import HashTool from './tools/HashTool.tsx';
import HtmlCssTool from './tools/HtmlCssTool.tsx';
import JsonPathTool from './tools/JsonPathTool.tsx';
import JwtTool from './tools/JwtTool.tsx';
import PerformanceTool from './tools/PerformanceTool.tsx';
import RegexTool from './tools/RegexTool.tsx';
import SecurityTool from './tools/SecurityTool.tsx';
import StorageTool from './tools/StorageTool.tsx';
import TextTool from './tools/TextTool.tsx';
import UrlTool from './tools/UrlTool.tsx';
import UuidTool from './tools/UuidTool.tsx';
import WebhookTool from './tools/WebhookTool.tsx';
import Icon from './ui/Icon.tsx';
import { fieldClass } from './ui/styles.ts';

type Category = 'data' | 'encoders' | 'generators' | 'validators' | 'converters' | 'datetime' | 'web' | 'comparators';

const TOOLS: { id: ToolId; category: Category; component: () => JSX.Element }[] = [
  { id: 'format', category: 'data', component: FormatTool },
  { id: 'jsonpath', category: 'data', component: JsonPathTool },
  { id: 'encode', category: 'encoders', component: EncodeTool },
  { id: 'jwt', category: 'encoders', component: JwtTool },
  { id: 'uuid', category: 'generators', component: UuidTool },
  { id: 'hash', category: 'generators', component: HashTool },
  { id: 'regex', category: 'validators', component: RegexTool },
  { id: 'webhook', category: 'validators', component: WebhookTool },
  { id: 'curl', category: 'converters', component: CurlTool },
  { id: 'text', category: 'converters', component: TextTool },
  { id: 'epoch', category: 'datetime', component: EpochTool },
  { id: 'cron', category: 'datetime', component: CronTool },
  { id: 'url', category: 'web', component: UrlTool },
  { id: 'security', category: 'web', component: SecurityTool },
  { id: 'performance', category: 'web', component: PerformanceTool },
  { id: 'storage', category: 'web', component: StorageTool },
  { id: 'htmlcss', category: 'web', component: HtmlCssTool },
  { id: 'diff', category: 'comparators', component: DiffTool },
];
const CATEGORIES: Category[] = ['data', 'encoders', 'generators', 'validators', 'converters', 'datetime', 'web', 'comparators'];

/** Everyday developer utilities and page diagnostics, all running locally. A tool keeps its state while you visit others. */
export default function ToolboxView() {
  const [filter, setFilter] = createSignal('');
  // a tool is built the first time it is opened and then only hidden, so what was typed stays
  const [opened, setOpened] = createSignal<ToolId[]>([activeTool()]);
  const select = (id: ToolId) => {
    setActiveTool(id);
    if (!opened().includes(id)) setOpened([...opened(), id]);
  };
  const visible = createMemo(() => {
    const word = filter().trim().toLowerCase();
    return TOOLS.filter(
      (tool) =>
        !word || `${t(`toolbox.tools.${tool.id}.name`)} ${t(`toolbox.tools.${tool.id}.about`)} ${tool.id}`.toLowerCase().includes(word),
    );
  });

  return (
    <div class="flex h-full min-h-0 flex-col sm:flex-row">
      <nav
        aria-label={t('toolbox.nav')}
        class="flex max-h-48 shrink-0 flex-col gap-1 overflow-auto border-b border-line p-1 sm:max-h-none sm:w-56 sm:border-e sm:border-b-0"
      >
        <input
          type="search"
          class={fieldClass}
          aria-label={t('toolbox.search')}
          placeholder={t('toolbox.search')}
          autocomplete="off"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        <For each={CATEGORIES}>
          {(category) => (
            <Show when={visible().some((tool) => tool.category === category)}>
              <div role="group" aria-label={t(`toolbox.categories.${category}`)} class="flex flex-col">
                <span class="px-1.5 pt-1 text-small font-semibold text-fg-2 uppercase">{t(`toolbox.categories.${category}`)}</span>
                <For each={visible().filter((tool) => tool.category === category)}>
                  {(tool) => (
                    <button
                      type="button"
                      class={[
                        'flex cursor-pointer flex-col rounded-md px-1.5 py-1 text-start hover:bg-bg-3',
                        activeTool() === tool.id ? 'bg-sel' : '',
                      ]}
                      aria-current={activeTool() === tool.id ? 'page' : undefined}
                      title={t(`toolbox.tools.${tool.id}.about`)}
                      onClick={() => select(tool.id)}
                    >
                      <span class="font-medium">{t(`toolbox.tools.${tool.id}.name`)}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          )}
        </For>
        <Show when={!visible().length}>
          <p class="flex items-center gap-1 px-1.5 text-fg-2">
            <Icon name="info" /> {t('toolbox.noTools')}
          </p>
        </Show>
      </nav>
      <section class="min-h-0 min-w-0 flex-1" aria-label={t(`toolbox.tools.${activeTool()}.name`)}>
        <For each={opened()}>
          {(id) => {
            const tool = TOOLS.find((candidate) => candidate.id === id)!;
            return (
              <div class="h-full min-h-0" hidden={activeTool() !== id}>
                <tool.component />
              </div>
            );
          }}
        </For>
      </section>
    </div>
  );
}
