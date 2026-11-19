// Shared Tailwind class lists. Components compose these instead of custom CSS, so every button,
// field and badge in the panel looks and behaves the same. Variants never repeat a property
// the base sets, so class order can never decide which colour wins.

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'record';

const BUTTON_BASE = [
  'inline-flex min-h-6.5 min-w-6.5 cursor-pointer items-center justify-center gap-1 rounded-md border py-0.5',
  'font-medium whitespace-nowrap transition-colors duration-100 motion-reduce:transition-none',
  'disabled:cursor-default disabled:opacity-55',
].join(' ');

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: 'border-line bg-bg-2 text-fg hover:bg-bg-3 active:bg-line aria-pressed:border-accent aria-pressed:bg-sel',
  primary: 'border-accent bg-accent text-on-accent hover:brightness-110 active:brightness-95',
  ghost: 'border-transparent bg-transparent text-fg hover:bg-bg-3 active:bg-line aria-pressed:bg-sel',
  // the recording toggle: red dot and red button while it is pressed (recording)
  record:
    'border-line bg-bg-2 text-fg hover:bg-bg-3 active:bg-line aria-pressed:border-bad aria-pressed:bg-bad/10 aria-pressed:text-bad aria-pressed:[&_svg]:fill-current',
};

/** Classes for a native <button>. `iconOnly` makes it square (no side padding). */
export function buttonClass(variant: ButtonVariant = 'default', iconOnly = false): string {
  return `${BUTTON_BASE} ${iconOnly ? 'px-0' : 'px-2'} ${BUTTON_VARIANTS[variant]}`;
}

/** Text inputs, textareas and number fields. */
export const fieldClass =
  'min-h-6.5 rounded-md border border-line bg-bg px-1.5 py-0.5 text-fg placeholder:text-fg-2 read-only:bg-bg-2 disabled:opacity-55';

/** Technical text: URLs, header names and values, JSON, code. */
export const monoClass = 'font-mono text-[11.5px]';

/** Small outlined label for states such as "truncated" or "replay response". */
export const badgeClass = 'inline-block rounded-full border border-current px-1.5 text-[11px] leading-4';

/** Heading of a block inside a tab. */
export const sectionTitleClass = 'pt-1.5 pb-0.5 font-semibold';

/** Modal dialogs share the same frame. */
export const dialogClass = 'rounded-lg border border-line bg-bg p-0 text-fg shadow-xl backdrop:bg-black/45';
