const {fork}=require('node:child_process');const path=require('node:path');const fs=require('node:fs');
const worker=fork(path.join(__dirname,'../electron/tts-worker.cjs'),[],{silent:true});
const cases=[{id:1,text:'A resilient learner remembers ideas.',sid:0},{id:2,text:'保留原句，理解单词的含义。',sid:3}];let index=0;
const timer=setTimeout(()=>{console.error('speech timeout');worker.kill();process.exitCode=1;},90000);
worker.stderr.on('data',b=>process.stderr.write(b));
worker.on('message',m=>{if(m.error){console.error(m.error);clearTimeout(timer);worker.kill();process.exitCode=1;return;}const b=Buffer.from(m.data,'base64');if(b.toString('ascii',0,4)!=='RIFF'||m.duration<0.3)throw Error('Invalid speech audio');fs.writeFileSync(path.join(__dirname,'fixtures','speech-'+m.id+'.wav'),b);console.log('Offline speech',m.id,'verified:',m.duration.toFixed(2),'seconds');index++;if(index<cases.length)send();else{clearTimeout(timer);worker.kill();}});
function send(){worker.send({...cases[index],modelDir:path.join(__dirname,'../assets/kokoro-multi-lang-v1_1')});}send();
