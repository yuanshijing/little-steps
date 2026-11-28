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
    const order=V.manualReminderOrder(v).filter(id=>safeKey(id) && P.timeOk(settings.times[id].time) && !settings.times[id].localArchive && !settings.times[id].localOnly);
    return {
      remind:state.settings.remind !== false,
      ...(order.length?{reminderOrder:order}:{}),
      times:Object.fromEntries(sortedEntries(settings.times).filter(([id,row])=>
        (V.ids.includes(id) || id.startsWith('custom-')) && safeKey(id) && P.timeOk(row?.time) && !row.localArchive && !row.localOnly)
        .map(([id,row])=>[id,{time:row.time,enabled:row.enabled!==false,removed:row.removed===true,
          ...(id.startsWith('custom-')?{title:P.clean(row.title,80),...(validDay(row.addedDay)?{addedDay:row.addedDay}:{}),
            ...(row.taskSchedule?{taskSchedule:true,repeat:P.repeats.includes(row.repeat)?row.repeat:'daily',paused:row.paused===true,remind:row.remind!==false,
              ...(validDay(row.addedDay)?{weekday:new Date(row.addedDay+'T12:00:00Z').getUTCDay()}: {})}:{})}:{})}])),
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
      times:{...incoming.settings.times,...times}, intervals:payload.intervals,wrapTimes:payload.wrapTimes,
      reminderOrder:payload.reminderOrder});
    for (const key of preferenceFields) incoming[key]=payload[key];
    candidate.settings.remind = payload.remind;
    const profile=snapshot(candidate), v=V.init(state);
    V.applyTaskReminders(state,times);
    for(const task of state.tasks){
      if(!task.sharedReminder || Object.hasOwn(times,V.reminderId(task)))continue;
      P.preserveSchedule(task,new Date());
      task.sharedReminder=false;
      task.reminderEnabled=false;
    }
    // Keep labels for custom reminders referenced by older local records.
    const retired=Object.fromEntries(Object.entries(v.settings.times).filter(([id])=>id.startsWith('custom-') &&
      !Object.hasOwn(profile.times,id) && Object.values(v.records).some(record=>record.id===id))
      .map(([id,row])=>[id,{...row,removed:true,enabled:false,localArchive:true}]));
    state.settings.remind=profile.remind;
    Object.assign(v.settings,Object.fromEntries(scalarSettings.map(key=>[key,profile[key]])),{
      times:{...retired,...Object.fromEntries(V.ids.map(id=>[id,{...v.settings.times[id],...profile.times[id]}])),
        ...Object.fromEntries(Object.entries(profile.times).filter(([id])=>!V.ids.includes(id)))},
      intervals:profile.intervals,wrapTimes:profile.wrapTimes,reminderOrder:profile.reminderOrder,
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
    let emailEnabled,emailBusy=false,emailEligible=null,emailError='',accountVersion=0;
    let emailChangeBusy=false,passwordBusy=false,passwordAccount=null;
    function openPassword(account) {
      if(!account || passwordAccount===account.id)return;
      passwordAccount=account.id;
      const dialog=document.createElement('dialog');
      dialog.className='planet-login-dialog';
      dialog.setAttribute('aria-labelledby','planet-password-title');
      dialog.innerHTML=`<h2 id="planet-password-title" class="section-title">设置新密码</h2>
        <form data-password-change method="post">
          <label class="planet-login-field">新密码<input class="field" type="password" name="password" required minlength="8" autocomplete="new-password"></label>
          <div class="controls"><button class="primary" type="submit">保存新密码</button>
          <button class="secondary" type="button" data-dismiss-password>稍后设置</button></div>
        </form>`;
      dialog.querySelector('[data-dismiss-password]').addEventListener('click',()=>dialog.close());
      dialog.addEventListener('close',()=>{passwordAccount=null;dialog.remove();},{once:true});
      loginDialog?.close();
      document.body.append(dialog);
      dialog.showModal();
    }
    const emailPreference=()=>emailEnabled ?? (emailEligible===true);
    async function readEmailPreference() {
      if(!user || emailBusy)return;
      const id=user.id,version=accountVersion;
      emailBusy=true;
      emailError='';
      try {
        const result=await client.from('reminder_email_subscriptions').select('enabled').eq('user_id',id).maybeSingle();
        if(version!==accountVersion)return;
        if(result.error)throw result.error;
        emailEnabled=result.data?.enabled ?? null;
      } catch {
        if(version===accountVersion)emailError='暂时无法读取邮件提醒设置，请重试。';
      } finally {
        if(version===accountVersion){emailBusy=false;redraw();}
      }
    }
    async function setEmailPreference(value) {
      if(!user || emailBusy || emailEnabled===undefined || value===emailPreference() || (value && emailEligible!==true))return;
      const id=user.id,version=accountVersion;
      emailBusy=true;
      emailError='';
      redraw();
      try {
        const result=await client.from('reminder_email_subscriptions').upsert({user_id:id,enabled:value},{onConflict:'user_id'})
          .select('enabled').single();
        if(version!==accountVersion)return;
        if(result.error || result.data?.enabled!==value)throw Error('email preference');
        emailEnabled=result.data.enabled;
        toast(value?'已开启邮件定时提醒':'已关闭邮件定时提醒');
      } catch {
        if(version===accountVersion)emailError='无法确认保存结果，请重试。';
      } finally {
        if(version===accountVersion){emailBusy=false;redraw();}
      }
    }
    function emailPreferencePanel() {
      const checked=emailEnabled!==undefined&&emailPreference();
      const disabled=emailBusy||emailEnabled===undefined||(!checked&&emailEligible!==true);
      const detail=emailError || (emailBusy?'正在同步邮件提醒设置…':!checked&&emailEligible===false?'目前仅已验证的内测邮箱可开启。':
        emailEligible===null&&!checked?'正在检查邮件提醒是否可用。':'按已同步的定时提醒发送至登录邮箱，使用北京时间。');
      return `<div>
        <label><input type="checkbox" data-reminder-email aria-describedby="email-reminder-help"${checked?' checked':''}${disabled?' disabled':''}> 接收定时提醒邮件</label>
        <p id="email-reminder-help" class="subtle" role="status">${detail}</p>
        ${emailError||(!emailBusy&&emailEligible===null)?button('email-retry','重新检查邮件提醒'):''}
      </div>`;
    }
    let trialVersion=0;
    let loginPromptShown=false;
    let loginDialog;
    let authResolved=false,authTimeout;
    function openLogin() {
      if(user)return false;
      if(loginDialog?.open)return true;
      loginPromptShown=true;
      const dialog=document.createElement('dialog');
      loginDialog=dialog;
      dialog.className='planet-login-dialog';
      dialog.setAttribute('aria-labelledby','planet-login-title');
      dialog.innerHTML='<h2 id="planet-login-title" class="section-title">登录小步星球</h2>'+panel()+
        '<div class="planet-login-footer"><button type="button" class="secondary" data-dismiss-login>稍后登录</button></div>';
      dialog.querySelector('[data-dismiss-login]').addEventListener('click',()=>dialog.close());
      dialog.addEventListener('close',()=>{
        dialog.remove();
        if(loginDialog===dialog)loginDialog=null;
      },{once:true});
      document.body.append(dialog);
      dialog.showModal();
      return true;
    }
    function showFirstLogin() {
      if(!loginPromptShown)openLogin();
    }
    function updateLoginStatus() {
      const label=loginDialog?.querySelector('[role="status"]');
      if(label)label.textContent=status;
    }
    async function trialCall(route,input) {
      const session=(await client.auth.getSession()).data?.session;
      if(!session || session.user.id!==user?.id)throw Error('请先登录试用邮箱');
      const res=await fetch(config.url+'/functions/v1/trial-coach',{method:'POST',redirect:'error',
        headers:{apikey:config.key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
        signal:AbortSignal.timeout(26000),body:JSON.stringify({route,input})});
      if(!res.ok)throw Error(({403:'此账号的试用资格已停用',429:'今天的试用次数已用完',401:'请重新登录'})[res.status]||'试用模型暂时无法连接');
      const result=await res.json();
      if(user?.id!==session.user.id)throw Error('登录账号已切换');
      return result;
    }
    async function refreshTrial(){
      const version=++trialVersion;
      if(!user || !enabled)return;
      let result;
      try {result=await trialCall('status');} catch {result={ready:false};}
      if(version===trialVersion){
        const eligible=typeof result.eligible==='boolean'?result.eligible:null;
        if(emailEligible!==eligible){emailEligible=eligible;redraw();}
        window.dispatchEvent(new CustomEvent('planet-trial',{detail:result}));
      }
    }
    if(enabled)window.PlanetTrial={run:trialCall,refresh:refreshTrial,accountId:()=>user?.id};
    function sessionChanged(session) {
      authResolved=true;
      clearTimeout(authTimeout);
      const next=session?.user;
      if (next?.id===user?.id) {
        if(!next){status='使用邮箱账号同步设置';redraw();showFirstLogin();updateLoginStatus();}
        else if(next.email!==user.email){
          user=next;
          const entry=document.querySelector('[data-account-entry]');
          if(entry)entry.textContent=user.email;
          redraw();
          void refreshTrial();
        }
        return;
      }
      clearTimeout(timer);
      user=next;
      ++accountVersion;
      emailEnabled=undefined;emailBusy=false;emailEligible=null;emailError='';
      if(user)loginDialog?.close();
      remote=null;pending=null;busy=false;last='';hadError=false;
      const entry=document.querySelector('[data-account-entry]');
      if(entry)entry.textContent=user?.email||'邮箱登录';
      ++trialVersion;
      window.dispatchEvent(new CustomEvent('planet-trial',{detail:{ready:false}}));
      if(user)void refreshTrial();
      status=user?'正在检查云端设置…':'使用邮箱账号同步设置';
      redraw();
      if(user){
        void pull();void readEmailPreference();
      }
    }
    const button=(action,label)=>`<button type="button" class="secondary small" data-sync="${action}">${label}</button>`;
    function panel() {
      if(!enabled)return '<p class="subtle">'+status+'。设置继续保存在当前浏览器。</p>';
      if(!user)return `<p class="subtle" role="status">${esc(status)}</p><form data-sync-form method="post">
        <label class="planet-login-field">邮箱<input class="field" type="email" name="email" required autocomplete="username"></label>
        <label class="planet-login-field">密码<input class="field" type="password" name="password" minlength="8" autocomplete="current-password"></label>
        <label class="planet-login-remember"><input type="checkbox" name="remember" checked> 在此浏览器保持登录</label>
        <div class="controls"><button class="primary" name="mode" value="login">登录</button>
        <button class="secondary" name="mode" value="register">创建邮箱账号</button>
        <button class="secondary small" name="mode" value="recover" formnovalidate>忘记密码</button></div></form>
        <details class="reminder-details" data-recovery-entry><summary>输入邮件验证码</summary>
          <form data-recovery-code method="post">
            <label class="planet-login-field">登录邮箱<input class="field" type="email" name="email" required autocomplete="username"></label>
            <label class="planet-login-field">邮件验证码<input class="field" name="token" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label>
            <button class="secondary small" type="submit">验证并设置新密码</button>
          </form>
        </details>`;
      return `<p>已登录 ${esc(user.email)}</p><p class="subtle" role="status">${esc(status)}</p>
        <div class="controls">${pending==='first' ? button('push','上传此设备设置') : pending==='conflict'
          ? button('adopt','使用云端设置')+button('push','上传此设备设置')
          : button('retry','立即同步')}${button('logout','退出登录')}</div>
        <p class="subtle">${button('reset-password','重置密码')}</p>
        <details class="reminder-details account-email-change"><summary>更换登录邮箱</summary>
          <form data-email-change method="post">
            <label class="planet-login-field">新邮箱<input class="field" type="email" name="email" required autocomplete="email" maxlength="254"></label>
            <label class="planet-login-field">当前小步星球密码<input class="field" type="password" name="password" required autocomplete="current-password"></label>
            <p class="subtle">请确认旧邮箱和新邮箱收到的验证邮件。</p>
            <button class="secondary small" type="submit">发送验证邮件</button>
          </form>
        </details>
        <p class="subtle">账号同步定时提醒设置、晨间语录与音效。具体任务拆解、对话、长期记忆、打卡、积分及复盘保存在此设备。</p>
        ${emailPreferencePanel()}`;
    }
    let rememberLogin=true;
    const authStorage={
      getItem(key){
        const temporary=sessionStorage.getItem(key);
        if(key.endsWith('-code-verifier'))return storage.getItem(key) ?? temporary;
        if(temporary!==null)rememberLogin=false;
        return temporary ?? storage.getItem(key);
      },
      setItem(key,value){
        if(key.endsWith('-code-verifier')){
          // The email may open in a different tab of the same browser.
          storage.setItem(key,value);
          sessionStorage.removeItem(key);
          return;
        }
        const target=rememberLogin?storage:sessionStorage;
        const other=rememberLogin?sessionStorage:storage;
        target.setItem(key,value);
        other.removeItem(key);
      },
      removeItem(key){sessionStorage.removeItem(key);storage.removeItem(key);},
    };
    if(enabled) {
      const redirect=location.protocol==='file:' ? 'https://yuanshijing.github.io/little-steps/' : location.origin+location.pathname;
      const sdk=document.createElement('script');
      sdk.src='https://unpkg.com/@supabase/supabase-js@2.119.2/dist/umd/supabase.js';
      sdk.integrity='sha384-A97u3Qnt9GZHURO9YJZRe7VQgGUeFzcv6I1oIGnUTxQrCxnpQMwR0/G8F2zt9abZ';
      sdk.crossOrigin='anonymous';
      const sdkUnavailable=()=>{
        if(authResolved)return;
        clearTimeout(authTimeout);
        status='暂时无法加载登录服务，请刷新后重试。';
        redraw();
        showFirstLogin();
        updateLoginStatus();
      };
      authTimeout=setTimeout(sdkUnavailable,8000);
      sdk.addEventListener('load',()=>{
        try {
          client=window.supabase.createClient(config.url,config.key,{auth:{flowType:'pkce',storage:authStorage}});
          client.auth.onAuthStateChange((event,session)=>setTimeout(()=>{
            sessionChanged(session);
            if(event==='PASSWORD_RECOVERY')openPassword(session?.user);
          },0));
          void client.auth.getSession().then(({data,error})=>{
            if(authResolved)return;
            if(error)sdkUnavailable();else sessionChanged(data?.session);
          }).catch(sdkUnavailable);
        } catch { sdkUnavailable(); }
      },{once:true});
      sdk.addEventListener('error',sdkUnavailable,{once:true});
      document.head.append(sdk);
      document.addEventListener('submit',async event=>{
        const form=event.target;
        if(form.matches('[data-recovery-code]')){
          event.preventDefault();
          if(!client || passwordBusy)return;
          const fields=new FormData(form);
          const email=String(fields.get('email')??'').trim();
          const token=String(fields.get('token')??'').trim();
          if(!email || !/^[0-9]{6}$/.test(token))return toast('请输入登录邮箱和邮件里的六位验证码。');
          passwordBusy=true;
          try {
            const {data,error}=await client.auth.verifyOtp({email,token,type:'recovery'});
            if(error || !data?.session?.user){
              return toast(error?.status===429?'验证过于频繁，请稍后再试。':'验证码无效或已过期，请重新申请密码重置。');
            }
            sessionChanged(data.session);
            openPassword(data.session.user);
          } catch {toast('无法连接登录服务，请稍后重试。');}
          finally {passwordBusy=false;form.elements.token.value='';}
          return;
        }
        if(form.matches('[data-password-change]')){
          event.preventDefault();
          if(!client || !user || user.id!==passwordAccount || passwordBusy)return;
          const password=String(new FormData(form).get('password')??'');
          if(password.length<8)return toast('请设置至少 8 个字符的新密码。');
          const id=user.id;
          passwordBusy=true;
          try {
            const {error}=await client.auth.updateUser({password});
            if(user?.id!==id)return;
            if(error)return toast(error.code==='same_password'?'请使用与原密码不同的新密码。':'未能保存新密码，请检查密码规则或重新打开重置邮件。');
            form.closest('dialog')?.close();
            toast('新密码已保存。');
          } catch { toast('无法连接登录服务，请稍后重试。'); }
          finally { passwordBusy=false;form.reset(); }
          return;
        }
        if(form.matches('[data-email-change]')){
          event.preventDefault();
          if(!client || !user || emailChangeBusy)return;
          const fields=new FormData(form);
          const email=String(fields.get('email')??'').trim().toLowerCase();
          const password=String(fields.get('password')??'');
          if(!email || email===user.email?.toLowerCase())return toast('请输入与当前邮箱不同的新邮箱。');
          if(!password)return toast('请输入当前小步星球密码。');
          const {id,email:currentEmail}=user, submit=form.querySelector('button[type="submit"]');
          emailChangeBusy=true;
          if(submit)submit.disabled=true;
          try {
            const verification=await client.auth.signInWithPassword({email:currentEmail,password});
            if(user?.id!==id || user.email!==currentEmail)return;
            if(verification.error || verification.data?.user?.id!==id){
              return toast(verification.error?.status===429?'验证次数过多，请稍后再试。':
                verification.error?.code==='invalid_credentials'?'当前小步星球密码不正确。':'暂时无法验证当前密码，请稍后重试。');
            }
            const {data,error}=await client.auth.updateUser({email},{emailRedirectTo:redirect});
            if(user?.id!==id)return;
            if(error){
              toast(({
                email_exists:'这个邮箱已关联其他账号。',
                user_already_exists:'这个邮箱已关联其他账号。',
                email_address_not_authorized:'登录服务暂时无法向该邮箱发送验证邮件。',
                over_email_send_rate_limit:'验证邮件发送太频繁，请稍后再试。',
                email_address_invalid:'请核对新邮箱地址。',
              })[error.code]??'未能发送验证邮件，请稍后再试。');
              return;
            }
            form.reset();
            if(data?.user?.id===id && data.user.email?.toLowerCase()===email){
              sessionChanged({user:data.user});
              toast('登录邮箱已更换。');
            } else toast('请确认旧邮箱和新邮箱收到的验证邮件，然后用新邮箱和原密码登录。');
          } catch {
            if(user?.id===id)toast('无法连接登录服务，请稍后重试。');
          } finally {
            emailChangeBusy=false;
            if(submit)submit.disabled=false;
            const passwordField=form.elements?.password;
            if(passwordField)passwordField.value='';
          }
          return;
        }
        if(!form.matches('[data-sync-form]'))return;
        event.preventDefault();
        if(!client){toast(status);return;}
        const fields=new FormData(form);
        const email=String(fields.get('email')).trim(),password=String(fields.get('password'));
        if(event.submitter?.value==='recover'){
          const field=form.elements.email;
          if(!email || !field.checkValidity())return field.reportValidity();
          if(passwordBusy)return;
          passwordBusy=true;
          try {
            const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:redirect});
            if(error){
              toast(error.status===429?'重置邮件申请太频繁，请稍后再试。':'暂未发送重置邮件，请稍后重试。');
            } else {
              const entry=form.nextElementSibling;
              if(entry?.matches('[data-recovery-entry]')){
                entry.open=true;
                if(!entry.querySelector('[name="email"]').value)entry.querySelector('[name="email"]').value=email;
              }
              toast('请查收密码重置邮件。可以输入邮件里的验证码，或用发起申请的浏览器打开邮件链接。');
            }
          } catch {toast('无法连接登录服务，请稍后重试。');}
          finally {passwordBusy=false;}
          return;
        }
        if(password.length<8)return toast('请输入至少 8 个字符的密码。');
        const register=event.submitter?.value==='register';
        rememberLogin=fields.has('remember');
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
          if(!register && rememberLogin && window.PasswordCredential && navigator.credentials?.store){
            void navigator.credentials.store(new PasswordCredential({id:email,password})).catch(()=>{});
          }
          if(register&&!result.data.session)toast('请打开邮箱里的验证链接，再回来登录。');
        } catch { toast('无法连接登录服务，请稍后重试。'); }
        finally { form.elements.password.value=''; }
      });
      document.addEventListener('change',event=>{
        if(event.target.matches('[data-reminder-email]'))void setEmailPreference(event.target.checked);
      });
      document.addEventListener('click',event=>{
        const op=event.target.closest('[data-sync]')?.dataset.sync;
        if(!op||!user)return;
        if(op==='reset-password')return openPassword(user);
        if(op==='adopt'&&remote&&!busy)adopt(remote);
        if(op==='push')void push();
        if(op==='email-retry'){
          void readEmailPreference();
          void refreshTrial();
        }
        if(op==='retry'){
          hadError=false;
          if(remote&&signature()!==last)void push();else void pull();
        }
        if(op==='logout')void client.auth.signOut({scope:'local'}).then(result=>{
          if(result.error)toast('无法退出，请稍后重试');
        });
      });
      window.addEventListener('focus',()=>{
        if(user){
          const sinceFocus=user;
          void client.auth.getUser().then(({data})=>{
            if(user===sinceFocus && data?.user?.id===sinceFocus.id)sessionChanged({user:data.user});
          }).catch(()=>{});
          void refreshTrial();void readEmailPreference();
        }
        if(!user||pending||busy)return;
        if(hadError && remote && signature()!==last){hadError=false;void push();}
        else if(!remote || signature()===last)void pull();
      });
    }
    return {panel,onSave,openLogin};
  }
  return {snapshot,apply,mount};
});
