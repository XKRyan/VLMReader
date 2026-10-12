import {useEffect,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import {Check,ChevronDown,Palette,RotateCcw} from 'lucide-react';
import {color,contrast,getPalette} from '../electron/palette.cjs';
import type {ColorKey} from '../electron/palette.cjs';
import type {Settings} from './types';
import {t} from './i18n';

const fields:{key:ColorKey;label:string}[]=[{key:'accent',label:'主题色'},{key:'bg',label:'界面背景'},{key:'paper',label:'阅读底色'},{key:'readingText',label:'正文文字'}];
const accents=['#5365dc','#477a72','#805d9b','#a5683d','#477eab','#af566b'];
function values(s:Settings){const p=getPalette(s);return {accent:p.accent,bg:p.bg,paper:p.paper,readingText:p.readingText};}

export default function ColorSettings({settings:s,saveSettings}:{settings:Settings;saveSettings:(patch:Partial<Settings>)=>Promise<Settings>}){
  const [open,setOpen]=useState(false),[draft,setDraft]=useState(()=>values(s)),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
  const saving=useRef(false),profile=JSON.stringify(s.colorThemes[s.theme]||{});
  useEffect(()=>{setDraft(values(s));},[s.theme,profile]);
  useEffect(()=>{setSaved(false);},[s.theme]);
  const valid=fields.every(field=>color(draft[field.key]));
  const dirty=fields.some(field=>color(draft[field.key])!==values(s)[field.key]);
  const preview=getPalette({...s,colorThemes:{...s.colorThemes,[s.theme]:Object.fromEntries(fields.map(field=>[field.key,color(draft[field.key])||values(s)[field.key]]))}});
  function change(key:ColorKey,value:string){setDraft(current=>({...current,[key]:value}));setSaved(false);}
  async function apply(reset=false){
    if(saving.current||!reset&&!valid)return;saving.current=true;setBusy(true);
    try{
      const next={...s.colorThemes};
      if(reset)delete next[s.theme];else next[s.theme]=Object.fromEntries(fields.map(field=>[field.key,color(draft[field.key])!]));
      const result=await saveSettings({colorThemes:next});setDraft(values(result));setSaved(true);
    }catch{/* The settings owner displays save errors. */}finally{saving.current=false;setBusy(false);}
  }
  return <div className={'color-settings '+(open?'expanded':'')}>
    <button className="color-settings-toggle" aria-expanded={open} aria-controls="color-editor" onClick={()=>setOpen(value=>!value)}>
      <Palette size={17}/><span>{t('调整配色')}</span><span className="color-summary" aria-hidden="true">{fields.map(field=><i key={field.key} style={{background:values(s)[field.key]}}/>)}</span><ChevronDown size={16}/>
    </button>
    {open&&<div id="color-editor" className="color-editor">
      <div className="accent-swatches" role="group" aria-label={t('常用主题色')}>{accents.map(hex=><button key={hex} title={hex} aria-label={t('主题色')+' '+hex} aria-pressed={color(draft.accent)===hex} style={{background:hex}} onClick={()=>change('accent',hex)}>{color(draft.accent)===hex&&<Check size={14}/>}</button>)}</div>
      <div className="color-fields">{fields.map(field=><label key={field.key} className="color-field"><span>{t(field.label)}</span><span className="color-inputs"><input type="color" aria-label={t('选择')+t(field.label)} value={color(draft[field.key])||values(s)[field.key]} onChange={event=>change(field.key,event.target.value)} disabled={busy}/><input type="text" aria-label={t(field.label)+t('色值')} value={draft[field.key]} maxLength={7} spellCheck={false} aria-invalid={!color(draft[field.key])} onChange={event=>change(field.key,event.target.value)} onBlur={()=>{const normalized=color(draft[field.key]);if(normalized)change(field.key,normalized);}} disabled={busy}/></span></label>)}</div>
      <div className="color-preview" aria-label={t('配色预览')} style={{'--preview-bg':preview.bg,'--preview-paper':preview.paper,'--preview-text':preview.readingText,'--preview-accent':preview.accent,'--preview-on-accent':preview.onAccent,'--preview-ui-text':preview.text} as CSSProperties}>
        <div className="color-preview-bar"><span>VLMReader</span><span className="preview-action">Aa</span></div><div className="color-preview-page"><strong>{t('阅读预览')}</strong><p>Read. Understand. Remember.</p><p>阅读，让思考留下来。</p></div>
      </div>
      {(!valid||contrast(preview.paper,preview.readingText)<4.5)&&<p className="color-hint" role="status">{t(!valid?'请输入 #RRGGBB 或 #RGB 色值':'文字与底色的对比度较低，可调整后预览。')}</p>}
      <div className="color-actions"><button className="text-button" onClick={()=>void apply(true)} disabled={busy}><RotateCcw size={14}/>{t('恢复默认配色')}</button><button className="primary compact" disabled={busy||!valid||!dirty} onClick={()=>void apply()}>{saved&&!dirty?<><Check size={14}/>{t('已保存')}</>:t(busy?'正在保存…':'应用配色')}</button></div>
    </div>}
  </div>;
}
