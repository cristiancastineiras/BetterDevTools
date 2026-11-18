import { createMemo, createSignal, For, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import { splitByQuery } from '../../lib/search.ts';
import CopyButton from './CopyButton.tsx';
import Icon from './Icon.tsx';
import IconButton from './IconButton.tsx';

/** Objects and arrays with more entries than this are shown in groups of CHUNK_SIZE. */
const CHUNK_SIZE = 100;
/** "Expand all" opens everything only below this many containers; past it, the first levels. */
const EXPAND_ALL_LIMIT = 2_000;
const EXPAND_ALL_FALLBACK_DEPTH = 3;

/** A number whose JSON text does not survive a round trip through a double (big ids, 0.10). */
class ExactNumber {
  constructor(readonly source: string) {}
}

type JsonValue = null | boolean | number | string | ExactNumber | JsonValue[] | { [key: string]: JsonValue };

/** JSON.parse that keeps the original text of numbers a double would change. */
function parseExact(text: string): { ok: true; value: JsonValue } | { ok: false; error: string } {
  try {
    const value = JSON.parse(text, (_key, parsed: unknown, context?: { source?: string }) =>
      typeof parsed === 'number' && context?.source !== undefined && context.source !== String(parsed)
        ? new ExactNumber(context.source)
        : parsed,
    ) as JsonValue;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const isContainer = (value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } =>
  typeof value === 'object' && value !== null && !(value instanceof ExactNumber);

function countContainers(value: JsonValue, limit: number): number {
  if (!isContainer(value)) return 0;
  let count = 1;
  for (const child of Object.values(value)) {
    count += countContainers(child, limit - count);
    if (count > limit) break;
  }
  return count;
}

/** JSON text of a leaf value, as it appears in the response. */
function leafText(value: JsonValue): string {
  if (value instanceof ExactNumber) return value.source;
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function leafClass(value: JsonValue): string {
  if (typeof value === 'string') return 'text-syn-str';
  if (typeof value === 'number' || value instanceof ExactNumber) return 'text-syn-num';
  return 'text-syn-kw'; // true, false, null
}

/** Shared by every node: what "expand all / collapse all" asked for, and the search text. */
interface TreeSettings {
  /** Containers at a depth below this start open. Changing it resets every node. */
  openDepth: () => number;
  query: () => string;
  caseSensitive: () => boolean;
}

/** Text with the search matches wrapped in <mark>. */
function Highlighted(props: { text: string; settings: TreeSettings }) {
  return (
    <For each={splitByQuery(props.text, props.settings.query(), props.settings.caseSensitive())}>
      {(piece) => (piece.hit ? <mark>{piece.text}</mark> : piece.text)}
    </For>
  );
}

/** One key/index of an object or array, with its value: a leaf row, or a collapsible container. */
function TreeNode(props: { name: string | null; value: JsonValue; depth: number; settings: TreeSettings }) {
  const [isOpen, setIsOpen] = createSignal(() => props.depth < props.settings.openDepth());
  const entries = createMemo<[string, JsonValue][]>(() => (isContainer(props.value) ? Object.entries(props.value) : []));
  const isArray = () => Array.isArray(props.value);
  const summary = () =>
    isArray() ? `[…] ${t('tree.items', { count: entries().length })}` : `{…} ${t('tree.keys', { count: entries().length })}`;
  const keyLabel = () =>
    props.name === null ? null : (
      <span class="text-syn-prop">
        <Highlighted text={props.name} settings={props.settings} />
        <span class="text-fg-2">: </span>
      </span>
    );

  return (
    <li class="group/node">
      <Show
        when={isContainer(props.value)}
        fallback={
          <div class="flex items-start gap-1 ps-4 hover:bg-bg-3">
            <span class="min-w-0 [overflow-wrap:anywhere]">
              {keyLabel()}
              <span class={leafClass(props.value)}>
                <Highlighted text={leafText(props.value)} settings={props.settings} />
              </span>
            </span>
            <span class="ms-auto opacity-0 group-hover/node:opacity-100 group-focus-within/node:opacity-100">
              <CopyButton
                text={() => (typeof props.value === 'string' ? props.value : leafText(props.value))}
                label={t('tree.copyValue')}
              />
            </span>
          </div>
        }
      >
        <button
          type="button"
          class="flex w-full cursor-pointer items-center gap-0.5 rounded-sm text-start hover:bg-bg-3"
          aria-expanded={isOpen() ? 'true' : 'false'}
          onClick={() => setIsOpen(!isOpen())}
        >
          <Icon name={isOpen() ? 'chevron-down' : 'chevron-right'} />
          {keyLabel()}
          <span class="text-fg-2">{summary()}</span>
        </button>
        <Show when={isOpen()}>
          <EntryList entries={entries()} depth={props.depth + 1} settings={props.settings} />
        </Show>
      </Show>
    </li>
  );
}

/** Children of a container; long lists are grouped into collapsible ranges of CHUNK_SIZE. */
function EntryList(props: { entries: [string, JsonValue][]; depth: number; settings: TreeSettings }) {
  const chunks = createMemo(() => {
    const groups: [string, JsonValue][][] = [];
    for (let start = 0; start < props.entries.length; start += CHUNK_SIZE) groups.push(props.entries.slice(start, start + CHUNK_SIZE));
    return groups;
  });

  return (
    <ul class="ms-2 border-s border-bg-3 ps-1">
      <Show
        when={props.entries.length > CHUNK_SIZE}
        fallback={
          <For each={props.entries}>
            {([name, value]) => <TreeNode name={name} value={value} depth={props.depth} settings={props.settings} />}
          </For>
        }
      >
        <For each={chunks()}>
          {(chunk, chunkIndex) => (
            <EntryChunk entries={chunk} first={chunkIndex() * CHUNK_SIZE} depth={props.depth} settings={props.settings} />
          )}
        </For>
      </Show>
    </ul>
  );
}

function EntryChunk(props: { entries: [string, JsonValue][]; first: number; depth: number; settings: TreeSettings }) {
  const [isOpen, setIsOpen] = createSignal(() => props.depth < props.settings.openDepth() - 1);
  return (
    <li>
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-0.5 rounded-sm text-start text-fg-2 hover:bg-bg-3"
        aria-expanded={isOpen() ? 'true' : 'false'}
        onClick={() => setIsOpen(!isOpen())}
      >
        <Icon name={isOpen() ? 'chevron-down' : 'chevron-right'} />
        {t('tree.range', { from: props.first, to: props.first + props.entries.length - 1 })}
      </button>
      <Show when={isOpen()}>
        <ul class="ms-2 border-s border-bg-3 ps-1">
          <For each={props.entries}>
            {([name, value]) => <TreeNode name={name} value={value} depth={props.depth} settings={props.settings} />}
          </For>
        </ul>
      </Show>
    </li>
  );
}

/**
 * Collapsible JSON tree. Nodes render only when opened, so huge documents stay cheap; numbers
 * keep their exact text (64-bit ids are not rounded).
 */
export default function JsonTree(props: { text: string; label: string; query?: string | undefined; caseSensitive?: boolean | undefined }) {
  const parsed = createMemo(() => parseExact(props.text));
  const root = () => {
    const result = parsed();
    return result.ok ? result : null;
  };
  const parseError = () => {
    const result = parsed();
    return result.ok ? '' : result.error;
  };
  // A new object on every "expand all / collapse all" click resets every node, including nodes
  // opened or closed by hand since the last click. The root and its children start open.
  const [expansion, setExpansion] = createSignal(() => {
    void props.text;
    return { depth: 1 };
  });
  const [tooLarge, setTooLarge] = createSignal(false);
  const settings: TreeSettings = {
    openDepth: () => expansion().depth,
    query: () => props.query ?? '',
    caseSensitive: () => props.caseSensitive ?? false,
  };

  function expandAll() {
    const result = root();
    if (!result) return;
    const exceedsLimit = countContainers(result.value, EXPAND_ALL_LIMIT) > EXPAND_ALL_LIMIT;
    setTooLarge(exceedsLimit);
    setExpansion({ depth: exceedsLimit ? EXPAND_ALL_FALLBACK_DEPTH : Number.POSITIVE_INFINITY });
  }

  function collapseAll() {
    setTooLarge(false);
    setExpansion({ depth: 0 });
  }

  return (
    <section aria-label={t('tree.label', { label: props.label })} class="flex min-h-0 flex-1 flex-col gap-1">
      <Show when={root()} fallback={<p class="text-warn">{parseError()}</p>}>
        {(result) => (
          <>
            <div class="flex items-center gap-1">
              <IconButton icon="expand" label={t('tree.expandAll')} text={t('tree.expandAll')} onClick={expandAll} />
              <IconButton icon="collapse" label={t('tree.collapseAll')} text={t('tree.collapseAll')} onClick={collapseAll} />
              <Show when={tooLarge()}>
                <span class="text-fg-2" role="status">
                  {t('tree.tooLarge')}
                </span>
              </Show>
            </div>
            <ul class="min-h-24 flex-1 overflow-auto rounded-sm border border-line p-1 font-mono text-[11.5px]/[18px]">
              <TreeNode name={null} value={result().value} depth={0} settings={settings} />
            </ul>
          </>
        )}
      </Show>
    </section>
  );
}
