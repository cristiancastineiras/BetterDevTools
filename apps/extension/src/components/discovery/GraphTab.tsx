import { buildDependencyGraph, GRAPH_BOX, layoutGraph } from '@betterdevtools/core';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { currentModel } from '../../state/discovery.ts';
import { monoClass, sectionTitleClass } from '../ui/styles.ts';

/** The graph shows at most this many endpoints (the busiest); more would be unreadable. */
const MAX_NODES = 60;

type Kind = 'data' | 'temporal';

const KIND_COLOR: Record<Kind, string> = { data: 'var(--color-syn-kw)', temporal: 'var(--color-fg-2)' };

/**
 * How the calls relate: a data edge means a value one response produced (a token, an id) shows up
 * in a later request, which is real evidence; a temporal edge only says one call followed another.
 */
export default function GraphTab() {
  const [kinds, setKinds] = createSignal<Record<Kind, boolean>>({ data: true, temporal: false });
  const [focus, setFocus] = createSignal<string | null>(null);

  const graph = createMemo(() => {
    const model = currentModel();
    if (!model) return null;
    const active = (Object.keys(kinds()) as Kind[]).filter((kind) => kinds()[kind]);
    const full = buildDependencyGraph(model, active);
    const kept = new Set(full.nodes.toSorted((a, b) => b.calls - a.calls).slice(0, MAX_NODES).map((node) => node.id));
    const nodes = full.nodes.filter((node) => kept.has(node.id));
    const edges = full.edges.filter((edge) => kept.has(edge.from) && kept.has(edge.to));
    return { full, nodes, edges, trimmed: full.nodes.length - nodes.length, layout: layoutGraph(nodes, edges) };
  });
  const evidence = createMemo(() => {
    const id = focus();
    return graph()?.full.edges.filter((edge) => edge.from === id || edge.to === id) ?? [];
  });
  const labelOf = (id: string) => graph()?.full.nodes.find((node) => node.id === id)?.label ?? id;
  const { width, height } = GRAPH_BOX;
  const touches = (edge: { from: string; to: string }) => !focus() || edge.from === focus() || edge.to === focus();

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex flex-wrap items-center gap-3 border-b border-line p-2">
        <For each={['data', 'temporal'] as Kind[]}>
          {(kind) => (
            <label class="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={kinds()[kind]}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setKinds({ ...kinds(), [kind]: checked });
                }}
              />
              <span class="inline-block h-0.5 w-4" style={{ background: KIND_COLOR[kind] }} />
              {t(`discovery.graph.${kind}`)}
            </label>
          )}
        </For>
        <span class="text-fg-2">{t('discovery.graph.counts', { nodes: formatNumber(graph()?.nodes.length ?? 0), edges: formatNumber(graph()?.edges.length ?? 0) })}</span>
        <Show when={(graph()?.trimmed ?? 0) > 0}>
          <span class="text-warn">{t('discovery.graph.trimmed', { count: graph()!.trimmed })}</span>
        </Show>
        <Show when={focus()}>
          <button type="button" class="cursor-pointer rounded-md border border-line px-2 hover:bg-bg-3" onClick={() => setFocus(null)}>
            {t('discovery.graph.clearFocus')}
          </button>
        </Show>
      </div>
      <p class="px-2 pt-1 text-fg-2">{t('discovery.graph.hint')}</p>
      <Show when={graph()?.nodes.length} fallback={<p class="p-4 text-fg-2">{t('discovery.graph.none')}</p>}>
        <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div class="min-h-0 overflow-auto p-2">
            <svg width={graph()!.layout.width} height={graph()!.layout.height} role="img" aria-label={t('discovery.tabs.dependencies')} class="text-fg">
              <For each={graph()!.layout.edges}>
                {(edge) => (
                  <path
                    d={edge.path}
                    fill="none"
                    stroke={KIND_COLOR[edge.kind as Kind]}
                    stroke-width={edge.kind === 'data' ? 1.6 : 1}
                    stroke-dasharray={edge.kind === 'temporal' ? '4 3' : undefined}
                    opacity={touches(edge) ? 0.9 : 0.12}
                  />
                )}
              </For>
              <For each={graph()!.layout.nodes}>
                {(node) => (
                  <g
                    class="cursor-pointer"
                    role="button"
                    tabindex="0"
                    aria-label={node.label}
                    aria-pressed={focus() === node.id ? 'true' : 'false'}
                    onClick={() => setFocus(focus() === node.id ? null : node.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setFocus(focus() === node.id ? null : node.id);
                    }}
                  >
                    <rect
                      x={node.x}
                      y={node.y}
                      width={width}
                      height={height}
                      rx="5"
                      fill={focus() === node.id ? 'var(--color-sel)' : 'var(--color-bg-2)'}
                      stroke={focus() === node.id ? 'var(--color-accent)' : 'var(--color-line)'}
                    />
                    <text x={node.x + 8} y={node.y + 18} font-size="11" font-family="var(--font-mono)" fill="currentColor">
                      {node.label.length > 33 ? `${node.label.slice(0, 32)}…` : node.label}
                    </text>
                  </g>
                )}
              </For>
            </svg>
          </div>
          <aside class="min-h-0 overflow-auto border-line p-2 lg:border-s" aria-label={t('discovery.graph.evidence')}>
            <h3 class={sectionTitleClass}>{t('discovery.graph.evidence')}</h3>
            <Show when={focus()} fallback={<p class="text-fg-2">{t('discovery.graph.pick')}</p>}>
              <ul class="flex flex-col gap-2">
                <For each={evidence()}>
                  {(edge) => (
                    <li>
                      <p class={[monoClass, '[overflow-wrap:anywhere]']}>
                        {labelOf(edge.from)} → {labelOf(edge.to)}
                      </p>
                      <p class="text-fg-2">
                        {t(`discovery.graph.${edge.kind as Kind}`)} ×{edge.count}
                      </p>
                      <For each={edge.evidence}>
                        {(item) => (
                          <p class={[monoClass, 'text-syn-kw']}>
                            {t('discovery.graph.flow', { source: item.source, target: item.target })}
                          </p>
                        )}
                      </For>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </aside>
        </div>
      </Show>
    </div>
  );
}
