/* oxlint-disable unicorn/consistent-function-scoping -- small helpers sit beside the one place that uses them */
import {
  formatCode,
  formatJson,
  formatMarkup,
  jsonEscape,
  jsonToYaml,
  jsonUnescape,
  minifyCss,
  minifyJson,
  minifyMarkup,
  sortJson,
} from '@betterdevtools/core';
import { createMemo, createSignal, Show } from 'solid-js';
import { t } from '../../i18n/index.ts';
import SegmentedControl from '../ui/SegmentedControl.tsx';
import SelectMenu from '../ui/SelectMenu.tsx';
import { CapturedPicker, ErrorText, Output, Page, Row, TextArea } from './kit.tsx';

type Language = 'json' | 'markup' | 'css' | 'js';
type Action = 'format' | 'minify' | 'sort' | 'yaml' | 'escape' | 'unescape';

const ACTIONS: Record<Language, Action[]> = {
  json: ['format', 'minify', 'sort', 'yaml', 'escape', 'unescape'],
  markup: ['format', 'minify'],
  css: ['format', 'minify'],
  js: ['format'], // shortcut: no JavaScript minifier; the response viewer's formatter is all that is bundled
};

/** JSON, XML/HTML, CSS and JavaScript: format, minify and, for JSON, sort, convert and escape. */
export default function FormatTool() {
  const [language, setLanguage] = createSignal<Language>('json');
  const [action, setAction] = createSignal<Action>('format');
  const [indent, setIndent] = createSignal('2');
  const [input, setInput] = createSignal('');

  const actions = createMemo(() => ACTIONS[language()]);
  const effective = () => (actions().includes(action()) ? action() : 'format');

  const result = createMemo((): { text: string; error?: string } => {
    const text = input();
    if (!text.trim()) return { text: '' };
    const json = (outcome: ReturnType<typeof formatJson>) =>
      outcome.ok
        ? { text: outcome.output }
        : { text: '', error: t('toolbox.format.jsonError', { message: outcome.error, line: outcome.line, column: outcome.column }) };
    switch (language()) {
      case 'json':
        switch (effective()) {
          case 'minify':
            return json(minifyJson(text));
          case 'sort':
            return json(sortJson(text));
          case 'yaml':
            return json(jsonToYaml(text));
          case 'escape':
            return { text: jsonEscape(text) };
          case 'unescape':
            return json(jsonUnescape(text));
          default:
            return json(formatJson(text, indent() === 'tab' ? 'tab' : indent() === '4' ? 4 : 2));
        }
      case 'markup': {
        if (effective() === 'minify') return { text: minifyMarkup(text) };
        const outcome = formatMarkup(text);
        return outcome.ok ? { text: outcome.output } : { text: '', error: outcome.error };
      }
      case 'css':
        return { text: effective() === 'minify' ? minifyCss(text) : formatCode(text, 'css') };
      case 'js':
        return { text: formatCode(text, 'js') };
    }
  });

  return (
    <Page>
      <Row>
        <SegmentedControl
          label={t('toolbox.format.language')}
          value={language()}
          onChange={setLanguage}
          options={[
            { value: 'json', label: 'JSON' },
            { value: 'markup', label: 'XML / HTML' },
            { value: 'css', label: 'CSS' },
            { value: 'js', label: 'JavaScript' },
          ]}
        />
        <SelectMenu
          label={t('toolbox.format.action')}
          value={effective()}
          onChange={(value) => setAction(value as Action)}
          options={actions().map((value) => ({ value, label: t(`toolbox.format.actions.${value}`) }))}
        />
        <Show when={language() === 'json' && effective() === 'format'}>
          <SelectMenu
            label={t('toolbox.format.indent')}
            value={indent()}
            onChange={setIndent}
            options={[
              { value: '2', label: t('toolbox.format.spaces', { count: 2 }) },
              { value: '4', label: t('toolbox.format.spaces', { count: 4 }) },
              { value: 'tab', label: t('toolbox.format.tab') },
            ]}
          />
        </Show>
        <CapturedPicker onPick={setInput} />
      </Row>
      <TextArea label={t('toolbox.input')} value={input()} onInput={setInput} rows={10} />
      <Show when={result().error}>{(message) => <ErrorText>{message()}</ErrorText>}</Show>
      <Output label={t('toolbox.output')} text={result().text} rows={12} />
    </Page>
  );
}
