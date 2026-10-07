'use strict';
function mainSize(area){
  const width=Math.max(320,Math.round(area.width/4));
  const height=Math.max(480,Math.round(area.height*2/3));
  return {width:Math.min(width,area.width),height:Math.min(height,area.height)};
}
function popupBounds(anchor,area,height,platform=process.platform){
  const width=Math.min(320,area.width),boundedHeight=Math.min(height,area.height),gap=6;
  const right=area.x+area.width,bottom=area.y+area.height;
  const clamp=(value,start,end)=>Math.max(start,Math.min(value,end));
  if(!anchor||anchor.width<=0||anchor.height<=0)return {
    width,height:boundedHeight,x:right-width,
    y:platform==='darwin'?area.y:bottom-boundedHeight
  };
  let x=anchor.x+anchor.width/2-width/2;
  let y=anchor.y+anchor.height+gap;
  if(anchor.y>=bottom)y=anchor.y-boundedHeight-gap;
  else if(anchor.y+anchor.height<=area.y)y=anchor.y+anchor.height+gap;
  else if(anchor.x>=right){x=anchor.x-width-gap;y=anchor.y+anchor.height/2-boundedHeight/2;}
  else if(anchor.x+anchor.width<=area.x){x=anchor.x+anchor.width+gap;y=anchor.y+anchor.height/2-boundedHeight/2;}
  else if(y+boundedHeight>bottom&&anchor.y-boundedHeight-gap>=area.y)y=anchor.y-boundedHeight-gap;
  return {width,height:boundedHeight,x:clamp(Math.round(x),area.x,right-width),
    y:clamp(Math.round(y),area.y,bottom-boundedHeight)};
}
module.exports={mainSize,popupBounds};
