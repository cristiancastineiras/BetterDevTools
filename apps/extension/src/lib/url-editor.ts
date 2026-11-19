// The CodeMirror side of the Replay URL field. Kept apart from the Solid component so the editor
// (about 300 kB) is loaded only when the Replay view first opens, not with the panel.
import { autocompletion, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { Compartment, EditorState, Facet, Prec } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder, tooltips, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { urlTokens, urlVariables, type UrlTokenKind } from './url-tokens.ts';

/** A variable of the active environment, as offered by the editor. */
export interface UrlEditorVariable {
  name: string;
  value: string;
  secret: boolean;
}

export interface UrlEditorOptions {
  value: string;
  label: string;
  placeholder: string;
  variables: readonly UrlEditorVariable[];
  onInput: (value: string) => void;
  /** Enter or Ctrl+Enter: send the request. */
  onSubmit: () => void;
}

export interface UrlEditorHandle {
  setValue: (value: string) => void;
  setVariables: (variables: readonly UrlEditorVariable[]) => void;
  setText: (label: string, placeholder: string) => void;
  destroy: () => void;
}

const variablesFacet = Facet.define<readonly UrlEditorVariable[], readonly UrlEditorVariable[]>({ combine: (values) => values[0] ?? [] });

// Colours come from the same tokens as the rest of the panel, so every theme and accent applies.
const PART_CLASS: Record<UrlTokenKind, string> = {
  scheme: 'text-syn-kw',
  host: 'font-medium text-accent',
  port: 'text-syn-num',
  slash: 'text-fg-2',
  path: '',
  punct: 'text-fg-2',
  key: 'text-syn-prop',
  value: 'text-syn-str',
  hash: 'text-warn',
};
const PART_MARKS = Object.fromEntries(
  (Object.keys(PART_CLASS) as UrlTokenKind[]).map((kind) => [kind, Decoration.mark({ class: PART_CLASS[kind] })]),
) as Record<UrlTokenKind, Decoration>;
const KNOWN_VARIABLE = Decoration.mark({ class: 'rounded-xs bg-sel text-accent' });
const UNKNOWN_VARIABLE = Decoration.mark({ class: 'rounded-xs bg-bad/15 text-bad underline decoration-wavy underline-offset-2' });

/** Colours the URL parts, and each {{variable}} as a chip (red and wavy when the environment lacks it). */
const urlColours = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.startState.facet(variablesFacet) !== update.state.facet(variablesFacet)) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const text = view.state.doc.toString();
      const known = new Set(view.state.facet(variablesFacet).map((variable) => variable.name));
      const ranges = [
        ...urlTokens(text).map((token) => PART_MARKS[token.kind].range(token.from, token.to)),
        ...urlVariables(text).map((variable) => (known.has(variable.name) ? KNOWN_VARIABLE : UNKNOWN_VARIABLE).range(variable.from, variable.to)),
      ];
      return Decoration.set(ranges, true);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const MAX_VALUE_PREVIEW = 40;

