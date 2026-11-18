import { redactDeep } from '@betterdevtools/core';

/** Local structured log; secret-named fields are masked before anything reaches the console. */
export function logEvent(level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown> = {}): void {
  console[level](`[betterdevtools] ${event}`, JSON.stringify(redactDeep({ at: new Date().toISOString(), ...data })));
}

/** execCommand first: navigator.clipboard is often rejected inside DevTools panels. */
export async function copyText(text: string): Promise<boolean> {
  const prev = document.activeElement;
  const field = Object.assign(document.createElement('textarea'), { value: text });
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } finally {
    field.remove();
    if (prev instanceof HTMLElement) prev.focus({ preventScroll: true });
  }
  if (ok) return true;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    logEvent('warn', 'clipboard.failed', { error: String(e) });
    return false;
  }
}

export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0));

export function readFile(file: File, maxBytes: number): Promise<string> {
  if (file.size > maxBytes) return Promise.reject(new Error(`${file.name} is larger than ${Math.round(maxBytes / 1048576)} MB`));
  return file.text();
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Fetches text from the extension origin, aborting past `maxBytes` (never buffers more). */
export async function fetchCapped(url: string, maxBytes: number, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) {
      await reader.cancel();
      throw new Error(`larger than ${Math.round(maxBytes / 1048576)} MB`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
