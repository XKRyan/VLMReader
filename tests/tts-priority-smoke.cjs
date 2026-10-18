const {fork}=require('node:child_process');const path=require('node:path');const assert=require('node:assert/strict');
// A short interactive request must finish while a long background warm-up is still generating.
const worker=fork(path.join(__dirname,'../electron/tts-worker.cjs'),[],{silent:true});
const modelDir=path.join(__dirname,'../assets/kokoro-multi-lang-v1_1');
const long=Array.from({length:12},(_,i)=>'Background sentence number '+(i+1)+' keeps the speech engine busy for a while.').join(' ');
const order=[];
const timer=setTimeout(()=>{console.error('speech timeout');worker.kill();process.exitCode=1;},180000);
worker.stderr.on('data',b=>process.stderr.write(b));
worker.on('message',m=>{
  if(m.error){console.error(m.error);clearTimeout(timer);worker.kill();process.exitCode=1;return;}
  if(m.id===1&&m.type==='cue'&&order.length===0){order.push('background-started');worker.send({id:2,text:'Resilient.',sid:0,modelDir,priority:true});}
  if(m.id===2){assert.equal(Buffer.from(m.data,'base64').toString('ascii',0,4),'RIFF');order.push('priority-done');}
  if(m.id===1&&m.type==='end'){order.push('background-done');clearTimeout(timer);worker.kill();
    assert.deepEqual(order,['background-started','priority-done','background-done'],'Priority speech must not wait for background generation');
    console.log('Priority speech preempts background generation: '+order.join(' -> '));}
});
worker.send({id:1,text:long,enVoice:0,zhVoice:3,stream:true,priority:false,modelDir});
