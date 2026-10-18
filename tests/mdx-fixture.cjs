const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {lzo1xCompress}=require('../electron/vendor/lzo1x.cjs');
// Writes a minimal MDict (.mdx) file so the reader is exercised without
// shipping any dictionary content. Layout mirrors the published format:
// header, key section (index + blocks), record section (index + blocks).
function adler32(buffer){
  let a=1,b=0;
  for(const byte of buffer){a=(a+byte)%65521;b=(b+a)%65521;}
  return ((b<<16)|a)>>>0;
}
function block(payload,compression){
  const head=Buffer.alloc(8);
  head.writeUInt32LE(compression,0);
  head.writeUInt32BE(adler32(payload),4);
  if(compression===0)return Buffer.concat([head,payload]);
  if(compression===2)return Buffer.concat([head,zlib.deflateSync(payload)]);
  if(compression===1)return Buffer.concat([head,Buffer.from(lzo1xCompress(payload))]);
  throw Error('unsupported compression');
}
function wide(value,bytes){const out=Buffer.alloc(bytes);if(bytes===8)out.writeBigUInt64BE(BigInt(value));else out.writeUInt32BE(value);return out;}
function mdxFixture({entries,encoding='UTF-8',version='2.0',compression=0,encrypted=0,corruptIndex=false,title='Fixture MDX'}){
  const width=encoding==='UTF-16'?2:1;
  const elements=Object.entries(entries).sort(([a],[b])=>a<b?-1:a>b?1:0);
  const articles=elements.map(([,article])=>Buffer.from(article,encoding==='UTF-16'?'utf16le':'utf8'));
  const record=Buffer.concat(articles);
  const offsets=[];let at=0;
  for(const article of articles){offsets.push(at);at+=article.length;}

  const keyBlock=Buffer.concat(elements.flatMap(([word],index)=>{
    const text=Buffer.from(word,encoding==='UTF-16'?'utf16le':'utf8');
    return [wide(offsets[index],version==='1.2'?4:8),text,Buffer.alloc(width)];
  }));
  const first=Buffer.from(elements[0][0],encoding==='UTF-16'?'utf16le':'utf8');
  const last=Buffer.from(elements.at(-1)[0],encoding==='UTF-16'?'utf16le':'utf8');
  const compressedKey=block(keyBlock,compression),compressedRecord=block(record,compression);

  const indexEntry=Buffer.concat([
    wide(elements.length,version==='1.2'?4:8),
    version==='1.2'?Buffer.from([elements[0][0].length]):(()=>{const b=Buffer.alloc(2);b.writeUInt16BE(elements[0][0].length);return b;})(),
    first,version==='2.0'?Buffer.alloc(width):Buffer.alloc(0),
    version==='1.2'?Buffer.from([elements.at(-1)[0].length]):(()=>{const b=Buffer.alloc(2);b.writeUInt16BE(elements.at(-1)[0].length);return b;})(),
    last,version==='2.0'?Buffer.alloc(width):Buffer.alloc(0),
    wide(compressedKey.length,version==='1.2'?4:8),wide(keyBlock.length,version==='1.2'?4:8),
  ]);
  const keyIndex=version==='1.2'?indexEntry:block(indexEntry,compression);
  // An encrypted index cannot be read without the registration key; corrupting
  // it proves the reader falls back to walking the key blocks themselves.
  if(corruptIndex)for(let i=8;i<keyIndex.length;i++)keyIndex[i]^=0x5a;

  const preamble=Buffer.concat([
    wide(1,version==='1.2'?4:8),wide(elements.length,version==='1.2'?4:8),
    wide(indexEntry.length,version==='1.2'?4:8),
    ...(version==='1.2'?[]:[wide(keyIndex.length,version==='1.2'?4:8)]),
    wide(compressedKey.length,version==='1.2'?4:8),
  ]);
  const checksum=Buffer.alloc(4);checksum.writeUInt32BE(adler32(preamble),0);

  const recordIndex=Buffer.concat([
    wide(compressedRecord.length,version==='1.2'?4:8),wide(record.length,version==='1.2'?4:8),
  ]);
  const recordHeader=Buffer.concat([
    wide(1,version==='1.2'?4:8),wide(elements.length,version==='1.2'?4:8),
    wide(recordIndex.length,version==='1.2'?4:8),wide(compressedRecord.length,version==='1.2'?4:8),
  ]);

  const declaration=`<Dictionary GeneratedByEngineVersion="${version}" RequiredEngineVersion="${version}" Encrypted="${encrypted}" Encoding="${encoding}" Format="Html" KeyCaseSensitive="No" Description="" Title="${title}" DataSourceFormat="106" RegisterBy="" RegCode=""/>\r\n\u0000`;
  const header=Buffer.from('\uFEFF'+declaration,'utf16le');
  const size=Buffer.alloc(4);size.writeUInt32BE(header.length,0);
  const headerChecksum=Buffer.alloc(4);headerChecksum.writeUInt32LE(adler32(header),0);

  return Buffer.concat([
    size,header,headerChecksum,
    preamble,version==='1.2'?Buffer.alloc(0):checksum,
    keyIndex,compressedKey,
    recordHeader,recordIndex,compressedRecord,
  ]);
}
function writeFixture(t,options){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-mdx-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'fixture.mdx');
  fs.writeFileSync(file,mdxFixture(options));
  return file;
}
module.exports={mdxFixture,writeFixture};
