// Test-only ZIP writer (deflate + stored). Mirrors what a real archiver emits so
// netlify/functions/_zip.js is exercised against genuine archive bytes.
import zlib from 'node:zlib';

function crc32(buf){
  const t = new Int32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c; }
  let c = 0 ^ (-1);
  for(let i=0;i<buf.length;i++) c=(c>>>8)^t[(c^buf[i])&0xFF];
  return (c^(-1))>>>0;
}

/** entries: [{path, data:Buffer, store?:bool}] -> Buffer */
export function makeZip(entries, opts={}){
  const locals=[], centrals=[]; let offset=0;
  for(const e of entries){
    const name = Buffer.from(e.path,'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data),'utf8');
    const store = !!e.store;
    const comp = store ? data : zlib.deflateRawSync(data, {level:9});
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50,0); lh.writeUInt16LE(20,4); lh.writeUInt16LE(0,6);
    lh.writeUInt16LE(store?0:8,8); lh.writeUInt16LE(0,10); lh.writeUInt16LE(0,12);
    lh.writeUInt32LE(crc,14); lh.writeUInt32LE(comp.length,18); lh.writeUInt32LE(data.length,22);
    lh.writeUInt16LE(name.length,26); lh.writeUInt16LE(0,28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50,0); ch.writeUInt16LE(20,4); ch.writeUInt16LE(20,6); ch.writeUInt16LE(0,8);
    ch.writeUInt16LE(store?0:8,10); ch.writeUInt16LE(0,12); ch.writeUInt16LE(0,14);
    ch.writeUInt32LE(crc,16); ch.writeUInt32LE(comp.length,20); ch.writeUInt32LE(data.length,24);
    ch.writeUInt16LE(name.length,28); ch.writeUInt16LE(0,30); ch.writeUInt16LE(0,32);
    ch.writeUInt16LE(0,34); ch.writeUInt16LE(0,36); ch.writeUInt32LE(0,38); ch.writeUInt32LE(offset,42);
    centrals.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const localBuf = Buffer.concat(locals);
  const cenBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(0,4); eocd.writeUInt16LE(0,6);
  eocd.writeUInt16LE(entries.length,8); eocd.writeUInt16LE(entries.length,10);
  eocd.writeUInt32LE(cenBuf.length,12); eocd.writeUInt32LE(localBuf.length,16); eocd.writeUInt16LE(0,20);
  const parts = [localBuf, cenBuf, eocd];
  if(opts.comment) parts.push(Buffer.from(opts.comment,'utf8')) && eocd.writeUInt16LE(Buffer.byteLength(opts.comment),20);
  return Buffer.concat(parts);
}

/** Zip a directory tree from disk. */
export async function zipDir(dir, prefix=''){
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const entries=[];
  async function walk(d, rel){
    for(const it of (await fs.readdir(d,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const full = path.join(d,it.name); const r = rel ? rel+'/'+it.name : it.name;
      if(it.isDirectory()) await walk(full, r);
      else entries.push({ path: prefix ? prefix+'/'+r : r, data: await fs.readFile(full) });
    }
  }
  await walk(dir,'');
  return makeZip(entries);
}
