import { createSignal } from 'solid-js';
import { setActiveRequestId } from './capture.ts';
import { setCurrentView } from './ui.ts';

export type ToolId =
  | 'format'
  | 'jsonpath'
  | 'encode'
  | 'jwt'
  | 'uuid'
  | 'hash'
  | 'regex'
  | 'curl'
  | 'text'
  | 'epoch'
  | 'cron'
  | 'url'
  | 'security'
  | 'performance'
  | 'storage'
  | 'webhook'
  | 'htmlcss'
  | 'diff';

export const [activeTool, setActiveTool] = createSignal<ToolId>('format');

/** Opens one captured request in the Network view. */
export function showInNetwork(id: number): void {
  setCurrentView('network');
  setActiveRequestId(id);
}
