const fs = require('node:fs');
const path = require('node:path');
const {sanitizeColorThemes}=require('./palette.cjs');
const {withReviewSkills}=require('./core.cjs');
const {enabledMethods}=require('../shared/review-policy.mjs');
const DEFAULTS = { theme: 'paper', colorThemes:{}, fontSize: 19, lineHeight: 1.9, contentWidth: 760, fontFamily: 'serif', uiFont:'Inter',uiFontSize:16,readingFont:'',pdfTextMode:false,
  autoSave: true, autoSaveSentences:false, preloadSpeech:true, hoverTranslate: false, rate: 1, enVoice: 0, zhVoice: 3, language:'zh', continuousRead:true,
  newPerDay: 20, vocabPageSize:20,reviewMethods:['meaning','cloze','spelling'],reviewMode: 'meaning', sentenceReviewMode:'meaning', apiBase: 'https://api.deepseek.com', apiModel: 'deepseek-flash', apiKeySet: false };
class Store {
  constructor(dir) {
    this.dir = dir; fs.mkdirSync(dir, {recursive:true});
    for (const sub of ['books','backups','audio']) fs.mkdirSync(path.join(dir,sub),{recursive:true});
    this.file = path.join(dir,'library.json');
    this.state = { version:1, books:[], entries:[], notebooks:[], bookmarks:[], notes:[], settings:{...DEFAULTS}, stats:{minutes:0,reviews:[]} };
    if (fs.existsSync(this.file)) {
      try { this.state = {...this.state,...JSON.parse(fs.readFileSync(this.file,'utf8'))}; }
      catch {
        const backup = this.file+'.bak';
        if (!fs.existsSync(backup)) throw Error('资料库文件损坏，请从备份恢复');
        this.state = {...this.state,...JSON.parse(fs.readFileSync(backup,'utf8'))};
        fs.copyFileSync(this.file,path.join(dir,'backups','library-damaged-'+Date.now()+'.json'));
      }
    }
    this.state.settings = {...DEFAULTS,...this.state.settings};
    this.state.settings.colorThemes = sanitizeColorThemes(this.state.settings.colorThemes);
    this.state.settings.reviewMethods=enabledMethods(this.state.settings);
    this.state.entries=this.state.entries.map(entry=>{
      const last=this.state.stats.reviews.findLast(record=>record.entryId===entry.id);
      const legacyMode=last?.mode|| (last?.exerciseId?'cloze':'meaning');
      return withReviewSkills(entry,legacyMode);
    });
    if(!Array.isArray(this.state.notebooks))this.state.notebooks=[];
    for(const entry of this.state.entries)entry.notebookIds=[...new Set((Array.isArray(entry.notebookIds)?entry.notebookIds:[]).filter(id=>this.state.notebooks.some(book=>book.id===id)))];
    if (!Number.isInteger(this.state.settings.uiFontSize) || this.state.settings.uiFontSize < 13 || this.state.settings.uiFontSize > 22) this.state.settings.uiFontSize = DEFAULTS.uiFontSize;
  }
  replaceState(next){const previous=this.state;this.state=next;try{this.save();}catch(error){this.state=previous;throw error;}}
  deleteEntries(ids) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) throw Error('请选择要删除的条目');
    const targets = new Set(ids), entries = this.state.entries, reviews = this.state.stats.reviews;
    const remaining = entries.filter(entry => !targets.has(entry.id)), count = entries.length - remaining.length;
    if (!count) return 0;
    this.state.entries = remaining;
    this.state.stats.reviews = reviews.filter(review => !targets.has(review.entryId));
    try { this.save(); } catch (error) { this.state.entries = entries; this.state.stats.reviews = reviews; throw error; }
    return count;
  }
  save() {
    const tmp = this.file+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(this.state,null,2),'utf8');
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file,this.file+'.bak');
    fs.renameSync(tmp,this.file);
  }
}
module.exports = { Store, DEFAULTS };
