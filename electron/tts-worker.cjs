const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const crypto=require('node:crypto'),zlib=require('node:zlib');
const sherpa=require('sherpa-onnx-node');
const engines=new Map(),cancelled=new Set(),queue=[];
let running=false;
const languageFor=text=>/[\u3400-\u9fff]/.test(text)?'zh':'en';
async function engine(modelDir,language){
  if(!engines.has(language)){
    const kokoro={model:path.join(modelDir,'model.onnx'),voices:path.join(modelDir,'voices.bin'),tokens:path.join(modelDir,'tokens.txt'),
      dataDir:path.join(modelDir,'espeak-ng-data'),lexicon:['lexicon-us-en.txt','lexicon-zh.txt'].map(x=>path.join(modelDir,x)).join(','),dictDir:path.join(modelDir,'dict')};
    // Chinese FSTs transform even English numerals into Chinese characters.
    // The English path uses eSpeak's English number pronunciation instead.
    const ruleFsts=language==='zh'?['date-zh.fst','number-zh.fst','phone-zh.fst'].map(x=>path.join(modelDir,x)).filter(x=>fs.existsSync(x)).join(','):'';
    engines.set(language,sherpa.OfflineTts.createAsync({model:{kokoro,numThreads:Math.min(4,os.availableParallelism()),debug:false,provider:'cpu'},ruleFsts,maxNumSentences:1}));
  }
  return engines.get(language);
}
function pcm(samples){const data=new Int16Array(samples.length);for(let i=0;i<samples.length;i++)data[i]=Math.max(-32768,Math.min(32767,Math.round(samples[i]*32767)));return data;}
function wav(samples,sampleRate){
  const data=pcm(samples),buffer=Buffer.alloc(44+data.length*2);
  buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVE',8);buffer.write('fmt ',12);buffer.writeUInt32LE(16,16);
  buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(sampleRate,24);buffer.writeUInt32LE(sampleRate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);
  buffer.write('data',36);buffer.writeUInt32LE(data.length*2,40);for(let i=0;i<data.length;i++)buffer.writeInt16LE(data[i],44+i*2);return buffer;
}
function pieces(text){return [...new Intl.Segmenter(languageFor(text),{granularity:'sentence'}).segment(text)].flatMap(s=>s.segment.trim().match(/.{1,500}(?:\s|$)|.{1,500}/gs)||[]);}
function send(message){if(process.connected)process.send(message);}
async function run(msg){
  if(!msg.stream){
    const language=languageFor(msg.text),tts=await engine(msg.modelDir,language);
    const audio=await tts.generateAsync({text:msg.text,generationConfig:new sherpa.GenerationConfig({sid:msg.sid,speed:1,silenceScale:0.2,extra:{lang:msg.sid===2?'en-gb':'en-us'}})});
    if(!audio.samples?.length)throw Error('此段文字无法生成语音');
    send({id:msg.id,data:wav(audio.samples,audio.sampleRate).toString('base64'),duration:audio.samples.length/audio.sampleRate,language});return;
  }
  const {Mp3Encoder}=await import('@breezystack/lamejs');let encoder,duration=0;const segments=[];
  if(msg.cacheDir)fs.mkdirSync(msg.cacheDir,{recursive:true});
  function encode(samples,rate){if(!encoder)encoder=new Mp3Encoder(1,rate,96);const data=encoder.encodeBuffer(samples);duration+=samples.length/rate;if(data.length)send({id:msg.id,type:'chunk',data:Buffer.from(data).toString('base64'),duration});}
  for(const text of pieces(msg.text)){
    if(cancelled.has(msg.id))break;
    const language=languageFor(text),sid=language==='zh'?msg.zhVoice:msg.enVoice,key=crypto.createHash('sha256').update(JSON.stringify(['kokoro-v1.1-pcm-v1',text,sid,language])).digest('hex');
    const segmentFile=msg.cacheDir&&path.join(msg.cacheDir,key+'.pcmz');let cached;
    if(segmentFile&&fs.existsSync(segmentFile))try{const bytes=fs.readFileSync(segmentFile),rate=bytes.readUInt32LE(0),pcmBytes=zlib.inflateRawSync(bytes.subarray(4));if(rate<8000||rate>48000||!pcmBytes.length||pcmBytes.length%2)throw Error('Invalid segment');cached={rate,samples:new Int16Array(pcmBytes.buffer,pcmBytes.byteOffset,pcmBytes.length/2)};}catch{}
    send({id:msg.id,type:'cue',start:duration,text});
    if(cached){segments.push(key);for(let at=0;at<cached.samples.length;at+=36864){if(cancelled.has(msg.id))break;encode(cached.samples.subarray(at,at+36864),cached.rate);await new Promise(resolve=>setImmediate(resolve));}continue;}
    const tts=await engine(msg.modelDir,language);if(cancelled.has(msg.id))break;
    const audio=await tts.generateAsync({text,generationConfig:new sherpa.GenerationConfig({sid,speed:1,silenceScale:0.2,extra:{lang:sid===2?'en-gb':'en-us'}}),onProgress:info=>{
      if(cancelled.has(msg.id))return 0;
      encode(pcm(info.samples),tts.sampleRate);return 1;
    }});
    if(!audio.samples?.length&&!cancelled.has(msg.id))throw Error('此段文字无法生成语音');
    if(segmentFile&&audio.samples?.length&&!cancelled.has(msg.id)){const samples=pcm(audio.samples),header=Buffer.alloc(4);header.writeUInt32LE(audio.sampleRate,0);fs.writeFileSync(segmentFile+'.tmp',Buffer.concat([header,zlib.deflateRawSync(Buffer.from(samples.buffer,samples.byteOffset,samples.byteLength))]));fs.renameSync(segmentFile+'.tmp',segmentFile);segments.push(key);}
  }
  if(cancelled.has(msg.id)){send({id:msg.id,type:'cancelled'});return;}
  if(!encoder)throw Error('没有可朗读的文字');
  const tail=encoder.flush();if(tail.length)send({id:msg.id,type:'chunk',data:Buffer.from(tail).toString('base64'),duration});
  send({id:msg.id,type:'end',duration,segments});
}
async function pump(){
  if(running)return;running=true;
  while(queue.length){const msg=queue.shift();if(!cancelled.has(msg.id)){try{await run(msg);}catch(err){send({id:msg.id,type:msg.stream?'error':undefined,error:err.message});}}else send({id:msg.id,type:'cancelled'});cancelled.delete(msg.id);}running=false;
}
process.on('message',msg=>{if(msg.cancel){cancelled.add(msg.id);return;}if(msg.priority)queue.unshift(msg);else queue.push(msg);void pump();});
