// Minimal typing for the part of web-ext's Node API the Firefox smoke test uses (the package ships no types).
declare module 'web-ext' {
  interface Runner {
    exit(): Promise<void>;
  }
  export const cmd: { run(params: Record<string, unknown>, options: { shouldExitProgram: boolean }): Promise<Runner> };
}
