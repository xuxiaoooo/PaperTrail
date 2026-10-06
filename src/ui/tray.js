'use strict';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
let refreshing=false;
function render(state){
  const papers=state.manuscripts||[];
  $('#count').textContent=papers.length+' 篇稿件';
  $('#papers').innerHTML=papers.length?papers.map(p=>`<article class="paper"><h2>${esc(p.journal_name)}</h2><div class="paper-line"><span class="status ${esc(p.status)}">${esc(p.raw_status||p.status_label)}</span><span class="number">${esc(p.number||'待识别')}</span></div></article>`).join(''):'<p class="empty">还没有稿件<br>打开主页面，添加要跟踪的稿件。</p>';
  $('#updated').textContent=state.last_checked_at?'更新 '+time(state.last_checked_at):'尚未刷新';
  $('#refresh').disabled=refreshing||state.sync_in_progress;
  $('#refresh').classList.toggle('busy',refreshing||state.sync_in_progress);
  if(!refreshing&&state.issue_count){$('#message').textContent='部分稿件读取未完成，可在主页面查看原因';$('#message').classList.add('error');}
}
$('#refresh').addEventListener('click',async()=>{
  if(refreshing)return;refreshing=true;$('#refresh').disabled=true;$('#refresh').classList.add('busy');$('#message').textContent='正在读取投稿状态…';$('#message').classList.remove('error');
  try{const result=await window.papertrailTray.refresh();$('#message').textContent=result.message||result.error||'';$('#message').classList.toggle('error',!!result.error||!!result.issues?.length);}
  catch{$('#message').textContent='刷新未完成，请稍后重试';$('#message').classList.add('error');}
  finally{refreshing=false;try{render(await window.papertrailTray.state());}catch{}}
});
$('#open').addEventListener('click',()=>window.papertrailTray.open());
$('#quit').addEventListener('click',()=>window.papertrailTray.quit());
window.papertrailTray.onState(render);
window.papertrailTray.state().then(render).catch(()=>{$('#papers').innerHTML='<p class="empty">本地服务正在恢复，请稍候。</p>';});
