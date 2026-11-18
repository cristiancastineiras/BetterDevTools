import type { JSX } from '@solidjs/web';
import { createEffect } from 'solid-js';
import { dialogClass } from './styles.ts';

/**
 * A native modal <dialog> driven by state: it opens when `open` becomes true and closes when it
 * becomes false. Escape and `<form method="dialog">` buttons close it natively; `onDismiss`
 * then brings the state back in line (and receives the button's value, if any).
 */
export default function Modal(props: {
  open: boolean;
  /** Called right before the dialog shows, to reset its form. */
  onOpen?: (() => void) | undefined;
  onDismiss: (returnValue: string) => void;
  /** id of the dialog's heading. */
  labelledBy?: string | undefined;
  label?: string | undefined;
  class?: string | undefined;
  /** Clicking the backdrop closes the dialog (palette, menus); forms keep it open. */
  lightDismiss?: boolean | undefined;
  children: JSX.Element;
}) {
  let dialog: HTMLDialogElement | undefined;
  /** Set while the state closes the dialog: that close must not be reported back as a dismissal. */
  let closingFromState = false;

  createEffect(
    () => props.open,
    (open) => {
      if (!dialog) return;
      if (open && !dialog.open) {
        props.onOpen?.();
        dialog.showModal();
      } else if (!open && dialog.open) {
        closingFromState = true;
        dialog.close();
      }
    },
  );

  // The close event arrives as a separate task. By then the dialog may already be open again
  // (Ctrl+K pressed right after running a command), and that stale event must not close it.
  function onClose() {
    if (!dialog) return;
    const returnValue = dialog.returnValue;
    dialog.returnValue = '';
    const closedByState = closingFromState;
    closingFromState = false;
    if (closedByState || dialog.open) return;
    if (props.open) props.onDismiss(returnValue);
  }

  return (
    <dialog
      ref={(element) => (dialog = element)}
      class={[dialogClass, props.class]}
      aria-labelledby={props.labelledBy}
      aria-label={props.label}
      closedby={props.lightDismiss ? 'any' : 'closerequest'}
      onClose={onClose}
    >
      {props.children}
    </dialog>
  );
}
