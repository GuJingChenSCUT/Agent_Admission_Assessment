// Validate structural limits and duplicate keys before JSON.parse loses information.
export function parseStrictJson(bytes, maxDepth = 32, { maxBytes = 1024 * 1024, maxStringLength = 65536 } = {}) {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (Buffer.byteLength(text) > maxBytes) throw new Error('JSON_TOO_LARGE');
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] || '') && i < text.length) i++; };
  function str() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') { const value = JSON.parse(text.slice(start, i)); if (value.length > maxStringLength || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('INVALID_JSON_STRING'); return value; }
    }
    throw new Error('INVALID_JSON');
  }
  function value(depth) {
    if (depth > maxDepth) throw new Error('JSON_TOO_DEEP'); ws();
    if (text[i] === '"') { str(); return; }
    if (text[i] === '{' || text[i] === '[') {
      const object = text[i++] === '{', end = object ? '}' : ']', keys = new Set(); ws();
      if (text[i] === end) { i++; return; }
      while (i < text.length) {
        ws(); if (object) {
          if (text[i] !== '"') throw new Error('INVALID_JSON'); const key = str();
          if (keys.has(key)) throw new Error('DUPLICATE_JSON_KEY'); keys.add(key); ws();
          if (text[i++] !== ':') throw new Error('INVALID_JSON');
        }
        value(depth + 1); ws(); if (text[i] === end) { i++; return; }
        if (text[i++] !== ',') throw new Error('INVALID_JSON');
      }
      throw new Error('INVALID_JSON');
    }
    const token = text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!token) throw new Error('INVALID_JSON');
    if (/^-?\d/.test(token) && !Number.isFinite(Number(token))) throw new Error('NON_FINITE_JSON_NUMBER');
    i += token.length;
  }
  value(0); ws(); if (i !== text.length) throw new Error('INVALID_JSON');
  return JSON.parse(text);
}
