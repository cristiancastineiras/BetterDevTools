import type { JSX } from '@solidjs/web';
import { omit, Show } from 'solid-js';
import Icon, { type IconName } from './Icon.tsx';
import { buttonClass, type ButtonVariant } from './styles.ts';

export type IconButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: IconName;
  /** Tooltip, and the accessible name when there is no visible `text`. */
  label: string;
  text?: string | undefined;
  variant?: ButtonVariant | undefined;
  /** Toggle buttons: rendered as aria-pressed. */
  pressed?: boolean | undefined;
  /** Work in progress: the button is disabled and announced as busy. */
  busy?: boolean | undefined;
};

/** A button with a 16 px icon and an optional visible label. */
export default function IconButton(props: IconButtonProps) {
  const nativeProps = omit(props, 'icon', 'label', 'text', 'variant', 'pressed', 'busy', 'disabled', 'type', 'class');
  return (
    <button
      {...nativeProps}
      type={props.type ?? 'button'}
      class={[buttonClass(props.variant ?? 'default', !props.text), props.class]}
      aria-label={props.text ? undefined : props.label}
      title={props.label}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed ? 'true' : 'false'}
      aria-busy={props.busy ? 'true' : undefined}
      disabled={Boolean(props.disabled || props.busy)}
    >
      <Icon name={props.icon} />
      <Show when={props.text}>
        <span>{props.text}</span>
      </Show>
    </button>
  );
}
