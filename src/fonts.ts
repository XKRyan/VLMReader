export const fontOptions=['Inter','Microsoft YaHei','SimSun','KaiTi','SimHei','Segoe UI','Arial','Calibri','Georgia','Times New Roman','Courier New'];
export function fontStack(font:string,serif=false){
  const selected=font.trim().replace(/["\\\r\n]/g,'');
  return (selected?'"'+selected+'", ':'')+(serif?'Georgia, "Noto Serif CJK SC", SimSun, serif':'Inter, "Microsoft YaHei", sans-serif');
}
