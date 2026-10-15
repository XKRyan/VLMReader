// A tiny original dictionary for format and safety tests; no third-party corpus.
function vint(value){const bytes=[(value&127)|128];while(value=Math.floor(value/128))bytes.unshift(value&127);return Buffer.from(bytes);}
function mobiFixture(entries=[{word:'scramble',html:'<h2>scramble</h2><div>To move hurriedly.</div>'}],compression=1){
  const text=Buffer.from(entries.map(row=>row.html).join(''),'utf8'),header=Buffer.alloc(300);
  header.writeUInt16BE(compression);header.writeUInt32BE(text.length,4);header.writeUInt16BE(1,8);header.writeUInt16BE(4096,10);
  header.write('MOBI',16);header.writeUInt32BE(232,20);header.writeUInt32BE(65001,28);header.writeUInt32BE(7,36);header.writeUInt32BE(2,40);
  header.writeUInt32BE(260,84);header.writeUInt32BE(17,88);header.write('Sample Dictionary',260);
  const meta=Buffer.alloc(216);meta.write('INDX');meta.writeUInt32BE(192,4);meta.writeUInt32BE(1,24);meta.writeUInt32BE(65001,28);meta.writeUInt32BE(entries.length,36);
  meta.write('TAGX',192);meta.writeUInt32BE(24,196);meta.writeUInt32BE(1,200);Buffer.from([1,1,1,0,2,1,2,0,0,0,0,1]).copy(meta,204);
  let start=0;const encoded=entries.map(row=>{const word=Buffer.from(row.word),length=Buffer.byteLength(row.html),data=Buffer.concat([Buffer.from([word.length]),word,Buffer.from([3]),vint(start),vint(length)]);start+=length;return data;});
  const size=encoded.reduce((sum,row)=>sum+row.length,192),leaf=Buffer.alloc(size+4+entries.length*2);leaf.write('INDX');leaf.writeUInt32BE(size,20);leaf.writeUInt32BE(entries.length,24);leaf.write('IDXT',size);
  let offset=192;encoded.forEach((row,i)=>{leaf.writeUInt16BE(offset,size+4+i*2);row.copy(leaf,offset);offset+=row.length;});
  let data=text;if(compression===2){const parts=[];for(let i=0;i<text.length;i+=8){const part=text.subarray(i,i+8);parts.push(Buffer.from([part.length]),part);}data=Buffer.concat(parts);}
  const records=[header,data,meta,leaf],pdb=Buffer.alloc(78+records.length*8+2);pdb.write('VLM sample');pdb.write('BOOKMOBI',60);pdb.writeUInt16BE(records.length,76);
  offset=pdb.length;records.forEach((row,i)=>{pdb.writeUInt32BE(offset,78+i*8);offset+=row.length;});return Buffer.concat([pdb,...records]);
}
module.exports={mobiFixture};
