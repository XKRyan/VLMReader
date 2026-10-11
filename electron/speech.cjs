const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fork}=require('node:child_process');
class SpeechService{
  constructor(assets,dataDir){this.assets=assets;this.dataDir=dataDir;this.worker=null;this.sequence=0;this.pending=new Map();this.jobs=new Map();}
  startWorker(){
    if(this.worker)return this.worker;
    const workerFile=path.join(__dirname,'tts-worker.cjs').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
    const worker=fork(workerFile,[],{execPath:path.join(this.assets,'runtime','node.exe'),env:{...process.env},windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
    this.worker=worker;worker.stderr.on('data',data=>fs.appendFileSync(path.join(this.dataDir,'speech.log'),data));
    worker.on('message',m=>this.receive(m));
    worker.on('exit',()=>{if(this.worker===worker)this.worker=null;for(const task of [...this.pending.values()])this.fail(task,Error('语音引擎已退出，请重试'));});return worker;
  }
  input(text){text=String(text||'').normalize('NFKC').replace(/\s+/g,' ').trim();if(!text)throw Error('没有可朗读的文字');if(text.length>250000)throw Error('这一章节过长，请选择一部分文字朗读');return text;}
  voice(sid,fallback){return Number.isInteger(sid)&&sid>=0&&sid<103?sid:fallback;}
  cacheKey(text,enVoice,zhVoice){return crypto.createHash('sha256').update(JSON.stringify(['stream-v2',text,enVoice,zhVoice])).digest('hex');}
  emit(task,event){for(const [id,owner] of task.subscribers||[])if(!owner.isDestroyed())owner.send('speech:event',{...event,id});}
  arm(task){clearTimeout(task.timer);task.timer=setTimeout(()=>{this.worker?.send({id:task.id,cancel:true});this.fail(task,Error('语音生成超时，请重试'));},120000);}
  forget(task){clearTimeout(task.timer);this.pending.delete(task.id);if(this.jobs.get(task.key)===task)this.jobs.delete(task.key);}
  fail(task,error){this.forget(task);if(task.subscribers)this.emit(task,{type:'error',error:error.message});task.reject(error);}
  receive(message){
    const task=this.pending.get(message.id);if(!task)return;if(message.error){this.fail(task,Error(message.error));return;}this.arm(task);
    if(!task.subscribers){clearTimeout(task.timer);this.pending.delete(task.id);task.resolve(message);return;}
    if(message.type==='chunk'){task.chunks.push(Buffer.from(message.data,'base64'));task.duration=message.duration;this.emit(task,message);}
    if(message.type==='cue'){task.cues.push({text:message.text,start:message.start});this.emit(task,message);}
    if(message.type==='end'){
      this.forget(task);
      try{const file=path.join(this.dataDir,'audio',task.key);fs.writeFileSync(file+'.mp3.tmp',Buffer.concat(task.chunks));fs.renameSync(file+'.mp3.tmp',file+'.mp3');fs.writeFileSync(file+'.json.tmp',JSON.stringify({duration:message.duration,cues:task.cues}));fs.renameSync(file+'.json.tmp',file+'.json');for(const key of message.segments||[])if(/^[a-f0-9]{64}$/.test(key)){const segment=path.join(this.dataDir,'audio','segments',key+'.pcmz');if(fs.existsSync(segment))fs.unlinkSync(segment);}}catch(error){fs.appendFileSync(path.join(this.dataDir,'speech.log'),'Cache: '+error.message+'\n');}
      this.emit(task,message);task.resolve();
    }
    if(message.type==='cancelled'){this.forget(task);task.resolve();}
  }
  generate(text,sid){
    text=this.input(text);sid=this.voice(sid,3);const id=++this.sequence;
    return new Promise((resolve,reject)=>{const task={id,resolve,reject};this.pending.set(id,task);this.arm(task);this.startWorker().send({id,text,sid,modelDir:path.join(this.assets,'kokoro-multi-lang-v1_1'),priority:true});});
  }
  stream(id,text,enVoice,zhVoice,owner,warm=false){
    text=this.input(text);enVoice=this.voice(enVoice,0);zhVoice=this.voice(zhVoice,3);
    const key=this.cacheKey(text,enVoice,zhVoice),file=path.join(this.dataDir,'audio',key);
    if(fs.existsSync(file+'.mp3')&&fs.existsSync(file+'.json'))try{
      const meta=JSON.parse(fs.readFileSync(file+'.json','utf8'));if(!Array.isArray(meta.cues)||!Number.isFinite(meta.duration))throw Error('Invalid audio cache');
      if(!warm){for(const cue of meta.cues)owner.send('speech:event',{id,type:'cue',...cue});owner.send('speech:event',{id,type:'chunk',data:fs.readFileSync(file+'.mp3').toString('base64'),duration:meta.duration});owner.send('speech:event',{id,type:'end',duration:meta.duration});}return Promise.resolve();
    }catch{}
    for(const task of this.jobs.values())if(task.key!==key&&task.warm&&!task.subscribers.size){task.warm=false;task.cancelRequested=true;this.worker?.send({id:task.id,cancel:true});}
    let task=this.jobs.get(key);
    if(task?.cancelRequested){this.jobs.delete(key);task=null;}
    if(task){
      if(warm)task.warm=true;else{task.subscribers.set(id,owner);for(const cue of task.cues)owner.send('speech:event',{id,type:'cue',...cue});for(const data of task.chunks)owner.send('speech:event',{id,type:'chunk',data:data.toString('base64'),duration:task.duration});}return warm?task.done:Promise.resolve();
    }
    const workerId=++this.sequence;let resolve,reject;const done=new Promise((a,b)=>{resolve=a;reject=b;});done.catch(()=>{});
    task={id:workerId,key,warm,done,resolve,reject,chunks:[],cues:[],duration:0,subscribers:new Map(warm?[]:[[id,owner]])};
    this.jobs.set(key,task);this.pending.set(workerId,task);this.arm(task);this.startWorker().send({id:workerId,text,enVoice,zhVoice,stream:true,priority:!warm,cacheDir:path.join(this.dataDir,'audio','segments'),modelDir:path.join(this.assets,'kokoro-multi-lang-v1_1')});return warm?done:Promise.resolve();
  }
  cancel(id,owner){for(const task of this.jobs.values())if(task.subscribers.get(id)===owner){task.subscribers.delete(id);if(!task.subscribers.size)task.warm=true;}}
  close(){this.worker?.kill();}
}
module.exports={SpeechService};
