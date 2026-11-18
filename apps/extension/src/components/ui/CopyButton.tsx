import { createSignal, onSettled } from 'solid-js';
import { t } from '../../i18n/index.ts';
import { createCopier, type CopyState } from '../../lib/copy.ts';
import { copyText } from '../../lib/io.ts';
import Icon from './Icon.tsx';
import { buttonClass } from './styles.ts';

/**
 * Copies text and shows "Copied" / "Copy failed" for a moment. The feedback bubble is absolutely
 * positioned and the icon keeps its size, so copying never moves the layout.
 */
export default function CopyButton(props: {
  /** Text, or a function building it on click (e.g. a cURL command). */
  text: string | (() => string | Promise<string>);
  /** What is copied, e.g. "Copy URL"; used as accessible name and tooltip. */
  label: string;
  disabled?: boolean | undefined;
  /** Tooltip explaining why the button is disabled. */
  reason?: string | undefined;
}) {
  const [copyState, setCopyState] = createSignal<CopyState>('idle');
  const copier = createCopier(copyText, setCopyState);
  onSettled(() => () => copier.dispose());

  return (
    <span class="relative inline-flex">
      <button
        type="button"
        class={buttonClass('ghost', true)}
        aria-label={props.label}
        title={props.disabled && props.reason ? props.reason : props.label}
        disabled={Boolean(props.disabled)}
        data-copy-state={copyState()}
        onClick={() => void copier.copy(props.text)}
      >
        <span
          class={[
            'inline-flex motion-safe:transition-transform motion-safe:duration-150',
            { 'scale-110 text-ok': copyState() === 'copied', 'text-bad': copyState() === 'failed' },
          ]}
        >
          <Icon name={copyState() === 'copied' ? 'check' : copyState() === 'failed' ? 'error' : 'copy'} />
        </span>
      </button>
      <span
        role="status"
        class={[
          'pointer-events-none absolute end-0 bottom-full z-20 mb-1 rounded border border-line bg-bg px-1.5 text-[11px] whitespace-nowrap',
          'motion-safe:transition-opacity motion-safe:duration-150',
          {
            'opacity-0': copyState() === 'idle',
            'opacity-100': copyState() !== 'idle',
            'text-ok': copyState() === 'copied',
            'text-bad': copyState() === 'failed',
          },
        ]}
      >
        {copyState() === 'copied' ? t('common.copied') : copyState() === 'failed' ? t('common.copyFailed') : ''}
      </span>
    </span>
  );
}
