import { For } from 'solid-js';
import { captureLog } from '../../state/capture.ts';
import { showInNetwork } from '../../state/toolbox.ts';
import { monoClass } from '../ui/styles.ts';

/** The captured requests behind a finding; each one opens in the Network view. */
export default function RequestLinks(props: { ids: number[]; label: string }) {
  return (
    <ul class="flex flex-col gap-0.5" aria-label={props.label}>
      <For each={props.ids}>
        {(id) => {
          const request = () => captureLog.get(id);
          return (
            <li>
              <button
                type="button"
                class={[monoClass, 'max-w-full cursor-pointer truncate text-start text-accent underline-offset-2 hover:underline']}
                onClick={() => showInNetwork(id)}
              >
                {request() ? `${request()!.status || '—'} ${request()!.method} ${request()!.url}` : `#${id}`}
              </button>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
