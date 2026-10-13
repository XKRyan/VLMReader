const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const canvasPath=require.resolve('@napi-rs/canvas',{paths:[path.dirname(require.resolve('pdfjs-dist/package.json'))]});
const {createCanvas,loadImage}=require(canvasPath);
function windowsBitmap(canvas,size){
  const pixels=canvas.getContext('2d').getImageData(0,0,size,size).data;
  const stride=Math.ceil(size/32)*4,pixelBytes=size*size*4;
  const bitmap=Buffer.alloc(40+pixelBytes+stride*size);
  bitmap.writeUInt32LE(40,0);bitmap.writeInt32LE(size,4);bitmap.writeInt32LE(size*2,8);
  bitmap.writeUInt16LE(1,12);bitmap.writeUInt16LE(32,14);bitmap.writeUInt32LE(pixelBytes+stride*size,20);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const from=(y*size+x)*4,to=40+((size-1-y)*size+x)*4;
    bitmap[to]=pixels[from+2];bitmap[to+1]=pixels[from+1];bitmap[to+2]=pixels[from];bitmap[to+3]=pixels[from+3];
    if(pixels[from+3]===0)bitmap[40+pixelBytes+(size-1-y)*stride+(x>>3)]|=0x80>>(x%8);
  }
  return bitmap;
}
(async()=>{
  const svg=await loadImage(fs.readFileSync(path.join(root,'assets','icon.svg'))),small=await loadImage(fs.readFileSync(path.join(root,'assets','icon-small.svg'))),sizes=[16,24,32,48,64,128,256],images=[];
  let preview;
  for(const size of sizes){const canvas=createCanvas(size,size);canvas.getContext('2d').drawImage(size<=24?small:svg,0,0,size,size);const png=canvas.toBuffer('image/png');if(size===256)preview=png;images.push(size===256?png:windowsBitmap(canvas,size));}
  const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
  sizes.forEach((size,i)=>{const at=6+16*i;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(images[i].length,at+8);header.writeUInt32LE(offset,at+12);offset+=images[i].length;});
  fs.writeFileSync(path.join(root,'assets','icon.ico'),Buffer.concat([header,...images]));fs.writeFileSync(path.join(root,'assets','icon.png'),preview);console.log('VLMReader purple book icon generated with Windows-compatible bitmaps and a 256px PNG.');
})().catch(error=>{console.error(error);process.exitCode=1;});
