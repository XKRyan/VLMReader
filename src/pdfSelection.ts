type Caret={node:Text;offset:number};
type Candidate={node:Text;rect:DOMRect;edges?:{x:number;offset:number}[]};
function textCandidates(root:Element){
  const candidates:Candidate[]=[];
  for(const span of root.querySelectorAll<HTMLElement>('.textLayer span')){
    if(span.firstChild?.nodeType!==Node.TEXT_NODE||!span.textContent?.trim()||span.querySelector('span'))continue;
    const rect=span.getBoundingClientRect();if(!rect.width||!rect.height)continue;
    candidates.push({node:span.firstChild as Text,rect});
  }
  return candidates;
}
function nearestCaret(root:Element,candidates:Candidate[],x:number,y:number):Caret|null{
  let best:Candidate|null=null,bestDistance=Infinity;
  for(const candidate of candidates){
    const {rect}=candidate;
    const vertical=Math.max(rect.top-y,y-rect.bottom,0),horizontal=Math.max(rect.left-x,x-rect.right,0);
    const distance=vertical*4+horizontal*.08;
    if(distance<bestDistance){best=candidate;bestDistance=distance;}
  }
  if(!best)return null;
  const {node}=best;let offset=0,distance=Infinity;
  // Glyph ranges account for PDF scale transforms and proportional fonts.
  if(!best.edges){
    best.edges=[];const range=root.ownerDocument.createRange();
    for(let at=0;at<node.length;at++){
      range.setStart(node,at);range.setEnd(node,at+1);const rect=range.getBoundingClientRect();
      best.edges.push({x:rect.left,offset:at},{x:rect.right,offset:at+1});
    }
  }
  for(const edge of best.edges){const next=Math.abs(x-edge.x);if(next<distance){distance=next;offset=edge.offset;}}
  return {node,offset};
}
export function installPdfDragSelection(root:HTMLElement){
  const doc=root.ownerDocument;let drag:{x:number;y:number;anchor:Node|null;offset:number}|null=null,frame=0,candidates:Candidate[]|null=null;
  function down(event:MouseEvent){
    if(event.button!==0||event.detail!==1||event.shiftKey||!(event.target instanceof Element)||!event.target.closest('.textLayer span'))return;
    drag={x:event.clientX,y:event.clientY,anchor:null,offset:0};candidates=null;
  }
  function correct(event:MouseEvent){
    if(!drag||Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<4)return;
    const selection=doc.getSelection();if(!selection?.anchorNode||!root.contains(selection.anchorNode))return;
    if(!drag.anchor){drag.anchor=selection.anchorNode;drag.offset=selection.anchorOffset;}
    candidates||=textCandidates(root);const focus=nearestCaret(root,candidates,event.clientX,event.clientY);if(!focus||!drag.anchor.isConnected)return;
    selection.setBaseAndExtent(drag.anchor,drag.offset,focus.node,focus.offset);
  }
  function move(event:MouseEvent){if(!drag)return;if(!(event.buttons&1)){drag=null;return;}cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>correct(event));}
  function up(event:MouseEvent){cancelAnimationFrame(frame);correct(event);drag=null;}
  function cancel(){cancelAnimationFrame(frame);drag=null;}
  function invalidate(){candidates=null;}
  root.addEventListener('mousedown',down);doc.addEventListener('mousemove',move);doc.addEventListener('mouseup',up,true);doc.defaultView?.addEventListener('blur',cancel);
  doc.addEventListener('scroll',invalidate,true);doc.defaultView?.addEventListener('resize',invalidate);
  return()=>{cancel();root.removeEventListener('mousedown',down);doc.removeEventListener('mousemove',move);doc.removeEventListener('mouseup',up,true);doc.defaultView?.removeEventListener('blur',cancel);doc.removeEventListener('scroll',invalidate,true);doc.defaultView?.removeEventListener('resize',invalidate);};
}
