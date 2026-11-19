import { For, Show } from 'solid-js';

// [scheme://]host[:port]/path?query#hash, split on the text as written (no URL normalisation)
const URL_PARTS = /^([a-z][a-z0-9+.-]*:\/\/)?([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
const VARIABLE = /(\{\{\s*[\w.-]+\s*\}\})/;

/** Text with its {{variables}} as chips. */
function WithVariables(props: { text: string }) {
  return (
    <For each={props.text.split(VARIABLE)} keyed={false}>
      {/* pieces are reused by position as the text changes, so their text must stay reactive */}
      {(piece, index) => <span class={index % 2 ? 'rounded-xs bg-sel text-accent' : undefined}>{piece()}</span>}
    </For>
  );
}

/** A URL with its parts in soft, different colours: protocol, domain, path, query and hash. */
export default function UrlText(props: { url: string }) {
  return (
    <Show when={URL_PARTS.exec(props.url)} fallback={<WithVariables text={props.url} />}>
      {(parts) => (
        <>
          <Show when={parts()[1]}>
            <span class="text-syn-kw">{parts()[1]}</span>
          </Show>
          <span class="font-medium text-accent">
            <WithVariables text={parts()[2]!} />
          </span>
          <span>
            <WithVariables text={parts()[3]!} />
          </span>
          <Show when={parts()[4]}>
            <span class="text-syn-str">
              <WithVariables text={parts()[4]!} />
            </span>
          </Show>
          <Show when={parts()[5]}>
            <span class="text-warn">{parts()[5]}</span>
          </Show>
        </>
      )}
    </Show>
  );
}
