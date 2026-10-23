const {app,BrowserWindow,dialog,ipcMain,safeStorage,shell,Menu}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {SpeechService}=require('./speech.cjs');
const {Store,DEFAULTS}=require('./store.cjs');
const {getPalette,sanitizeColorThemes}=require('./palette.cjs');
const {notebookIds,collectMembership,saveNotebook,deleteNotebook,assignEntries,moveEntries,mergeBackup}=require('./notebooks.cjs');
const {Dictionary}=require('./dictionary.cjs');
const {DictionaryHistory}=require('./dictionary-history.cjs');
const {createRichDictionary}=require('./dictionary-rich.cjs');
const {saveAnnotation,updateAnnotation,deleteAnnotation,validateColor}=require('./annotations.cjs');
const {createWordbookService}=require('./wordbooks.cjs');
const {makeEntry,studyEntry,normalize,reviewEntry,reviewIntervals,undoReviewEntry,withReviewSkills,vocabularyCsv,setDecay}=require('./core.cjs');
const {calibrate}=require('./fsrs-calibrate.cjs');
const {ContextMeanings}=require('./context-meanings.cjs');
const {REVIEW_METHODS,isUnreviewed,inNotebook,wordlistIds}=require('../shared/review-policy.mjs');
const {translate,validateBase}=require('./translation.cjs');
const {convertDocx}=require('./docx.cjs');
const {createClozeService}=require('./cloze.cjs');
const {lookupAI}=require('./ai-dictionary.cjs');
const {generateSentence}=require('./review-examples.cjs');
const {createWordDetails}=require('./word-details.cjs');
const {createProductionService}=require('./production.cjs');
const {LibraryExamples}=require('./library-examples.cjs');
const {readText,copyImages,imageResources}=require('./document-files.cjs');
const {cacheImage,localLink,diagramData,saveDiagram}=require('./markdown-resources.cjs');
const {exportBundle,importBundle}=require('./book-bundle.cjs');
const isTest=process.env.MEMREADER_TEST==='1';
// Windows shows the process name in places where the app identity is missing;
// without this Electron falls back to "Electron".
app.setName('VLMReader');
if(process.platform==='win32')app.setAppUserModelId('study.memreader.desktop');
const assets=app.isPackaged?path.join(process.resourcesPath,'assets'):path.join(__dirname,'..','assets');
const baseDir=app.isPackaged?path.resolve(path.dirname(process.execPath),'..','..'):path.join(__dirname,'..');
const dataDir=isTest?process.env.MEMREADER_TEST_DATA:path.join(baseDir,'data');
app.setPath('userData',path.join(dataDir,'runtime'));
if(!isTest&&!app.requestSingleInstanceLock())app.exit(0);
const store=new Store(dataDir);
const contextMeanings=new ContextMeanings(dataDir);
// A previously calibrated forgetting curve is part of the learner's schedule.
if(Number.isFinite(store.state.settings.fsrsDecay))setDecay(store.state.settings.fsrsDecay);
const dictionary=new Dictionary(assets,dataDir);
dictionary.contextMeanings=contextMeanings;
dictionary.setSources(store.state.settings.dictionarySources);
const dictionaryHistory=new DictionaryHistory(dataDir);
const {repairDictionaryEntries}=require('./dictionary-policy.cjs');
let dictionaryRepair;
const ensureDictionaryRepair=()=>dictionaryRepair||=(repairDictionaryEntries(store,dictionary).catch(error=>{dictionaryRepair=null;throw error;}));
const libraryExamples=new LibraryExamples(store,assets,()=>main?.webContents.send('entries:changed'));
const richDictionary=createRichDictionary(dictionary,dataDir,()=>store.state.settings,getKey);
const wordDetails=createWordDetails(dictionary,dataDir,()=>store.state.settings,getKey);
const wordbooks=createWordbookService(store,dictionary,assets,()=>libraryExamples.queue());
const productionService=createProductionService(store,getKey,undefined,undefined,{lookup:text=>dictionary.lookup(text)});
const clozeService=createClozeService(store,getKey,{lookup:text=>dictionary.lookup(text),findExamples:entry=>libraryExamples.find(entry)});
let main,progressSaveTimer;const speechService=new SpeechService(assets,dataDir);
app.on('second-instance',()=>{if(main){if(main.isMinimized())main.restore();main.show();main.focus();}});
const ui=(zh,en)=>store.state.settings.language==='en'?en:zh;
function updateMenu(){
  Menu.setApplicationMenu(null);
}
function updateChrome(){const p=getPalette(store.state.settings);main?.setTitleBarOverlay({color:p.sidebar,symbolColor:p.text,height:44});}
const formats=new Set(['pdf','epub','docx','txt','md','markdown','html','htm','vlmbook']);
function getKey(){
  const p=path.join(dataDir,'api-key.bin');if(!fs.existsSync(p))return '';
  try{return safeStorage.decryptString(fs.readFileSync(p));}catch{return '';}
}
function safeState(){return {...store.state,settings:{...store.state.settings,apiKeySet:!!getKey()},dataDir,dictionaryInfo:fs.existsSync(path.join(assets,'dictionary-info.json'))?JSON.parse(fs.readFileSync(path.join(assets,'dictionary-info.json'),'utf8')):null,ttsReady:fs.existsSync(path.join(assets,'kokoro-multi-lang-v1_1','model.onnx'))};}
function entryById(id){const e=store.state.entries.find(e=>e.id===id);if(!e)throw Error('生词条目不存在');return e;}
function bookById(id){const b=store.state.books.find(b=>b.id===id);if(!b)throw Error('文档不存在');return b;}
async function importBooks(paths){
  if(!paths){const result=await dialog.showOpenDialog(main,{title:ui('导入阅读文档','Import reading documents'),properties:['openFile','multiSelections'],filters:[{name:ui('支持的文档','Supported documents'),extensions:[...formats]}]});if(result.canceled)return [];paths=result.filePaths;}
  if(!Array.isArray(paths) || paths.length>100)throw Error('一次最多导入 100 个文档');
  const added=[];
  for(const filename of paths){
    if(typeof filename!=='string'||!path.isAbsolute(filename))continue;
    let ext=path.extname(filename).slice(1).toLowerCase();if(!formats.has(ext))continue;if(ext==='markdown')ext='md';
    if(ext==='vlmbook'){added.push(await importBundle(store,filename));continue;}
    const info=fs.statSync(filename);if(!info.isFile()||info.size>300*1024*1024)throw Error('文档过大（上限 300 MB）：'+path.basename(filename));
    const hash=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    const existing=store.state.books.find(b=>b.hash===hash);if(existing){if(['md','html','htm'].includes(ext)){copyImages(filename,path.join(dataDir,'books',existing.id+'-assets'));existing.sourcePath=filename;}added.push(existing);continue;}
    const id=crypto.randomUUID();const dest=path.join(dataDir,'books',id+'.'+ext);fs.copyFileSync(filename,dest);
    if(['md','html','htm'].includes(ext))copyImages(filename,path.join(dataDir,'books',id+'-assets'));
    const book={id,hash,format:ext,title:path.basename(filename,path.extname(filename)),size:info.size,createdAt:new Date().toISOString(),lastRead:null,progress:0,location:null,favorite:false,...(['md','html','htm'].includes(ext)?{sourcePath:filename}:{})};
    store.state.books.unshift(book);added.push(book);
  }
  store.save();libraryExamples.queue();return added;
}
async function generateSpeech(text,sid){
  return speechService.generate(text,sid);
}
app.whenReady().then(async()=>{
  main=new BrowserWindow({width:1400,height:940,minWidth:1000,minHeight:720,title:'VLMReader',backgroundColor:'#f6f7fb',show:!isTest,titleBarStyle:'hidden',titleBarOverlay:{color:'#f6f7fb',symbolColor:'#31394a',height:44},
    icon:path.join(assets,'icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  main.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  main.webContents.on('will-navigate',event=>event.preventDefault());
  updateMenu();
  updateChrome();
  main.webContents.on('before-input-event',(event,input)=>{if(input.type!=='keyDown')return;if((input.control||input.meta)&&input.key.toLowerCase()==='o'){event.preventDefault();main.webContents.send('import-request');}if(input.key==='F11'){event.preventDefault();main.setFullScreen(!main.isFullScreen());}});
  const handle=(channel,fn)=>ipcMain.handle(channel,(_event,...args)=>fn(...args));
  // Words that no offline dictionary covers are kept in the AI 补充 section after an AI translation.
  async function rememberAiWord(found){
    if(!found?.word||!found.translation||!dictionary.custom)return;
    const known=await dictionary.lookup(found.word).catch(()=>null);if(known&&known.source!=='AI 补充')return;
    try{dictionary.custom.saveAi(found);}catch{/* A rejected AI entry must not fail the translation itself. */}
  }
  // Every AI meaning of a word is remembered per word, so the same word shows
  // instantly next time and dictionaries that lack it can fall back to it.
  function rememberContextMeaning(text,context,result){
    const word=normalize(text);
    if(!/^\p{L}[\p{L}\p{M}'’-]{0,39}$/u.test(word)||!result?.translation)return;
    try{contextMeanings.save(word,{translation:result.translation,english:result.english,explanation:result.explanation,context});}catch{/* memory is optional */}
  }
  handle('boot',async()=>{await ensureDictionaryRepair();return safeState();});
  handle('books:import',importBooks);
  handle('books:remote-image',(id,url,plantuml=false)=>cacheImage(dataDir,bookById(id),url,{allowLocal:isTest,plantuml:plantuml===true}));
  handle('books:diagram-data',(id,source,url)=>diagramData(dataDir,bookById(id),source,url,isTest));
  handle('books:cache-diagram',(id,source,svg)=>saveDiagram(dataDir,bookById(id),source,svg));
  handle('books:open-link',async(id,href)=>{
    const book=bookById(id);if(typeof href!=='string'||href.length>8192)throw Error('Invalid link');
    if(/^https?:\/\/|^mailto:/i.test(href)){const url=new URL(href);if(url.username||url.password)throw Error('Invalid link');await shell.openExternal(url.href);return null;}
    const link=localLink(book,href);if(!formats.has(path.extname(link.path).slice(1).toLowerCase()))throw Error('This linked file type cannot be opened in VLMReader');
    const added=await importBooks([link.path]);return {book:added[0],anchor:link.anchor};
  });
  handle('books:export-annotated',async id=>{
    const book=bookById(id),name=book.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,150)||'Document';
    const result=await dialog.showSaveDialog(main,{title:ui('导出带批注文档','Export annotated document'),defaultPath:name+'.vlmbook',filters:[{name:ui('VLMReader 带批注文档','VLMReader annotated document'),extensions:['vlmbook']}]});
    if(result.canceled||!result.filePath)return null;const destination=path.extname(result.filePath).toLowerCase()==='.vlmbook'?result.filePath:result.filePath+'.vlmbook';return exportBundle(store,id,destination);
  });
  handle('books:read',async (id,original=false)=>{
    const b=bookById(id);b.lastRead=new Date().toISOString();store.save();
    const p=path.join(dataDir,'books',b.id+'.'+b.format);
    if(b.format==='docx'&&!original)return convertDocx(p);
    if(['txt','md','html','htm'].includes(b.format))return {text:readText(p),resources:imageResources(path.join(dataDir,'books',b.id+'-assets'))};
    return {bytes:new Uint8Array(fs.readFileSync(p))};
  });
  handle('books:update',(id,patch)=>{
    const b=bookById(id);
    if('collectionNotebookId' in patch&&patch.collectionNotebookId!=='unfiled'&&!store.state.notebooks.some(item=>item.id===patch.collectionNotebookId))throw Error('词本不存在');
    if('wordOriginal' in patch&&typeof patch.wordOriginal!=='boolean')throw Error('Invalid Word view');
    const next={...b};for(const key of ['wordOriginal','title','location','progress','favorite','cover','pageCount','collectionNotebookId'])if(key in patch)next[key]=patch[key];
    if(Object.keys(patch).some(key=>key!=='collectionNotebookId'))next.lastRead=new Date().toISOString();
    store.replaceState({...store.state,books:store.state.books.map(book=>book.id===id?next:book)});return next;
  });
  ipcMain.on('books:progress',(_event,id,patch)=>{
    const b=store.state.books.find(book=>book.id===id);
    if(!b||!patch||!Number.isFinite(patch.progress)||!(typeof patch.location==='string'||typeof patch.location==='number'&&Number.isFinite(patch.location)))return;
    b.location=typeof patch.location==='string'?patch.location.slice(0,12000):patch.location;b.progress=Math.max(0,Math.min(1,patch.progress));b.lastRead=new Date().toISOString();
    clearTimeout(progressSaveTimer);progressSaveTimer=setTimeout(()=>{try{store.save();}catch(error){main?.webContents.send('storage:error',error.message);}},600);
  });
  handle('books:delete',id=>{const b=bookById(id);const p=path.join(dataDir,'books',b.id+'.'+b.format);if(fs.existsSync(p))fs.unlinkSync(p);const images=path.resolve(dataDir,'books',b.id+'-assets');if(images.startsWith(path.resolve(dataDir,'books')+path.sep)&&fs.existsSync(images))fs.rmSync(images,{recursive:true});store.state.books=store.state.books.filter(b=>b.id!==id);store.state.bookmarks=store.state.bookmarks.filter(m=>m.bookId!==id);store.state.notebooks=store.state.notebooks.map(notebook=>({...notebook,bookIds:notebook.bookIds.filter(bookId=>bookId!==id)}));store.save();libraryExamples.queue();return true;});
  handle('wordbooks:list',()=>wordbooks.list());
  handle('wordbooks:preview',async(input={})=>{if(!input.path&&!input.builtin){const result=await dialog.showOpenDialog(main,{properties:['openFile'],filters:[{name:ui('词书','Word lists'),extensions:['csv','tsv','txt','xlsx','json']}]});if(result.canceled)return null;input={path:result.filePaths[0]};}return wordbooks.preview(input);});
  handle('wordbooks:import',(token,input)=>wordbooks.commit(token,input));
  handle('dictionary:custom-gloss',text=>dictionary.customGloss(String(text).slice(0,150)))
  handle('dictionary:lookup',text=>dictionary.lookup(String(text).slice(0,150)));
  handle('dictionary:suggest',text=>dictionary.suggest(String(text).slice(0,150)));
  handle('dictionary:history',()=>dictionaryHistory.list());
  handle('dictionary:history-add',input=>dictionaryHistory.add(input));
  handle('dictionary:history-clear',()=>dictionaryHistory.clear());
  handle('dictionary:rich',(word,generate)=>richDictionary(word,generate===true));
  handle('dictionaries:list',()=>dictionary.custom.list());
  handle('dictionaries:preview',async file=>{if(!file){const selected=await dialog.showOpenDialog(main,{title:ui('导入自定义词典','Import dictionary'),properties:['openFile'],filters:[{name:ui('离线词典','Offline dictionaries'),extensions:['csv','tsv','json','ifo','mobi','mdx']}]});if(selected.canceled)return null;file=selected.filePaths[0];}return dictionary.custom.preview(file);});
  handle('dictionaries:commit',(token,name)=>dictionary.custom.commit(token,name));
  handle('dictionaries:discard',token=>dictionary.custom.discard(token));
  handle('dictionaries:toggle',(id,enabled)=>dictionary.custom.update(id,enabled));
  handle('dictionaries:move',(id,beforeId)=>dictionary.custom.move(id,beforeId));
  handle('dictionaries:delete',id=>dictionary.custom.remove(id));
  handle('dictionaries:personal',()=>dictionary.custom.personalEntries());
  handle('dictionaries:ai',()=>dictionary.custom.aiEntries());
  handle('dictionaries:ai-delete',word=>dictionary.custom.deleteAi(String(word)));
  handle('dictionaries:save',(entry,oldWord)=>dictionary.custom.savePersonal(entry,oldWord));
  handle('dictionaries:delete-word',word=>dictionary.custom.deletePersonal(word));
  handle('dictionary:ai-lookup',text=>lookupAI(text,store.state.settings,getKey()));
  handle('dictionary:details',(input,generate)=>wordDetails(input,generate===true));
  handle('entries:production',id=>productionService.prepare(id));
  handle('entries:production-draft',(id,exerciseId,text)=>productionService.draft(id,exerciseId,text));
  handle('entries:production-hint',(id,exerciseId)=>productionService.hint(id,exerciseId));
  handle('entries:production-defer',(id,exerciseId)=>productionService.defer(id,exerciseId));
  handle('entries:production-answer',(id,exerciseId,text)=>productionService.submit(id,exerciseId,text));
  handle('dictionary:example',input=>{
    if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.length>100||typeof input.translation!=='string'||input.translation.length>4000)throw Error('请输入有效的单词和释义');
    const entry={text:normalize(input.text),translation:input.translation,definition:typeof input.definition==='string'?input.definition.slice(0,1500):'',kind:'word',language:/[\u3400-\u9fff]/.test(input.text)?'zh':'en'};
    return generateSentence(entry,store.state.settings,getKey());
  });
  handle('notebooks:create',input=>saveNotebook(store,input));
  handle('notebooks:cloze',()=>{
    let notebook=store.state.notebooks.find(item=>item.system==='cloze'||item.name==='句子填空');
    if(!notebook){notebook={id:crypto.randomUUID(),name:'句子填空',system:'cloze',bookIds:[],createdAt:new Date().toISOString()};store.replaceState({...store.state,notebooks:[...store.state.notebooks,notebook]});}
    return notebook;
  });
  handle('notebooks:update',(id,input)=>saveNotebook(store,input,id));
  handle('notebooks:delete',id=>deleteNotebook(store,id));
  handle('notebooks:assign',(id,ids,remove)=>assignEntries(store,id,ids,remove));
  handle('notebooks:move',(fromId,toId,ids)=>moveEntries(store,fromId,toId,ids));
  handle('entries:collect',async input=>{
    const text=normalize(input.text);let e=store.state.entries.find(e=>e.text.toLocaleLowerCase()===text.toLocaleLowerCase());
    notebookIds(store.state,input);
    if(!text||text.length>5000)throw Error('请选择有效的单词或句子');
    const encounter=entry=>{entry.encounters++;collectMembership(store.state,entry,input);const context=normalize(input.context||'');if(context&&(context!==entry.context||input.bookId!==entry.bookId)&&!entry.contexts.some(item=>item.context===context&&item.bookId===input.bookId))entry.contexts=[...entry.contexts,{context,bookId:input.bookId,bookTitle:input.bookTitle,location:input.location}].slice(-50);store.save();return entry;};
    if(e)return encounter(e);
    const found=await dictionary.lookup(text).catch(()=>null);
    // Another lookup can finish while the dictionary is loading. Recheck before insertion.
    e=store.state.entries.find(entry=>entry.text.toLocaleLowerCase()===text.toLocaleLowerCase());if(e)return encounter(e);
    e=withReviewSkills(makeEntry(input));
    if(found){if(!e.translation){e.translation=found.translation||found.definition;e.source=found.source;}e.definition=e.definition||found.definition;e.phonetic=found.phonetic;e.dictionaryWord=found.word;e.cueWords=found.cueWords;e.status='ready';if(/[\u3400-\u9fff]/.test(text))e.kind='word';}
    collectMembership(store.state,e,input);store.state.entries.unshift(e);store.save();libraryExamples.queue();return e;
  });
  handle('entries:translate',async id=>{const e=entryById(id);const {dictionary:found,...result}=await translate(e.text,e.context,store.state.settings,getKey(),e.kind);await rememberAiWord(found);rememberContextMeaning(e.text,e.context,result);const current=entryById(id);Object.assign(current,result,{updatedAt:new Date().toISOString()});store.save();return current;});
  handle('entries:cloze',id=>clozeService.prepare(id));
  handle('entries:cloze-answer',(id,exerciseId,answer)=>clozeService.submit(id,exerciseId,answer));
  handle('entries:cloze-hint',(id,exerciseId)=>clozeService.hint(id,exerciseId));
  handle('selection:translate',async(text,context,kind)=>{const clean=normalize(text).slice(0,5000);const nearby=normalize(context).slice(0,12000);const result=await translate(clean,nearby,store.state.settings,getKey(),kind==='word'?'word':'sentence');await rememberAiWord(result.dictionary);rememberContextMeaning(clean,nearby,result);return result;});
  handle('context:meaning',word=>contextMeanings.get(String(word||'')));
  handle('context:clear',()=>contextMeanings.clear());
  handle('entries:update',(id,patch)=>{const e=entryById(id);if('reviewTarget' in patch){const target=normalize(patch.reviewTarget);if(target.length>80||target&&!e.text.toLocaleLowerCase().includes(target.toLocaleLowerCase()))throw Error('填空目标必须是原句中的词或短语');patch={...patch,reviewTarget:target};}for(const key of ['translation','definition','context','note','suspended','kind','reviewTarget'])if(key in patch)e[key]=patch[key];e.status=e.translation?'ready':'pending';store.save();return e;});
  handle('entries:delete',id=>{store.deleteEntries([id]);libraryExamples.queue();return true;});
  handle('entries:delete-many',ids=>{const count=store.deleteEntries(ids);libraryExamples.queue();return count;});
  handle('entries:study',id=>{
    const entry=entryById(id),updated=studyEntry(entry);
    if(updated!==entry)store.replaceState({...store.state,entries:store.state.entries.map(item=>item.id===id?updated:item)});
    return updated;
  });
  handle('entries:review',(id,rating,mode='meaning')=>{
    const e=entryById(id);if(!e.translation)throw Error('请先补全译文再复习');
    const time=new Date(),updated=reviewEntry(e,rating,time,mode),record={entryId:id,mode,rating,time:time.toISOString(),isNew:isUnreviewed(e)};
    store.replaceState({...store.state,entries:store.state.entries.map(entry=>entry.id===id?updated:entry),stats:{...store.state.stats,reviews:[...store.state.stats.reviews,record]}});return updated;
  });
  handle('entries:undo',id=>{const e=entryById(id);if(!e.history.length)return e;const updated=undoReviewEntry(e),reviews=[...store.state.stats.reviews],index=reviews.findLastIndex(r=>r.entryId===id&&r.rating>0);if(index>=0)reviews.splice(index,1);store.replaceState({...store.state,entries:store.state.entries.map(entry=>entry.id===id?updated:entry),stats:{...store.state.stats,reviews}});return updated;});
  handle('entries:intervals',(id,mode='meaning')=>reviewIntervals(entryById(id),new Date(),mode));
  handle('bookmarks:add',input=>{const item={...input,id:crypto.randomUUID(),createdAt:new Date().toISOString()};store.state.bookmarks.unshift(item);store.save();return item;});
  handle('bookmarks:delete',id=>{store.state.bookmarks=store.state.bookmarks.filter(b=>b.id!==id);store.save();});
  handle('notes:add',input=>saveAnnotation(store,input));
  handle('notes:update',(id,patch)=>updateAnnotation(store,id,patch));
  handle('notes:delete',id=>deleteAnnotation(store,id));
  handle('settings:save',input=>{
    const updates={...input};
    if('readerPanelWidth' in updates&&(!Number.isInteger(updates.readerPanelWidth)||updates.readerPanelWidth<280||updates.readerPanelWidth>760))throw Error('侧栏宽度需为 280–760px');
    if('theme' in updates&&!['paper','white','sage','night'].includes(updates.theme))throw Error('阅读主题无效');
    if('readerPanelTab' in updates&&!['translation','marks'].includes(updates.readerPanelTab))throw Error('侧栏标签无效');
    if('annotationColor' in updates)validateColor(updates.annotationColor);
    if('colorThemes' in updates)updates.colorThemes=sanitizeColorThemes(updates.colorThemes,true);
    if('uiFontSize' in updates && (!Number.isInteger(updates.uiFontSize)||updates.uiFontSize<13||updates.uiFontSize>22))throw Error('界面字号需为 13–22px');
    if('reviewMethods' in updates&&(!Array.isArray(updates.reviewMethods)||!updates.reviewMethods.length||updates.reviewMethods.some(mode=>!REVIEW_METHODS.includes(mode))))throw Error('至少开启一种有效的复习方式');
    if('reviewMethods' in updates)updates.reviewMethods=REVIEW_METHODS.filter(mode=>updates.reviewMethods.includes(mode));
    if('reviewCustomDictionary' in updates)updates.reviewCustomDictionary=updates.reviewCustomDictionary===true;
    if('vocabPageSize' in updates&&![10,20,50].includes(updates.vocabPageSize))throw Error('每页条数无效');
    if('dictionarySources' in updates){const list=updates.dictionarySources;if(!Array.isArray(list)||list.some(id=>!Dictionary.SOURCES.includes(id)))throw Error('词典来源无效');updates.dictionarySources=Dictionary.SOURCES.filter(id=>list.includes(id));}
    if(updates.apiBase)updates.apiBase=validateBase(updates.apiBase);
    if('apiKey' in updates){const key=String(updates.apiKey).trim();if(key){if(!safeStorage.isEncryptionAvailable())throw Error('系统加密存储暂不可用');fs.writeFileSync(path.join(dataDir,'api-key.bin'),safeStorage.encryptString(key));}else{const p=path.join(dataDir,'api-key.bin');if(fs.existsSync(p))fs.unlinkSync(p);}delete updates.apiKey;}
    for(const key of Object.keys(DEFAULTS))if(key in updates && key!=='apiKeySet')store.state.settings[key]=updates[key];
    store.save();if('language' in updates)updateMenu();if('theme' in updates||'colorThemes' in updates)updateChrome();if('dictionarySources' in updates)dictionary.setSources(store.state.settings.dictionarySources);return {...store.state.settings,apiKeySet:!!getKey()};
  });
  handle('settings:test-api',()=>translate('Learning builds lasting understanding.','',store.state.settings,getKey()));
  // Calibrate the forgetting curve against this learner's own reviews. Nothing
  // leaves the machine and the default is kept unless the fit wins on holdout.
  handle('review:calibrate',()=>{
    const report=calibrate(store.state);
    if(report.status==='fitted'&&setDecay(report.decay)){
      store.state.settings.fsrsDecay=report.decay;store.save();
    }
    return report;
  });
  handle('speech:generate',generateSpeech);
  ipcMain.handle('speech:start',(event,id,text,enVoice,zhVoice)=>speechService.stream(String(id),text,enVoice,zhVoice,event.sender));
  ipcMain.handle('speech:cancel',(event,id)=>speechService.cancel(String(id),event.sender));
  handle('speech:warm',(text,enVoice,zhVoice)=>speechService.stream('',text,enVoice,zhVoice,null,true));
  handle('stats:minute',()=>{store.state.stats.minutes++;store.save();});
  handle('window:fullscreen',()=>{main.setFullScreen(!main.isFullScreen());return main.isFullScreen();});
  handle('window:print',()=>new Promise(resolve=>main.webContents.print({printBackground:true},(ok,reason)=>resolve({ok,reason}))));
  handle('data:open',()=>shell.openPath(dataDir));
  handle('data:export',async(type,notebookId)=>{
    const csv=type==='csv';if(csv&&notebookId&&!['unfiled','unreviewed','unreviewed-lists'].includes(notebookId)&&!store.state.notebooks.some(notebook=>notebook.id===notebookId))throw Error('词本不存在');
    const lists=wordlistIds(store.state.notebooks),entries=csv&&notebookId?store.state.entries.filter(entry=>inNotebook(entry,notebookId,lists)):store.state.entries;
    const result=await dialog.showSaveDialog(main,{defaultPath:'VLMReader-'+new Date().toISOString().slice(0,10)+(csv?'.csv':'.json'),filters:[{name:csv?ui('CSV 生词本','CSV vocabulary'):ui('JSON 资料备份','JSON data backup'),extensions:[csv?'csv':'json']}]});
    if(result.canceled)return null;fs.writeFileSync(result.filePath,csv?vocabularyCsv(entries,store.state.settings):JSON.stringify(store.state,null,2),'utf8');return result.filePath;
  });
  handle('data:import',async()=>{
    const result=await dialog.showOpenDialog(main,{properties:['openFile'],filters:[{name:ui('VLMReader JSON 备份','VLMReader JSON backup'),extensions:['json']}]});if(result.canceled)return null;
    const imported=JSON.parse(fs.readFileSync(result.filePaths[0],'utf8'));if(!Array.isArray(imported.entries))throw Error('这不是有效的 VLMReader 备份');
    const count=mergeBackup(store,imported);libraryExamples.queue();return count;
  });
  handle('data:backup',()=>{const p=path.join(dataDir,'backups','VLMReader-'+Date.now()+'.json');fs.writeFileSync(p,JSON.stringify(store.state,null,2));return p;});
  if(!store.state.books.length && fs.existsSync(path.join(assets,'欢迎阅读.html')))await importBooks([path.join(assets,'欢迎阅读.html')]);
  libraryExamples.queue();
  if(process.env.MEMREADER_DEV)await main.loadURL(process.env.MEMREADER_DEV);else await main.loadFile(path.join(__dirname,'..','dist','index.html'));
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{clearTimeout(progressSaveTimer);libraryExamples.stop();speechService.close();dictionary.close();store.save();});
