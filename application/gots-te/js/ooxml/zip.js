/**
 * Minimal ZIP reader/writer for OOXML packages. No dependencies.
 *
 * The point of this module is FIDELITY, not generality:
 * entries the caller does not replace are carried over as their ORIGINAL COMPRESSED BYTES,
 * so they come out of the writer bit-identical to the master. Only a replaced entry is
 * re-compressed.
 *
 * Deliberately unsupported (the master uses none of them; each throws rather than guessing):
 * ZIP64, encryption, data descriptors, compression methods other than STORE/DEFLATE.
 *
 * Works in the browser and in Node 24 via native Compression/DecompressionStream.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;

/* ---------------- CRC-32 ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------------- deflate helpers ---------------- */

async function streamThrough(bytes, stream) {
  const out = await new Response(
    new Blob([bytes]).stream().pipeThrough(stream)
  ).arrayBuffer();
  return new Uint8Array(out);
}

export const inflateRaw = (bytes) => streamThrough(bytes, new DecompressionStream('deflate-raw'));
export const deflateRaw = (bytes) => streamThrough(bytes, new CompressionStream('deflate-raw'));

/* ---------------- reading ---------------- */

function findEOCD(view, len) {
  const max = Math.min(len, 0xffff + 22);
  for (let i = 22; i <= max; i++) {
    const p = len - i;
    if (view.getUint32(p, true) === SIG_EOCD) return p;
  }
  throw new Error('ZIP: end-of-central-directory record not found');
}

/**
 * @returns {{entries: Array<{name:string, method:number, crc:number,
 *   compressedSize:number, uncompressedSize:number, raw:Uint8Array,
 *   flags:number, modTime:number, modDate:number, versionMadeBy:number,
 *   versionNeeded:number, internalAttrs:number, externalAttrs:number,
 *   extraCentral:Uint8Array, comment:Uint8Array}>}}
 */
