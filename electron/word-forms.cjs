const labels={p:'过去式',d:'过去分词',i:'现在分词',3:'第三人称单数',s:'复数',r:'比较级',t:'最高级'};
const key=text=>String(text||'').normalize('NFKC').trim().toLowerCase();
function inflections(found){
  const forms=[],word=key(found?.word);
  for(const part of String(found?.exchange||'').split('/')){
    const at=part.indexOf(':'),code=part.slice(0,at),values=part.slice(at+1);
    if(!labels[code])continue;
    for(const value of values.split(/[,;]+/).map(value=>value.trim())){
      if(!/^[a-z][a-z'’ -]{0,59}$/i.test(value)||forms.some(form=>form.word===value&&form.code===code))continue;
      forms.push({word:value,code,label:labels[code]});
    }
  }
  const lemma=String(found?.exchange||'').split('/').find(part=>part.startsWith('0:'))?.slice(2);
  return {lemma:lemma&&key(lemma)!==word?lemma:'',forms:forms.slice(0,16)};
}
function family(found,entry){
  const info=inflections(found);
  // An inflected headword can have a different lexical sense (e.g. "running").
  // Do not turn its lemma's entire family into accepted answers automatically.
  if(entry.language!=='en'||key(found?.word)!==key(entry.text)||info.lemma)return [];
  return info.forms.filter(form=>key(form.word)!==key(entry.text));
}
function canVary(entry,now=new Date()){
  const skill=entry.reviewSkills?.cloze,practice=entry.clozePractice||{};
  return practice.unassistedStreak>=2&&practice.firstUnassistedAt&&+now-new Date(practice.firstUnassistedAt)>=86400000
    &&skill?.card.state===2&&[3,4].includes(skill.lastRating);
}
module.exports={inflections,family,canVary};
