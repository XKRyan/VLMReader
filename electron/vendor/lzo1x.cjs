'use strict';

// src/compress.ts
var M1_MAX_OFFSET = 1024;
var M2_MAX_OFFSET = 2048;
var M3_MAX_OFFSET = 16384;
var M4_MAX_OFFSET = 49151;
var M2_MAX_LEN = 8;
var M3_MAX_LEN = 33;
var M4_MAX_LEN = 9;
var M3_MARKER = 32;
var M4_MARKER = 16;
var HASH_BITS = 13;
var HASH_SIZE = 1 << HASH_BITS;
var HASH_MASK = HASH_SIZE - 1;
function hash3(b, p) {
  const v = b[p] | b[p + 1] << 8 | b[p + 2] << 16;
  return Math.imul(v, 506832829) >>> 32 - HASH_BITS & HASH_MASK;
}
function lzo1xCompress(input) {
  const inLen = input.length;
  const outCap = inLen + (inLen + 15 >>> 4) + 67 + 16;
  const out = new Uint8Array(outCap);
  let op = 0;
  let litStart = 0;
  let ip = 0;
  const ht = new Int32Array(HASH_SIZE).fill(-1);
  const TRAIL_GUARD = 20;
  const scanEnd = inLen - TRAIL_GUARD;
  const emitLiteralRun = (len, firstFrame2) => {
    if (firstFrame2 && len !== 0 && len <= 238) {
      out[op++] = 17 + len;
    } else if (len <= 3) {
      out[op - 2] = (out[op - 2] | len) & 255;
    } else if (len <= 18) {
      out[op++] = len - 3;
    } else {
      out[op++] = 0;
      let rem = len - 18;
      while (rem > 255) {
        out[op++] = 0;
        rem -= 255;
      }
      out[op++] = rem;
    }
    for (let i = 0; i < len; i++) out[op++] = input[litStart + i];
  };
  const emitMatch = (matchLen, matchOff, litLen) => {
    if (matchLen === 2) {
      const off = matchOff - 1;
      out[op++] = (off & 3) << 2 & 255;
      out[op++] = off >>> 2 & 255;
    } else if (matchLen <= M2_MAX_LEN && matchOff <= M2_MAX_OFFSET) {
      const off = matchOff - 1;
      out[op++] = (matchLen - 1 << 5 | (off & 7) << 2) & 255;
      out[op++] = off >>> 3 & 255;
    } else if (matchLen === 3 && matchOff <= M1_MAX_OFFSET + M2_MAX_OFFSET && litLen >= 4) {
      const off = matchOff - 1 - M2_MAX_OFFSET;
      out[op++] = (off & 3) << 2 & 255;
      out[op++] = off >>> 2 & 255;
    } else if (matchOff <= M3_MAX_OFFSET) {
      const off = matchOff - 1;
      if (matchLen <= M3_MAX_LEN) {
        out[op++] = (M3_MARKER | matchLen - 2) & 255;
      } else {
        out[op++] = M3_MARKER;
        let rem = matchLen - M3_MAX_LEN;
        while (rem > 255) {
          out[op++] = 0;
          rem -= 255;
        }
        out[op++] = rem;
      }
      out[op++] = off << 2 & 255;
      out[op++] = off >>> 6 & 255;
    } else {
      const off = matchOff - 16384;
      if (matchLen <= M4_MAX_LEN) {
        out[op++] = (M4_MARKER | (off & 16384) >>> 11 | matchLen - 2) & 255;
      } else {
        out[op++] = (M4_MARKER | (off & 16384) >>> 11) & 255;
        let rem = matchLen - M4_MAX_LEN;
        while (rem > 255) {
          out[op++] = 0;
          rem -= 255;
        }
        out[op++] = rem;
      }
      out[op++] = off << 2 & 255;
      out[op++] = off >>> 6 & 255;
    }
  };
  let firstFrame = true;
  while (ip < scanEnd) {
    if (ip + 3 > inLen) break;
    const h = hash3(input, ip);
    const ref = ht[h];
    ht[h] = ip;
    let matchLen = 0;
    let matchOff = 0;
    if (ref >= 0 && ip - ref <= M4_MAX_OFFSET && ip - ref > 0 && input[ref] === input[ip] && input[ref + 1] === input[ip + 1] && input[ref + 2] === input[ip + 2]) {
      const maxLen = Math.min(scanEnd - ip, inLen - ref);
      let n = 3;
      while (n < maxLen && input[ref + n] === input[ip + n]) n++;
      matchLen = n;
      matchOff = ip - ref;
    }
    if (matchLen > 0) {
      const litLen2 = ip - litStart;
      const validM1 = matchLen === 2 && matchOff <= M1_MAX_OFFSET && litLen2 >= 4 && !firstFrame;
      const validM2 = matchLen >= 3 && matchLen <= M2_MAX_LEN && matchOff <= M2_MAX_OFFSET;
      const validM1Long = matchLen === 3 && matchOff > M2_MAX_OFFSET && matchOff <= M1_MAX_OFFSET + M2_MAX_OFFSET && litLen2 >= 4;
      const validM3 = matchLen >= 3 && matchOff <= M3_MAX_OFFSET;
      const validM4 = matchLen >= 3 && matchOff <= M4_MAX_OFFSET;
      if (!(validM1 || validM2 || validM1Long || validM3 || validM4)) {
        matchLen = 0;
      }
    }
    if (matchLen === 0) {
      ip++;
      continue;
    }
    const litLen = ip - litStart;
    emitLiteralRun(litLen, firstFrame && op === 0);
    firstFrame = false;
    emitMatch(matchLen, matchOff, litLen);
    ip += matchLen;
    litStart = ip;
  }
  const finalLitLen = inLen - litStart;
  emitLiteralRun(finalLitLen, firstFrame && op === 0);
  out[op++] = M4_MARKER | 1;
  out[op++] = 0;
  out[op++] = 0;
  return out.slice(0, op);
}