/** After "{{", offers the environment's variables; picking one writes it with its closing braces. */
function variableCompletions(context: CompletionContext) {
  const typed = context.matchBefore(/\{\{\s*[\w.-]*/);
  if (!typed) return null;
  const from = typed.from + typed.text.search(/[\w.-]*$/);
  return {
    from,
    filter: true,
    options: context.state.facet(variablesFacet).map(
      (variable): Completion => ({
        label: variable.name,
        type: 'variable',
        // a secret is never written out in the list
        detail: variable.secret ? '••••••' : variable.value.length > MAX_VALUE_PREVIEW ? `${variable.value.slice(0, MAX_VALUE_PREVIEW)}…` : variable.value,
        apply: (view, _completion, start, end) => {
          // swallow braces already after the cursor, so "{{ba|}}" does not become "{{base}}}}"
          const after = view.state.doc.sliceString(end, end + 2);
          const close = after === '}}' ? 2 : after.startsWith('}') ? 1 : 0;
          const insert = `${variable.name}}}`;
          view.dispatch({ changes: { from: start, to: end + close, insert }, selection: { anchor: start + insert.length } });
        },
      }),
    ),
  };
}

const theme = EditorView.theme({
  '&': { width: '100%', minWidth: '0', color: 'var(--color-fg)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit', overflow: 'hidden' },
  '.cm-content': { padding: '0 6px', caretColor: 'var(--color-fg)', minHeight: 'unset' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--color-fg)' },
  '.cm-placeholder': { color: 'var(--color-fg-2)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--color-sel)' },
  '.cm-tooltip': {
    border: '1px solid var(--color-line)',
    borderRadius: '6px',
    backgroundColor: 'var(--color-bg)',
    color: 'var(--color-fg)',
    boxShadow: '0 4px 12px rgb(0 0 0 / 20%)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', maxHeight: '14em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px', display: 'flex', gap: '12px', alignItems: 'baseline' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--color-sel)', color: 'var(--color-fg)' },
  '.cm-completionLabel': { flexShrink: '0' },
  '.cm-completionDetail': { marginLeft: 'auto', fontStyle: 'normal', color: 'var(--color-fg-2)', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-completionIcon': { display: 'none' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700', color: 'var(--color-accent)' },
});

/**
 * A one-line CodeMirror editor for the URL: caret, selection, scrolling, undo and input methods
 * are the browser's real ones. It colours the URL as it is typed, marks unknown {{variables}},
 * and offers the environment's variables after "{{".
 */
export function createUrlEditor(host: HTMLElement, options: UrlEditorOptions): UrlEditorHandle {
  const variables = new Compartment();
  const hint = new Compartment();
  const submit = () => {
    options.onSubmit();
    return true;
  };

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: options.value,
      extensions: [
        history(),
        // a URL is one line: nothing that would add a line break gets through (Enter is "send")
        EditorState.transactionFilter.of((transaction) => (transaction.docChanged && transaction.newDoc.lines > 1 ? [] : transaction)),
        EditorView.domEventHandlers({
          paste(event, editor) {
            const text = event.clipboardData?.getData('text/plain');
            if (text === undefined || !/[\r\n]/.test(text)) return false;
            event.preventDefault();
            editor.dispatch(editor.state.replaceSelection(text.replace(/\s*[\r\n]+\s*/g, '')), { userEvent: 'input.paste', scrollIntoView: true });
            return true;
          },
        }),
        Prec.high(keymap.of([{ key: 'Enter', run: submit }, { key: 'Mod-Enter', run: submit }])),
        keymap.of([...historyKeymap, ...standardKeymap]),
        // the list lives inside the field's own box (not fixed on the page), so the interface zoom cannot misplace it
        tooltips({ parent: host, position: 'absolute' }),
        autocompletion({ override: [variableCompletions], icons: false }),
        urlColours,
        theme,
        EditorView.contentAttributes.of({
          role: 'textbox',
          'aria-multiline': 'false',
          'aria-label': options.label,
          spellcheck: 'false',
          autocapitalize: 'off',
          autocorrect: 'off',
        }),
        variables.of(variablesFacet.of(options.variables)),
        hint.of(placeholder(options.placeholder)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onInput(update.state.doc.toString());
          // when the field loses focus, show the start of the URL again (the host is what matters)
          if (update.focusChanged && !update.view.hasFocus) update.view.scrollDOM.scrollLeft = 0;
        }),
      ],
    }),
  });

  return {
    // another request was opened: replace the text, caret at the end
    setValue(value) {
      if (view.state.doc.toString() === value) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor: value.length } });
    },
    setVariables(list) {
      view.dispatch({ effects: variables.reconfigure(variablesFacet.of(list)) });
    },
    setText(label, text) {
      view.contentDOM.setAttribute('aria-label', label);
      view.dispatch({ effects: hint.reconfigure(placeholder(text)) });
    },
    destroy: () => view.destroy(),
  };
}
