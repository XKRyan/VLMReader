const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {fork}=require('node:child_process');
const {SpeechService}=require('../electron/speech.cjs');
test('completed speech survives service restart and stopping still saves the finished job',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memreader-audio-'));fs.mkdirSync(path.join(dir,'audio'));const received=[],messages=[],owner={isDestroyed:()=>false,send:(_name,event)=>received.push(event)},service=new SpeechService('',dir);
  service.startWorker=()=>service.worker={send:msg=>messages.push(msg)};
  await service.stream('first','This speech is retained.',0,3,owner);const id=messages[0].id;service.cancel('first',owner);assert.equal(messages.length,1,'Stopping playback must not cancel background completion');
  service.receive({id,type:'cue',text:'This speech is retained.',start:0});service.receive({id,type:'chunk',data:Buffer.from('cached MP3 bytes').toString('base64'),duration:3});service.receive({id,type:'end',duration:3});assert.equal(received.length,0);
  const restart=new SpeechService('',dir);restart.startWorker=()=>{throw Error('A cached replay must not load the voice engine');};await restart.stream('restart','This speech is retained.',0,3,owner);
  assert.deepEqual(received.map(e=>e.type),['cue','chunk','end']);assert.equal(Buffer.from(received[1].data,'base64').toString(),'cached MP3 bytes');assert.notEqual(restart.cacheKey('This speech is retained.',0,3),restart.cacheKey('This speech is retained.',1,3));
});
test('the worker reuses saved sentence audio without loading a model',async()=>{
  const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'memreader-segments-')),sentences=['A reusable sentence.','Another cached sentence.'];
  for(const text of sentences){const key=crypto.createHash('sha256').update(JSON.stringify(['kokoro-v1.1-pcm-v1',text,0,'en'])).digest('hex'),header=Buffer.alloc(4),samples=new Int16Array(6000);header.writeUInt32LE(24000);for(let i=0;i<samples.length;i++)samples[i]=Math.round(Math.sin(i/10)*4000);fs.writeFileSync(path.join(dir,key+'.pcmz'),Buffer.concat([header,zlib.deflateRawSync(Buffer.from(samples.buffer))]));}
  const worker=fork(path.join(root,'electron/tts-worker.cjs'),[],{execPath:path.join(root,'assets/runtime/node.exe'),windowsHide:true,stdio:['ignore','ignore','pipe','ipc']}),events=[];let stderr='';worker.stderr.on('data',data=>stderr+=data);
  try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Sentence cache replay timed out: '+stderr)),15000);worker.on('message',message=>{events.push(message);if(message.error){clearTimeout(timer);reject(Error(message.error));}if(message.type==='end'){clearTimeout(timer);resolve();}});worker.once('error',reject);worker.send({id:1,text:sentences.join(' '),enVoice:0,zhVoice:3,stream:true,cacheDir:dir,modelDir:path.join(dir,'no-model')});});assert.equal(events.filter(e=>e.type==='cue').length,2);assert.ok(events.some(e=>e.type==='chunk'));assert.equal(events.at(-1).duration,.5);}finally{worker.kill();}
});
