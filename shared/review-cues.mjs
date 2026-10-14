const clean=value=>String(value||'').normalize('NFKC').trim();
export function referenceDefinition(value){
  const text=clean(value).replace(/^(?:n|v|a|s|r|adj|adv)\.?\s+/i,'').replace(/^(?:[a-z'-]+\s+(?:is|are)\s+)?(?:the\s+)?(?=(?:past|present|plural|singular|comparative|superlative|imp\b))/i,'');
  return /^(?:(?:simple\s+)?past(?:\s+tense|\s+participle)?|present\s+participle|plural|singular|third[- ]person|comparative|superlative|inflected\s+form|(?:imp\.?|p\.?\s*p\.?|pres\.?\s*p\.?)(?:\s*[&,]\s*(?:imp\.?|p\.?\s*p\.?))?)\s+(?:form\s+)?(?:of|for)\b/i.test(text)
    ||/^(?:simple\s+)?past\s+(?:tense|participle)(?:\s+and\s+(?:past\s+)?(?:tense|participle))?\s+of\b/i.test(text)
    ||/^[a-z' -]+\s*(?:的)?(?:过去式|过去分词|现在分词|复数|比较级|最高级)/i.test(text);
}
export function semanticDefinition(value){
  return clean(value).split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!referenceDefinition(line)).join('\n');
}
export function maskCue(value,words=[]){
  let result=semanticDefinition(value);
  for(const word of [...new Set(words.map(clean).filter(Boolean))].sort((a,b)=>b.length-a.length)){
    const pattern=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    result=result.replace(new RegExp('(?<![\\p{L}\\p{M}])'+pattern+'(?![\\p{L}\\p{M}])','giu'),'______');
  }
  return result;
}
