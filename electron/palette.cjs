const BASE = {
  paper: {bg:'#f7f6f2',surface:'#fffefa',paper:'#fffdf7',sidebar:'#f6f5f0',text:'#273044',muted:'#7a7d83',line:'#e9e6dd',secondary:'#f4f2eb',accent:'#5365dc'},
  white: {bg:'#f6f7fb',surface:'#ffffff',paper:'#ffffff',sidebar:'#f6f7fb',text:'#273044',muted:'#737e91',line:'#e5e8ef',secondary:'#f5f6fa',accent:'#5365dc'},
  sage: {bg:'#f2f6f4',surface:'#fafffc',paper:'#f8fcf9',sidebar:'#f0f5f3',text:'#273044',muted:'#737e91',line:'#e1e9e5',secondary:'#edf3ef',accent:'#5365dc'},
  night: {bg:'#171c26',surface:'#202632',paper:'#202632',sidebar:'#171c26',text:'#e5e9f2',muted:'#a0aabe',line:'#333c4d',secondary:'#2b3343',accent:'#a0adff'}
};
const KEYS = ['accent','bg','paper','readingText'];
function color(value){
  if(typeof value!=='string')return null;
  const input=value.trim();
  if(/^#[0-9a-f]{6}$/i.test(input))return input.toLowerCase();
  if(/^#[0-9a-f]{3}$/i.test(input))return '#'+[...input.slice(1)].map(char=>char+char).join('').toLowerCase();
  return null;
}
function sanitizeColorThemes(input,strict=false){
  if(!input||typeof input!=='object'||Array.isArray(input)){if(strict)throw Error('配色设置无效');return {};}
  const result={};
  for(const [theme,values] of Object.entries(input)){
    if(!Object.hasOwn(BASE,theme)||!values||typeof values!=='object'||Array.isArray(values)){if(strict)throw Error('配色设置无效');continue;}
    const cleaned={};
    for(const [key,value] of Object.entries(values)){
      const hex=color(value);
      if(!KEYS.includes(key)||!hex){if(strict)throw Error('颜色需为有效的十六进制色值');continue;}
      cleaned[key]=hex;
    }
    if(Object.keys(cleaned).length)result[theme]=cleaned;
  }
  return result;
}
function rgb(hex){return [1,3,5].map(at=>parseInt(hex.slice(at,at+2),16));}
function mix(a,b,weight){return '#'+rgb(a).map((value,i)=>Math.round(value*(1-weight)+rgb(b)[i]*weight).toString(16).padStart(2,'0')).join('');}
function luminance(hex){const values=rgb(hex).map(value=>{const v=value/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function foreground(background){return contrast(background,'#ffffff')>=contrast(background,'#171c26')?'#ffffff':'#171c26';}
function readable(value,background,target=4.5){
  if(contrast(value,background)>=target)return value;
  const end=foreground(background);
  for(let step=1;step<=100;step++){const candidate=mix(value,end,step/100);if(contrast(candidate,background)>=target)return candidate;}
  return end;
}
function getPalette(settings){
  const theme=Object.hasOwn(BASE,settings.theme)?settings.theme:'paper';
  const base=BASE[theme],overrides=sanitizeColorThemes(settings.colorThemes)[theme]||{};
  const p={...base,...overrides},dark=luminance(p.bg)<.18;
  if(overrides.bg){
    p.sidebar=p.bg;p.surface=mix(p.bg,dark?'#2c3547':'#ffffff',.48);
    p.secondary=mix(p.bg,p.surface,.5);p.line=mix(p.surface,foreground(p.surface),.13);
    p.text=readable(base.text,p.surface);p.muted=readable(mix(p.text,p.surface,.38),p.surface);
  }
  p.readingText=overrides.readingText||readable(base.text,p.paper);
  p.accentText=readable(p.accent,p.surface);
  p.onAccent=foreground(p.accent);
  p.accentHover=mix(p.accent,p.onAccent==='#ffffff'?'#000000':'#ffffff',.12);
  p.soft=mix(p.surface,p.accent,dark?.19:.1);
  p.selection=mix(p.paper,p.accent,.25);
  p.annotationFill=p.accent+'55';
  p.danger=readable(dark?'#f294a0':'#b7454e',p.surface);
  p.shadow=dark?'none':'0 12px 36px #24304b0c';
  return p;
}
module.exports={BASE,KEYS,color,sanitizeColorThemes,getPalette,contrast};
