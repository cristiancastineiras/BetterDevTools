// Panel-wide UI state: current view, status line, error banner, context menu, the open dialog
// and which request currently shows its secrets.
import type { Captured, Draft } from '@betterdevtools/core';
import { createSignal } from 'solid-js';
import { t } from '../i18n/index.ts';
import { copyText, logEvent } from '../lib/io.ts';
import { preferences } from './preferences.ts';

export type View = 'network' | 'replay' | 'collections' | 'discovery' | 'realtime' | 'toolbox';

export const [currentView, setCurrentView] = createSignal<View>('network');

// ------------------------------------------------------------------------------ status line

const [statusMessage, setStatusMessage] = createSignal('');
export { statusMessage };
let lastStatus = '';

/** Announces a short message in the footer's live region. */
export function announce(message: string): void {
  // screen readers skip a repeated identical message, so repeats get an invisible difference
  lastStatus = lastStatus === message ? `${message} ` : message;
  setStatusMessage(lastStatus);
}

// ----------------------------------------------------------------------------- error banner

export const [errorMessage, setErrorMessage] = createSignal('');

/** Shows an error banner and records it in the (redacted) local log. */
export function reportError(message: string, error?: unknown): void {
  setErrorMessage(message + (error instanceof Error ? `: ${error.message}` : ''));
  logEvent('error', 'ui.error', { message, error: String(error) });
}

export async function copyToClipboard(text: string, what: string): Promise<void> {
  announce((await copyText(text)) ? t('status.copiedWhat', { what }) : t('status.copyFailedHint'));
}

// ------------------------------------------------------------------------------ context menu

export interface MenuItem {
  label: string;
  run: () => void;
  disabled?: boolean;
}

export interface MenuRequest {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
}

export const [contextMenu, setContextMenu] = createSignal<MenuRequest | null>(null);

/** Opens the shared context menu at a pointer position (or below a row for keyboard users). */
export function openContextMenu(at: { clientX: number; clientY: number }, label: string, items: MenuItem[]): void {
  setContextMenu({ x: at.clientX, y: at.clientY, label, items });
}

// ----------------------------------------------------------------------------------- dialogs

export type ExportScope = 'selected' | 'filtered' | 'all';
export type SavableRequest = Pick<Draft, 'method' | 'url' | 'query' | 'headers' | 'body'>;

/** At most one modal dialog is open; any view can open one by setting this. */
export type DialogRequest =
  | { kind: 'palette' }
  | { kind: 'settings' }
  | { kind: 'export'; scope: ExportScope }
  | { kind: 'save'; request: SavableRequest }
  | { kind: 'compare'; first: Captured; second: Captured };

export const [openDialog, setOpenDialog] = createSignal<DialogRequest | null>(null);

export const showDialog = (request: DialogRequest): void => void setOpenDialog(request);
export const closeDialog = (): void => void setOpenDialog(null);

/** A yes/no question before an action with side effects (sending, deleting, exporting secrets). */
export interface ConfirmationRequest {
  title: string;
  /** Paragraphs explaining the effect; `warning` ones are shown in the warning colour. */
  details: { text: string; warning?: boolean }[];
  confirmLabel: string;
  resolve: (confirmed: boolean) => void;
}

export const [confirmation, setConfirmation] = createSignal<ConfirmationRequest | null>(null);

/** Shows the confirmation dialog; resolves true only when the user picks the confirm button. */
export function askConfirmation(question: Omit<ConfirmationRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    confirmation()?.resolve(false); // a newer question replaces an unanswered one
    setConfirmation({ ...question, resolve });
  });
}

// ---------------------------------------------------------------------------- secret values

/** Secrets are revealed for one place at a time (a request id, or the replay editor) and never saved. */
type RevealTarget = number | 'replay';
const [revealedFor, setRevealedFor] = createSignal<RevealTarget | null>(null);

export const secretsRevealed = (target: RevealTarget): boolean => preferences.revealSecrets || revealedFor() === target;

export function hideSecrets(): void {
  setRevealedFor(null);
}

export function toggleSecrets(target: RevealTarget): void {
  setRevealedFor(revealedFor() === target ? null : target);
}
