import {useEffect,useState} from 'react';
import {fontOptions,fontStack} from './fonts';
import {t} from './i18n';
export default function FontSelect({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
  const [custom,setCustom]=useState(!!value&&!fontOptions.includes(value)),[draft,setDraft]=useState(value);
  useEffect(()=>{setDraft(value);if(value&&!fontOptions.includes(value))setCustom(true);},[value]);
  const commit=()=>{const name=draft.trim().slice(0,100);if(name!==value)onChange(name);};
  return <div className="font-control"><select aria-label={label} value={custom?'custom':value} onChange={event=>{const next=event.target.value;setCustom(next==='custom');if(next!=='custom')onChange(next);}}>
    <option value="">{t('默认字体')}</option>{fontOptions.map(font=><option key={font} value={font} style={{fontFamily:fontStack(font)}}>{font}</option>)}<option value="custom">{t('自定义字体…')}</option>
  </select>{custom&&<input aria-label={label+' '+t('字体名称')} placeholder={t('输入已安装的字体名称')} value={draft} onChange={event=>setDraft(event.target.value)} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/>}</div>;
}
