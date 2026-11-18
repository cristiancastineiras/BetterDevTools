export interface DiffLine {
  op: '=' | '+' | '-';
  text: string;
}

/**
 * Line diff (LCS). The common prefix and suffix are trimmed first, so typical bodies are cheap;
 * returns null when the differing middle exceeds `maxCells` (memory guard, 4M cells ≈ 16 MB).
 */
export function diffLines(a: string, b: string, maxCells = 4_000_000): DiffLine[] | null {
  const x = a.split('\n');
  const y = b.split('\n');
  let s = 0;
  while (s < x.length && s < y.length && x[s] === y[s]) s++;
  let e = 0;
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
  const xm = x.slice(s, x.length - e);
  const ym = y.slice(s, y.length - e);
  const n = xm.length;
  const m = ym.length;
  if (n * m > maxCells) return null;

  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = xm[i] === ym[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }

  const out: DiffLine[] = x.slice(0, s).map((text) => ({ op: '=', text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (xm[i] === ym[j]) {
      out.push({ op: '=', text: xm[i++]! });
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) out.push({ op: '-', text: xm[i++]! });
    else out.push({ op: '+', text: ym[j++]! });
  }
  while (i < n) out.push({ op: '-', text: xm[i++]! });
  while (j < m) out.push({ op: '+', text: ym[j++]! });
  for (const text of x.slice(x.length - e)) out.push({ op: '=', text });
  return out;
}
