const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const canvasPath=require.resolve('@napi-rs/canvas',{paths:[path.dirname(require.resolve('pdfjs-dist/package.json'))]});
const {createCanvas,loadImage}=require(canvasPath);
(async()=>{
  const svg=await loadImage(fs.readFileSync(path.join(root,'assets','icon.svg'))),small=await loadImage(fs.readFileSync(path.join(root,'assets','icon-small.svg'))),sizes=[16,24,32,48,64,128,256],images=[];
  for(const size of sizes){const canvas=createCanvas(size,size);canvas.getContext('2d').drawImage(size<=24?small:svg,0,0,size,size);images.push(canvas.toBuffer('image/png'));}
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
  sizes.forEach((size,i)=>{const at=6+16*i;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(images[i].length,at+8);header.writeUInt32LE(offset,at+12);offset+=images[i].length;});
  fs.writeFileSync(path.join(root,'assets','icon.ico'),Buffer.concat([header,...images]));fs.writeFileSync(path.join(root,'assets','icon.png'),images.at(-1));console.log('VLM folded-page icon generated, with dedicated 16/24px artwork.');
})().catch(error=>{console.error(error);process.exitCode=1;});
