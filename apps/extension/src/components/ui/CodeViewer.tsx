import {
  base64ToBytes,
  bodyText,
  detectFormat,
  formatBytes,
  formatCode,
  formFields,
  graphqlOf,
  hexDump,
  isMinified,
  jsonShape,
  langOf,
  prettyGraphql,
  prettyJson,
  prettyMarkup,
  viewModes,
  type Body,
  type CodeFormat,
  type Header,
  type ViewMode,
} from '@betterdevtools/core';
import { createMemo, createSignal, Match, onSettled, Show, Switch } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { bytesToBase64 } from '../../lib/io.ts';
import { indexLines, lineCount, NO_MATCHES, searchText } from '../../lib/search.ts';
import { copyToClipboard, openContextMenu } from '../../state/ui.ts';
import CodeLines from './CodeLines.tsx';
import CopyButton from './CopyButton.tsx';
import Icon from './Icon.tsx';
import IconButton from './IconButton.tsx';
import JsonTree from './JsonTree.tsx';
import KeyValueSection from './KeyValueSection.tsx';
import SegmentedControl from './SegmentedControl.tsx';
import SourceMapStatus from './SourceMapStatus.tsx';
import { badgeClass, fieldClass } from './styles.ts';

/** Prepended to HTML previews: no scripts, no network; inline styles and data: images only. */
const PREVIEW_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`;
/** Typing in the find box waits this long before searching, so big bodies do not stutter. */
const FIND_DEBOUNCE_MS = 80;
/** Bodies above this size wait longer: one search of the whole tree takes a few hundred ms. */
const BIG_BODY_CHARS = 5_000_000;
const BIG_FIND_DEBOUNCE_MS = 300;
/** Raw binary content is shown as base64 up to this many characters. */
const BASE64_PREVIEW_CHARS = 64 * 1024;

const encodeUtf8 = (text: string) => new TextEncoder().encode(text);

/**
 * Shows a request or response body: Pretty (formatted and coloured), Tree (JSON), Raw and
 * Preview (images, HTML in a sandbox). Hex is only reachable from the options menu. The find
 * bar highlights matches in the Pretty and Raw text.
 */
export default function CodeViewer(props: {
  body: Body;
  mime: string;
  url: string;
  headers?: Header[] | undefined;
  /** e.g. "Response body"; used in accessible names and menus. */
  label: string;
  /** Text to search for when the body opens (the free text of the network filter). */
  initialQuery?: string | undefined;
  /** Grow to fill a flex column (the Response tab) instead of capping the height. */
  fill?: boolean | undefined;
}) {
  let findInput: HTMLInputElement | undefined;
  let findTimer: ReturnType<typeof setTimeout> | undefined;
  onSettled(() => () => clearTimeout(findTimer));

  const hasContent = createMemo(() => props.body.state === 'available' || props.body.state === 'truncated');
  const format = createMemo<CodeFormat>(() => (hasContent() ? detectFormat(props.mime, props.body, props.url) : 'text'));
  const isSvg = createMemo(() => props.mime.includes('svg') || (format() === 'xml' && /<svg[\s>]/.test(props.body.text.slice(0, 500))));
  const availableModes = createMemo(() => viewModes(format(), isSvg()));
  // the user's choice of view; another body goes back to its default view (never to hex)
  const [chosenMode, setChosenMode] = createSignal<ViewMode | null>(() => {
    void props.body;
    return null;
  });
  const mode = createMemo<ViewMode>(() => {
    const chosen = chosenMode();
    return chosen === 'hex' || (chosen && availableModes().main.includes(chosen)) ? chosen : availableModes().default;
  });
  // position picked in the Raw view of a script, for the source map lookup
  const [pickedPosition, setPickedPosition] = createSignal<{ line: number; column: number } | null>(() => {
    void props.body;
    return null;
  });

  const isBinary = createMemo(() => format() === 'binary' || format() === 'image');
  const text = createMemo(() => (hasContent() && !isBinary() ? bodyText(props.body) : ''));
  const language = createMemo(() => langOf(format()));
  const isScript = createMemo(() => language() === 'js' || language() === 'css');
  const isMinifiedCode = createMemo(() => isScript() && isMinified(text()));
  // a big body is parsed once: for the summary, the formatter and the tree
  const parsedJson = createMemo<{ value: unknown } | null>(() => {
    if (format() !== 'json') return null;
    try {
      return { value: JSON.parse(text()) };
    } catch {
      return null;
    }
  });
  const json = createMemo(() => {
    const parsed = parsedJson();
    return parsed ? jsonShape(parsed.value) : null;
  });

  const prettyText = createMemo(() => {
    const source = text();
    const graphql = format() === 'graphql' ? graphqlOf(source) : null;
    if (graphql) return prettyGraphql(graphql.query) + (graphql.variables ? `\n\n# variables\n${graphql.variables}` : '');
    if (format() === 'json') {
      const parsed = parsedJson();
      return parsed ? (prettyJson(source, parsed) ?? source) : source;
    }
    if (language() === 'markup') return prettyMarkup(source);
    if (isMinifiedCode()) return formatCode(source, language() as 'js' | 'css');
    return source;
  });
  const rawText = createMemo(() => (isBinary() ? props.body.text : text()));
  const hexText = createMemo(() =>
    mode() === 'hex' ? hexDump(props.body.encoding === 'base64' ? base64ToBytes(props.body.text) : encodeUtf8(props.body.text)) : '',
  );
  /** The text the code view shows (and the find bar searches). */
  const shownText = createMemo(() => {
    if (mode() === 'hex') return hexText();
    if (mode() === 'tree') return ''; // the tree works on the parsed value: no formatting needed
    if (mode() === 'pretty') return prettyText();
    return isBinary() ? rawText().slice(0, BASE64_PREVIEW_CHARS) : rawText();
  });

  // where each line starts, built once per text and shared by the view and the search
  const shownLines = createMemo(() => indexLines(shownText()));

  const summary = createMemo(() => {
    const jsonShape = json();
    return [
      t(`viewer.formats.${format()}`),
      jsonShape ? t(jsonShape.kind === 'array' ? 'viewer.jsonArray' : 'viewer.jsonObject', { count: formatNumber(jsonShape.count) }) : '',
      isMinifiedCode() ? t('viewer.minified') : '',
      isBinary() || mode() === 'tree' ? '' : t('common.lines', { count: formatNumber(lineCount(shownLines())) }),
      formatBytes(props.body.size),
    ]
      .filter(Boolean)
      .join(' · ');
  });

  // ----------------------------------------------------------------------------- find bar

  const [findQuery, setFindQuery] = createSignal(() => props.initialQuery ?? '');
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  // a lower-case copy for case-insensitive search, made only when such a search runs
  let lowered: { text: string; lower: string } | null = null;
  const lowerText = () => {
    const current = shownText();
    if (lowered?.text !== current) lowered = { text: current, lower: current.toLowerCase() };
    return lowered.lower;
  };
  const search = createMemo(() =>
    mode() === 'preview' || mode() === 'tree' ? NO_MATCHES : searchText(shownText(), findQuery(), caseSensitive(), lowerText),
  );
  // the tree searches the parsed document itself and reports its count
  // written by the tree's own effect, hence ownedWrite
  const [treeMatches, setTreeMatches] = createSignal({ total: 0, kept: 0 }, { ownedWrite: true });
  const matchTotal = () => (mode() === 'tree' ? treeMatches().total : search().total);
  const navigable = () => (mode() === 'tree' ? treeMatches().kept : search().offsets.length);
  // back to the first match whenever the matches change
  const [currentMatch, setCurrentMatch] = createSignal(() => {
    void search();
    void treeMatches();
    return 0;
  });
  const canNavigate = () => navigable() > 0;

  function stepMatch(direction: 1 | -1) {
    const total = navigable();
    if (total) setCurrentMatch((index) => (index + direction + total) % total);
  }

  function onFindInput(value: string) {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => setFindQuery(value), text().length > BIG_BODY_CHARS ? BIG_FIND_DEBOUNCE_MS : FIND_DEBOUNCE_MS);
  }

  function onFindKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      // apply what was typed right away, then move
      clearTimeout(findTimer);
      const typed = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : '';
      if (typed !== findQuery()) setFindQuery(typed);
      else stepMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape' && findQuery()) {
      event.preventDefault();
      event.stopPropagation(); // Escape here clears the search instead of closing the details
      clearTimeout(findTimer);
      if (findInput) findInput.value = '';
      setFindQuery('');
    }
  }

  function onViewerKeyDown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && findInput) {
      event.preventDefault();
      findInput.focus();
      findInput.select();
    }
  }

  const matchCountText = () => {
    const total = matchTotal();
    if (!findQuery()) return '';
    if (!total) return t('viewer.findNone');
    return t('viewer.findMatches', { current: formatNumber(currentMatch() + 1), total: formatNumber(total) });
  };

  // -------------------------------------------------------------------------------- menus

  function openOptions(event: MouseEvent) {
    openContextMenu(event, t('viewer.options', { label: props.label }), [
      {
        label: mode() === 'hex' ? t('viewer.backToNormal') : t('viewer.showHex'),
        run: () => setChosenMode(mode() === 'hex' ? null : 'hex'),
      },
      { label: t('viewer.copyRaw'), run: () => void copyToClipboard(rawText(), props.label) },
    ]);
  }

  const imageSource = () =>
    `data:${props.mime || 'image/png'};base64,${props.body.encoding === 'base64' ? props.body.text : bytesToBase64(encodeUtf8(props.body.text))}`;

  return (
    <section aria-label={props.label} class={['flex min-h-0 flex-col gap-1', { 'flex-1': props.fill }]} onKeyDown={onViewerKeyDown}>
      <div class="flex flex-wrap items-center gap-2">
        <Show
          when={hasContent()}
          fallback={
            <span class="text-fg-2">
              {props.mime || t('viewer.unknownType')} · {formatBytes(props.body.size)}
            </span>
          }
        >
          <Show
            when={mode() === 'hex'}
            fallback={
              <Show when={availableModes().main.length > 1}>
                <SegmentedControl
                  label={t('viewer.viewLabel', { label: props.label })}
                  options={availableModes().main.map((option) => ({ value: option, label: t(`viewer.modes.${option}`) }))}
                  value={mode()}
                  onChange={(option) => setChosenMode(option)}
                />
              </Show>
            }
          >
            <span class={[badgeClass, 'text-fg-2']}>{t('viewer.hexDump')}</span>
          </Show>
          <span class="text-fg-2">{summary()}</span>
          <span class="ms-auto flex items-center gap-1">
            <CopyButton
              text={() => (mode() === 'preview' || mode() === 'tree' ? rawText() : shownText())}
              label={t('viewer.copyView', { label: props.label })}
            />
            <IconButton icon="more" variant="ghost" label={t('viewer.options', { label: props.label })} onClick={openOptions} />
          </span>
        </Show>
        <Show when={props.body.state !== 'available'}>
          <span class={[badgeClass, props.body.state === 'empty' ? 'text-fg-2' : 'text-warn']}>
            {t(`viewer.states.${props.body.state}`)}
          </span>
        </Show>
      </div>

      <Show when={props.body.reason}>
        <p class="flex items-center gap-1 text-warn">
          <Icon name="warning" />
          {props.body.reason}
        </p>
      </Show>

      <Show when={hasContent() && mode() !== 'preview' && !(mode() === 'pretty' && format() === 'form')}>
        <div role="search" class="flex flex-wrap items-center gap-1">
          <span class="relative flex items-center">
            <span class="pointer-events-none absolute start-1.5 inline-flex text-fg-2">
              <Icon name="search" />
            </span>
            <input
              ref={(element) => (findInput = element)}
              type="search"
              class={[fieldClass, 'w-56 ps-6']}
              aria-label={t('viewer.find')}
              placeholder={t('viewer.findPlaceholder')}
              value={findQuery()}
              spellcheck={false}
              onInput={(event) => onFindInput(event.currentTarget.value)}
              onKeyDown={onFindKeyDown}
            />
          </span>
          <IconButton
            icon="previous"
            variant="ghost"
            label={t('viewer.findPrevious')}
            disabled={!canNavigate()}
            onClick={() => stepMatch(-1)}
          />
          <IconButton icon="next" variant="ghost" label={t('viewer.findNext')} disabled={!canNavigate()} onClick={() => stepMatch(1)} />
          <IconButton
            icon="match-case"
            variant="ghost"
            label={t('viewer.findCase')}
            pressed={caseSensitive()}
            onClick={() => setCaseSensitive(!caseSensitive())}
          />
          <span class="text-fg-2 tabular-nums" role="status">
            {matchCountText()}
          </span>
        </div>
      </Show>

      <Show when={hasContent()}>
        <Show when={isScript() && mode() !== 'hex'}>
          <SourceMapStatus code={text()} headers={props.headers ?? []} url={props.url} position={pickedPosition()} />
        </Show>
        <Switch
          fallback={
            <CodeLines
              lines={shownLines()}
              lang={mode() === 'pretty' ? language() : 'plain'}
              label={`${props.label} (${t(`viewer.modes.${mode()}`)})`}
              search={search()}
              currentMatch={currentMatch()}
              fill={props.fill}
              onPick={mode() === 'raw' && isScript() ? (line, column) => setPickedPosition({ line, column }) : undefined}
            />
          }
        >
          <Match when={mode() === 'tree'}>
            <JsonTree
              text={text()}
              parsed={parsedJson()}
              label={props.label}
              query={findQuery()}
              caseSensitive={caseSensitive()}
              currentMatch={currentMatch()}
              onMatches={(total, kept) => setTreeMatches({ total, kept })}
            />
          </Match>
          <Match when={mode() === 'preview' && format() === 'image'}>
            <img
              class="max-w-full self-start border border-line bg-[repeating-conic-gradient(var(--color-bg-3)_0_25%,transparent_0_50%)] bg-size-[16px_16px]"
              alt={t('viewer.previewAlt', { label: props.label })}
              src={imageSource()}
            />
          </Match>
          <Match when={mode() === 'preview' && isSvg()}>
            <img
              class="max-w-full self-start border border-line"
              alt={t('viewer.previewAlt', { label: props.label })}
              src={`data:image/svg+xml;base64,${bytesToBase64(encodeUtf8(text()))}`}
            />
          </Match>
          <Match when={mode() === 'preview'}>
            <p class="text-fg-2">{t('viewer.previewNotice')}</p>
            <iframe
              title={t('viewer.previewFrame', { label: props.label })}
              sandbox=""
              referrerpolicy="no-referrer"
              class="h-96 w-full border border-line bg-white"
              srcdoc={PREVIEW_CSP + text()}
            />
          </Match>
          <Match when={mode() === 'pretty' && format() === 'form'}>
            <KeyValueSection title={t('viewer.formFields')} rows={formFields(text())} />
          </Match>
          <Match when={isBinary() && mode() === 'raw'}>
            <p class="text-fg-2">{t('viewer.binaryNotice')}</p>
            <CodeLines lines={shownLines()} lang="plain" label={`${props.label} base64`} fill={props.fill} />
          </Match>
        </Switch>
      </Show>
    </section>
  );
}
