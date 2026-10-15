'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {submitted:'已投稿',editor:'编辑处理中',review:'审稿中',decision:'等待决定',revision:'待返修',accepted:'已录用',rejected:'已拒稿',withdrawn:'已撤稿',unknown:'待确认'};
const zones = ['Asia/Shanghai','Asia/Hong_Kong','Asia/Tokyo','Asia/Singapore','Europe/London','Europe/Berlin','America/New_York','America/Los_Angeles','UTC'];
let live = {journals:[],accounts:[],manuscripts:[],events:[]}, view = 'papers', search = '', busy = false, verifying = '', desktopInfo = null, toastTimer;
const openLogIds = new Set();
const accountFor = paper => live.accounts.find(a => a.id === paper?.account_id);
const journalFor = account => live.journals.find(j => j.id === account?.journal_id);
const paperFor = id => live.manuscripts.find(p => p.id === id);
const statusText = paper => paper.raw_status || paper.status_label || labels[paper.status] || paper.status;
const dateText = value => value ? new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '尚无变化';
const safeUrl = value => {try {const url=new URL(value);return url.protocol==='https:'?esc(url.href):'#';}catch{return '#';}};
const changesFor = id => live.events.filter(e => e.manuscript_id===id && e.old_status!==null).sort((a,b)=>b.happened_at.localeCompare(a.happened_at));
const icons={refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.7-1L20 9M4 15l2.2 3A7 7 0 0 0 18 17"/>',plus:'<path d="M12 5v14M5 12h14"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
function toast(message) {
  $('#toast').textContent=message;$('#toast').classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),5500);
}
async function api(path,body) {
  const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-PaperTrail-Token':live.token},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'操作未完成');return value;
}
async function load(){live=await api('/api/state');}
function manuscriptRows(){
  const term=search.trim().toLocaleLowerCase();
  return live.manuscripts.map(paper=>({paper,account:accountFor(paper)}))
    .map(row=>({...row,journal:journalFor(row.account)}))
    .filter(({paper,journal})=>!term||`${journal?.name||''} ${paper.number||''} ${statusText(paper)}`.toLocaleLowerCase().includes(term))
    .sort((a,b)=>(b.paper.last_changed_at||b.paper.recorded_at||'').localeCompare(a.paper.last_changed_at||a.paper.recorded_at||''));
}
function papersView(){
  const rows=manuscriptRows();
  return `<header class="page-head"><div><h1>投稿状态 <span class="count">${live.manuscripts.length}</span></h1></div>
    <div class="head-actions"><button class="icon-button ${busy?'spinning':''}" data-action="refresh" aria-label="立即刷新" title="立即刷新" ${busy?'disabled':''}>${icon('refresh')}</button><button class="icon-button" data-action="${live.accounts.length?'add-paper':'add-account'}" aria-label="${live.accounts.length?'添加稿件':'添加期刊账号'}" title="${live.accounts.length?'添加稿件':'添加期刊账号'}">${icon('plus')}</button></div></header>
    <div class="list-tools"><input id="search" aria-label="搜索稿件" placeholder="搜索期刊或稿件号" value="${esc(search)}"></div>
    ${rows.length?`<section class="paper-list" role="list" aria-label="稿件列表">
      ${rows.map(({paper,journal})=>`<article class="paper-card" role="listitem"><h2>${esc(journal?.name||'未知期刊')}</h2>
      <div class="paper-state"><span class="status ${esc(paper.status)}">${esc(statusText(paper))}</span></div>
      <div class="paper-meta"><button class="text-button manuscript-number" data-action="detail" data-id="${esc(paper.id)}">${esc(paper.number||'待识别')}</button></div>
      <div class="paper-change">${paper.last_changed_at?`变化 ${esc(dateText(paper.last_changed_at))} · ${paper.change_count} 次`:'本地尚无变化'}</div></article>`).join('')}
    </section>`:`<div class="empty"><div class="empty-symbol">${icon('plus')}</div><h2>${live.manuscripts.length?'没有匹配的稿件':'还没有稿件'}</h2><p>${live.accounts.length?'添加稿件号，开始跟踪进度。':'添加期刊账号，开始跟踪进度。'}</p>
    <button class="button primary" data-action="${live.accounts.length?'add-paper':'add-account'}">${live.accounts.length?'添加稿件':'添加期刊账号'}</button></div>`}
    <footer class="sync-footer"><span>${live.last_checked_at?'更新 '+esc(dateText(live.last_checked_at)):'尚未刷新'}</span><span>${live.auto_refresh?.enabled?`每天 ${live.auto_refresh.times.length} 个时间点`:'自动刷新已关闭'}</span></footer>`;
}
function accountsView(){
  return `<header class="page-head"><div><h1>期刊账号</h1><p>每个账号单独登录和保存会话</p></div><button class="button primary" data-action="add-account">添加期刊账号</button></header>
    <div class="account-grid">${live.journals.map(journal=>{
      const accounts=live.accounts.filter(a=>a.journal_id===journal.id);
      return `<section class="panel account-card"><div class="account-head"><div><h2>${esc(journal.name)}</h2><p>${esc(journal.platform)} · <a href="${safeUrl(journal.login_url)}" target="_blank" rel="noopener noreferrer">打开投稿网站</a></p></div>
      <button class="button subtle" data-action="edit-journal" data-id="${esc(journal.id)}" aria-label="编辑期刊">编辑</button></div>
      ${accounts.map(a=>`<div class="account-line"><div><strong>${esc(a.label||a.username)}</strong><small>${esc(a.username)} · ${a.has_password?'密码已保存':'未保存密码'}${a.last_authenticated_at?' · 最近验证 '+esc(dateText(a.last_authenticated_at)):''}${a.last_checked_at?' · 最近读取 '+esc(dateText(a.last_checked_at)):''}</small>
      ${a.sync_error?`<p class="error">${esc(a.sync_error)}</p>`:''}</div><div class="account-actions">
      <button class="button subtle" data-action="verify" data-id="${esc(a.id)}" ${busy?'disabled':''}>${verifying===a.id?'正在验证…':'打开验证窗口'}</button>
      <button class="button subtle" data-action="edit-account" data-id="${esc(a.id)}">管理</button></div></div>`).join('')}
      <button class="button secondary full" data-action="add-account" data-id="${esc(journal.id)}">添加该期刊账号</button></section>`;
    }).join('')}</div>${live.journals.length?'':'<div class="empty"><h2>还没有期刊</h2><p>添加投稿入口和账号即可开始。</p></div>'}`;
}
function logView(){
  const groups=live.manuscripts.map(paper=>({paper,changes:changesFor(paper.id)})).filter(group=>group.changes.length)
    .sort((a,b)=>b.changes[0].happened_at.localeCompare(a.changes[0].happened_at));
  return `<header class="page-head"><div><h1>本地变化日志</h1><p>从添加稿件后开始记录，不追溯网站以前的变化</p></div></header>
    <section class="panel">${groups.length?groups.map(({paper,changes})=>{
      const journal=journalFor(accountFor(paper));
      return `<details class="log-group" data-paper-id="${esc(paper.id)}" ${openLogIds.has(paper.id)?'open':''}><summary><span>${esc(journal?.name||'未知期刊')} · ${esc(paper.number||'待识别')}</span><small>${changes.length} 次变化 · ${esc(dateText(changes[0].happened_at))}</small></summary>
        ${changes.map(e=>`<div class="log-line"><time>${esc(dateText(e.happened_at))}</time><p>${esc(labels[e.old_status]||e.old_status)} → ${esc(e.raw_status||labels[e.new_status]||e.new_status)}</p></div>`).join('')}</details>`;
    }).join(''):'<div class="empty"><h2>尚无状态变化</h2><p>首次读取建立当前状态；之后的变化会记录在这里。</p></div>'}</section>`;
}
function render(){
  $('#app').innerHTML=`<div class="shell"><header class="title-bar"><div class="brand"><img src="/mark.svg" alt=""><strong>PaperTrail</strong><span>v${esc(desktopInfo?.version||live.version||'')}</span></div>
    <button class="icon-button settings-link" data-action="settings" aria-label="设置与数据" title="设置与数据">${icon('settings')}</button></header>
    <nav class="tabs" aria-label="页面导航"><button class="nav ${view==='papers'?'active':''}" data-action="nav" data-id="papers">稿件</button>
    <button class="nav ${view==='accounts'?'active':''}" data-action="nav" data-id="accounts">期刊账号</button>
    <button class="nav ${view==='log'?'active':''}" data-action="nav" data-id="log">变化日志</button></nav>
    <main>${view==='papers'?papersView():view==='accounts'?accountsView():logView()}</main></div>`;
}
function modal(title,content,kind='',id=''){
  if($('#modal').open)$('#modal').close();
  $('#modal').innerHTML=`<form id="editor-form" data-kind="${esc(kind)}" data-id="${esc(id)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="close" data-action="close" aria-label="关闭">×</button></div>
    <div class="modal-body">${content}<p id="form-error" class="error" role="alert"></p></div>
    <div class="modal-foot"><button type="button" class="button secondary" data-action="close">取消</button>
    <button type="submit" class="button ${kind.startsWith('delete-')?'danger':'primary'}">${kind.startsWith('delete-')?'确认删除':'保存'}</button></div></form>`;
  $('#modal').showModal();
}
function field(name,label,value='',type='text',required=false,hint=''){
  return `<label class="field"><span>${label}${required?' *':''}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${hint?`placeholder="${esc(hint)}"`:''}></label>`;
}
function paperForm(id=''){
  if(!live.accounts.length){view='accounts';render();accountForm();toast('请先添加期刊账号');return;}
  const paper=id?paperFor(id):null,selected=paper?.account_id||live.accounts[0].id;
  modal(paper?'编辑稿件':'添加稿件',`<label class="field"><span>投稿账号 *</span><select name="account_id" required>
    ${live.accounts.map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(journalFor(a)?.name||'')} · ${esc(a.label||a.username)}</option>`).join('')}</select></label>
    ${field('number','稿件号',paper?.number||'','text',true,'例如 ABC-2026-001')}
    <label class="field"><span>当前状态</span><select name="status">${Object.entries(labels).map(([key,value])=>`<option value="${key}" ${(paper?.status||'unknown')===key?'selected':''}>${value}</option>`).join('')}</select></label>
    ${paper?`<div class="form-extra"><button type="button" class="text-button danger-text" data-action="delete-paper" data-id="${esc(paper.id)}">删除这篇稿件</button></div>`:''}`,'paper',id);
}
function accountForm(id='',journalId=''){
  const account=id?live.accounts.find(a=>a.id===id):null,journal=account?journalFor(account):null,selected=journal?.id||journalId;
  modal(account?'管理投稿账号':'添加期刊账号',`${account?`<p class="help">${esc(journal.name)} · ${esc(journal.login_url)}</p>`:
    `<label class="field"><span>期刊</span><select name="journal_id" id="journal-select"><option value="">新增期刊</option>
      ${live.journals.map(j=>`<option value="${esc(j.id)}" ${j.id===selected?'selected':''}>${esc(j.name)}</option>`).join('')}</select></label>
    <div id="new-journal" ${selected?'hidden':''}>${field('journal_name','期刊全名','','text',!selected)}
      ${field('login_url','投稿网址','','url',!selected,'https://susy.mdpi.com/user/manuscripts 等投稿入口')}
      <p class="help">支持 ScholarOne、IEEE 投稿门户、Editorial Manager／Elsevier、Wiley Research Exchange 和 MDPI SuSy。</p></div>`}
    ${field('username','登录账号',account?.username||'','text',true,'邮箱或用户名')}
    ${field('password','密码','','password',!account,account?'留空保留已保存密码':'')}
    ${journal?.platform==='IEEE Research Exchange'?'<p class="help">此投稿入口使用 IEEE 账号密码，登录页面中的 IEEE 账号与 ScholarOne 期刊账号可能不同。</p>':''}
    <label class="field"><span>登录方式</span><select name="login_method">
      <option value="password" ${account?.login_method==='password'?'selected':''}>期刊账号密码</option>
      <option value="elsevier" ${account?.login_method==='elsevier'?'selected':''}>Elsevier 账号密码（Editorial Manager）</option></select></label>
    ${account?`<div class="form-extra"><button type="button" class="text-button danger-text" data-action="delete-account" data-id="${esc(account.id)}">删除账号及关联稿件</button></div>`:''}`,'account',id);
}
function journalForm(id){
  const journal=live.journals.find(j=>j.id===id);
  modal('编辑期刊',`${field('name','期刊全名',journal.name,'text',true)}${field('abbreviation','简称',journal.abbreviation)}
    ${field('login_url','投稿网址',journal.login_url,'url',true)}
    <div class="form-extra"><button type="button" class="text-button danger-text" data-action="delete-journal" data-id="${esc(id)}">删除期刊及全部账号和稿件</button></div>`,'journal',id);
}
function detail(id){
  const paper=paperFor(id),account=accountFor(paper),journal=journalFor(account),changes=changesFor(id);
  const previousNumbers=JSON.parse(paper.number_aliases||'[]');
  $('#modal').innerHTML=`<div class="modal-head"><h2>稿件 ${esc(paper.number||'待识别')}</h2><button class="close" data-action="close" aria-label="关闭">×</button></div>
    <div class="modal-body"><p class="help">${esc(journal?.name||'')} · ${esc(account?.username||'')}</p>
    ${previousNumbers.length?`<p class="help">历史稿件号：${previousNumbers.map(esc).join('、')}</p>`:''}
    <p class="detail-status">${esc(statusText(paper))}</p><p class="help">本地变化 ${paper.change_count} 次 · 最近变化：${esc(dateText(paper.last_changed_at))}</p>
    <h3>变化记录</h3>
    ${changes.length?changes.map(e=>`<div class="detail-event"><time>${esc(dateText(e.happened_at))}</time>
      <span>${esc(labels[e.old_status]||e.old_status)} → ${esc(e.raw_status||labels[e.new_status]||e.new_status)}</span></div>`).join(''):'<p class="help">保存稿件后的状态尚未变化。</p>'}</div>
    <div class="modal-foot"><button class="button secondary" data-action="close">关闭</button><button class="button primary" data-action="edit-paper" data-id="${esc(id)}">编辑稿件</button></div>`;
  $('#modal').showModal();
}
function confirmDelete(kind,id){
  const labels={paper:'稿件及本地变化日志',account:'账号及关联稿件',journal:'期刊及全部账号和稿件'};
  modal('确认删除',`<p>确定删除${labels[kind]}？此操作仅影响本机记录。</p>`,'delete-'+kind,id);
}
function settingsForm(){
  const zone=live.profile?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  const prefs=desktopInfo?.preferences||{keepRunning:true,startAtLogin:false};
  modal('设置与数据',`<div class="setting-block"><h3>自动刷新</h3>
    <label class="check"><input type="checkbox" name="enabled" ${live.auto_refresh?.enabled?'checked':''}>启用自动刷新</label>
    <p class="help">按所选时区每天在指定时间刷新；关闭窗口后保持运行时生效。</p>
    <div id="refresh-times" class="time-list">${(live.auto_refresh?.times||[]).map(value=>`<span class="time-chip" data-time="${esc(value)}">${esc(value)}<button type="button" data-action="remove-time" aria-label="删除 ${esc(value)}">×</button></span>`).join('')}</div>
    <div class="button-row"><input type="time" id="new-refresh-time" aria-label="新增刷新时间"><button type="button" class="button secondary" data-action="add-time">添加时间点</button></div>
    <label class="field"><span>时区</span><select name="timezone">${[...new Set([zone,...zones])].map(value=>`<option value="${esc(value)}" ${zone===value?'selected':''}>${esc(value)}</option>`).join('')}</select></label></div>
    ${desktopInfo?`<div class="setting-block"><h3>桌面应用</h3>
      <label class="check"><input type="checkbox" name="keepRunning" ${prefs.keepRunning?'checked':''}>关闭窗口后继续运行</label>
      <label class="check"><input type="checkbox" name="startAtLogin" ${prefs.startAtLogin?'checked':''}>登录电脑时启动</label></div>
      <div class="setting-block"><h3>本地数据</h3><div class="button-row">
      <button type="button" class="button secondary" data-action="backup">导出备份</button>
      <button type="button" class="button secondary" data-action="restore">恢复备份</button>
      <button type="button" class="button secondary" data-action="open-data">打开数据目录</button>
      <button type="button" class="button secondary" data-action="updates">检查并安装更新</button></div>
      <p class="help">当前版本 ${esc(desktopInfo.version)}</p></div>`:''}`,'settings');
}
async function refresh(body={}){
  if(busy)return;busy=true;render();toast(body.interactive?'请在验证窗口完成登录':'正在读取投稿状态…');
  try{const result=await api('/api/refresh',body);await load();render();toast(result.message);}
  catch(error){await load();render();toast(error.message);}
  finally{busy=false;render();}
}
async function verifyAccount(id){
  if(busy)return;
  busy=true;verifying=id;render();toast('请在验证窗口完成登录，成功后会自动关闭');
  try{
    const result=await api('/api/accounts/connect',{account_id:id,interactive:true});
    await load();render();toast(result.message);
  }catch(error){await load();render();toast(error.message);}
  finally{busy=false;verifying='';render();}
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  const {action,id}=button.dataset;
  try{
    if(action==='nav'){view=id;render();}
    else if(action==='refresh')await refresh();
    else if(action==='add-paper')paperForm();
    else if(action==='add-account')accountForm('',id||'');
    else if(action==='edit-paper'){ $('#modal').close();paperForm(id); }
    else if(action==='edit-account')accountForm(id);
    else if(action==='edit-journal')journalForm(id);
    else if(action==='detail')detail(id);
    else if(action==='settings')settingsForm();
    else if(action==='add-time'){
      const value=$('#new-refresh-time').value;
      if(!value)throw new Error('请选择刷新时间');
      if([...document.querySelectorAll('#refresh-times [data-time]')].some(item=>item.dataset.time===value))throw new Error('这个时间点已添加');
      const chip=document.createElement('span');chip.className='time-chip';chip.dataset.time=value;
      chip.textContent=value;const remove=document.createElement('button');remove.type='button';remove.dataset.action='remove-time';remove.setAttribute('aria-label','删除 '+value);remove.textContent='×';chip.append(remove);$('#refresh-times').append(chip);$('#new-refresh-time').value='';
    }
    else if(action==='remove-time')button.closest('[data-time]').remove();
    else if(action==='close')$('#modal').close();
    else if(action.startsWith('delete-'))confirmDelete(action.slice(7),id);
    else if(action==='verify')await verifyAccount(id);
    else if(['backup','restore','open-data','updates'].includes(action)&&window.papertrail){
      const name={backup:'backup',restore:'restore','open-data':'openDataFolder',updates:'checkUpdates'}[action];
      const result=await window.papertrail[name]();if(result?.error)throw new Error(result.error);
      if(result?.message)toast(result.message);
      if(action==='restore'&&result?.ok){$('#modal').close();await load();render();}
    }
  }catch(error){toast(error.message);}
});
document.addEventListener('change',event=>{
  if(event.target.id==='journal-select'){
    const fresh=!event.target.value;$('#new-journal').hidden=!fresh;
    for(const name of ['journal_name','login_url'])$('#editor-form [name="'+name+'"]').required=fresh;
  }
});
document.addEventListener('toggle',event=>{
  const details=event.target.closest?.('.log-group');
  if(!details)return;
  if(details.open)openLogIds.add(details.dataset.paperId);
  else openLogIds.delete(details.dataset.paperId);
},true);
document.addEventListener('input',event=>{
  if(event.target.id==='search'){
    const pos=event.target.selectionStart;search=event.target.value;render();$('#search').focus();$('#search').setSelectionRange(pos,pos);
  }
});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='editor-form')return;event.preventDefault();
  const form=event.target,kind=form.dataset.kind,id=form.dataset.id,body=Object.fromEntries(new FormData(form));
  const submit=form.querySelector('[type=submit]');submit.disabled=true;$('#form-error').textContent='';
  try{
    let result;
    if(kind==='paper'){
      const old=paperFor(id);if(old&&body.status===old.status)body.raw_status=old.raw_status;
      result=await api('/api/manuscripts'+(id?'/'+encodeURIComponent(id):''),body);
    }else if(kind==='account'){
      if(!id&&!body.journal_id)body.platform='自动识别';
      result=await api('/api/accounts'+(id?'/'+encodeURIComponent(id):''),body);
    }else if(kind==='journal')result=await api('/api/journals/'+encodeURIComponent(id),body);
    else if(kind.startsWith('delete-')){
      const group=kind.slice(7),path=group==='paper'?'manuscripts':group==='account'?'accounts':'journals';
      result=await api('/api/'+path+'/'+encodeURIComponent(id)+'/delete',{});
    }else if(kind==='settings'){
      await api('/api/profile',{timezone:body.timezone});
      const times=[...form.querySelectorAll('#refresh-times [data-time]')].map(item=>item.dataset.time);
      await api('/api/schedule',{enabled:body.enabled==='on',times});
      if(desktopInfo){
        const prefs=await window.papertrail.preferences({keepRunning:body.keepRunning==='on',startAtLogin:body.startAtLogin==='on'});
        if(prefs.error)throw new Error(prefs.error);desktopInfo.preferences=prefs.preferences;
      }
      result={message:'设置已保存'};
    }
    $('#modal').close();await load();
    if(['account','journal','delete-account','delete-journal'].includes(kind))view='accounts';
    else if(['paper','delete-paper'].includes(kind))view='papers';
    render();toast(result.message);
  }catch(error){$('#form-error').textContent=error.message;submit.disabled=false;}
});
async function start(){
  await load();
  if(window.papertrail){
    desktopInfo=await window.papertrail.info();
    window.papertrail.onAction(action=>{
      if(action==='refresh')refresh();
      else if(['settings','profile','about'].includes(action))settingsForm();
      else if(action==='reload')load().then(render).catch(()=>{});
    });
    document.body.classList.toggle('mac',desktopInfo.platform==='darwin');
  }
  render();
  setInterval(async()=>{
    if(document.hidden||$('#modal').open||document.activeElement?.matches('input,select,textarea'))return;
    try{const next=await api('/api/state');if(JSON.stringify(next)!==JSON.stringify(live)){live=next;render();}}catch{}
  },15000);
}
start().catch(()=>{$('#app').innerHTML='<div class="boot">无法连接本地服务，请重新打开PaperTrail。</div>';});
