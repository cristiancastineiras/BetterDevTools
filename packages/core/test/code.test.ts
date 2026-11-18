import { describe, expect, it } from 'vitest';
import { detectFormat, formatCode, isMinified, jsonSummary, tokenize, viewModes } from '../src/index.ts';

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');

describe('format detection', () => {
  it.each([
    ['application/json', '{"a":1}', '', 'json'],
    ['application/problem+json', '{}', '', 'json'],
    ['application/json', '{"query":"{ me { id } }"}', '', 'graphql'],
    ['application/javascript', 'let a=1', '', 'javascript'],
    ['text/javascript', 'export interface A { b: string }', '', 'typescript'],
    ['', 'const x = 1', 'https://h/app.ts', 'typescript'],
    ['', 'export const A = () => <div/>', 'https://h/A.tsx', 'jsx'],
    ['text/css', 'a{}', '', 'css'],
    ['text/html', '<p>x</p>', '', 'html'],
    ['image/svg+xml', '<svg/>', '', 'xml'],
    ['application/x-www-form-urlencoded', 'a=1', '', 'form'],
    ['text/plain', '  {"sniffed": true}', '', 'json'],
    ['text/plain', '<?xml version="1.0"?><a/>', '', 'xml'],
    ['', '<!DOCTYPE html><html></html>', '', 'html'],
    ['text/plain', 'hello', '', 'text'],
  ])('%s + %j → %s', (mime, text, url, expected) => {
    expect(detectFormat(mime, { text }, url)).toBe(expected);
  });

  it('detects images and binaries by signature, whatever the MIME says', () => {
    expect(detectFormat('application/octet-stream', { text: b64([0x89, 0x50, 0x4e, 0x47, 13, 10]), encoding: 'base64' })).toBe('image');
    expect(detectFormat('', { text: b64([0x25, 0x50, 0x44, 0x46, 0x2d]), encoding: 'base64' })).toBe('binary');
    expect(detectFormat('application/wasm', { text: b64([0, 0x61, 0x73, 0x6d]), encoding: 'base64' })).toBe('binary');
    expect(detectFormat('text/css', { text: Buffer.from('a{}').toString('base64'), encoding: 'base64' })).toBe('css');
  });
});

describe('view modes', () => {
  it('never offers hex as a main or default mode', () => {
    for (const f of [
      'json',
      'graphql',
      'javascript',
      'typescript',
      'jsx',
      'css',
      'html',
      'xml',
      'form',
      'text',
      'image',
      'binary',
    ] as const) {
      const m = viewModes(f, false);
      expect(m.main, f).not.toContain('hex');
      expect(m.main[0], f).toBe(m.default);
    }
    expect(viewModes('json', false).main).toEqual(['pretty', 'tree', 'raw']);
    expect(viewModes('html', false).main).toEqual(['pretty', 'raw', 'preview']);
    expect(viewModes('xml', true).main).toEqual(['pretty', 'raw', 'preview']);
    expect(viewModes('image', false).main).toEqual(['preview', 'raw']);
    expect(viewModes('binary', false).main).toEqual(['raw']);
    expect(viewModes('text', false).main).toEqual(['raw']);
  });
});

/** Token kinds of `text`, without plain-text runs. */
const kinds = (text: string, lang: Parameters<typeof tokenize>[1]) => tokenize(text, lang).filter(([kind]) => kind !== 'text');

describe('tokenizer', () => {
  it('covers the input exactly', () => {
    const src = 'const a = /x\\/y/g.test("s") // c\nlet b = `t${1}` /* d */ + 0x1f;';
    expect(
      tokenize(src, 'js')
        .map(([, t]) => t)
        .join(''),
    ).toBe(src);
  });

  it('classifies JS keywords, strings, regex, numbers, comments, operators and props', () => {
    expect(kinds('return a.b / 2 + /re/i // x', 'js')).toEqual([
      ['kw', 'return'],
      ['punct', '.'],
      ['prop', 'b'],
      ['op', '/'],
      ['num', '2'],
      ['op', '+'],
      ['str', '/re/i'],
      ['com', '// x'],
    ]);
  });

  it('classifies JSON keys apart from values', () => {
    expect(kinds('{"k": "v", "n": -1.5e3, "t": true}', 'json')).toEqual([
      ['punct', '{'],
      ['prop', '"k"'],
      ['punct', ':'],
      ['str', '"v"'],
      ['punct', ','],
      ['prop', '"n"'],
      ['punct', ':'],
      ['num', '-1.5e3'],
      ['punct', ','],
      ['prop', '"t"'],
      ['punct', ':'],
      ['kw', 'true'],
      ['punct', '}'],
    ]);
  });

  it('separates markup tags, attributes and text', () => {
    expect(kinds('<a href="x">it\'s</a><!-- c -->', 'markup')).toEqual([
      ['tag', '<a'],
      ['attr', 'href'],
      ['punct', '='],
      ['str', '"x"'],
      ['tag', '>'],
      ['tag', '</a'],
      ['tag', '>'],
      ['com', '<!-- c -->'],
    ]);
  });

  it('marks CSS at-rules, properties and colours', () => {
    expect(kinds('@media x{a{color:#fff}}', 'css')).toContainEqual(['prop', 'color']);
    expect(kinds('@media x{a{color:#fff}}', 'css')).toContainEqual(['kw', '@media']);
    expect(kinds('@media x{a{color:#fff}}', 'css')).toContainEqual(['num', '#fff']);
  });
});

describe('formatting', () => {
  it('indents minified JavaScript without touching strings, regex or templates', () => {
    const src = 'function a(b){if(b){return"x;{y}"}else{return/;}/.test(b)}}const c=`p;{q}`;a(1);';
    expect(formatCode(src, 'js')).toBe(
      [
        'function a(b) {',
        '  if(b) {',
        '    return"x;{y}"',
        '  } else {',
        '    return/;}/.test(b)',
        '  }',
        '}',
        'const c=`p;{q}`;',
        'a(1);',
      ].join('\n'),
    );
  });

  it('keeps for(;;) headers on one line and indents CSS', () => {
    expect(formatCode('for(let i=0;i<2;i++){x()}', 'js')).toBe('for(let i=0;i<2;i++) {\n  x()\n}');
    expect(formatCode('a{color:red;margin:0}b{}', 'css')).toBe('a {\n  color:red;\n  margin:0\n}\nb {\n}');
  });

  it('tells minified from formatted code', () => {
    expect(isMinified('x'.repeat(2000))).toBe(true);
    expect(isMinified('const a = 1;\nconst b = 2;\n')).toBe(false);
  });

  it('summarises JSON documents', () => {
    expect(jsonSummary('{"a":1,"b":[1,2]}')).toEqual({ kind: 'object', count: 2 });
    expect(jsonSummary('[1,2,3]')).toEqual({ kind: 'array', count: 3 });
    expect(jsonSummary('nope')).toBeNull();
  });
});
