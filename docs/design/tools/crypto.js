(function (root) {
  'use strict';
  const mask = (1n << 64n) - 1n;
  const rotation = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
  const constants = [0x1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,
    0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,
    0x8000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,
    0x8000000000008002n,0x8000000000000080n,0x800an,0x800000008000000an,
    0x8000000080008081n,0x8000000000008080n,0x80000001n,0x8000000080008008n];
  const rol = (v, n) => n ? ((v << BigInt(n)) | (v >> BigInt(64 - n))) & mask : v;
  function permute(a) {
    for (const rc of constants) {
      const c = Array(5).fill(0n), d = [], b = Array(25).fill(0n);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) c[x] ^= a[x + 5*y];
      for (let x = 0; x < 5; x++) d[x] = c[(x+4)%5] ^ rol(c[(x+1)%5], 1);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        const i = x + 5*y;
        b[y + 5*((2*x + 3*y)%5)] = rol(a[i] ^ d[x], rotation[i]);
      }
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
        a[x+5*y] = (b[x+5*y] ^ ((~b[(x+1)%5+5*y]) & b[(x+2)%5+5*y])) & mask;
      a[0] ^= rc;
    }
  }
  function keccak256(text) {
    const input = new TextEncoder().encode(text), rate = 136;
    const data = new Uint8Array(rate * Math.ceil((input.length + 1) / rate));
    data.set(input); data[input.length] ^= 1; data[data.length-1] ^= 128;
    const a = Array(25).fill(0n);
    for (let offset = 0; offset < data.length; offset += rate) {
      for (let i = 0; i < rate; i++) a[i >> 3] ^= BigInt(data[offset+i]) << BigInt((i%8)*8);
      permute(a);
    }
    let hex = '0x';
    for (let i = 0; i < 32; i++) hex += Number((a[i>>3] >> BigInt((i%8)*8)) & 255n).toString(16).padStart(2,'0');
    return hex;
  }
  function validUnicode(s) {
    for (let i = 0; i < s.length; i++) {
      const n = s.charCodeAt(i);
      if (n >= 0xd800 && n <= 0xdbff) {
        const next = s.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Lone Unicode surrogate');
      } else if (n >= 0xdc00 && n <= 0xdfff) throw new Error('Lone Unicode surrogate');
    }
  }
  function canonicalize(value, visited = new Set()) {
    if (value === null) return 'null';
    if (typeof value === 'string') { validUnicode(value); return JSON.stringify(value); }
    if (typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Non-finite number');
      return JSON.stringify(value);
    }
    if (typeof value !== 'object') throw new Error('Unsupported JSON value');
    if (visited.has(value)) throw new Error('Circular value');
    visited.add(value);
    let result;
    if (Array.isArray(value)) result = '[' + value.map(v => canonicalize(v, visited)).join(',') + ']';
    else {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Non-JSON object');
      result = '{' + Object.keys(value).sort().map(k => {
        validUnicode(k); return JSON.stringify(k) + ':' + canonicalize(value[k], visited);
      }).join(',') + '}';
    }
    visited.delete(value); return result;
  }
  function validateProfile(value) {
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))))
      throw new Error('Contract numbers must be finite; integers must be safe. Store chain quantities as strings.');
    if (value && typeof value === 'object') for (const v of Object.values(value)) validateProfile(v);
  }
  function hashObject(value) { validateProfile(value); return keccak256(canonicalize(value)); }
  const api = Object.freeze({keccak256,canonicalize,hashObject,validateProfile});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DesignCrypto = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
