const cfiNumbers=value=>String(value||'').replace(/\[[^\]]*\]/g,'').match(/\d+/g)?.map(Number)||[];
export function compareAnnotations(a,b,format){
  if(format==='epub'){
    const left=cfiNumbers(a.cfi||a.location),right=cfiNumbers(b.cfi||b.location);
    for(let i=0;i<Math.max(left.length,right.length);i++){const difference=(left[i]??-1)-(right[i]??-1);if(difference)return difference;}
  }else if(format==='pdf'){
    const difference=Math.floor(Number(a.location)||1)-Math.floor(Number(b.location)||1);if(difference)return difference;
  }
  const difference=(a.start??Number.MAX_SAFE_INTEGER)-(b.start??Number.MAX_SAFE_INTEGER);if(difference)return difference;
  return String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id||'').localeCompare(String(b.id||''));
}
// Nearby paragraph markers share a badge rather than obscuring one another.
export function layoutAnnotationMarkers(items,height,gap=34){
  const visible=items.filter(item=>item.bottom>0&&item.top<height).sort((a,b)=>a.top-b.top),groups=[];
  for(const item of visible){const previous=groups.at(-1);if(previous&&item.top-previous.top<gap){previous.ids.push(...item.ids);previous.draft||=item.draft;previous.bottom=Math.max(previous.bottom,item.bottom);}else groups.push({...item,ids:[...item.ids]});}
  const maximum=Math.max(8,height-30);let last=-gap;
  for(const group of groups){group.top=Math.max(8,Math.min(maximum,group.top),last+gap);last=group.top;}
  for(let i=groups.length-1;i>=0;i--)groups[i].top=Math.min(groups[i].top,i===groups.length-1?maximum:groups[i+1].top-gap);
  return groups;
}
