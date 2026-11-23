export interface SseEvent {
  /** The event name; "message" when the stream gave none. */
  event: string;
  data: string;
  id: string | undefined;
  retry: number | undefined;
  comments: string[];
}

/** Server-Sent Events text (a response body) as the events a browser's EventSource would have delivered. */
export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  let current: { event: string; data: string[]; id: string | undefined; retry: number | undefined; comments: string[] } | undefined;
  const flush = () => {
    if (current && (current.data.length || current.comments.length || current.id !== undefined || current.retry !== undefined)) {
      events.push({
        event: current.event || 'message',
        data: current.data.join('\n'),
        id: current.id,
        retry: current.retry,
        comments: current.comments,
      });
    }
    current = undefined;
  };
  for (const line of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    if (line === '') {
      flush();
      continue;
    }
    current ??= { event: '', data: [], id: undefined, retry: undefined, comments: [] };
    if (line.startsWith(':')) {
      current.comments.push(line.slice(1).trim());
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') current.event = value;
    else if (field === 'data') current.data.push(value);
    else if (field === 'id') current.id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) current.retry = Number(value);
  }
  flush();
  return events;
}
