import {Check} from 'lucide-react';
import type {HighlightColor} from './types';
import {highlightColors} from './highlights';
import {t} from './i18n';
export default function HighlightPalette({color,onChange,disabled=false}:{color:HighlightColor;onChange:(color:HighlightColor)=>void;disabled?:boolean}){
  return <div className="highlight-palette" role="group" aria-label={t('高亮颜色')}><span>{t('高亮颜色')}</span><div>{highlightColors.map(item=><button key={item.id} type="button" aria-label={t(item.label)} title={t(item.label)} aria-pressed={color===item.id} disabled={disabled} style={{background:item.fill}} onClick={()=>onChange(item.id)}>{color===item.id&&<Check size={14}/>}</button>)}</div></div>;
}
