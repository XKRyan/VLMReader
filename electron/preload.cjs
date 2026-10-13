const {contextBridge,ipcRenderer,webUtils}=require('electron');
const invoke=channel=>(...args)=>ipcRenderer.invoke(channel,...args);
contextBridge.exposeInMainWorld('mem',{
  boot:invoke('boot'), importBooks:invoke('books:import'), readBook:invoke('books:read'), updateBook:invoke('books:update'), deleteBook:invoke('books:delete'),
  reportProgress:(id,patch)=>ipcRenderer.send('books:progress',id,patch),
  createNotebook:invoke('notebooks:create'),updateNotebook:invoke('notebooks:update'),deleteNotebook:invoke('notebooks:delete'),assignNotebook:invoke('notebooks:assign'),
  onStorageError:fn=>{const listener=(_event,message)=>fn(message);ipcRenderer.on('storage:error',listener);return()=>ipcRenderer.removeListener('storage:error',listener);},
  lookup:invoke('dictionary:lookup'),lookupAI:invoke('dictionary:ai-lookup'),dictionaryExample:invoke('dictionary:example'), collect:invoke('entries:collect'), translate:invoke('entries:translate'), translateSelection:invoke('selection:translate'), updateEntry:invoke('entries:update'), deleteEntry:invoke('entries:delete'), deleteEntries:invoke('entries:delete-many'),
  review:invoke('entries:review'), undoReview:invoke('entries:undo'), intervals:invoke('entries:intervals'),
  cloze:invoke('entries:cloze'),answerCloze:invoke('entries:cloze-answer'),hintCloze:invoke('entries:cloze-hint'),clozeNotebook:invoke('notebooks:cloze'),
  bookmark:invoke('bookmarks:add'), deleteBookmark:invoke('bookmarks:delete'), note:invoke('notes:add'), updateNote:invoke('notes:update'), deleteNote:invoke('notes:delete'),
  saveSettings:invoke('settings:save'), testApi:invoke('settings:test-api'), exportData:invoke('data:export'), importData:invoke('data:import'), backup:invoke('data:backup'),
  speak:invoke('speech:generate'),startSpeech:invoke('speech:start'),cancelSpeech:invoke('speech:cancel'),warmSpeech:invoke('speech:warm'), minute:invoke('stats:minute'), fullscreen:invoke('window:fullscreen'), print:invoke('window:print'), openData:invoke('data:open'),
  onSpeech:fn=>{const listener=(_event,message)=>fn(message);ipcRenderer.on('speech:event',listener);return()=>ipcRenderer.removeListener('speech:event',listener);},
  getPath:file=>webUtils.getPathForFile(file),
  onImport:fn=>{const listener=()=>fn();ipcRenderer.on('import-request',listener);return()=>ipcRenderer.removeListener('import-request',listener);},
});
