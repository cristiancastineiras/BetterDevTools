export interface ListOption {
  value: string;
  label: string;
  description?: string | undefined;
  disabled?: boolean | undefined;
}

/**
 * Keyboard model of SelectMenu's listbox: returns the next active index (disabled options are
 * skipped) and the typeahead buffer, or null when the key is not a navigation key.
 */
export function listboxKey(key: string, active: number, options: ListOption[], typed = ''): { index: number; typed: string } | null {
  const enabled = options.flatMap((o, i) => (o.disabled ? [] : [i]));
  if (!enabled.length) return null;
  const first = enabled[0]!;
  const last = enabled.at(-1)!;
  if (key === 'Home') return { index: first, typed: '' };
  if (key === 'End') return { index: last, typed: '' };
  if (key === 'ArrowDown') return { index: enabled.find((i) => i > active) ?? (active < 0 ? first : active), typed: '' };
  if (key === 'ArrowUp') return { index: enabled.findLast((i) => i < active) ?? (active < 0 ? last : active), typed: '' };
  if (key.length !== 1 || key === ' ') return null;
  // typeahead: repeat one letter to cycle, keep typing to match a longer prefix
  const buffer = typed + key.toLowerCase();
  const cycling = [...buffer].every((c) => c === buffer[0]);
  const prefix = cycling ? buffer[0]! : buffer;
  const start = cycling || !typed ? active + 1 : active;
  const order = [...enabled.filter((i) => i >= start), ...enabled.filter((i) => i < start)];
  const hit = order.find((i) => options[i]!.label.toLowerCase().startsWith(prefix));
  return { index: hit ?? active, typed: buffer };
}
