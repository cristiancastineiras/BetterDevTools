export type CopyState = 'idle' | 'copied' | 'failed';

export const COPY_FEEDBACK_MS = 1400;

/**
 * State machine behind CopyButton: resolves the text, writes it, reports copied/failed for
 * COPY_FEEDBACK_MS, then idle. A newer copy or dispose() makes older results irrelevant.
 */
export function createCopier(write: (text: string) => Promise<boolean>, onState: (s: CopyState) => void) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (s: CopyState, g: number) => {
    if (g !== generation) return;
    clearTimeout(timer);
    onState(s);
    timer = setTimeout(() => g === generation && onState('idle'), COPY_FEEDBACK_MS);
  };
  return {
    async copy(source: string | (() => string | Promise<string>)): Promise<void> {
      const g = ++generation;
      try {
        const text = typeof source === 'string' ? source : await source();
        if (g !== generation) return;
        settle((await write(text)) ? 'copied' : 'failed', g);
      } catch {
        settle('failed', g); // building the text failed: report it, never pretend success
      }
    },
    dispose(): void {
      generation++;
      clearTimeout(timer);
    },
  };
}
