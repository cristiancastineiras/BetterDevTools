/* oxlint-disable unicorn/consistent-function-scoping -- small helpers sit beside the one place that uses them */
import {
  colorFormats,
  contrastRatio,
  evaluateCss,
  parseColor,
  selectorMatches,
  toHexColor,
  wcag,
  type Rgba,
  type SelectorMatch,
} from '@betterdevtools/core';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { evalInInspectedPage, revealElement } from '../../lib/devtools.ts';
import { attachedToDevtools } from '../../state/capture.ts';
import IconButton from '../ui/IconButton.tsx';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import { monoClass } from '../ui/styles.ts';
import { ErrorText, Field, Hint, Output, Page, Pairs, Row, TextArea } from './kit.tsx';

type Tab = 'selector' | 'css' | 'color' | 'contrast';
const DEBOUNCE_MS = 250;
const SAMPLE_PROPERTIES = ['width', 'height', 'margin', 'padding', 'font-size', 'color', 'background-color', 'line-height', 'gap', 'inset'];

let canvasContext: CanvasRenderingContext2D | null | undefined;

/** Any CSS colour (names, oklch(), color-mix()…) as sRGB, using the browser's own parser. */
function resolveColor(text: string): Rgba | null {
  const direct = parseColor(text);
  if (direct || !text.trim() || !CSS.supports('color', text.trim())) return direct;
  canvasContext ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!canvasContext) return null;
  canvasContext.clearRect(0, 0, 1, 1);
  canvasContext.fillStyle = text.trim();
  canvasContext.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = canvasContext.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: Math.round((a / 255) * 100) / 100 };
}

function Swatch(props: { color: Rgba | null }) {
  return (
    <span
      class="inline-block size-8 rounded-sm border border-line"
      style={{ background: props.color ? toHexColor(props.color) : 'transparent' }}
      aria-hidden="true"
    />
  );
}

