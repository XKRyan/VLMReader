export function onSelectionClick(doc:Document,onClick:(event:MouseEvent,newSelection:boolean)=>void){
  let gesture:{x:number;y:number;before:string;moved:boolean}|null=null;
  const down=(event:PointerEvent)=>{gesture={x:event.clientX,y:event.clientY,before:doc.getSelection()?.toString()||'',moved:false};};
  const move=(event:PointerEvent)=>{if(gesture&&event.buttons&1&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>3)gesture.moved=true;};
  const click=(event:MouseEvent)=>{
    const text=doc.getSelection()?.toString().trim()||'';
    const newSelection=!!text&&!!(gesture?.moved||event.detail>1||event.shiftKey||gesture&&text!==gesture.before.trim());
    gesture=null;onClick(event,newSelection);
  };
  doc.addEventListener('pointerdown',down,true);doc.addEventListener('pointermove',move);doc.addEventListener('click',click);
  return()=>{doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('pointermove',move);doc.removeEventListener('click',click);};
}