// src/decompress.ts
var ERR_OVERRUN = "lzo1x: unexpected end of input";
var ERR_LOOKBEHIND = "lzo1x: invalid lookbehind reference";
var ERR_TRAILING = "lzo1x: trailing bytes after end-of-stream marker";
var ERR_NO_EOS = "lzo1x: missing end-of-stream marker";
var ERR_LENGTH = "lzo1x: decompressed length does not match expectedOutputLength";
function lzo1xDecompress(input, expectedOutputLength) {
  const inEnd = input.length;
  if (inEnd < 3) throw new RangeError(ERR_OVERRUN);
  const presized = expectedOutputLength !== void 0;
  let out = presized ? new Uint8Array(expectedOutputLength) : new Uint8Array(Math.max(64, input.length * 2));
  let op = 0;
  const ensure = (need) => {
    if (presized) {
      if (op + need > out.length) throw new RangeError(ERR_LENGTH);
      return;
    }
    if (op + need <= out.length) return;
    let cap = out.length;
    while (cap < op + need) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(out.subarray(0, op));
    out = grown;
  };
  let ip = 0;
  let state = 0;
  let nstate = 0;
  let matchLen = 0;
  let matchSrc = 0;
  const first = input[ip];
  if (first >= 22) {
    const len = first - 17;
    ip++;
    if (ip + len > inEnd) throw new RangeError(ERR_OVERRUN);
    ensure(len);
    for (let i = 0; i < len; i++) out[op++] = input[ip++];
    state = 4;
  } else if (first >= 18) {
    const len = first - 17;
    ip++;
    if (ip + len > inEnd) throw new RangeError(ERR_OVERRUN);
    ensure(len);
    for (let i = 0; i < len; i++) out[op++] = input[ip++];
    state = len;
    nstate = len;
  }
  let sawEos = false;
  const readLengthLadder = () => {
    let extra = 0;
    while (ip < inEnd && input[ip] === 0) {
      extra += 255;
      ip++;
      if (extra > 262144) throw new RangeError(ERR_OVERRUN);
    }
    if (ip >= inEnd) throw new RangeError(ERR_OVERRUN);
    extra += input[ip++];
    return extra;
  };
  mainLoop: while (true) {
    if (ip >= inEnd) throw new RangeError(ERR_OVERRUN);
    const inst = input[ip++];
    if (inst & 192) {
      if (ip >= inEnd) throw new RangeError(ERR_OVERRUN);
      const h = input[ip++];
      matchSrc = op - ((h << 3) + (inst >> 2 & 7) + 1);
      matchLen = (inst >> 5) + 1;
      nstate = inst & 3;
    } else if (inst & 32) {
      matchLen = (inst & 31) + 2;
      if (matchLen === 2) {
        const extra = readLengthLadder();
        matchLen += extra + 31;
      }
      if (ip + 2 > inEnd) throw new RangeError(ERR_OVERRUN);
      const lo = input[ip++];
      const hi = input[ip++];
      const word = lo | hi << 8;
      matchSrc = op - ((word >>> 2) + 1);
      nstate = word & 3;
    } else if (inst & 16) {
      matchLen = (inst & 7) + 2;
      if (matchLen === 2) {
        const extra = readLengthLadder();
        matchLen += extra + 7;
      }
      if (ip + 2 > inEnd) throw new RangeError(ERR_OVERRUN);
      const lo = input[ip++];
      const hi = input[ip++];
      const word = lo | hi << 8;
      const distBase = ((inst & 8) << 11) + (word >>> 2);
      nstate = word & 3;
      if (distBase === 0) {
        sawEos = true;
        break mainLoop;
      }
      matchSrc = op - distBase - 16384;
    } else {
      if (state === 0) {
        let len = inst + 3;
        if (len === 3) {
          const extra = readLengthLadder();
          len += extra + 15;
        }
        if (ip + len > inEnd) throw new RangeError(ERR_OVERRUN);
        ensure(len);
        for (let i = 0; i < len; i++) out[op++] = input[ip++];
        state = 4;
        continue;
      } else if (state !== 4) {
        if (ip >= inEnd) throw new RangeError(ERR_OVERRUN);
        nstate = inst & 3;
        matchSrc = op - ((inst >> 2) + (input[ip++] << 2) + 1);
        matchLen = 2;
      } else {
        if (ip >= inEnd) throw new RangeError(ERR_OVERRUN);
        nstate = inst & 3;
        matchSrc = op - ((inst >> 2) + (input[ip++] << 2) + 2049);
        matchLen = 3;
      }
    }
    if (matchSrc < 0) throw new RangeError(ERR_LOOKBEHIND);
    ensure(matchLen + nstate);
    for (let i = 0; i < matchLen; i++) out[op++] = out[matchSrc++];
    state = nstate;
    if (nstate > 0) {
      if (ip + nstate > inEnd) throw new RangeError(ERR_OVERRUN);
      for (let i = 0; i < nstate; i++) out[op++] = input[ip++];
    }
  }
  if (!sawEos) throw new RangeError(ERR_NO_EOS);
  if (matchLen !== 3) throw new RangeError(ERR_NO_EOS);
  if (ip !== inEnd) throw new RangeError(ERR_TRAILING);
  if (presized) {
    if (op !== expectedOutputLength) throw new RangeError(ERR_LENGTH);
    return out;
  }
  return op === out.length ? out : out.slice(0, op);
}

exports.lzo1xCompress = lzo1xCompress;
exports.lzo1xDecompress = lzo1xDecompress;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map