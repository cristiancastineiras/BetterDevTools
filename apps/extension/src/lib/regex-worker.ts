/* oxlint-disable unicorn/require-post-message-target-origin -- a worker's postMessage takes no targetOrigin */
// Runs regular expressions away from the panel's thread: a pattern that never finishes can then be
// stopped by terminating this worker instead of freezing the interface.
import { runRegex, type RegexRequest } from '@betterdevtools/core';

self.onmessage = (event: MessageEvent<RegexRequest & { id: number }>) => {
  const { id, ...request } = event.data;
  self.postMessage({ id, outcome: runRegex(request) });
};
