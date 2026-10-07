'use strict';
const assert=require('node:assert/strict');
const {popupBounds}=require('../../src/desktop/window-layout.cjs');

const area={x:0,y:24,width:1920,height:1016};
assert.deepEqual(popupBounds({x:1840,y:0,width:24,height:24},area,220,'darwin'),
  {x:1600,y:30,width:320,height:220});
assert.deepEqual(popupBounds({x:1840,y:1040,width:24,height:40},area,220,'win32'),
  {x:1600,y:814,width:320,height:220});
assert.deepEqual(popupBounds({x:1920,y:450,width:40,height:40},area,220,'win32'),
  {x:1594,y:360,width:320,height:220});
assert.deepEqual(popupBounds({x:-40,y:450,width:40,height:40},area,220,'win32'),
  {x:6,y:360,width:320,height:220});
assert.deepEqual(popupBounds(null,area,220,'win32'),
  {x:1600,y:820,width:320,height:220});
assert.deepEqual(popupBounds(null,area,220,'darwin'),
  {x:1600,y:24,width:320,height:220});
assert.deepEqual(popupBounds({x:2370,y:1020,width:24,height:40},
  {x:1920,y:0,width:480,height:1020},520,'win32'),
  {x:2080,y:494,width:320,height:520});
console.log('Tray popup placement passed');
