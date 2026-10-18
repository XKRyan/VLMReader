// RIPEMD-128 and Salsa20/8 as used by the MDict encrypted keyword index.
// Implemented here because the format needs both primitives and the only
// reference implementations are GPL/AGPL, which this project cannot use.
const ZL=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13];
const ZR=[5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11];
const SL=[11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6];
const SR=[8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11];
const KL=[0x00000000,0x5a827999,0x6ed9eba1,0x8f1bbcdc],KR=[0x50a28be6,0x5c4dd124,0x6d703ef3,0x00000000];
const rotl=(value,bits)=>(value<<bits)|(value>>>(32-bits));
const f=(index,x,y,z)=>index===0?x^y^z:index===1?(x&y)|(~x&z):index===2?(x|~y)^z:(x&z)|(y&~z);
function ripemd128(input){
  const padded=Buffer.alloc(((input.length+8)>>6<<6)+64);
  Buffer.from(input).copy(padded);
  padded[input.length]=0x80;
  const bits=input.length*8;
  padded.writeUInt32LE(bits>>>0,padded.length-8);
  padded.writeUInt32LE(Math.floor(bits/0x100000000),padded.length-4);
  let h0=0x67452301,h1=0xefcdab89,h2=0x98badcfe,h3=0x10325476;
  for(let offset=0;offset<padded.length;offset+=64){
    const X=[];for(let i=0;i<16;i++)X.push(padded.readUInt32LE(offset+i*4));
    let al=h0,bl=h1,cl=h2,dl=h3,ar=h0,br=h1,cr=h2,dr=h3;
    for(let i=0;i<64;i++){
      const round=i>>4;
      // RIPEMD-128 rotates four registers; there is no fifth register and no
      // extra add of D as in RIPEMD-160.
      let t=(al+f(round,bl,cl,dl)+X[ZL[i]]+KL[round])>>>0;
      t=rotl(t,SL[i]);
      al=dl;dl=cl;cl=bl;bl=t;
      t=(ar+f(3-round,br,cr,dr)+X[ZR[i]]+KR[round])>>>0;
      t=rotl(t,SR[i]);
      ar=dr;dr=cr;cr=br;br=t;
    }
    const t=(h1+cl+dr)>>>0;
    h1=(h2+dl+ar)>>>0;h2=(h3+al+br)>>>0;h3=(h0+bl+cr)>>>0;h0=t;
  }
  const out=Buffer.alloc(16);
  [h0,h1,h2,h3].forEach((value,index)=>out.writeUInt32LE(value>>>0,index*4));
  return out;
}
const SIGMA=[0x61707865,0x3320646e,0x79622d32,0x6b206574],TAU=[0x61707865,0x3120646e,0x79622d36,0x6b206574];
function salsaState(key,nonce,counter){
  const constants=key.length===16?TAU:SIGMA,state=new Uint32Array(16),half=key.length===16?0:16;
  state[0]=constants[0];
  for(let i=0;i<4;i++)state[1+i]=key.readUInt32LE(i*4);
  state[5]=constants[1];
  state[6]=nonce.readUInt32LE(0);state[7]=nonce.readUInt32LE(4);
  state[8]=counter>>>0;state[9]=Math.floor(counter/4294967296)>>>0;
  state[10]=constants[2];
  for(let i=0;i<4;i++)state[11+i]=key.readUInt32LE(half+i*4);
  state[15]=constants[3];
  return state;
}
function salsaBlock(input,rounds){
  const x=Uint32Array.from(input);
  const quarter=(a,b,c,d)=>{
    x[b]^=rotl((x[a]+x[d])>>>0,7);
    x[c]^=rotl((x[b]+x[a])>>>0,9);
    x[d]^=rotl((x[c]+x[b])>>>0,13);
    x[a]^=rotl((x[d]+x[c])>>>0,18);
  };
  for(let round=0;round<rounds;round+=2){
    quarter(0,4,8,12);quarter(5,9,13,1);quarter(10,14,2,6);quarter(15,3,7,11);
    quarter(0,1,2,3);quarter(5,6,7,4);quarter(10,11,8,9);quarter(15,12,13,14);
  }
  const out=Buffer.alloc(64);
  for(let i=0;i<16;i++)out.writeUInt32LE((x[i]+input[i])>>>0,i*4);
  return out;
}
// MDict derives a 16-byte key from the block's Adler-32 and the 0x3695 magic,
// then encrypts everything after the 8-byte block header with Salsa20/8.
function decryptIndex(block){
  if(block.length<8)throw Error('MDX 加密索引损坏');
  const magic=Buffer.alloc(4);magic.writeUInt32LE(0x3695,0);
  const key=ripemd128(Buffer.concat([block.subarray(4,8),magic])),nonce=Buffer.alloc(8);
  const body=Buffer.from(block.subarray(8)),out=Buffer.alloc(body.length);
  for(let offset=0;offset<body.length;offset+=64){
    const keystream=salsaBlock(salsaState(key,nonce,offset/64),8);
    const size=Math.min(64,body.length-offset);
    for(let i=0;i<size;i++)out[offset+i]=body[offset+i]^keystream[i];
  }
  return Buffer.concat([block.subarray(0,8),out]);
}
module.exports={ripemd128,decryptIndex,salsaBlock,salsaState};