function SelectorTester() {
  const [source, setSource] = createSignal<'page' | 'html'>(attachedToDevtools ? 'page' : 'html');
  const [selector, setSelector] = createSignal('');
  const [html, setHtml] = createSignal('');
  const [result, setResult] = createSignal<{ total: number; matches: SelectorMatch[] } | { error: string } | null>(null);

  createEffect(
    () => ({ source: source(), selector: selector(), html: html() }),
    (request) => {
      if (!request.selector.trim()) {
        setResult(null);
        return;
      }
      let active = true;
      const timer = setTimeout(() => {
        if (request.source === 'html') {
          const fake = new DOMParser().parseFromString(request.html, 'text/html');
          setResult(selectorMatches({ document: fake }, request.selector) as never);
        } else {
          void evalInInspectedPage(`(${selectorMatches.toString()})(globalThis, ${JSON.stringify(request.selector)})`).then(
            (reply) => active && setResult(reply as never),
            (cause: unknown) => active && setResult({ error: cause instanceof Error ? cause.message : String(cause) }),
          );
        }
      }, DEBOUNCE_MS);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    },
  );

  return (
    <>
      <Row>
        <Field
          label={t('htmlcss.selector')}
          value={selector()}
          onInput={setSelector}
          placeholder="main > article:nth-child(2) a[href^='https']"
          class="min-w-72 flex-1"
        />
        <SegmentedControl
          label={t('htmlcss.source')}
          value={source()}
          onChange={setSource}
          options={[
            { value: 'page', label: t('htmlcss.page') },
            { value: 'html', label: t('htmlcss.pastedHtml') },
          ]}
        />
      </Row>
      <Show when={source() === 'html'}>
        <TextArea label="HTML" value={html()} onInput={setHtml} rows={8} placeholder="<ul><li class='a'>One</li><li>Two</li></ul>" />
      </Show>
      <Show when={source() === 'page' && !attachedToDevtools}>
        <Hint>{t('htmlcss.notAttached')}</Hint>
      </Show>
      <Show when={result()}>
        {(found) => (
          <Show
            when={'matches' in found() ? (found() as { total: number; matches: SelectorMatch[] }) : null}
            fallback={<ErrorText>{(found() as { error: string }).error}</ErrorText>}
          >
            {(ok) => (
              <>
                <p class="font-semibold" role="status">
                  {t('htmlcss.count', { count: formatNumber(ok().total) })}
                </p>
                <ol class="flex flex-col gap-0.5" aria-label={t('htmlcss.matches')}>
                  <For each={ok().matches}>
                    {(match) => (
                      <li class="flex items-baseline gap-2 border-b border-bg-3 py-0.5">
                        <span
                          class={[monoClass, 'text-accent']}
                        >{`${match.tag}${match.id ? `#${match.id}` : ''}${match.classes ? `.${match.classes.trim().split(/\s+/).join('.')}` : ''}`}</span>
                        <span class="min-w-0 flex-1 truncate text-fg-2">{match.text}</span>
                        <Show when={source() === 'page'}>
                          <IconButton
                            icon="search"
                            variant="ghost"
                            label={t('htmlcss.reveal')}
                            onClick={() => void revealElement(selector(), match.index)}
                          />
                        </Show>
                      </li>
                    )}
                  </For>
                </ol>
                <Show when={ok().total > ok().matches.length}>
                  <Hint>{t('htmlcss.capped', { shown: ok().matches.length, total: formatNumber(ok().total) })}</Hint>
                </Show>
              </>
            )}
          </Show>
        )}
      </Show>
    </>
  );
}

function ValueEvaluator() {
  const [property, setProperty] = createSignal('width');
  const [value, setValue] = createSignal('calc(100vw - 2rem)');
  const [outcome, setOutcome] = createSignal<{ supported: boolean; computed: string } | null>(null);

  createEffect(
    () => ({ property: property().trim(), value: value().trim() }),
    (css) => {
      if (!css.property || !css.value) {
        setOutcome(null);
        return;
      }
      let active = true;
      const timer = setTimeout(() => {
        const run = attachedToDevtools
          ? evalInInspectedPage(`(${evaluateCss.toString()})(globalThis, ${JSON.stringify(css.property)}, ${JSON.stringify(css.value)})`)
          : Promise.resolve(evaluateCss(globalThis, css.property, css.value));
        void run.then(
          (reply) => active && setOutcome(reply as { supported: boolean; computed: string }),
          () => active && setOutcome(null),
        );
      }, DEBOUNCE_MS);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    },
  );

  return (
    <>
      <Hint>{attachedToDevtools ? t('htmlcss.evalPage') : t('htmlcss.evalPanel')}</Hint>
      <Row>
        <Field label={t('htmlcss.property')} value={property()} onInput={setProperty} class="w-48" />
        <Field label={t('htmlcss.value')} value={value()} onInput={setValue} class="min-w-64 flex-1" placeholder="clamp(1rem, 2vw, 3rem)" />
      </Row>
      <div class="flex flex-wrap gap-1" aria-label={t('htmlcss.examples')} role="group">
        <For each={SAMPLE_PROPERTIES}>
          {(name) => <IconButton icon="check" variant="ghost" label={name} text={name} onClick={() => setProperty(name)} />}
        </For>
      </div>
      <Show when={outcome()}>
        {(result) => (
          <Show when={result().supported} fallback={<ErrorText>{t('htmlcss.unsupported')}</ErrorText>}>
            <Output label={t('htmlcss.computed')} text={result().computed} rows={2} />
          </Show>
        )}
      </Show>
    </>
  );
}

function ColorConverter() {
  const [text, setText] = createSignal('#3b82f6');
  const color = createMemo(() => resolveColor(text()));
  return (
    <>
      <Row>
        <Field
          label={t('htmlcss.color')}
          value={text()}
          onInput={setText}
          placeholder="rebeccapurple, #3b82f6, oklch(70% 0.2 250)…"
          class="min-w-64 flex-1"
        />
        <label class="flex flex-col gap-0.5">
          <span class="text-fg-2">{t('htmlcss.picker')}</span>
          <input
            type="color"
            class="h-6.5 w-12 cursor-pointer"
            value={color() ? toHexColor({ ...color()!, a: 1 }) : '#000000'}
            onInput={(event) => setText(event.currentTarget.value)}
          />
        </label>
        <Swatch color={color()} />
      </Row>
      <Show
        when={color()}
        fallback={
          <Show when={text().trim()}>
            <ErrorText>{t('htmlcss.badColor')}</ErrorText>
          </Show>
        }
      >
        {(rgba) => <Pairs label={t('htmlcss.formats')} rows={colorFormats(rgba())} />}
      </Show>
    </>
  );
}

function ContrastChecker() {
  const [foreground, setForeground] = createSignal('#595959');
  const [background, setBackground] = createSignal('#ffffff');
  const fg = createMemo(() => resolveColor(foreground()));
  const bg = createMemo(() => resolveColor(background()));
  const result = createMemo(() => (fg() && bg() ? wcag(contrastRatio(fg()!, bg()!)) : null));
  const pass = (ok: boolean) => <span class={ok ? 'text-ok' : 'text-bad'}>{ok ? t('htmlcss.pass') : t('htmlcss.fail')}</span>;
  return (
    <>
      <Row>
        <Field label={t('htmlcss.foreground')} value={foreground()} onInput={setForeground} class="w-56" />
        <Field label={t('htmlcss.background')} value={background()} onInput={setBackground} class="w-56" />
        <IconButton
          icon="replay"
          label={t('htmlcss.swap')}
          text={t('htmlcss.swap')}
          onClick={() => {
            const f = foreground();
            setForeground(background());
            setBackground(f);
          }}
        />
      </Row>
      <Show when={result()} fallback={<ErrorText>{t('htmlcss.badColor')}</ErrorText>}>
        {(wc) => (
          <>
            <p class="rounded-sm border border-line p-3 text-[1.3em]" style={{ color: toHexColor(fg()!), background: toHexColor(bg()!) }}>
              {t('htmlcss.sample')}
            </p>
            <p class="text-[1.4em] font-semibold" role="status">
              {wc().ratio.toFixed(2)} : 1
            </p>
            <table class="border-collapse" aria-label={t('htmlcss.levels')}>
              <tbody>
                <tr class="border-b border-bg-3">
                  <th scope="row" class="pe-4 text-start font-medium">
                    {t('htmlcss.aaNormal')}
                  </th>
                  <td>{pass(wc().aaNormal)}</td>
                </tr>
                <tr class="border-b border-bg-3">
                  <th scope="row" class="pe-4 text-start font-medium">
                    {t('htmlcss.aaLarge')}
                  </th>
                  <td>{pass(wc().aaLarge)}</td>
                </tr>
                <tr class="border-b border-bg-3">
                  <th scope="row" class="pe-4 text-start font-medium">
                    {t('htmlcss.aaaNormal')}
                  </th>
                  <td>{pass(wc().aaaNormal)}</td>
                </tr>
                <tr class="border-b border-bg-3">
                  <th scope="row" class="pe-4 text-start font-medium">
                    {t('htmlcss.aaaLarge')}
                  </th>
                  <td>{pass(wc().aaaLarge)}</td>
                </tr>
                <tr class="border-b border-bg-3">
                  <th scope="row" class="pe-4 text-start font-medium">
                    {t('htmlcss.ui')}
                  </th>
                  <td>{pass(wc().ui)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </Show>
    </>
  );
}

/** Selectors against the page or pasted HTML, CSS values computed by the page, colour conversion and WCAG contrast. */
export default function HtmlCssTool() {
  const [tab, setTab] = createSignal<Tab>('selector');
  return (
    <Page>
      <SegmentedControl
        label={t('htmlcss.tools')}
        value={tab()}
        onChange={setTab}
        options={[
          { value: 'selector', label: t('htmlcss.tabSelector') },
          { value: 'css', label: t('htmlcss.tabCss') },
          { value: 'color', label: t('htmlcss.tabColor') },
          { value: 'contrast', label: t('htmlcss.tabContrast') },
        ]}
      />
      <Show when={tab() === 'selector'}>
        <SelectorTester />
      </Show>
      <Show when={tab() === 'css'}>
        <ValueEvaluator />
      </Show>
      <Show when={tab() === 'color'}>
        <ColorConverter />
      </Show>
      <Show when={tab() === 'contrast'}>
        <ContrastChecker />
      </Show>
    </Page>
  );
}