export function readZip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEOCD(view, bytes.length);

  if (bytes.length > 20) {
    // ZIP64 locator sits immediately before the EOCD when present
    for (let p = Math.max(0, eocd - 20); p < eocd; p++) {
      if (view.getUint32(p, true) === SIG_ZIP64_EOCD) throw new Error('ZIP: ZIP64 is not supported');
    }
  }

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) throw new Error('ZIP: bad central directory record');
    const versionMadeBy = view.getUint16(p + 4, true);
    const versionNeeded = view.getUint16(p + 6, true);
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const modTime = view.getUint16(p + 12, true);
    const modDate = view.getUint16(p + 14, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const internalAttrs = view.getUint16(p + 36, true);
    const externalAttrs = view.getUint32(p + 38, true);
    const localOffset = view.getUint32(p + 42, true);

    if (flags & 0x0001) throw new Error('ZIP: encrypted entries are not supported');
    if (flags & 0x0008) throw new Error('ZIP: data descriptors are not supported');
    if (method !== 0 && method !== 8) throw new Error(`ZIP: unsupported compression method ${method}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff)
      throw new Error('ZIP: ZIP64 sizes are not supported');

    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const extraCentral = bytes.slice(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    const comment = bytes.slice(p + 46 + nameLen + extraLen, p + 46 + nameLen + extraLen + commentLen);

    // local header: recompute payload start (its extra field may differ from the central one)
    if (view.getUint32(localOffset, true) !== SIG_LOCAL) throw new Error(`ZIP: bad local header for ${name}`);
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;

    entries.push({
      name, method, crc, compressedSize, uncompressedSize,
      raw: bytes.slice(dataStart, dataStart + compressedSize),
      flags, modTime, modDate, versionMadeBy, versionNeeded,
      internalAttrs, externalAttrs, extraCentral, comment,
    });

    p += 46 + nameLen + extraLen + commentLen;
  }

  return { entries };
}

/** Inflate one entry to a UTF-8 string. */
export async function entryText(entry) {
  const bytes = entry.method === 0 ? entry.raw : await inflateRaw(entry.raw);
  return new TextDecoder('utf-8').decode(bytes);
}

/* ---------------- writing ---------------- */

/**
 * Rebuild a ZIP from entries, preserving order and per-entry metadata.
 * Entries carrying `replacement` (a Uint8Array of UNCOMPRESSED bytes) are re-deflated;
 * all others reuse their original compressed bytes verbatim.
 */
export async function writeZip(entries) {
  const prepared = [];

  for (const e of entries) {
    if (e.replacement) {
      const uncompressed = e.replacement;
      const deflated = await deflateRaw(uncompressed);
      // only accept deflate if it actually helps, mirroring normal ZIP behaviour
      const useStore = deflated.length >= uncompressed.length;
      prepared.push({
        ...e,
        method: useStore ? 0 : 8,
        crc: crc32(uncompressed),
        compressedSize: useStore ? uncompressed.length : deflated.length,
        uncompressedSize: uncompressed.length,
        raw: useStore ? uncompressed : deflated,
      });
    } else {
      prepared.push(e);
    }
  }

  const enc = new TextEncoder();
  const nameBytes = prepared.map((e) => enc.encode(e.name));

  let localSize = 0;
  prepared.forEach((e, i) => { localSize += 30 + nameBytes[i].length + e.raw.length; });
  let centralSize = 0;
  prepared.forEach((e, i) => { centralSize += 46 + nameBytes[i].length + e.extraCentral.length + e.comment.length; });

  const out = new Uint8Array(localSize + centralSize + 22);
  const dv = new DataView(out.buffer);
  let off = 0;
  const offsets = [];

  prepared.forEach((e, i) => {
    offsets.push(off);
    dv.setUint32(off, SIG_LOCAL, true);
    dv.setUint16(off + 4, e.versionNeeded, true);
    dv.setUint16(off + 6, e.flags, true);
    dv.setUint16(off + 8, e.method, true);
    dv.setUint16(off + 10, e.modTime, true);
    dv.setUint16(off + 12, e.modDate, true);
    dv.setUint32(off + 14, e.crc, true);
    dv.setUint32(off + 18, e.compressedSize, true);
    dv.setUint32(off + 22, e.uncompressedSize, true);
    dv.setUint16(off + 26, nameBytes[i].length, true);
    dv.setUint16(off + 28, 0, true);          // local extra dropped: not semantically meaningful
    out.set(nameBytes[i], off + 30);
    out.set(e.raw, off + 30 + nameBytes[i].length);
    off += 30 + nameBytes[i].length + e.raw.length;
  });

  const centralStart = off;
  prepared.forEach((e, i) => {
    dv.setUint32(off, SIG_CENTRAL, true);
    dv.setUint16(off + 4, e.versionMadeBy, true);
    dv.setUint16(off + 6, e.versionNeeded, true);
    dv.setUint16(off + 8, e.flags, true);
    dv.setUint16(off + 10, e.method, true);
    dv.setUint16(off + 12, e.modTime, true);
    dv.setUint16(off + 14, e.modDate, true);
    dv.setUint32(off + 16, e.crc, true);
    dv.setUint32(off + 20, e.compressedSize, true);
    dv.setUint32(off + 24, e.uncompressedSize, true);
    dv.setUint16(off + 28, nameBytes[i].length, true);
    dv.setUint16(off + 30, e.extraCentral.length, true);
    dv.setUint16(off + 32, e.comment.length, true);
    dv.setUint16(off + 34, 0, true);          // disk number
    dv.setUint16(off + 36, e.internalAttrs, true);
    dv.setUint32(off + 38, e.externalAttrs, true);
    dv.setUint32(off + 42, offsets[i], true);
    out.set(nameBytes[i], off + 46);
    out.set(e.extraCentral, off + 46 + nameBytes[i].length);
    out.set(e.comment, off + 46 + nameBytes[i].length + e.extraCentral.length);
    off += 46 + nameBytes[i].length + e.extraCentral.length + e.comment.length;
  });

  dv.setUint32(off, SIG_EOCD, true);
  dv.setUint16(off + 4, 0, true);
  dv.setUint16(off + 6, 0, true);
  dv.setUint16(off + 8, prepared.length, true);
  dv.setUint16(off + 10, prepared.length, true);
  dv.setUint32(off + 12, centralSize, true);
  dv.setUint32(off + 16, centralStart, true);
  dv.setUint16(off + 20, 0, true);

  return out;
}

/** SHA-256 hex of a byte array, via WebCrypto (present in browser and Node 24). */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
