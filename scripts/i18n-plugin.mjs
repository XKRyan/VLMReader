export default function localization({types:t}){
  return {name:'memreader-localization',visitor:{
    Program(path,state){if(!/src[\\/](App|Reader|ReviewView|useSpeech|main)\.tsx?$/.test(state.filename||''))return;state.memEnabled=true;path.unshiftContainer('body',t.importDeclaration([t.importSpecifier(t.identifier('__t'),t.identifier('t'))],t.stringLiteral('./i18n')));},
    StringLiteral(path,state){
      if(!state.memEnabled||!/[\u3400-\u9fff]/.test(path.node.value)||!path.getFunctionParent())return;
      if(path.parentPath.isCallExpression()&&path.parentPath.node.callee.name==='__t')return;
      if(path.parentPath.isImportDeclaration()||path.parentPath.isExportNamedDeclaration()||path.parentPath.isTSLiteralType()||path.key==='key'&&path.parentPath.isObjectProperty())return;
      const call=t.callExpression(t.identifier('__t'),[t.stringLiteral(path.node.value)]);
      if(path.parentPath.isJSXAttribute())path.replaceWith(t.jsxExpressionContainer(call));else path.replaceWith(call);path.skip();
    },
    JSXText(path,state){if(!state.memEnabled||!/[\u3400-\u9fff]/.test(path.node.value))return;path.replaceWith(t.jsxExpressionContainer(t.callExpression(t.identifier('__t'),[t.stringLiteral(path.node.value)])));path.skip();}
  }};
}
