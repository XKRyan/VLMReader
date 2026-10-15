const test=require('node:test'),assert=require('node:assert/strict');
test('annotation overview follows text position rather than creation time',async()=>{
 const {compareAnnotations}=await import('../shared/annotation-layout.mjs');
 const early={id:'early',start:5,location:800,createdAt:'2026-10-16'},late={id:'late',start:200,location:0,createdAt:'2026-10-01'};
 assert.deepEqual([late,early].sort((a,b)=>compareAnnotations(a,b,'docx')).map(item=>item.id),['early','late']);
 assert.ok(compareAnnotations({...early,location:1.9},{...late,location:2},'pdf')<0);
 assert.ok(compareAnnotations({cfi:'epubcfi(/6/2[chapter10]!/4/10:0)'},{cfi:'epubcfi(/6/10[chapter2]!/4/2:0)'},'epub')<0);
 assert.ok(compareAnnotations({cfi:'epubcfi(/6/2!/4/2:2)'},{cfi:'epubcfi(/6/2!/4/2:10)'},'epub')<0);
});
test('overlapping margin markers cluster without losing notes or leaving the viewport',async()=>{
 const {layoutAnnotationMarkers}=await import('../shared/annotation-layout.mjs');
 const input=[{key:'a',ids:['one'],top:10,bottom:50,draft:false},{key:'b',ids:['two','three'],top:14,bottom:45,draft:false},{key:'c',ids:[],top:30,bottom:52,draft:true},{key:'d',ids:['four'],top:90,bottom:120,draft:false},{key:'offscreen',ids:['hidden'],top:800,bottom:850,draft:false}];
 const groups=layoutAnnotationMarkers(input,400);assert.equal(groups.length,2);assert.deepEqual(groups[0].ids,['one','two','three']);assert.equal(groups[0].draft,true);assert.deepEqual(groups.flatMap(item=>item.ids),['one','two','three','four']);assert.ok(groups.every((item,i)=>item.top>=0&&item.top+26<=400&&(!i||item.top-groups[i-1].top>=34)));
});
