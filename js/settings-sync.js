((root,factory)=>{
  if (typeof module !== 'undefined') module.exports = factory(require('./model'),require('./v1'));
  else root.PlanetSettingsSync = factory(root.Planet,root.PlanetV1);
})(globalThis,(P,V)=>{
  'use strict';
  const preferenceFields = ['preferences','customQuotes','scheduledQuotes'];
  const scalarSettings = ['weekDay','weekTime','sound','reminderSound','volume'];
  const esc = value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const clone = value=>JSON.parse(JSON.stringify(value));
  const validDay = value=>/^\d{4}-\d{2}-\d{2}$/.test(value??'') && P.shiftDate(value,0)===value;
  const sortedEntries = value=>Object.entries(value??{}).sort(([a],[b])=>a.localeCompare(b));
  const safeKey = value=>typeof value==='string' && /^[A-Za-z0-9-]{1,80}$/.test(value) && value!=='constructor';
  const validTheme = row=>row && safeKey(row.id) && typeof row.theme==='string' && Array.isArray(row.lines) &&
    row.lines.length===2 && row.lines.every(line=>typeof line==='string');

  function snapshot(state) {
    const v = V.init(state), settings = v.settings;
    return {
      remind:state.settings.remind !== false,
      times:Object.fromEntries(sortedEntries(settings.times).filter(([id,row])=>
        (V.ids.includes(id) || id.startsWith('custom-')) && safeKey(id) && P.timeOk(row?.time) && !row.localArchive)
        .map(([id,row])=>[id,{time:row.time,enabled:row.enabled!==false,removed:row.removed===true,
          ...(id.startsWith('custom-')?{title:P.clean(row.title,60),...(validDay(row.addedDay)?{addedDay:row.addedDay}:{})}:{})}])),
      intervals:Object.fromEntries(Object.entries(V.intervals).map(([key,value])=>[key,P.bounded(settings.intervals?.[key],1,120,value)])),
      wrapTimes:{am:P.timeOk(settings.wrapTimes?.am)?settings.wrapTimes.am:'11:50',pm:P.timeOk(settings.wrapTimes?.pm)?settings.wrapTimes.pm:'18:15'},
      weekDay:P.bounded(settings.weekDay,0,6,0),weekTime:P.timeOk(settings.weekTime)?settings.weekTime:'14:00',
      sound:settings.sound!==false,reminderSound:settings.reminderSound!==false,volume:P.bounded(settings.volume,0,200,125),
      preferences:Object.fromEntries(sortedEntries(v.preferences).filter(([id,value])=>safeKey(id)&&['favorite','dislike','hidden'].includes(value))),
      customQuotes:(Array.isArray(v.customQuotes)?v.customQuotes:[]).filter(validTheme)
        .map(row=>({id:row.id,theme:P.clean(row.theme,30),lines:row.lines.map(line=>P.clean(line,120))})),
      scheduledQuotes:Object.fromEntries(sortedEntries(v.scheduledQuotes).filter(([date,value])=>validDay(date)&&safeKey(value))),
    };
  }
  function apply(state,payload) {
    if (!payload || typeof payload !== 'object' || !payload.times) return false;
    const candidate=P.createState();
    const incoming=V.init(candidate);
    const times=Object.fromEntries(sortedEntries(payload.times).filter(([id,row])=>safeKey(id) &&
      (V.ids.includes(id)||id.startsWith('custom-')) && P.timeOk(row?.time)));
    Object.assign(incoming.settings,{...Object.fromEntries(scalarSettings.map(key=>[key,payload[key]])),
      times:{...incoming.settings.times,...times}, intervals:payload.intervals,wrapTimes:payload.wrapTimes});
    for (const key of preferenceFields) incoming[key]=payload[key];
    candidate.settings.remind = payload.remind;
    const profile=snapshot(candidate), v=V.init(state);
    // Keep labels for custom reminders referenced by older local records.
    const retired=Object.fromEntries(Object.entries(v.settings.times).filter(([id])=>id.startsWith('custom-') &&
      !Object.hasOwn(profile.times,id) && Object.values(v.records).some(record=>record.id===id))
      .map(([id,row])=>[id,{...row,removed:true,enabled:false,localArchive:true}]));
    state.settings.remind=profile.remind;
    Object.assign(v.settings,Object.fromEntries(scalarSettings.map(key=>[key,profile[key]])),{
      times:{...retired,...profile.times},intervals:profile.intervals,wrapTimes:profile.wrapTimes,
    });
    for (const key of preferenceFields) v[key]=profile[key];
    v.queue=v.queue.filter(row=>v.settings.times[row.id]?.enabled && !v.settings.times[row.id].removed);
    if (v.active && v.active.id!=='return' && v.settings.times[v.active.id]?.removed) V.park(v,'未记录');
    return true;
  }

  function mount({state,save,redraw,toast,config,storage}) {
    const enabled = typeof config?.url==='string' && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(config.url) &&
      /^sb_publishable_[A-Za-z0-9_-]+$/.test(config.key??'');
    let client,user,remote,pending,busy=false,last='',hadError=false,timer;
    let status=enabled?'正在读取登录状态…':'邮箱登录和云同步等待部署';
    const signature = () => JSON.stringify(snapshot(state()));
    function cloudSignature(payload) {
      const draft=P.createState();
      return apply(draft,payload)?JSON.stringify(snapshot(draft)):'';
    }
    const emptyProfile = JSON.stringify(snapshot(P.createState()));
    const metaKey = id=>'little-steps-sync/'+id;
    function remember(row) {
      remote=row;
      last=cloudSignature(row.payload);
      try { storage.setItem(metaKey(user.id),last); } catch { /* Sync still works for this session. */ }
    }
    function sameAccount(id) { return user?.id===id; }
    async function read(id) {
      const result=await client.from('planet_settings').select('payload,revision').eq('user_id',id).maybeSingle();
      if(result.error) throw result.error;
      return result.data;
    }
    function adopt(row) {
      remember(row);
      apply(state(),clone(row.payload));
      last=signature();
      try { storage.setItem(metaKey(user.id),last); } catch { /* Sync still works for this session. */ }
      pending=null;
      status='已同步云端设置';
      save();
      redraw();
    }
    async function pull() {
      if (!user || busy || pending) return;
      const id=user.id;
      busy=true;
      try {
        const row=await read(id);
        if(!sameAccount(id))return;
        hadError=false;
        if(!row) {
          pending='first';
          status='首次同步，确认后可上传此浏览器的设置';
        } else if(remote?.revision===row.revision) {
          return;
        } else {
          let known=last;
          try { known ||= storage.getItem(metaKey(id)); } catch { /* No browser sync metadata. */ }
          const local=signature();
          if(local===emptyProfile || local===known || local===cloudSignature(row.payload)) adopt(row);
          else {
            remote=row;
            pending='conflict';
            status='本机与云端设置不同，请选择要使用的一份';
          }
        }
      } catch { hadError=true; status='暂时无法读取云端设置'; }
      finally {
        if(sameAccount(id)){
          busy=false;redraw();
          if(!hadError&&!pending) onSave();
        }
      }
    }
    async function push() {
      if(!user || busy || (pending!=='first'&&pending!=='conflict'&&signature()===last))return;
      const id=user.id;
      const payload=snapshot(state());
      const revision=remote?.revision;
      busy=true;
      try {
        const table=client.from('planet_settings');
        const result=revision==null
          ? await table.insert({user_id:id,payload,revision:1}).select('payload,revision').single()
          : await table.update({payload,revision:revision+1}).eq('user_id',id).eq('revision',revision).select('payload,revision').maybeSingle();
        if(!sameAccount(id))return;
        if(result.error?.code==='23505' || !result.data && !result.error) {
          remote=await read(id);
          if(!sameAccount(id))return;
          pending=remote?'conflict':'first';
          status='云端设置已在另一台设备更新，请确认使用哪一份';
        } else if(result.error) throw result.error;
        else {
          remember(result.data);
          pending=null;
          hadError=false;
          status='已同步此设备的设置';
        }
      } catch { hadError=true; status='上传失败，设置仍已保存在此浏览器'; }
      finally {
        if(sameAccount(id)){
          busy=false;
          redraw();
          if(!hadError&&!pending) onSave();
        }
      }
    }
    function onSave() {
      if(!user || pending || busy || hadError || signature()===last) return;
      clearTimeout(timer);
      timer=setTimeout(()=>void push(),350);
    }
    function sessionChanged(session) {
      const next=session?.user;
      if (next?.id===user?.id) {
        if(!next){status='使用邮箱账号同步设置';redraw();}
        return;
      }
      clearTimeout(timer);
      user=next;remote=null;pending=null;busy=false;last='';hadError=false;
      const entry=document.querySelector('[data-account-entry]');
      if(entry)entry.textContent=user?'账号与同步':'邮箱登录';
      status=user?'正在检查云端设置…':'使用邮箱账号同步设置';
      redraw();
      if(user)void pull();
    }
    const button=(action,label)=>`<button type="button" class="secondary small" data-sync="${action}">${label}</button>`;
    function panel() {
      if(!enabled)return '<p class="subtle">'+status+'。设置继续保存在当前浏览器。</p>';
      if(!user)return `<p class="subtle" role="status">${esc(status)}</p><form data-sync-form method="post">
        <label>邮箱<input class="field" type="email" name="email" required autocomplete="email"></label>
        <label>密码<input class="field" type="password" name="password" required minlength="8" autocomplete="current-password"></label>
        <div class="controls"><button class="primary" name="mode" value="login">登录</button>
        <button class="secondary" name="mode" value="register">创建邮箱账号</button></div></form>`;
      return `<p>已登录 ${esc(user.email)}</p><p class="subtle" role="status">${esc(status)}</p>
        <div class="controls">${pending==='first' ? button('push','上传此设备设置') : pending==='conflict'
          ? button('adopt','使用云端设置')+button('push','上传此设备设置')
          : button('retry','立即同步')}${button('logout','退出登录')}</div>
        <p class="subtle">同步提醒、晨间语录和音效。对话和复盘仍保存在此设备。</p>`;
    }
    if(enabled) {
      const redirect=location.origin+location.pathname;
      const sdk=document.createElement('script');
      sdk.src='https://unpkg.com/@supabase/supabase-js@2.119.2/dist/umd/supabase.js';
      sdk.integrity='sha384-A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ';
      sdk.crossOrigin='anonymous';
      const sdkUnavailable=()=>{ status='暂时无法加载登录服务'; redraw(); };
      sdk.addEventListener('load',()=>{
        try {
          client=window.supabase.createClient(config.url,config.key,{auth:{flowType:'pkce'}});
          client.auth.onAuthStateChange((_,session)=>setTimeout(()=>sessionChanged(session),0));
        } catch { sdkUnavailable(); }
      },{once:true});
      sdk.addEventListener('error',sdkUnavailable,{once:true});
      document.head.append(sdk);
      document.addEventListener('submit',async event=>{
        const form=event.target;
        if(!form.matches('[data-sync-form]'))return;
        event.preventDefault();
        if(!client){toast(status);return;}
        const fields=new FormData(form);
        const email=String(fields.get('email')).trim(),password=String(fields.get('password'));
        const register=event.submitter?.value==='register';
        form.elements.password.value='';
        try {
          const result=register?await client.auth.signUp({email,password,options:{emailRedirectTo:redirect}})
            :await client.auth.signInWithPassword({email,password});
          if(result.error){
            const code=result.error.code;
            toast(code==='email_address_not_authorized' ? '验证邮件目前只对内测邮箱开放。' :
              code==='over_email_send_rate_limit' ? '验证邮件发送太频繁，请稍后再试。' :
              code==='email_not_confirmed' ? '请先打开邮箱确认注册。' :
              '未能完成'+(register?'注册':'登录')+'，请核对邮箱和密码。');
            return;
          }
          if(register&&!result.data.session)toast('请打开邮箱里的验证链接，再回来登录。');
        } catch { toast('无法连接登录服务，请稍后重试。'); }
      });
      document.addEventListener('click',event=>{
        const op=event.target.closest('[data-sync]')?.dataset.sync;
        if(!op||!user)return;
        if(op==='adopt'&&remote&&!busy)adopt(remote);
        if(op==='push')void push();
        if(op==='retry'){
          hadError=false;
          if(remote&&signature()!==last)void push();else void pull();
        }
        if(op==='logout')void client.auth.signOut({scope:'local'}).then(result=>{
          if(result.error)toast('无法退出，请稍后重试');
        });
      });
      window.addEventListener('focus',()=>{
        if(!user||pending||busy)return;
        if(hadError && remote && signature()!==last){hadError=false;void push();}
        else if(!remote || signature()===last)void pull();
      });
    }
    return {panel,onSave};
  }
  return {snapshot,apply,mount};
});
