const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto');
const JSZip=require('jszip');
const {convertDocx}=require('../electron/docx.cjs');
const {copyImages,imageResources}=require('../electron/document-files.cjs');
const fixtures=path.join(__dirname,'fixtures');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function sample(body,styles='',theme=''){
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="'+W+'"><w:body>'+body+'</w:body></w:document>');
  if(styles)zip.file('word/styles.xml','<w:styles xmlns:w="'+W+'">'+styles+'</w:styles>');
  if(theme)zip.file('word/theme/theme1.xml','<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Test">'+theme+'</a:clrScheme></a:themeElements></a:theme>');
  return zip.generateAsync({type:'nodebuffer'});
}
test('DOCX preserves highlights, source colors, inherited emphasis, tables and embedded image bytes',async()=>{
  const filename=path.join(fixtures,'Formatting.docx'),before=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  const {html,warnings}=await convertDocx(filename);
  assert.match(html,/<span style="color:#000000;background-color:#ffff00;">yellow highlight<\/span>/);
  assert.match(html,/<span style="color:#c00000;"><strong>red text<\/strong><\/span>/);
  assert.match(html,/<span style="color:#0066cc;">Paragraph style carries blue ink\.<\/span>/);
  assert.match(html,/<span style="color:#800000;background-color:#00ffff;"><strong>retrieval<\/strong><\/span>/);
  assert.match(html,/<span style="color:#ffffff;background-color:#000080;">Dark blue highlight<\/span>/);
  assert.match(html,/<u>underlined detail<\/u>/);
  assert.match(html,/background-color:#d8ead3/);assert.match(html,/<table>/);assert.match(html,/color:#008000;background-color:#ffff00/);
  const image=html.match(/<img src="data:image\/png;base64,([^"]+)"/);assert.ok(image);
  assert.deepEqual(Buffer.from(image[1],'base64'),fs.readFileSync(path.join(fixtures,'formatting-figure.png')));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),before,'Reading must not modify the original document');
  assert.ok(warnings.every(message=>message.startsWith('Unrecognised paragraph style:')),'No image or generated-format warnings');
});
test('DOCX resolves based-on styles and explicit highlight/color resets',async()=>{
  const styles='<w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:rPr><w:color w:val="0066CC"/><w:highlight w:val="yellow"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Derived"><w:basedOn w:val="Base"/><w:name w:val="Derived"/></w:style>';
  const body='<w:p><w:pPr><w:pStyle w:val="Derived"/></w:pPr><w:r><w:t>Inherited</w:t></w:r><w:r><w:rPr><w:highlight w:val="none"/><w:color w:val="auto"/></w:rPr><w:t>Reset</w:t></w:r></w:p>';
  const {html}=await convertDocx(await sample(body,styles));assert.match(html,/style="color:#0066cc;background-color:#ffff00;">Inherited<\/span>Reset/);
});
test('DOCX theme tint/shade preserve Word rounding and override stale RGB values',async()=>{
  const run=(text,attributes)=>'<w:r><w:rPr><w:color '+attributes+'/></w:rPr><w:t>'+text+'</w:t></w:r>';
  const {html}=await convertDocx(await sample('<w:p>'+run('Tint','w:val="00FF00" w:themeColor="accent1" w:themeTint="99"')+run('Shade','w:val="943634" w:themeColor="accent2" w:themeShade="BF"')+'</w:p>','','<a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2>'));
  assert.match(html,/color:#95b3d7;">Tint/);assert.match(html,/color:#9436(?:34|35);">Shade/);
});
test('HTML and Markdown images remain local and readable after the source file is removed',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-document-'));
  try{
    const source=path.join(temp,'source'),assets=path.join(temp,'book-assets');fs.mkdirSync(source);fs.copyFileSync(path.join(fixtures,'formatting-figure.png'),path.join(source,'figure with space.png'));
    const file=path.join(source,'book.md');fs.writeFileSync(file,'![Figure](<figure with space.png>)\n<img src="figure%20with%20space.png">\n![outside](../private.png)\n![remote](https://invalid.example/image.png)');
    copyImages(file,assets);fs.unlinkSync(path.join(source,'figure with space.png'));
    const resources=imageResources(assets);assert.equal(Object.keys(resources).length,2);assert.ok(resources['figure with space.png'].startsWith('data:image/png;base64,'));assert.equal(resources['figure with space.png'],resources['figure%20with%20space.png']);
  }finally{assert.ok(temp.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
});
