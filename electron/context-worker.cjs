const {ContextIndex}=require('./context-index.cjs');let index,chain=Promise.resolve();
process.on('message',message=>{chain=chain.then(async()=>{
  try{index||=new ContextIndex(message.dataDir);const failures=await index.update(message.books);const results=message.words.map(word=>({id:word.id,text:word.text,examples:index.search(word.text,message.books)}));process.send({id:message.id,results,failures});}
  catch(error){process.send({id:message.id,error:error.message});}
});});
process.on('disconnect',()=>{index?.close();process.exit(0);});
