// cURL command → request → code. The parser knows the options that shape a request; the ones
// that only change how curl prints (-s, -v, -o …) are read and ignored.

export interface CurlRequest {
  method: string;
  url: string;
  headers: [string, string][];
  /** Raw body text (several -d are joined with &). */
  body: string | undefined;
  /** Multipart fields from -F. */
  form: [string, string][];
  basicAuth: { user: string; password: string } | undefined;
  insecure: boolean;
  followRedirects: boolean;
  compressed: boolean;
}

export type CurlResult = { ok: true; request: CurlRequest } | { ok: false; error: string };

const ANSI: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  "'": "'",
  '"': '"',
  a: '\u0007',
  b: '\b',
  e: '\u001b',
  f: '\f',
  v: '\v',
};

/** Splits a shell command line the way bash would (quotes, $'…', backslashes, line continuations). */
export function splitShell(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  const text = command.replace(/\\\r?\n|\^\r?\n/g, ' ');
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      current += text.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? text.length : end;
      started = true;
    } else if (c === '$' && text.charAt(i + 1) === "'") {
      i += 2;
      for (; i < text.length && text.charAt(i) !== "'"; i++) {
        const d = text.charAt(i);
        if (d !== '\\') current += d;
        else {
          const e = text.charAt(++i);
          const hex = /^x([0-9a-f]{2})|^u([0-9a-f]{4})/i.exec(text.slice(i));
          if (hex) {
            current += String.fromCharCode(Number.parseInt(hex[1] ?? hex[2] ?? '0', 16));
            i += hex[0].length - 1;
          } else current += ANSI[e] ?? `\\${e}`;
        }
      }
      started = true;
    } else if (c === '"') {
      for (i++; i < text.length && text.charAt(i) !== '"'; i++) {
        const d = text.charAt(i);
        const next = text.charAt(i + 1);
        if (d === '\\' && '\\"$`'.includes(next)) current += text.charAt(++i);
        else current += d;
      }
      started = true;
    } else if (c === '\\') {
      current += text.charAt(++i);
      started = true;
    } else if (/\s/.test(c)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else if ((c === '|' || c === ';' || (c === '&' && text.charAt(i + 1) === '&')) && !started) {
      break; // the rest is another command
    } else {
      current += c;
      started = true;
    }
  }
  if (started) tokens.push(current);
  return tokens;
}

const WITH_VALUE: Record<string, string> = {
  '-X': 'method',
  '--request': 'method',
  '-H': 'header',
  '--header': 'header',
  '-d': 'data',
  '--data': 'data',
  '--data-ascii': 'data',
  '--data-raw': 'raw',
  '--data-binary': 'raw',
  '--data-urlencode': 'urlencode',
  '-F': 'form',
  '--form': 'form',
  '--form-string': 'form',
  '-u': 'user',
  '--user': 'user',
  '-b': 'cookie',
  '--cookie': 'cookie',
  '-A': 'agent',
  '--user-agent': 'agent',
  '-e': 'referer',
  '--referer': 'referer',
  '--url': 'url',
  '--json': 'json',
};
const IGNORED_WITH_VALUE = new Set([
  '-o',
  '--output',
  '-m',
  '--max-time',
  '--connect-timeout',
  '-x',
  '--proxy',
  '-w',
  '--write-out',
  '-T',
  '--upload-file',
  '--cacert',
  '-E',
  '--cert',
  '--key',
  '-c',
  '--cookie-jar',
  '--retry',
  '-K',
  '--config',
  '--resolve',
  '-y',
  '--speed-time',
  '--limit-rate',
  '--proxy-user',
  '-U',
]);
const FLAG_LETTERS = new Set('LkIsSvifGgN#'.split(''));
const SHORT_WITH_VALUE = new Set('XHdFubAe'.split(''));

function pairOf(text: string): [string, string] {
  const at = text.indexOf(':');
  return at < 0 ? [text.trim(), ''] : [text.slice(0, at).trim(), text.slice(at + 1).trim()];
}

