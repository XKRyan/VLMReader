const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {fork}=require('node:child_process');
const {EventEmitter}=require('node:events');
const {SpeechService}=require('../electron/speech.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const end=Date.now()+1000;while(!check()){assert.ok(Date.now()<end,'Speech worker did not become idle');await delay(5);}}
function fakeService(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memreader-audio-idle-'));fs.mkdirSync(path.join(dir,'audio'));const workers=[];
  const service=new SpeechService('',dir,{idleMs:25,workerFactory:()=>{const worker=new EventEmitter();worker.stderr=new EventEmitter();worker.messages=[];worker.kills=0;worker.send=message=>worker.messages.push(message);worker.kill=()=>{worker.kills++;return true;};workers.push(worker);return worker;}});
  t.after(()=>{service.close();for(const worker of workers)worker.emit('exit',0);});return {service,workers,dir};
}
test('speech idle retirement waits for a completed engine job and new work cancels its deadline',async t=>{
  const {service,workers}=fakeService(t);assert.equal(new SpeechService('','').idleMs,60000);
  const first=service.generate('A short pronunciation.',3),worker=workers[0],firstId=worker.messages[0].id;
  assert.equal(service.idleTimer,null);await delay(60);assert.equal(worker.kills,0,'Active generation must never be retired');
  worker.emit('message',{id:firstId,data:'first WAV'});assert.equal((await first).data,'first WAV');assert.equal(service.pending.size,0);assert.equal(service.idleTimer.hasRef(),false,'Idle cleanup must not keep the process alive');
  const second=service.generate('Another pronunciation.',3),secondId=worker.messages.at(-1).id;assert.equal(workers.length,1);assert.equal(service.idleTimer,null);
  await delay(60);assert.equal(worker.kills,0,'An earlier idle deadline must not interrupt new work');worker.emit('message',{id:secondId,data:'second WAV'});await second;
  await until(()=>worker.kills===1);assert.equal(service.worker,null);assert.equal(service.idleTimer,null);
});
test('streaming and warm jobs finish in the background before idle release and cached replay loads no worker',async t=>{
  const {service,workers}=fakeService(t),events=[],owner={isDestroyed:()=>false,send:(_channel,event)=>events.push(event)},text='Stopping playback still retains completed speech.';
  await service.stream('playing',text,0,3,owner);const first=workers[0],id=first.messages[0].id;service.cancel('playing',owner);
  await delay(60);assert.equal(first.kills,0);assert.equal(service.pending.size,1);assert.equal(service.idleTimer,null);
  first.emit('message',{id,type:'cue',text,start:0});first.emit('message',{id,type:'chunk',data:Buffer.from('cached MP3').toString('base64'),duration:3});first.emit('message',{id,type:'end',duration:3});assert.equal(events.length,0);
  const timer=service.idleTimer;await service.stream('warm-cache',text,0,3,undefined,true);await service.stream('replay',text,0,3,owner);assert.equal(workers.length,1);assert.equal(service.idleTimer,timer,'Cache replay must not extend engine lifetime');assert.deepEqual(events.map(event=>event.type),['cue','chunk','end']);
  await until(()=>first.kills===1);await service.stream('after-release',text,0,3,owner);assert.equal(workers.length,1,'Replay after release must still use the MP3 cache');
  const warm=service.stream('preload','A new passage can be prepared.',0,3,undefined,true),second=workers[1],warmId=second.messages[0].id,pronunciation=service.generate('word',3),generateId=second.messages.at(-1).id;
  await delay(60);assert.equal(second.kills,0);assert.equal(service.pending.size,2);assert.equal(service.idleTimer,null);
  second.emit('message',{id:warmId,type:'chunk',data:Buffer.from('warm MP3').toString('base64'),duration:1});second.emit('message',{id:warmId,type:'end',duration:1});await warm;assert.equal(service.pending.size,1);assert.equal(service.idleTimer,null,'One completed job cannot retire another active job');
  await delay(60);assert.equal(second.kills,0);second.emit('message',{id:generateId,data:'word WAV'});await pronunciation;await until(()=>second.kills===1);assert.equal(service.worker,null);
});
test('a retired speech worker cannot complete or fail work owned by its replacement',async t=>{
  const {service,workers}=fakeService(t),first=service.generate('First worker.',3),old=workers[0];old.emit('message',{id:old.messages[0].id,data:'old WAV'});await first;await until(()=>old.kills===1);
  const next=service.generate('Replacement worker.',3),current=workers[1],id=current.messages[0].id;let settled=false;next.then(()=>settled=true,()=>settled=true);
  old.emit('message',{id,data:'stale WAV'});old.emit('exit',0);old.emit('error',Error('Old IPC closed'));await delay(0);assert.equal(settled,false);assert.equal(service.worker,current);assert.equal(service.pending.size,1);assert.equal(current.kills,0);
  current.emit('message',{id,data:'replacement WAV'});assert.equal((await next).data,'replacement WAV');await until(()=>current.kills===1);assert.equal(service.pending.size,0);
});
test('completed speech survives service restart and stopping still saves the finished job',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memreader-audio-'));fs.mkdirSync(path.join(dir,'audio'));const received=[],messages=[],owner={isDestroyed:()=>false,send:(_name,event)=>received.push(event)},service=new SpeechService('',dir);
  service.startWorker=()=>service.worker={send:msg=>messages.push(msg),kill:()=>{}};t.after(()=>service.close());
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
