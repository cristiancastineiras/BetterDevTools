/* oxlint-disable unicorn/require-post-message-target-origin -- a worker's postMessage takes no targetOrigin */
import type { RegexOutcome, RegexRequest } from '@betterdevtools/core';

const TIMEOUT_MS = 1500;

let worker: Worker | undefined;
let pending: ((outcome: RegexOutcome | null) => void) | undefined;
let nextId = 0;

/**
 * Runs a regex in a worker. A newer call cancels the older one (null); a run that takes longer than
 * the limit is stopped and reported as an error, which is what catastrophic backtracking looks like.
 */
export function runRegexSafely(request: RegexRequest): Promise<RegexOutcome | null> {
  pending?.(null);
  worker?.terminate(); // an older run may still be spinning: its worker goes with it
  const running = new Worker(new URL('./regex-worker.ts', import.meta.url), { type: 'module' });
  worker = running;
  const id = ++nextId;
  return new Promise((resolve) => {
    const stop = (outcome: RegexOutcome | null) => {
      clearTimeout(timer);
      running.terminate();
      if (worker === running) worker = undefined;
      if (pending === settle) pending = undefined;
      resolve(outcome);
    };
    const settle = (outcome: RegexOutcome | null) => stop(outcome);
    const timer = setTimeout(
      () => stop({ ok: false, error: `Stopped after ${TIMEOUT_MS / 1000} s: this pattern backtracks too much on this text` }),
      TIMEOUT_MS,
    );
    pending = settle;
    running.onmessage = (event: MessageEvent<{ id: number; outcome: RegexOutcome }>) => {
      if (event.data.id === id) stop(event.data.outcome);
    };
    running.onerror = () => stop({ ok: false, error: 'The regex worker could not run' });
    running.postMessage({ id, ...request });
  });
}