export function parseCurl(command: string): CurlResult {
  const tokens = splitShell(command.trim());
  if (/^curl(\.exe)?$/i.test(tokens[0] ?? '')) tokens.shift();
  const request: CurlRequest = {
    method: '',
    url: '',
    headers: [],
    body: undefined,
    form: [],
    basicAuth: undefined,
    insecure: false,
    followRedirects: false,
    compressed: false,
  };
  const data: string[] = [];
  let head = false;
  let useGet = false;
  const apply = (option: string, value: string) => {
    switch (option) {
      case 'method':
        request.method = value.toUpperCase();
        break;
      case 'header':
        request.headers.push(pairOf(value));
        break;
      case 'data':
        data.push(value.replace(/[\r\n]/g, ''));
        break;
      case 'raw':
        data.push(value);
        break;
      case 'urlencode': {
        const at = value.indexOf('=');
        data.push(at < 0 ? encodeURIComponent(value) : `${at ? `${value.slice(0, at)}=` : ''}${encodeURIComponent(value.slice(at + 1))}`);
        break;
      }
      case 'json':
        data.push(value);
        if (!request.headers.some(([n]) => n.toLowerCase() === 'content-type')) request.headers.push(['Content-Type', 'application/json']);
        if (!request.headers.some(([n]) => n.toLowerCase() === 'accept')) request.headers.push(['Accept', 'application/json']);
        break;
      case 'form': {
        const at = value.indexOf('=');
        request.form.push(at < 0 ? [value, ''] : [value.slice(0, at), value.slice(at + 1)]);
        break;
      }
      case 'user': {
        const at = value.indexOf(':');
        request.basicAuth = { user: at < 0 ? value : value.slice(0, at), password: at < 0 ? '' : value.slice(at + 1) };
        break;
      }
      case 'cookie':
        if (value.includes('=')) request.headers.push(['Cookie', value]);
        break;
      case 'agent':
        request.headers.push(['User-Agent', value]);
        break;
      case 'referer':
        request.headers.push(['Referer', value]);
        break;
      case 'url':
        request.url = value;
        break;
    }
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const long = /^(--[a-z0-9.-]+)=(.*)$/s.exec(token);
    if (long && (WITH_VALUE[long[1]!] || IGNORED_WITH_VALUE.has(long[1]!))) {
      if (WITH_VALUE[long[1]!]) apply(WITH_VALUE[long[1]!]!, long[2]!);
    } else if (WITH_VALUE[token]) apply(WITH_VALUE[token]!, tokens[++i] ?? '');
    else if (IGNORED_WITH_VALUE.has(token)) i++;
    else if (token === '-L' || token === '--location' || token === '--location-trusted') request.followRedirects = true;
    else if (token === '-k' || token === '--insecure') request.insecure = true;
    else if (token === '--compressed') request.compressed = true;
    else if (token === '-I' || token === '--head') head = true;
    else if (token === '-G' || token === '--get') useGet = true;
    else if (/^-[A-Za-z#]{2,}/.test(token) && !token.startsWith('--')) {
      // a cluster such as -sSL, or an option with its value attached such as -XPOST
      const letters = token.slice(1);
      let at = 0;
      for (; at < letters.length && FLAG_LETTERS.has(letters.charAt(at)); at++) {
        const flag = letters.charAt(at);
        if (flag === 'L') request.followRedirects = true;
        else if (flag === 'k') request.insecure = true;
        else if (flag === 'I') head = true;
        else if (flag === 'G') useGet = true;
      }
      if (at < letters.length && SHORT_WITH_VALUE.has(letters.charAt(at))) {
        const rest = letters.slice(at + 1);
        apply(WITH_VALUE[`-${letters.charAt(at)}`]!, rest || (tokens[++i] ?? ''));
      }
    } else if (
      [
        '-s',
        '-S',
        '-v',
        '-i',
        '-f',
        '-g',
        '-N',
        '--silent',
        '--show-error',
        '--verbose',
        '--include',
        '--fail',
        '--globoff',
        '--http1.1',
        '--http2',
        '--http3',
        '--no-buffer',
      ].includes(token)
    ) {
      // output-only options
    } else if (!token.startsWith('-') && !request.url) request.url = token;
  }
  if (!request.url) return { ok: false, error: 'No URL found in the command' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(request.url)) request.url = `http://${request.url}`;
  const body = data.join('&');
  if (useGet && body) {
    request.url += (request.url.includes('?') ? '&' : '?') + body;
  } else if (body) request.body = body;
  request.method = request.method || (head ? 'HEAD' : request.body !== undefined || request.form.length ? 'POST' : 'GET');
  if (request.body !== undefined && !request.headers.some(([n]) => n.toLowerCase() === 'content-type') && !request.form.length) {
    request.headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  }
  return { ok: true, request };
}

// -------------------------------------------------------------------------------------- code

export const CURL_TARGETS = ['fetch', 'axios', 'python', 'csharp', 'java'] as const;
export type CurlTarget = (typeof CURL_TARGETS)[number];

const q = (s: string) => JSON.stringify(s);
const header = (r: CurlRequest, name: string) => r.headers.find(([n]) => n.toLowerCase() === name)?.[1];
const withAuth = (r: CurlRequest): [string, string][] =>
  r.basicAuth
    ? [...r.headers, ['Authorization', `Basic ${btoa(unescape(encodeURIComponent(`${r.basicAuth.user}:${r.basicAuth.password}`)))}`]]
    : r.headers;
const jsonBody = (r: CurlRequest): unknown => {
  if (r.body === undefined || !/json/i.test(header(r, 'content-type') ?? '')) return undefined;
  try {
    const value: unknown = JSON.parse(r.body);
    return typeof value === 'object' && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
};
const indent = (text: string, spaces: number) =>
  text
    .split('\n')
    .map((l, i) => (i ? ' '.repeat(spaces) + l : l))
    .join('\n');
const pyValue = (v: unknown, depth = 0): string => {
  const pad = '    '.repeat(depth + 1);
  const end = '    '.repeat(depth);
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => pad + pyValue(x, depth + 1)).join(',\n')},\n${end}]` : '[]';
  if (typeof v === 'object') {
    const entries = Object.entries(v);
    return entries.length ? `{\n${entries.map(([k, x]) => `${pad}${q(k)}: ${pyValue(x, depth + 1)}`).join(',\n')},\n${end}}` : '{}';
  }
  return typeof v === 'string' ? q(v) : String(v);
};

export function curlToCode(r: CurlRequest, target: CurlTarget): string {
  const headers = withAuth(r);
  const json = jsonBody(r);
  const isForm = r.form.length > 0;
  const headerLines = (pad: string, shape: (n: string, v: string) => string, list = headers) =>
    list.map(([n, v]) => `${pad}${shape(n, v)}`).join('\n');
  switch (target) {
    case 'fetch': {
      const list = isForm ? headers.filter(([n]) => n.toLowerCase() !== 'content-type') : headers;
      const options = [`  method: ${q(r.method)},`];
      if (list.length) options.push(`  headers: {\n${headerLines('    ', (n, v) => `${q(n)}: ${q(v)},`, list)}\n  },`);
      if (isForm) options.push('  body: form,');
      else if (json !== undefined) options.push(`  body: JSON.stringify(${indent(JSON.stringify(json, null, 2), 2)}),`);
      else if (r.body !== undefined) options.push(`  body: ${q(r.body)},`);
      const form = isForm ? `const form = new FormData();\n${r.form.map(([n, v]) => `form.append(${q(n)}, ${q(v)});`).join('\n')}\n\n` : '';
      return `${form}const response = await fetch(${q(r.url)}, {\n${options.join('\n')}\n});\nconsole.log(await response.text());`;
    }
    case 'axios': {
      const list = isForm ? headers.filter(([n]) => n.toLowerCase() !== 'content-type') : headers;
      const options = [`  method: ${q(r.method.toLowerCase())},`, `  url: ${q(r.url)},`];
      if (list.length) options.push(`  headers: {\n${headerLines('    ', (n, v) => `${q(n)}: ${q(v)},`, list)}\n  },`);
      if (isForm) options.push('  data: form,');
      else if (json !== undefined) options.push(`  data: ${indent(JSON.stringify(json, null, 2), 2)},`);
      else if (r.body !== undefined) options.push(`  data: ${q(r.body)},`);
      if (r.followRedirects === false) options.push('  maxRedirects: 0,');
      const form = isForm ? `const form = new FormData();\n${r.form.map(([n, v]) => `form.append(${q(n)}, ${q(v)});`).join('\n')}\n\n` : '';
      return `import axios from "axios";\n\n${form}const response = await axios({\n${options.join('\n')}\n});\nconsole.log(response.data);`;
    }
    case 'python': {
      const args = [`    ${q(r.method)},`, `    ${q(r.url)},`];
      const list = r.basicAuth ? r.headers : headers;
      const clean = isForm ? list.filter(([n]) => n.toLowerCase() !== 'content-type') : list;
      if (clean.length) args.push(`    headers={\n${headerLines('        ', (n, v) => `${q(n)}: ${q(v)},`, clean)}\n    },`);
      if (isForm) args.push(`    files={\n${r.form.map(([n, v]) => `        ${q(n)}: (None, ${q(v)}),`).join('\n')}\n    },`);
      else if (json !== undefined) args.push(`    json=${pyValue(json, 1)},`);
      else if (r.body !== undefined) args.push(`    data=${q(r.body)},`);
      if (r.basicAuth) args.push(`    auth=(${q(r.basicAuth.user)}, ${q(r.basicAuth.password)}),`);
      args.push(`    allow_redirects=${r.followRedirects ? 'True' : 'False'},`);
      if (r.insecure) args.push('    verify=False,');
      return `import requests\n\nresponse = requests.request(\n${args.join('\n')}\n)\nprint(response.text)`;
    }
    case 'csharp': {
      const contentType = header(r, 'content-type');
      const lines = [
        'using System.Net.Http;',
        'using System.Text;',
        '',
        'using var client = new HttpClient();',
        `var request = new HttpRequestMessage(${/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE)$/.test(r.method) ? `HttpMethod.${r.method.charAt(0)}${r.method.slice(1).toLowerCase()}` : `new HttpMethod(${q(r.method)})`}, ${q(r.url)});`,
      ];
      for (const [n, v] of headers)
        if (!/^content-(type|length)$/i.test(n)) lines.push(`request.Headers.TryAddWithoutValidation(${q(n)}, ${q(v)});`);
      if (isForm) {
        lines.push(
          'var content = new MultipartFormDataContent();',
          ...r.form.map(([n, v]) => `content.Add(new StringContent(${q(v)}), ${q(n)});`),
          'request.Content = content;',
        );
      } else if (r.body !== undefined) {
        const media = (contentType ?? 'text/plain').split(';')[0]!.trim();
        lines.push(`request.Content = new StringContent(${q(r.body)}, Encoding.UTF8, ${q(media)});`);
      }
      lines.push('var response = await client.SendAsync(request);', 'Console.WriteLine(await response.Content.ReadAsStringAsync());');
      return lines.join('\n');
    }
    case 'java': {
      const skipped = new Set(['host', 'content-length', 'connection', 'expect', 'upgrade']);
      const lines = [
        'import java.net.URI;',
        'import java.net.http.HttpClient;',
        'import java.net.http.HttpRequest;',
        'import java.net.http.HttpResponse;',
        '',
        'HttpClient client = HttpClient.newHttpClient();',
        'HttpRequest request = HttpRequest.newBuilder()',
        `    .uri(URI.create(${q(r.url)}))`,
      ];
      for (const [n, v] of headers) if (!skipped.has(n.toLowerCase())) lines.push(`    .header(${q(n)}, ${q(v)})`);
      const publisher = isForm
        ? 'HttpRequest.BodyPublishers.noBody() /* multipart bodies need a hand-built publisher */'
        : r.body !== undefined
          ? `HttpRequest.BodyPublishers.ofString(${q(r.body)})`
          : 'HttpRequest.BodyPublishers.noBody()';
      lines.push(
        `    .method(${q(r.method)}, ${publisher})`,
        '    .build();',
        'HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());',
        'System.out.println(response.body());',
      );
      return lines.join('\n');
    }
  }
}
