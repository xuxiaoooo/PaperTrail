'use strict';
function mainSize(area){
  const width=Math.max(320,Math.round(area.width/4));
  const height=Math.max(480,Math.round(area.height*2/3));
  return {width:Math.min(width,area.width),height:Math.min(height,area.height)};
}
function popupBounds(anchor,area,height){
  const width=Math.min(320,area.width),boundedHeight=Math.min(height,area.height);
  const clamp=(value,start,size)=>Math.max(start,Math.min(value,start+size));
  return {width,height:boundedHeight,x:clamp(Math.round(anchor.x+anchor.width/2-width/2),area.x,area.width-width),
    y:clamp(Math.round(anchor.y+anchor.height+5),area.y,area.height-boundedHeight)};
}
module.exports={mainSize,popupBounds};
