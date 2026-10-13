const {fork}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
class LibraryExamples{
  constructor(store,assets,onChanged=()=>{}){this.store=store;this.assets=assets;this.onChanged=onChanged;this.worker=null;this.pending=null;this.dirty=false;this.stamp='';}
  queue(){this.dirty=true;if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;void this.scan().catch(()=>{});},300);}
  async scan(){
    if(this.pending){this.dirty=true;return this.pending;}
    const books=this.store.state.books.map(({id,title,format,hash})=>({id,title,format,hash})),words=this.store.state.entries.filter(entry=>entry.kind==='word'&&entry.text.length<=100).map(({id,text})=>({id,text}));
    const stamp=JSON.stringify([books,words]);if(!this.dirty&&stamp===this.stamp)return;
    this.dirty=false;
    if(!this.worker){
      const file=path.join(__dirname,'context-worker.cjs').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
      this.worker=fork(file,[],{execPath:path.join(this.assets,'runtime','node.exe'),windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
      this.worker.stderr.on('data',()=>{});
    }
    const worker=this.worker;
    const operation=new Promise((resolve,reject)=>{
      const done=message=>{if(message.error){reject(Error(message.error));return;}try{
        const alive=new Set(this.store.state.books.map(book=>book.id));let changed=false;
        const entries=this.store.state.entries.map(entry=>{const match=message.results.find(item=>item.id===entry.id&&item.text===entry.text);if(!match)return entry;const examples=match.examples.filter(item=>alive.has(item.bookId));if(JSON.stringify(entry.libraryExamples||[])===JSON.stringify(examples))return entry;changed=true;return {...entry,libraryExamples:examples};});
        if(changed){this.store.replaceState({...this.store.state,entries});this.onChanged();}this.stamp=stamp;resolve();
      }catch(error){reject(error);}};
      const exited=()=>{if(this.worker===worker)this.worker=null;reject(Error('书籍例句索引暂不可用'));};
      worker.once('message',done);worker.once('exit',exited);worker.once('error',exited);
      this.cleanup=()=>{worker.removeListener('message',done);worker.removeListener('exit',exited);worker.removeListener('error',exited);};
      worker.send({id:1,dataDir:this.store.dir,books,words});
    });
    this.pending=operation;
    try{await operation;}finally{this.cleanup?.();this.pending=null;if(this.dirty)this.queue();}
  }
  async find(entry){
    const valid=()=>{const current=this.store.state.entries.find(item=>item.id===entry.id);return (current?.libraryExamples||[]).filter(example=>this.store.state.books.some(book=>book.id===example.bookId));};
    if(valid().length)return valid();
    // Reuse the index when ready. Bound the first scan wait so a large library
    // never freezes a review; background work continues without further calls.
    await Promise.race([this.scan().catch(()=>{}),new Promise(resolve=>{const timer=setTimeout(resolve,5000);timer.unref();})]);return valid();
  }
  stop(){clearTimeout(this.timer);this.dirty=false;const worker=this.worker;this.worker=null;if(!worker)return Promise.resolve();return new Promise(resolve=>{const timer=setTimeout(()=>{worker.kill();},2000);worker.once('exit',()=>{clearTimeout(timer);resolve();});if(worker.connected)worker.disconnect();else worker.kill();});}
}
module.exports={LibraryExamples};
