import { REGEX_FLAGS, type RegexMatch, type RegexOutcome } from '@betterdevtools/core';
import { createEffect, createSignal, For, Show } from 'solid-js';
import { formatNumber, t } from '../../i18n/index.ts';
import { runRegexSafely } from '../../lib/regex-runner.ts';
import IconButton from '../ui/IconButton.tsx';
import { monoClass } from '../ui/styles.ts';
import { CapturedPicker, ErrorText, Field, Hint, Output, Page, Row, TextArea } from './kit.tsx';

const DEBOUNCE_MS = 150;

/** The text cut at the matches: [plain, match, plain, match…]. Overlapping or empty matches are skipped. */
function segments(text: string, matches: RegexMatch[]): { text: string; match: boolean }[] {
  const out: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const match of matches) {
    if (match.length === 0 || match.index < at) continue;
    if (match.index > at) out.push({ text: text.slice(at, match.index), match: false });
    out.push({ text: match.text, match: true });
    at = match.index + match.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out;
}

/** Regular expression tester: matches, groups, highlighting and a replacement preview, run in a worker. */
export default function RegexTool() {
  const [pattern, setPattern] = createSignal('');
  const [flags, setFlags] = createSignal('g');
  const [text, setText] = createSignal('');
  const [replacement, setReplacement] = createSignal('');
  const [outcome, setOutcome] = createSignal<RegexOutcome | null>(null);
  const [running, setRunning] = createSignal(false);

  createEffect(
    () => ({ pattern: pattern(), flags: flags(), text: text(), replacement: replacement() }),
    (request) => {
      if (!request.pattern) {
        setOutcome(null);
        return;
      }
      setRunning(true);
      const timer = setTimeout(() => {
        void runRegexSafely({ ...request, replacement: request.replacement === '' ? null : request.replacement }).then((result) => {
          if (result === null) return; // a newer run took over
          setOutcome(result);
          setRunning(false);
        });
      }, DEBOUNCE_MS);
      return () => clearTimeout(timer);
    },
  );

  const toggle = (flag: string) => setFlags(flags().includes(flag) ? flags().replace(flag, '') : flags() + flag);

  return (
    <Page>
      <Row>
        <Field
          label={t('toolbox.regex.pattern')}
          value={pattern()}
          onInput={setPattern}
          placeholder="(?<key>\w+)=(\d+)"
          class="min-w-64 flex-1"
        />
        <div class="flex gap-1" role="group" aria-label={t('toolbox.regex.flags')}>
          <For each={REGEX_FLAGS}>
            {(flag) => (
              <IconButton
                icon="check"
                label={t(`toolbox.regex.flag.${flag}`)}
                text={flag}
                pressed={flags().includes(flag)}
                onClick={() => toggle(flag)}
              />
            )}
          </For>
        </div>
        <CapturedPicker onPick={setText} />
      </Row>
      <TextArea label={t('toolbox.regex.text')} value={text()} onInput={setText} rows={8} />
      <Field label={t('toolbox.regex.replacement')} value={replacement()} onInput={setReplacement} placeholder="$1: $2" />
      <Show when={outcome()}>
        {(result) => (
          <Show
            when={result().ok ? (result() as Extract<RegexOutcome, { ok: true }>) : null}
            fallback={<ErrorText>{(result() as { error: string }).error}</ErrorText>}
          >
            {(done) => (
              <>
                <p class="font-semibold" role="status">
                  {running() ? t('toolbox.regex.running') : t('toolbox.regex.count', { count: formatNumber(done().matches.length) })}
                  <Show when={done().more}> {t('toolbox.regex.more')}</Show>
                </p>
                <pre
                  class={[
                    monoClass,
                    'max-h-48 overflow-auto rounded-sm border border-line p-1 whitespace-pre-wrap [overflow-wrap:anywhere]',
                  ]}
                  tabindex="0"
                  aria-label={t('toolbox.regex.highlighted')}
                >
                  <For each={segments(text(), done().matches)}>
                    {(part) => (part.match ? <mark class="rounded-xs bg-sel text-fg">{part.text}</mark> : <>{part.text}</>)}
                  </For>
                </pre>
                <Show when={done().matches.length}>
                  <div class="overflow-x-auto">
                    <table class={[monoClass, 'w-full border-collapse']} aria-label={t('toolbox.regex.matches')}>
                      <thead>
                        <tr class="border-b border-line text-start text-fg-2">
                          <th scope="col" class="px-1 text-start">
                            #
                          </th>
                          <th scope="col" class="px-1 text-start">
                            {t('toolbox.regex.index')}
                          </th>
                          <th scope="col" class="px-1 text-start">
                            {t('toolbox.regex.match')}
                          </th>
                          <th scope="col" class="px-1 text-start">
                            {t('toolbox.regex.groups')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={done().matches.slice(0, 200)}>
                          {(match, index) => (
                            <tr class="border-b border-bg-3 align-top">
                              <td class="px-1">{index() + 1}</td>
                              <td class="px-1">{match.index}</td>
                              <td class="px-1 [overflow-wrap:anywhere]">{match.text}</td>
                              <td class="px-1 [overflow-wrap:anywhere]">
                                {Object.keys(match.named).length
                                  ? Object.entries(match.named)
                                      .map(([name, value]) => `${name}=${value ?? '∅'}`)
                                      .join(' · ')
                                  : match.groups.map((group, i) => `$${i + 1}=${group ?? '∅'}`).join(' · ')}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
                <Show when={done().replaced !== null}>
                  <Output label={t('toolbox.regex.replaced')} text={done().replaced ?? ''} rows={5} />
                </Show>
                <Show when={!done().matches.length && !running()}>
                  <Hint>{t('toolbox.regex.none')}</Hint>
                </Show>
              </>
            )}
          </Show>
        )}
      </Show>
    </Page>
  );
}
