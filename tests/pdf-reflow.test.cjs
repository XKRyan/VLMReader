const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../src/pdfReflow.ts'),loaded=new Module(filename,module);loaded.paths=module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023}}).outputText,filename);
const {buildPdfReflow}=loaded.exports;
async function pageModel(file,number=1){const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs'),doc=await pdf.getDocument({data:new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures',file))),standardFontDataUrl:path.resolve(__dirname,'../node_modules/pdfjs-dist/standard_fonts').replace(/\\/g,'/')+'/'}).promise;
  try{const page=await doc.getPage(number),[text,operators,annotations]=await Promise.all([page.getTextContent(),page.getOperatorList({annotationMode:pdf.AnnotationMode.DISABLE}),page.getAnnotations({intent:'display'})]);return buildPdfReflow(text,operators,annotations,page.getViewport({scale:1,rotation:0}),pdf.OPS);}finally{await doc.destroy();}}
function text(model){return model.blocks.filter(b=>b.kind==='text').flatMap(b=>b.runs).map(r=>r.text).join(' ');}
function marked(model){return model.blocks.filter(b=>b.kind==='text').flatMap(b=>b.runs).filter(r=>r.background).map(r=>r.text).join('|');}
test('real PDF preserves partial/multiline highlights, ink, image order and vector labels',async()=>{
  const model=await pageModel('Reflow.pdf');assert.match(marked(model),/recall/);assert.match(marked(model),/curious/);assert.match(marked(model),/sentence/);assert.match(marked(model),/Reflow keeps/);
  assert.doesNotMatch(marked(model),/Active|thoughtful|across/,'Highlight boundaries must not spread onto adjacent words');
  assert.match(marked(model),/spacing/);assert.doesNotMatch(marked(model),/Careful|keeps marks/,'Monospaced PDF spaces must have their original widths');
  const runs=model.blocks.filter(b=>b.kind==='text').flatMap(b=>b.runs);assert.ok(runs.some(r=>r.text.includes('Colored ink')&&r.color==='#0066cc'));
  assert.equal(model.blocks.filter(b=>b.kind==='figure').length,3);assert.doesNotMatch(text(model),/\bREAD\b|\bRECALL\b/,'Figure labels must stay in the figure rather than repeat in the prose');
  const at=model.blocks.findIndex(b=>b.kind==='figure');assert.ok(at>0&&at<model.blocks.length-1);assert.match(model.blocks[at+1].runs.map(r=>r.text).join(''),/Figure 1/);
  assert.match(text(model),/Figure 1\. Read, recall and review\./,'Nearby caption text outside a rotated image must remain complete and editable');assert.ok(model.blocks.filter(b=>b.kind==='figure')[1].polygons);
});
test('flattened highlight remains text, and rotation and scanned images remain visible',async()=>{
  const flat=await pageModel('Formatting.pdf');assert.equal(flat.blocks.filter(b=>b.kind==='figure').length,1);assert.match(marked(flat),/Highlighted source text stays colored/);assert.ok(flat.blocks[1].runs.every(r=>r.color==='#800000'));
  const rotated=await pageModel('Reflow.pdf',2);assert.match(marked(rotated),/Rotation/);assert.equal(rotated.blocks.filter(b=>b.kind==='figure').length,1);
  const scanned=await pageModel('Reflow.pdf',3);assert.equal(scanned.blocks.filter(b=>b.kind==='figure').length,1);assert.equal(text(scanned),'');
});
test('hidden annotations and page backgrounds cannot become spurious highlights or figures',()=>{
  const content={items:[{str:'Keep learning',transform:[16,0,0,16,40,160],width:100,height:16,hasEOL:true}],styles:{}},viewport={width:300,height:200,transform:[1,0,0,-1,0,200]},ops={setFillRGBColor:1,constructPath:2,fill:3};
  const model=buildPdfReflow(content,{fnArray:[1,2],argsArray:[['#ffffff'],[3,[null],[0,0,300,200]]]},[{subtype:'Highlight',rect:[40,158,140,175],color:[255,255,0],annotationFlags:2}],viewport,ops);
  assert.equal(marked(model),'');assert.equal(model.blocks.length,1);assert.equal(text(model),'Keep learning');
});
