(() => {
  'use strict';
  const V = window.PlanetV1;
  const P = window.Planet;
  const C = window.PlanetCoach;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const card = (title, html) => `<section class="surface v1-card"><h2 class="section-title">${esc(title)}</h2>${html}</section>`;
  const btn = (action, label, value = '', primary = false) => `<button type="button" class="${primary ? 'primary' : 'secondary'} small" data-v1="${action}" data-value="${esc(value)}">${esc(label)}</button>`;
  const input = (name, text, value = '', attrs = '') => `<label>${esc(text)}<input class="field" name="${name}" value="${esc(value)}" ${attrs}></label>`;
  const when = (name, text, value) => input(name, text, value, 'type="time" required');
  const number = (name, text, value, min = 1, max = 120) => input(name, text, value, `type="number" min="${min}" max="${max}" required`);
  const messageSources = {schedule:'定时提醒',queued:'开始处理',transition:'环节衔接',manual:'主动开启',review:'复盘邀请'};
  const values = { wake: '已醒未离床', rise: '坐起尚未站立', wash: '洗漱', start: '准备开始',
    switch: '活动切换', returning: '偏航回归', bedtime: '睡前收尾', unanswered: '未回复' };
  const levelName = { basic: '完成积分', advanced: '进阶总积分', wakeLimit: '起床宽限分钟', startLimit: '启动宽限分钟',
    focusMin: '专注持续分钟', sleepLimit: '上床宽限分钟', returnLimit: '回归宽限分钟', returnMin: '回归持续分钟' };
  const readDuration = values => values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) + ' 分钟' : '暂无记录';
  const voice = window.SpeechRecognition || window.webkitSpeechRecognition;
  const coachStyles = [
    ['active','主动监督','直接提醒当前要做的事，帮你回到下一步。'],
    ['gentle','温柔陪伴','先回应你的状态，再一起找一个小动作。'],
    ['brief','简洁指令','少说一点，直接给出下一步。'],
  ];

  const routes = {chat:'v1', schedule:'v1reminders', review:'v1review', library:'v1library', ideas:'v1ideas'};
  function mount({ state: getState, page, save, render, go, toast, syncPanel }) {
    const vNow = () => V.init(getState());
    const date = () => P.dateKey();
    const api = location.protocol !== 'file:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
    const publicModel = !api && ['https:','file:'].includes(location.protocol) ? window.PlanetPublicDeepSeek : null;
    let day = date();
    let lastReview = '';
    let modelSending = false;
    let speechSession=null;
    const speechFeedback=new Map();
    const keyboardFallbacks=new Set();
    const device=window.navigator;
    const mobileDictation=device?.userAgentData?.mobile===true ||
      /Android|iPhone|iPad|iPod/i.test(device?.userAgent??'') ||
      (device?.platform==='MacIntel' && device.maxTouchPoints>1);
    let micPermission;
    if(voice) {
      window.navigator?.permissions?.query({name:'microphone'}).then(permission=>{
        micPermission=permission;
      }).catch(()=>{ /* Some browsers cannot report microphone permissions. */ });
    }
    const micBlocked='请在浏览器的网站权限里允许麦克风，再点一次听写。';
    let modelStatus = api ? '检测本机模型连接中' : '基础教练模式';
    let modelEnabled = false;
    let trial=null;
    const usingTrial=()=>Boolean(trial && !publicModel?.status().enabled);
    window.addEventListener('planet-trial',event=>{
      if(!publicModel)return;
      trial=event.detail.ready ? event.detail : null;
      modelEnabled=Boolean(trial || publicModel.status().enabled);
      modelStatus=publicModel.status().enabled ? 'DeepSeek 已连接 · 个人账户付费' :
        trial ? '内测 DeepSeek · 研究方付费 · 今日 '+trial.used+'/'+trial.limit+' 次' :
        event.detail.eligible ? '已加入试用名单 · 等待后台启用模型' :
        modelEnabled ? 'DeepSeek 已连接 · 个人账户付费' : '基础教练模式';
      if(['v1','v1settings','v1review'].includes(page()) && !document.activeElement?.matches('input,textarea'))paint();
    });
    let todayTokens;
    let reviewPending = '';
    let audio;
    const remindersAudible = () => vNow().settings.reminderSound !== false;
    async function armAudio() {
      const Context = window.AudioContext || window.webkitAudioContext;
      if ((!vNow().settings.sound && !remindersAudible()) || !Context) return false;
      audio ??= new Context();
      if (audio.state === 'suspended') await audio.resume().catch(() => {});
      return audio.state === 'running';
    }
    const volumeScale = value => P.bounded(value,0,200,125) / 100;
    function playSound(scale = volumeScale(vNow().settings.volume)) {
      if (!vNow().settings.sound || audio?.state !== 'running') return;
      const notes = [
        [659, 0, .044, .18], [784, .045, .035, .22], [1047, .095, .038, .26],
        [1319, .13, .020, .21], [1568, .155, .015, .19], [2093, .24, .010, .17],
        [1760, .303, .009, .23], [2637, .37, .006, .19],
      ];
      playNotes(notes,0,scale);
    }
    function playCompletionSound() {
      if (vNow().settings.sound) void armAudio().then(ready=>{ if (ready) playSound(); }).catch(()=>{});
    }
    function playReminderSound(delay = 0,scale = volumeScale(vNow().settings.volume)) {
      if (!remindersAudible() || audio?.state !== 'running') return false;
      playNotes([[880,0,.18,.115],[1175,.145,.2,.16]],delay,scale);
      return true;
    }
    function playNotes(notes,delay,scale) {
      if (!scale) return;
      const when = audio.currentTime + delay;
      for (const [frequency, offset, volume, duration] of notes) {
        const start = when + offset;
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(Math.min(.8,volume*scale*1.35), start + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
        osc.connect(gain).connect(audio.destination);
        osc.start(start);
        osc.stop(start + duration + .01);
      }
    }
    function reward(award) {
      if (!award) return;
      const el = document.createElement('div');
      el.className = 'v1-celebration ' + (award.id === 'sleep' ? 'quiet' : award.level === 2 ? 'bright' : '');
      el.setAttribute('role', 'status');
      el.textContent = award.text + '　⭐ +' + award.bonus + ' · ' + award.star;
      if (award.id !== 'sleep') {
        const sparks = document.createElement('span');
        sparks.className = 'reward-sparks';
        sparks.setAttribute('aria-hidden', 'true');
        for (const [index, x] of [-95,-69,-44,-19,20,45,70,96].entries()) {
          const spark = document.createElement('span');
          spark.textContent = index % 2 ? '✧' : '✦';
          spark.style.setProperty('--x', x + 'px');
          spark.style.setProperty('--y', -(42 + (index * 13) % 46) + 'px');
          spark.style.setProperty('--delay', index * 18 + 'ms');
          sparks.append(spark);
        }
        el.append(sparks);
      }
      playCompletionSound();
      document.body.append(el);
      setTimeout(() => el.remove(), 3700);
    }
    function chatPage(v) {
      const a = v.active;
      const controls = a ? V.options(v).map(({id,label}) => btn('choice',label,a.revision+'/'+id)).join('') : '';
      const due = a?.due ? '下次跟进约 ' + new Date(a.due).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) : '';
      const custom = a?.stage === 'wait' && a.id!=='wake' ? `<form data-v1-form="follow">${number('minutes','多少分钟后确认',10,1,1440)}<button class="secondary">确认时间</button></form>` : '';
      const timer = (a?.id === 'bath' && a.stage === 'bathTimer') || v.timer ? timerView(v) : '';
      const paused = getState().settings.pausedUntil > Date.now();
      const writingReview = Boolean(V.activeReview(v));
      const reviewPrompts = Object.entries(v.reviewPrompts ?? {})
        .filter(([,row]) => row.kind === 'daily' ? row.day === date() : V.monday(row.day) === V.monday(date()));
      const reviewCard = ([key,row]) => `<div class="review-prompt"><strong>${row.kind==='daily'?'睡前复盘':'每周复盘'}</strong>
        <div class="controls">${row.pending && v.reviewSession!==key ? btn('startReview',row.kind==='daily'?'开始简短复盘':'开始每周复盘',key,true) : ''}
        ${row.pending ? btn('dismissReview',row.kind==='daily'?'今晚跳过':'稍后再看',key) : ''}${btn('openReview','查看复盘总结',key)}</div></div>`;
      return `<div class="coach-layout"><div>` + card('消息', `<p class="subtle">${esc(modelStatus)}${paused ? ' · 监督已暂停' : ''}</p>
        <p id="chat-usage" class="chat-usage">${usageLabel()}</p>
        <div id="v1-chat" class="chatbox" aria-live="polite">${v.messages.map(row =>
          `<div class="bubble ${row.role === 'you' ? 'you' : 'ai'}"><span class="bubble-speaker">${row.role === 'you' ? '我' : '小星'}${Object.hasOwn(messageSources, row.source) ? ' · ' + messageSources[row.source] + ' · ' + new Date(row.at).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'}) : ''}</span>${esc(row.text)}</div>`).join('') || '<p class="subtle">小星会在设定时间主动发消息。你也可以随时主动发消息或求助。</p>'}
        ${v.queue.filter(row=>row.day===date() && v.records[row.day+'/'+row.id]?.notifiedAt != null).map(row=>
          `<div class="review-prompt"><strong>${esc(V.title(v,row.id))} · 待处理</strong>
          ${btn('open','处理这条提醒',row.id)}</div>`).join('')}
        ${reviewPrompts.filter(([,row])=>row.kind==='weekly').map(reviewCard).join('')}
        </div>
        ${a ? `<section class="chat-choices" aria-label="${esc(V.title(v,a.id))}的对话操作"><p><b>${esc(V.title(v,a.id))}</b> <span class="subtle">${esc(due)}</span></p>
        ${controls ? (a.stage==='sustain'
          ? `<details><summary>确认专注进展</summary><div class="controls">${controls}</div></details>`
          : `${a.stage!=='initial' && !a.prompt && V.phases[a.stage]?.question ? '<p>'+esc(V.phases[a.stage].question)+'</p>' : ''}
            <div class="controls">${controls}</div>`) : ''}
        <details${a.stage==='wait'?' open':''}><summary>更多操作</summary><div class="controls">
          ${a.id==='wake'||a.stage==='wait'?'':btn('agreeTime','约定下次确认')}
          ${btn('outcome','跳过本次','主动跳过')}${btn('outcome','记为未完成','未完成')}
          ${v.settings.times[a.id]?btn('remindOff','关闭该环节提醒'):''}
          ${paused?btn('resume','恢复监督'):btn('pause','暂停监督一小时')}</div>${custom}</details>
        ${a.id==='sleep' ? btn('tab','查看每日复盘','review') : ''}</section>` : ''}
        ${reviewPrompts.filter(([,row])=>row.kind==='daily').map(reviewCard).join('')}
        <form data-v1-form="chat"><label>${writingReview?'填写本次复盘反馈':'和小星聊聊'}<textarea id="v1-input" class="field" name="message" rows="2" maxlength="500" required></textarea></label>
        <div class="controls"><button type="submit" class="primary" ${!writingReview&&(!modelEnabled||modelSending)?'disabled':''}>发送</button>${voiceButton('v1-input')}</div></form>
        <p class="subtle">${writingReview?'发送后记入本次复盘。':modelEnabled?'输入消息会用到 DeepSeek 和相关对话、计划及允许检索的记忆。快捷选项不消耗 Token。':'连接 DeepSeek 后可发送消息，也可以直接点选状态。'}</p>
        ${voice ? '<p class="subtle">语音转文字由浏览器提供，可能使用浏览器的在线服务。转写后可先检查再发送。</p>' : ''}`) + timer +
        `</div><aside>` + card('小工具', `<div class="section-links">${btn('emotion','梳理此刻的情绪')}${btn('tab','记个灵感','ideas')}
          <button type="button" class="secondary small" data-act="page" data-target="focus">专注计时</button>
          ${!a ? `<details><summary>更多操作</summary>${paused ? btn('resume','恢复监督') : btn('pause','暂停监督一小时')}</details>` : ''}</div>`) +
        '<button type="button" class="chat-reminder-link" data-v1="tab" data-value="schedule">查看主动提醒</button></aside></div>' +
        '<div class="controls chat-message-actions"><button type="button" class="primary chat-return-button" data-v1="open" data-value="return">回到正轨</button></div>';
    }
    function timerView(v) {
      return card('洗澡计时', v.timer ? `<p id="v1-timer" class="timer">00:00</p><p id="v1-timer-stage"></p>
      <div class="controls">${btn('timer',v.timer.runningSince == null ? '继续' : '暂停',v.timer.runningSince == null ? 'resume' : 'pause')}${btn('timer','结束并记录用时','end',true)}</div>` :
        `<form data-v1-form="timer"><label>计时模式<select class="field" name="mode"><option value="bath">仅洗澡 · 20 分钟</option><option value="combined">洗澡 30 分钟＋整理 10 分钟</option><option value="custom">自定义</option></select></label>
        ${number('custom','自定义分钟',20,1,180)}<button class="primary">开始计时</button></form>`);
    }
    function schedulePage(v) {
      const state = getState();
      const removed = V.ids.filter(id => v.settings.times[id].removed);
      return card('主动提醒', `<form data-v1-form="schedule">${window.PlanetDashboard.reminders(state)}
        ${removed.length ? `<details class="reminder-details"><summary>已移除的提醒</summary>${removed.map(id=>`<label><input type="checkbox" name="restore_${esc(id)}"> 恢复${esc(V.title(v,id))}</label>`).join('')}</details>` : ''}
        <details class="reminder-details"><summary>跟进间隔和学习收尾时间</summary>
        <div class="cols">${Object.entries(values).map(([key,label]) => number('interval_'+key,label+'（分钟）',v.settings.intervals[key])).join('')}
        ${when('wrap_am','上午收尾确认',v.settings.wrapTimes?.am??'11:50')}${when('wrap_pm','下午收尾确认',v.settings.wrapTimes?.pm??'18:15')}</div></details>
        <details class="reminder-details"><summary>每周复盘提醒</summary><div class="cols"><label>星期<select class="field" name="weekDay">${['日','一','二','三','四','五','六'].map((label,i) =>
          `<option value="${i}" ${i === v.settings.weekDay ? 'selected' : ''}>星期${label}</option>`).join('')}</select></label>${when('weekTime','时间',v.settings.weekTime)}</div></details>
        <label><input type="checkbox" name="remind" ${state.settings.remind ? 'checked' : ''}> 启用自动提醒</label>
        <div class="controls"><button class="primary">保存提醒</button>${btn('notify','授权浏览器通知')}</div></form>`);
    }
    function settingsPage(v) {
      return card('账号与设置同步',`<div id="settings-sync-panel">${syncPanel()}</div>`) +
        card('教练风格', `<div class="coach-style-options" role="radiogroup" aria-label="小星的教练风格">
          ${coachStyles.map(([value,label,description])=>`<label class="coach-style-choice">
            <input type="radio" name="coach-style" data-coach-style value="${value}" ${getState().settings.style===value?'checked':''}>
            <span><strong>${label}</strong><small>${description}</small></span>
          </label>`).join('')}</div>`) +
        memorySettings(v) + coachGuideSettings() +
        card('提醒与奖励音效', `<form data-v1-form="settings">
        <label>总音量 <output id="v1-volume-value">${Math.round(volumeScale(v.settings.volume)*100)}%</output>
        <input class="field" type="range" name="volume" min="0" max="200" step="5" value="${Math.round(volumeScale(v.settings.volume)*100)}" aria-label="总音量"></label>
        <label><input type="checkbox" name="reminderSound" ${remindersAudible() ? 'checked' : ''}> 播放定时提醒提示音</label>
        <div class="controls">${btn('soundDemo','试听定时提醒音','reminder')}</div>
        <p class="subtle">到点提醒会响。你回复后的引导消息保持静音。首次使用时，可点击试听开启网页播放。</p>
        <label><input type="checkbox" name="sound" ${v.settings.sound ? 'checked' : ''}> 播放任务完成奖励音</label>
        <div class="controls">${btn('soundDemo','试听撒星星音效','normal')}</div>
        <details class="reminder-details"><summary>积分和进阶条件</summary><div class="cols">${Object.entries(levelName).map(([key,label]) => number(key,label,v.settings[key],1,1000)).join('')}</div></details>
        <button class="primary">保存音效和奖励设置</button></form>`) +
        ((trial || api || publicModel) ? card('模型连接', `<p>${esc(modelStatus)}</p>${usingTrial() ? '<p class="subtle">当前使用试用额度，也可以连接自己的密钥。</p>' : ''}
          ${publicModel?.status().enabled ? btn('disconnectModel','断开个人 DeepSeek') : api && modelEnabled ? btn('connection','测试已配置模型') : ''}
          <form method="post" data-v1-form="deepseek" autocomplete="off"><label>DeepSeek API Key
          <input class="field" type="password" name="key" placeholder="sk-…" required maxlength="223" autocomplete="off" spellcheck="false"></label>
          <p class="subtle">${api ? '测试发送一条示例问题。密钥保存在本机服务的内存中，关闭服务后需要重新填写。' : '测试会向 DeepSeek 发送一条示例问题，并计入你自己的 DeepSeek 用量。密钥只在当前页面的内存中使用，刷新或关闭页面后需要重新填写。'}</p>
          <button class="primary">连接并测试 DeepSeek</button></form>`) : '') +
        card('本地数据', `<div class="controls"><button type="button" class="secondary small" data-act="export">导出数据</button>
          <button type="button" class="danger small" data-act="reset">清除本地数据</button></div>`);
    }
    function reviewInput(v,kind,reviewDay,note) {
      const stats = kind === 'weekly' ? V.weekly(v,reviewDay) : null;
      const cases = stats?.cases ?? v.events.filter(row=>row.type==='detour' && row.day===reviewDay);
      return {kind,day:reviewDay,note:note ?? (kind === 'daily' ? v.reviews[reviewDay]?.note : v.weekNotes?.[reviewDay]) ?? '',
        records:stats ? stats.stats.map(row=>V.title(v,row.id) + '：完成 ' + row.completed + '，部分完成 ' + row.partial + '，未完成 ' + row.incomplete +
          '，跳过 ' + row.skipped + '，未记录 ' + row.missing) : V.dailyText(v,reviewDay).split('\n'),
        cases:cases.slice(-6).map(row=>[row.day,row.obstacle,row.strategy,row.outcome].filter(Boolean).join(' · '))};
    }
    function reviewSummary(v,kind,reviewDay) {
      const key = kind + '/' + reviewDay;
      const stored = v.reviewSummaries?.[key];
      let summary;
      if (kind === 'daily') {
        const rows = V.dailyRows(v,reviewDay);
        const done = rows.filter(row=>['已完成','完成得很好'].includes(row.status)).map(row=>row.title);
        const missing = rows.filter(row=>row.status==='未记录').length;
        summary = (done.length ? '这一天有 ' + done.length + ' 项确认完成，包括' + done.slice(0,3).join('、') + '。' : '这一天暂时没有确认完成的任务记录。') +
          (missing ? '还有 ' + missing + ' 项未记录。' : '') + '可以选一件想记下的小事，或为明天写下第一个具体动作。';
      } else {
        const stats = V.weekly(v,reviewDay);
        const completed = stats.stats.reduce((sum,row)=>sum+row.completed,0);
        summary = '最近七天确认完成 ' + completed + ' 项次，记录偏航 ' + stats.cases.length + ' 次，确认回归 ' + stats.returns + ' 次。' +
          (stats.suggested[0] ? stats.suggested[0] : '下一周可以记录一次中断和恢复的过程，用来找出适合你的策略。');
      }
      return `<section class="review-summary" id="summary-${kind}"><div class="review-summary-title"><h3>小星的总结</h3>
        <span>${stored ? '上次生成 · 大模型' : '根据记录整理'}</span></div>
        ${(stored?.text ?? summary).split(/\n+/).filter(Boolean).map(text=>`<p>${esc(text)}</p>`).join('')}
        ${modelEnabled ? `<p class="subtle">生成会把相关任务记录、偏航案例、复盘补充和已保存的个人教练指导发送给已配置的模型。</p>
        ${reviewPending === key ? '<p class="subtle" role="status">小星正在整理……</p>' : btn('generateReview',stored?'重新生成大模型总结':'用大模型生成总结',kind)}`
          : '<p class="subtle">当前未连接大模型服务。</p>'}</section>`;
    }
    function coachGuideKey() {
      const account = window.PlanetTrial;
      const owner = account ? account.accountId?.() : 'device';
      return owner ? 'little-steps.coach-guide.' + owner : '';
    }
    function readCoachGuide(key=coachGuideKey()) {
      try { return key ? localStorage.getItem(key) ?? '' : ''; }
      catch { return ''; }
    }
    async function callModel(route,input) {
      const coachGuide = readCoachGuide();
      if (coachGuide) input = {...input,coachGuide};
      if (usingTrial()) return window.PlanetTrial.run(route,input);
      if (publicModel) return publicModel.run(route,input);
      const response = await fetch('/api/v1/'+route,{method:'POST',headers:{'Content-Type':'application/json'},
        signal:AbortSignal.timeout(25000),body:JSON.stringify(input)});
      if (!response.ok) throw new Error();
      return response.json();
    }
    async function generateReview(kind) {
      if (!modelEnabled || reviewPending || !['daily','weekly'].includes(kind)) return;
      const state = getState(), v = vNow(), reviewDay = day, key = kind + '/' + day;
      const note = kind === 'daily' ? document.getElementById('v1-reflection')?.value : undefined;
      const content = reviewInput(v,kind,reviewDay,note);
      const refresh = () => {
        if (page() === 'v1review' && day === reviewDay) {
          const panel = document.getElementById('summary-'+kind);
          if (panel) panel.outerHTML = reviewSummary(v,kind,reviewDay);
        }
      };
      reviewPending = key;
      refresh();
      try {
        const result = await callModel('review',{...content,consent:true});
        if (typeof result.summary !== 'string') throw new Error();
        if (state !== getState()) return;
        (v.reviewSummaries ??= {})[key] = {text:result.summary,at:Date.now()};
        save();
      } catch {
        toast('大模型总结暂时不可用，可以稍后重试');
      } finally {
        reviewPending = '';
        refresh();
        void refreshUsage();
      }
    }
    function tomorrowRow(index,row={}) {
      return `<fieldset><legend>重点 ${index+1}</legend>
        ${input('title'+index,'任务',row.title,'maxlength="80" data-plan-field="title"')}
        ${input('when'+index,'计划时间',row.when ?? '09:00','type="time" data-plan-field="when"')}
        ${input('step'+index,'第一步',row.firstStep,'maxlength="150" data-plan-field="step"')}
        ${btn('clearTomorrow','移除重点 '+(index+1))}</fieldset>`;
    }
    function reindexTomorrow(form) {
      const rows=[...form.querySelector('#tomorrow-items').children];
      rows.forEach((row,index)=>{
        row.querySelector('legend').textContent='重点 '+(index+1);
        row.querySelector('[data-v1="clearTomorrow"]').textContent='移除重点 '+(index+1);
        row.querySelectorAll('[data-plan-field]').forEach(field=>{field.name=field.dataset.planField+index;});
      });
      form.querySelector('[data-v1="addTomorrow"]').disabled=rows.length>=3;
    }
    function addTomorrow(form,row={}) {
      const list=form.querySelector('#tomorrow-items');
      if(list.children.length>=3)return false;
      list.insertAdjacentHTML('beforeend',tomorrowRow(list.children.length,row));
      reindexTomorrow(form);
      return true;
    }
    function reviewPage(v) {
      const row = v.reviews[day];
      const report = V.weekly(v, day);
      const dayRows = V.dailyRows(v, day);
      const todayCases = v.events.filter(event => event.day === day && event.type === 'detour');
      const tomorrow = P.shiftDate(date(), 1);
      const state=getState(), plan=state.plans[tomorrow]?.items ?? [];
      const remindPlan=state.settings.nextDayRemind!==false;
      const stamp = xs => xs.map(n => String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0')).join('、') || '暂无记录';
      const timingMetrics=[
        ['平均启动延迟',readDuration(report.delays)],['上周平均启动延迟',readDuration(report.previousDelays)],
        ['平均洗澡用时',readDuration(report.durations)],['起床时间',stamp(report.wakeTimes)],['上床时间',stamp(report.bedTimes)],
        ['偏航与回归','偏航 '+report.cases.length+' 次 · 回归 '+report.returns+' 次'],
      ];
      const reviewBlock=(heading,body)=>`<section class="weekly-detail-card"><h3>${heading}</h3><div class="weekly-detail-body">${body}</div></section>`;
      return `<nav class="review-navigation" aria-label="复盘入口"><a class="secondary small" href="#daily-review">每日复盘</a>
        <a class="secondary small" href="#tomorrow-plan">明日重点</a><a class="secondary small" href="#weekly-review">每周复盘</a></nav>` +
        '<div id="daily-review">' +
        card('每日复盘', `<label class="review-date">查看日期<input class="field" type="date" id="v1-review-date" value="${esc(day)}"></label>
        ${reviewSummary(v,'daily',day)}
        <h3 class="daily-records-heading">任务记录</h3><ul class="daily-records">${dayRows.map(task => `<li><span class="daily-record-title">${esc(task.title)}</span><span class="daily-record-status">${task.completedAt ? new Date(task.completedAt).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'}) + ' · ' : ''}${esc(task.status)}</span></li>`).join('')}</ul>
        <div class="review-note"><h3>偏航与恢复 · ${todayCases.length} 次</h3>
        ${todayCases.length ? '<ul>' + todayCases.map(c=>'<li>' + esc(c.obstacle + ' · 尝试 ' + c.strategy) + '</li>').join('') + '</ul>' : '<p>暂无偏航记录</p>'}
        <p>${esc(todayCases[0] ? '明天可以先试：' + todayCases[0].strategy : '明天可以先选一件重要的小事。')}</p></div>
        <form data-v1-form="daily"><label>补充复盘或口述草稿<textarea id="v1-reflection" class="field" maxlength="1500" rows="3" name="note" data-review-day="${esc(day)}">${esc(row?.note)}</textarea></label>
        <div class="controls"><button class="primary">保存复盘</button>${btn('skipReview','跳过详细复盘')}${voiceButton('v1-reflection')}</div></form>
        ${row ? '<p class="subtle">' + (row.skipped ? '已跳过详细复盘' : '复盘已保存') + '</p>' : ''}`) +
        '</div><div id="tomorrow-plan">' +
        card('明日重点 · ' + tomorrow, `<form data-v1-form="tomorrow">
        <input type="hidden" name="planDay" value="${tomorrow}">
        <p class="subtle">最多填写三项，次日起床提醒会显示这些重点。网页运行时，「计划时间」可触发站内提醒，这些重点不会加入「定时提醒」清单或发送邮件。「第一步」是提醒里显示的具体起手动作。也可以在复盘里分行写「明天：任务」，再提取。</p>
        <div id="tomorrow-items">${plan.map((row,index)=>tomorrowRow(index,row)).join('')}</div>
        <div class="controls"><button type="button" class="secondary small" data-v1="addTomorrow" ${plan.length>=3?'disabled':''}>＋ 添加明日重点</button>
          ${btn('extract','从复盘提取明日重点')}</div>
          <div class="tomorrow-time">
            <label class="tomorrow-time-field">提示时间<input class="field" name="nextDayTime" type="time" value="${esc(state.settings.nextDayTime)}" required${remindPlan?'':' disabled'}></label>
            <p class="subtle" id="tomorrow-remind-help">勾选后，次日网页运行时会在指定时间额外提示整份重点。各项计划时间仍单独生效。</p>
            <label class="tomorrow-remind"><input type="checkbox" name="nextDayRemind" data-tomorrow-remind ${remindPlan?'checked':''} aria-describedby="tomorrow-remind-help"> 提示整份明日重点</label>
          </div>
          <button class="primary">保存明日重点</button></form>`) +
        '</div><div id="weekly-review">' +
        card('每周复盘 · 最近七天', `${reviewSummary(v,'weekly',day)}${v.weekNotes?.[day] ? '<p><strong>你在对话中补充</strong> · '+esc(v.weekNotes[day])+'</p>' : ''}
        <dl class="weekly-metrics">${timingMetrics.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
        <h3 class="weekly-records-heading">任务完成情况</h3><ul class="weekly-records">${report.stats.map(s => `<li><span class="weekly-record-title">${esc(V.title(v,s.id))}</span><span class="weekly-record-stats">普通 ${s.completed - s.advanced} · 进阶 ${s.advanced} · 部分完成 ${s.partial} · 未完成 ${s.incomplete} · 跳过 ${s.skipped} · 未记录 ${s.missing} · 无须执行 ${s.notScheduled} · 完成率 ${s.rate == null ? '暂无' : Math.round(s.rate*100)+'%'}</span></li>`).join('')}</ul>
        <div class="weekly-detail-grid">
        ${reviewBlock('代表性案例',report.cases.slice(-4).map(e => `<div class="weekly-case"><p>${esc(e.day+' · '+e.obstacle+'（'+e.source+'） · '+e.strategy+' · '+e.outcome)}</p>
        ${v.settings.memory && e.outcome==='已确认回归' ? btn('rememberCase','存入长期记忆',e.at) : ''}</div>`).join('') || '<p class="subtle">暂无案例</p>')}
        ${reviewBlock('回归记录中的策略',`<p>${esc(report.strategies.join('；') || '暂无记录')}</p>`)}
        ${reviewBlock('下周可试',`<p>${esc(report.suggested.join('；') || '先记录一次真实的中断和恢复过程。')}</p>`)}
        </div>`) + '</div>';
    }
    function libraryPage(v) {
      const current = V.chooseQuote(v, date());
      const nextWeek = P.shiftDate(V.monday(date()),7);
      const all = [...V.catalog.quotes,...v.customQuotes];
      const available = all.filter(row=>!['hidden','dislike'].includes(v.preferences[row.id]));
      const quotePicker = (name,label,selected) => `<label>${label}<select class="field" name="${name}">
        <option value="">自动选择</option>${available.map(row=>`<option value="${esc(row.id)}" ${row.id===selected?'selected':''}>
        ${esc(row.theme + ' · ' + row.lines[0])}</option>`).join('')}</select></label>`;
      return card('本周晨间语录', `<p class="subtle">每周一自动换一组，同一周随起床提醒发送这两句。收藏的语录会优先入选。</p>
        ${current ? '<blockquote class="weekly-quote"><b>' + esc(current.theme) + '</b>' + current.lines.map(line=>'<p>' + esc(line) + '</p>').join('') + '</blockquote>' : '<p>目前没有可用语料</p>'}`) +
        card('管理语录', `<form data-v1-form="quoteSchedule"><div class="cols">
        ${quotePicker('thisWeek','本周使用',v.scheduledQuotes?.[V.monday(date())])}
        ${quotePicker('nextWeek','下周使用 · '+nextWeek,v.scheduledQuotes?.[nextWeek])}
        </div><button class="primary">保存语录安排</button></form>
        <details class="reminder-details"><summary>添加自定义语录</summary>
        <form data-v1-form="quote">${input('theme','主题','','required maxlength="30"')}${input('a','第一句','','required maxlength="120"')}${input('b','第二句','','required maxlength="120"')}<button class="primary">添加语录</button></form></details>` +
        all.map(q => `<div class="v1-line quote-row"><div><b>${esc(q.theme)}</b>${q.lines.map(line=>'<p>' + esc(line) + '</p>').join('')}</div>
          <select aria-label="${esc(q.theme)}偏好" class="field" data-v1-quote="${esc(q.id)}">${[['','可用'],['favorite','收藏'],['dislike','不喜欢'],['hidden','隐藏']].map(([k,l])=>`<option value="${k}" ${(v.preferences[q.id]??'')===k?'selected':''}>${l}</option>`).join('')}</select></div>`).join(''));
    }
    function ideasPage(v) {
      return card('灵感暂存', `<form data-v1-form="idea"><label>记下现在不必展开的事<textarea class="field" required id="v1-idea" name="text" maxlength="500"></textarea></label>
        <div class="controls"><button class="primary">保存并回到原任务</button>${voiceButton('v1-idea')}</div></form>
        ${v.ideas.slice().reverse().map(row => `<div class="v1-line"><span>${esc(row.text)}</span>${btn('removeIdea','删除',row.id)}</div>`).join('')}`);
    }
    function coachGuideSettings() {
      const key = coachGuideKey();
      return card('个人教练指导', key ? `<form method="post" data-v1-form="coach-guide" data-guide-owner="${esc(key)}">
        <label>长期指导原则<textarea class="field" name="guide" rows="5" maxlength="8000"
          autocomplete="off" aria-describedby="coach-guide-note">${esc(readCoachGuide(key))}</textarea></label>
        <p class="subtle" id="coach-guide-note">可粘贴一整份指导文档。内容保存在此浏览器下的当前账号中，在发送 AI 消息或生成 AI 复盘时随请求发给 DeepSeek。清空并保存可移除。</p>
        <button class="secondary">保存个人教练指导</button></form>` :
        '<p class="subtle">登录后可以保存这个账号的个人教练指导。</p>');
    }
    function memorySettings(v) {
      return card('长期记忆', `<label><input type="checkbox" id="v1-memory-on" ${v.settings.memory ? 'checked' : ''}> 启用长期记忆检索</label>
        <p class="subtle">确认添加后保存，可随时编辑或删除。开启检索后，小星会在使用 AI 时参考相关记忆。</p>
        ${[...v.memory,{id:'',text:'',scene:'all'}].map(row=>`<form data-v1-form="memory" class="v1-memory-row">
          <input type="hidden" name="id" value="${esc(row.id)}">${input('text',row.id?'编辑记忆':'添加记忆',row.text,'required maxlength="320"'+(row.id?'':' aria-describedby="memory-examples"'))}
          ${row.id?'':'<p class="subtle" id="memory-examples">可以写你的习惯或偏好（如「卡住时请只给我一个小步骤」）、试过有效的方法（如「把手机放远后，我顺利开始了」），或想试试的做法（如「下次先把材料摆到桌上」）。</p>'}
          <label>相关环节<select class="field" name="scene"><option value="all">通用</option>${V.ids.map(id=>`<option value="${id}" ${row.scene===id?'selected':''}>${esc(V.data[id].title)}</option>`).join('')}</select></label>
          <div class="controls"><button class="secondary">${row.id?'保存修改':'确认添加'}</button>${row.id?btn('deleteMemory','删除',row.id):''}</div></form>`).join('')}`);
    }
    function screen(section) {
      const v = vNow();
      return ({chat:chatPage,schedule:schedulePage,settings:settingsPage,review:reviewPage,library:libraryPage,ideas:ideasPage}[section])(v);
    }
    function paint() {
      const inputs=['v1-input','v1-reflection','v1-idea'];
      const drafts=inputs.map(id=>{
        const field=document.getElementById(id);
        return [id,field?.value,field?.dataset?.reviewDay];
      });
      render();
      for(const [id,value,reviewDay] of drafts){
        const field=document.getElementById(id);
        if(field && value!==undefined && field.dataset?.reviewDay===reviewDay)field.value=value;
      }
      clock();
      save();
    }
    function clock() {
      const t = vNow().timer;
      const el = document.getElementById('v1-timer');
      if (!t || !el) return;
      const elapsed = V.elapsed(t, Date.now());
      const remaining = Math.ceil(Math.max(0,t.target - elapsed)/1000);
      el.textContent = String(Math.floor(remaining/60)).padStart(2,'0') + ':' + String(remaining%60).padStart(2,'0');
      document.getElementById('v1-timer-stage').textContent = t.runningSince == null ? '已暂停'
        : elapsed >= t.target ? '已到目标时间 · 仍在记录实际用时'
        : t.stages.length === 2 && elapsed >= 30*60000 ? '第二阶段 · 洗衣及整理' : '第一阶段 · 洗澡';
    }
    function updateReminderStatuses(v) {
      for (const node of document.querySelectorAll('[data-reminder-status]')) {
        const id = node.dataset.reminderStatus;
        const status = window.PlanetDashboard.reminderStatus(v, date(), id);
        node.textContent = status;
        const button = node.parentElement.querySelector('.reminder-open');
        const label = status === '对话中' ? '继续对话' : '现在聊聊';
        button.textContent = label;
        button.setAttribute('aria-label', V.title(v,id) + ' · ' + label);
      }
    }
    function selectTab(next) { go(routes[next]); }
    function configureSchedule(data) {
      const v = vNow(), s = v.settings;
      const ids = V.ids.filter(id => !s.times[id].removed && !data['remove_'+id]);
      const rescheduled = new Set(ids.filter(id=>s.times[id].time!==data['time_'+id]));
      if(ids.some(id=>!P.timeOk(data['time_'+id]))){toast('请填写有效提醒时间');return false;}
      for (const id of ids) {
        const time = data['time_'+id];
        const enabled = Boolean(data['enabled_'+id]);
        const setting = s.times[id];
        if (setting.enabled && !enabled && v.active?.id === id) V.park(v,'主动跳过');
        V.setFixedReminder(v,id,{time,enabled});
      }
      for (const id of V.ids) {
        if (data['remove_'+id]) {
          V.setFixedReminder(v,id,{removed:true,enabled:false});
          if (v.active?.id === id) V.park(v,'未记录');
        } else if (data['restore_'+id] && s.times[id].removed) {
          V.setFixedReminder(v,id,{removed:false,enabled:true});
        }
      }
      v.queue = v.queue.filter(row=>s.times[row.id]?.enabled && (row.source!=='schedule' || !rescheduled.has(row.id)));
      for (const id of rescheduled) {
        const record = v.records[date()+'/'+id];
        if (record?.status === '待执行') {
          record.planned = P.dueAt(date(),s.times[id].time);
        }
      }
      for (const key of Object.keys(values)) s.intervals[key] = P.bounded(data['interval_'+key],1,120,s.intervals[key]);
      s.weekDay = P.bounded(data.weekDay,0,6,0);
      if (P.timeOk(data.weekTime)) s.weekTime = data.weekTime;
      if (P.timeOk(data.wrap_am) && P.timeOk(data.wrap_pm)) s.wrapTimes = {am:data.wrap_am,pm:data.wrap_pm};
      const settings=getState().settings;
      settings.remind = Boolean(data.remind);
      toast('提醒设置已保存');
    }
    function removeReminderRow(button) {
      const draft = button.closest('[data-draft-reminder]');
      if (draft) { draft.remove(); return; }
      const row = button.closest('[data-saved-reminder]');
      const field = document.createElement('input');
      field.type = 'hidden';
      field.name = 'remove_'+row.dataset.savedReminder;
      field.value = '1';
      button.form.append(field);
      row.remove();
      toast('已移出列表，保存提醒后生效');
    }
    function sortReminderRows(field) {
      const list = document.getElementById('reminder-list');
      if (!list || V.manualReminderOrder(vNow()).length) return;
      const rows = [...list.children];
      const rank = row=>V.reminderTimeOrder(row.querySelector('[data-reminder-time]').value);
      const sorted = rows.slice().sort((a,b)=>rank(a)-rank(b));
      if (sorted.every((row,index)=>row===rows[index])) return;
      const focused = field && document.activeElement === field;
      list.append(...sorted);
      if (focused) field.focus({preventScroll:true});
    }
    function moveReminder(row, destination) {
      const list=row.parentElement;
      const rows=[...list.children];
      const index=rows.indexOf(row), target=rows[destination];
      if (!target || destination===index) return;
      list.insertBefore(row,destination<index?target:target.nextElementSibling);
      vNow().settings.reminderOrder=[...list.children].map(node=>node.dataset.savedReminder);
      const status=document.getElementById('reminder-order-status');
      if(status)status.textContent='已移到第 '+(destination+1)+' 项，当前按手动顺序排列。';
      save();
    }
    let reminderDrag=null;
    document.addEventListener('pointerdown',e=>{
      const grip=e.target.closest('[data-reminder-grip]');
      if(!grip || !e.isPrimary || e.button!==0)return;
      const row=grip.closest('[data-saved-reminder]');
      grip.setPointerCapture(e.pointerId);
      reminderDrag={row,grip,id:e.pointerId,startY:e.clientY,target:null};
    });
    document.addEventListener('pointermove',e=>{
      const drag=reminderDrag;
      if(!drag || e.pointerId!==drag.id || !drag.row.isConnected || (!drag.target && Math.abs(e.clientY-drag.startY)<6))return;
      const rows=[...drag.row.parentElement.children];
      const target=rows.find(row=>e.clientY<row.getBoundingClientRect().bottom) ?? rows.at(-1);
      if(drag.target!==target)drag.target?.classList.remove('reminder-drop-target');
      drag.target=target;
      target.classList.toggle('reminder-drop-target',target!==drag.row);
    });
    function finishReminderDrag(e) {
      const drag=reminderDrag;
      if(!drag || e.pointerId!==drag.id)return;
      reminderDrag=null;
      drag.target?.classList.remove('reminder-drop-target');
      if(e.type==='pointerup' && drag.target && drag.row.isConnected && drag.target.parentElement===drag.row.parentElement){
        moveReminder(drag.row,[...drag.row.parentElement.children].indexOf(drag.target));
        drag.grip.focus({preventScroll:true});
      }
    }
    document.addEventListener('pointerup',finishReminderDrag);
    document.addEventListener('pointercancel',finishReminderDrag);
    document.addEventListener('lostpointercapture',finishReminderDrag);
    document.addEventListener('keydown',e=>{
      const grip=e.target.closest('[data-reminder-grip]');
      if(!grip || !['ArrowUp','ArrowDown'].includes(e.key))return;
      e.preventDefault();
      const row=grip.closest('[data-saved-reminder]');
      moveReminder(row,[...row.parentElement.children].indexOf(row)+(e.key==='ArrowUp'?-1:1));
      grip.focus({preventScroll:true});
    });
    document.addEventListener('pointerdown',()=>{
      if (audio?.state !== 'running') void armAudio().catch(()=>{});
    });
    document.addEventListener('keydown',()=>{
      if (audio?.state !== 'running') void armAudio().catch(()=>{});
    });
    function configureRewards(data) {
      const s = vNow().settings;
      if (Number(data.advanced) < Number(data.basic)) return toast('进阶总积分至少等于完成积分');
      for (const key of Object.keys(levelName)) s[key] = P.bounded(data[key],1,1000,s[key]);
      s.sound = Boolean(data.sound);
      s.reminderSound = Boolean(data.reminderSound);
      s.volume = P.bounded(data.volume,0,200,125);
      toast('奖励设置已保存');
    }
    function voiceButton(id) {
      const active=speechSession?.id===id;
      const label=active?'结束语音输入':'开始语音输入';
      const webMic=voice ? `<button type="button" class="secondary voice-button" data-v1="voice" data-value="${id}"
        aria-label="${label}" aria-pressed="${active}" aria-describedby="${id}-voice-feedback" title="${label}"><span class="mic-icon" aria-hidden="true"></span></button>` : '';
      return `${webMic}<button type="button" class="secondary small" id="${id}-keyboard-dictation" data-v1="keyboardDictation"
        data-value="${id}" ${voice && !mobileDictation && !keyboardFallbacks.has(id)?'hidden':''}>设备键盘听写</button>
        <span class="subtle voice-feedback" id="${id}-voice-feedback" role="status">${esc(speechFeedback.get(id)??'')}</span>
        <span class="subtle voice-preview" id="${id}-voice-preview">${esc(active?speechSession.preview:'')}</span>`;
    }
    function showKeyboardFallback(id) {
      keyboardFallbacks.add(id);
      const button=document.getElementById(id+'-keyboard-dictation');
      if(button) button.hidden=false;
    }
    function keyboardDictation(id) {
      const field=document.getElementById(id);
      if(!field)return;
      cancelSpeech();
      field.focus();
      updateSpeech(id,'请点屏幕键盘上的麦克风开始听写。文字会填在这里，检查后再发送或保存。');
    }
    function updateSpeech(id,text) {
      speechFeedback.set(id,text);
      const feedback=document.getElementById(id+'-voice-feedback');
      if(feedback)feedback.textContent=text;
      const button=document.querySelector(`[data-v1="voice"][data-value="${id}"]`);
      if(!button)return;
      const active=speechSession?.id===id, label=active?'结束语音输入':'开始语音输入';
      button.setAttribute('aria-pressed',String(active));
      button.setAttribute('aria-label',label);
      button.title=label;
    }
    function cancelSpeech() {
      if(!speechSession)return;
      const {id,recognizer}=speechSession;
      speechSession=null;
      showSpeechPreview(id,'');
      updateSpeech(id,'已结束听写。');
      try { recognizer.abort(); } catch { /* Ignore an already-ended recognition session. */ }
    }
    function showSpeechPreview(id,text) {
      const preview=document.getElementById(id+'-voice-preview');
      if(preview)preview.textContent=text;
    }
    function recognize(id) {
      if (!voice || !document.getElementById(id)) return;
      if(speechSession) {
        if(speechSession.id===id && speechSession.listening && !speechSession.stopping) {
          speechSession.stopping=true;
          updateSpeech(id,'正在转写…');
          try { speechSession.recognizer.stop(); }
          catch {
            speechSession.stopping=false;
            updateSpeech(id,'还在听，可以稍后再点一次结束。');
          }
        } else if(speechSession.id!==id) {
          updateSpeech(id,'请先结束正在使用的麦克风。');
        }
        return;
      }
      if(micPermission?.state==='denied'){
        showKeyboardFallback(id);
        updateSpeech(id,micBlocked+' 也可以用设备键盘听写。');
        return;
      }
      let recognizer;
      try { recognizer=new voice(); }
      catch {
        showKeyboardFallback(id);
        updateSpeech(id,'网页麦克风无法启动，可以改用设备键盘听写。');
        return;
      }
      const session={id,recognizer,listening:false,stopping:false,received:false,preview:'',finalized:new Set()};
      speechSession=session;
      const finish=text=>{
        if(speechSession!==session)return;
        speechSession=null;
        showSpeechPreview(id,'');
        updateSpeech(id,text);
      };
      const appendTranscript=text=>{
        const field=document.getElementById(id);
        if(!text||!field)return;
        const combined=(field.value+' '+text).trim();
        field.value=field.maxLength>0?combined.slice(0,field.maxLength):combined;
        session.received=true;
      };
      recognizer.lang='zh-CN';
      recognizer.continuous=true;
      recognizer.interimResults=true;
      recognizer.onstart=()=>{
        if(speechSession!==session)return;
        session.listening=true;
        updateSpeech(id,'正在听，再按一次麦克风停止听写。');
      };
      recognizer.onresult=event=>{
        if(speechSession!==session)return;
        const parts=[],pending=[];
        for(let i=0;i<event.results.length;i++){
          const result=event.results[i];
          if(session.finalized.has(i))continue;
          const text=result[0]?.transcript?.trim();
          if(!text)continue;
          if(result.isFinal===false){pending.push(text);continue;}
          session.finalized.add(i);
          parts.push(text);
        }
        appendTranscript(parts.join(' '));
        session.preview=pending.join(' ');
        showSpeechPreview(id,session.preview);
      };
      const offerKeyboard=message=>{
        if(speechSession!==session)return;
        showKeyboardFallback(id);
        finish(message+' 也可以用设备键盘听写。');
      };
      recognizer.onerror=event=>offerKeyboard({
        'not-allowed':micBlocked,
        'service-not-allowed':'当前浏览器无法使用语音识别服务。',
        'audio-capture':'没有检测到可用的麦克风。',
        'no-speech':'没有听清，请再点一次麦克风。',
        network:'语音识别服务暂时连不上。',
      }[event.error]??'语音识别未完成，可以再试一次。');
      recognizer.onend=()=>{
        if(speechSession!==session)return;
        appendTranscript(session.preview);
        if(!session.received)return offerKeyboard('没有收到语音，请再试一次。');
        document.getElementById(id)?.focus({preventScroll:true});
        finish('已填入输入框，可以检查后再保存或发送。');
      };
      updateSpeech(id,'正在启动麦克风…');
      try { recognizer.start(); }
      catch { offerKeyboard('无法启动麦克风，请检查浏览器权限。'); }
    }
    function usageLabel() {
      if (!modelEnabled) return '今日累计用量 · 未连接大模型';
      if (usingTrial()) return '今日试用用量 · '+trial.tokens+' Token';
      if (publicModel) todayTokens = publicModel.status().todayTokens;
      return '今日累计用量 · ' + (Number.isFinite(todayTokens) ? todayTokens.toLocaleString('zh-CN') + ' Token' : '用量暂不可用') + (publicModel ? ' · 当前页面' : '');
    }
    function updateUsage(status) {
      todayTokens = status.todayTokens;
      const label = document.getElementById('chat-usage');
      if (label) label.textContent = usageLabel();
    }
    async function refreshUsage() {
      if (!modelEnabled) return;
      if (usingTrial()) return window.PlanetTrial.refresh();
      if (publicModel) return updateUsage(publicModel.status());
      try {
        const response = await fetch('/api/v1/config',{signal:AbortSignal.timeout(5000)});
        if (response.ok) updateUsage(await response.json());
      } catch { /* Keep the last confirmed count. */ }
    }
    async function checkConnection(deep = false) {
      if (!api) return;
      try {
        const response = await fetch(deep ? '/api/v1/test' : '/api/v1/config', deep ? {
          method:'POST', headers:{'Content-Type':'application/json'}, body:'{}', signal:AbortSignal.timeout(22000),
        } : undefined);
        const result = await response.json();
        if (!response.ok) throw new Error();
        modelEnabled = result.enabled === true;
        updateUsage(result);
        modelStatus = modelEnabled ? (deep?'模型测试成功':'模型已配置，等待你选择调用') +
          (result.model ? ' · ' + result.model : '') + ' · 今日 ' + (result.calls ?? 0) + ' 次 · 本月 ' + (result.monthTokens ?? 0) + ' Token' :
          '基础教练模式 · 尚未配置模型';
      } catch {
        if (!deep) modelEnabled = false;
        modelStatus = '基础教练模式 · 模型连接不可用';
      }
      if (['v1','v1settings','v1review'].includes(page())) paint();
    }
    async function connectDeepSeek(form,key) {
      if (!api && !publicModel) return;
      const button = form.querySelector('button');
      button.disabled = true;
      button.textContent = '正在测试 DeepSeek…';
      form.reset();
      try {
        let result;
        if (publicModel) result = await publicModel.connect(key);
        else {
          const response = await fetch('/api/v1/deepseek/connect',{method:'POST',headers:{'Content-Type':'application/json'},
            signal:AbortSignal.timeout(24000),body:JSON.stringify({key})});
          result = await response.json();
          if (!response.ok || !result.enabled) {
            toast(result.error || '未能连接 DeepSeek');
            return;
          }
        }
        modelEnabled = true;
        updateUsage(result);
        modelStatus = 'DeepSeek 已连接并测试成功 · ' + result.model;
        if (['v1','v1settings','v1review'].includes(page())) paint();
        toast('DeepSeek 连接成功');
      } catch (error) {
        toast(publicModel ? (error.message === 'Failed to fetch' ? '无法连接 DeepSeek，请检查网络' : error.message) : '未能完成连接，请检查本机服务和网络后重试');
      } finally {
        button.disabled = false;
        button.textContent = '连接并测试 DeepSeek';
      }
    }
    async function reply(text,writingReview) {
      const state=getState(),v=vNow();
      if(writingReview){
        V.free(state,text);
        paint();
        return;
      }
      if(V.safetyReply(state,text))return paint();
      const input=V.modelContext(state,text);
      const thread=v.active?.thread, detail={thread,reminderId:input.reminderId};
      V.message(v,text.trim(),'you',detail);
      modelSending=true;
      paint();
      try {
        const value=await callModel('coach',input);
        if(typeof value.reply!=='string' || !value.reply.trim())throw Error('无可用回复');
        const startup=/(?:帮(?:助)?我[^。！？!?\n]{0,14}(?:启动|开始|起步)|(?:要|怎么|如何)开始|下一步[^。！？!?\n]{0,6}(?:做|干)什么|最小(?:启动)?(?:动作|步骤))/.test(text);
        const action=typeof value.nextAction==='string'?value.nextAction.trim():'';
        const singleAction=action.length<=45 && !/[。！？.!?；;\n]/.test(action.replace(/[。！？.!?]$/,''));
        const urgent=/急救|急诊|紧急服务|立即就医/.test(value.reply);
        const response=startup && action && singleAction && !urgent ? action : value.reply;
        if(getState()===state && v.active?.thread===thread)V.message(v,response,'coach',detail);
      } catch {
        if(getState()===state)toast('AI 暂未回复，可以继续使用下方的基础状态选项。');
      } finally {
        modelSending=false;
        if(getState()===state){if(page()==='v1')paint();else save();}
        void refreshUsage();
      }
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-v1]');
      if (audio?.state !== 'running' && b?.dataset.v1 !== 'soundDemo') void armAudio().catch(()=>{});
      if (!b) return;
      const {v1: name,value} = b.dataset, v = vNow(), state = getState();
      try {
        if (name === 'tab') return selectTab(value);
        if (name === 'removeReminder') return removeReminderRow(b);
        if (name === 'reminderTimeSort') {
          delete v.settings.reminderOrder;
          sortReminderRows();
          const status=document.getElementById('reminder-order-status');
          if(status)status.textContent='当前按时间排序，从早上 06:00 开始。';
          save();
          return;
        }
        if (name === 'disconnectModel' && publicModel) {
          publicModel.disconnect();
          modelEnabled=Boolean(trial);
          modelStatus=trial ? '内测 DeepSeek · 研究方付费' : '基础教练模式';
          paint();
          return;
        }
        if (name === 'generateReview') return void generateReview(value);
        if (name === 'openReview') {
          const prompt = v.reviewPrompts?.[value];
          if (!prompt) return;
          day = prompt.day;
          selectTab('review');
          const section = document.getElementById(prompt.kind === 'daily' ? 'daily-review' : 'weekly-review');
          section?.scrollIntoView({block:'start'});
          return;
        }
        if (name === 'startReview') {
          if (V.startReview(v,value)) {
            paint();
            document.getElementById('v1-input')?.focus();
          }
          return;
        }
        if (name === 'dismissReview') {
          const prompt=v.reviewPrompts?.[value];
          if(prompt?.kind==='daily')v.reviews[prompt.day] ??= {skipped:true};
          V.finishReview(v,value);
        }
        if (name === 'emotion') {
          const field = document.getElementById('v1-input');
          field.placeholder = '比如：我现在觉得很烦，脑子里总在想……';
          field.focus();
          return;
        }
        if (name === 'voice') return recognize(value);
        if (name === 'keyboardDictation') return keyboardDictation(value);
        if (name === 'connection') return void checkConnection(true);
        if (name === 'soundDemo') {
          const reminder = value === 'reminder';
          if (reminder ? !remindersAudible() : !v.settings.sound) return toast('请先启用并保存对应的音效设置');
          return void armAudio().then(ready => {
            if (ready) {
              const scale = volumeScale(b.form?.elements.volume?.value ?? v.settings.volume);
              if (reminder) playReminderSound(0,scale);
              else playSound(scale);
            }
            else toast('浏览器未能播放音效');
          }).catch(() => toast('浏览器未能播放音效'));
        }
        if (name === 'notify') {
          if (!window.Notification || !isSecureContext) return toast('浏览器未提供通知权限');
          return void Notification.requestPermission().then(r=>toast(r==='granted'?'浏览器通知已授权':'当前未授权浏览器通知'));
        }
        if (name === 'open') {
          const opened = V.open(state,value);
          if (!opened && v.active?.id !== value) toast('这个环节今天已经记录了');
          if (page() !== 'v1') selectTab('chat');
          if(value==='return'){
            paint();
            const chat=document.getElementById('v1-chat');
            if(chat){chat.scrollTop=chat.scrollHeight;chat.scrollIntoView({block:'end'});}
            return;
          }
        }
        if (name === 'choice') {
          const [revision,optionId]=value.split('/');
          const record = v.records[v.active?.key];
          const wasComplete = record?.completedAt != null;
          const r=V.choose(state,revision,optionId);
          if (!r) return;
          if (r?.award) reward(r.award);
          else if (r && !wasComplete && record?.completedAt != null) playCompletionSound();
        }
        if (name === 'outcome') {
          const active=v.active, task=V.linkedTask(state,active?.id);
          if(!active)return;
          if(task)V.checkTask(state,task,active.day,value==='主动跳过'?'skipped':'incomplete');
          else V.park(v,value);
          V.message(v,'已记录「'+value+'」。');
        }
        if (name === 'remindOff' && v.settings.times[v.active?.id]) {
          if (!window.confirm('关闭「'+V.title(v,v.active.id)+'」的后续提醒？'))return;
          const task=V.linkedTask(state,v.active.id);
          if(task){P.preserveSchedule(task,new Date());task.reminderEnabled=false;V.init(state);}
          else V.setFixedReminder(v,v.active.id,{enabled:false});
          V.park(v,'未记录');
        }
        if (name === 'pause') { state.settings.pausedUntil=Date.now()+3600000; V.park(v,'暂时延迟'); toast('已暂停监督一小时'); }
        if (name === 'resume') { state.settings.pausedUntil = 0; toast('已恢复监督'); }
        if (name === 'agreeTime') V.agreeTime(v);
        if (name === 'timer') V.timerAction(v,value);
        if (name === 'skipReview') {
          v.reviews[day] ??= {skipped:true};
          V.finishReview(v,'daily/'+day);
        }
        if (name === 'deleteMemory') v.memory=v.memory.filter(row=>row.id!==value);
        if (name === 'rememberCase') {
          const rec = v.events.find(row=>row.type==='detour' && row.at === Number(value));
          if (rec && v.settings.memory && !v.memory.some(row=>row.id==='case-'+value)) {
            v.memory.push({id:'case-'+value,scene:v.records[rec.key]?.id ?? 'all',
              text:P.clean('当「'+rec.obstacle+'」发生时，使用「'+rec.strategy+'」后确认回归。',320)});
            toast('回归案例已存入记忆');
          }
        }
        if (name === 'removeIdea') v.ideas=v.ideas.filter(row=>row.id!==value);
        if (name === 'addTomorrow') {
          if(addTomorrow(b.form))b.form.querySelector('#tomorrow-items').lastElementChild.querySelector('input').focus();
          return;
        }
        if (name === 'clearTomorrow') {
          const form=b.form;
          b.closest('fieldset').remove();
          reindexTomorrow(form);
          return;
        }
        if (name === 'extract') {
          const form=document.querySelector('[data-v1-form="tomorrow"]');
          const draft=C.draft(document.getElementById('v1-reflection')?.value || lastReview);
          if(!draft.items.length)return toast('可以分行写「明天：任务」');
          let added=0;
          for(const row of draft.items){
            const inputs=[...form.querySelectorAll('[data-plan-field="title"]')];
            if(inputs.some(field=>field.value.trim()===row.title))continue;
            const empty=inputs.find(field=>!field.value.trim()&&!field.closest('fieldset').querySelector('[data-plan-field="step"]').value.trim());
            if(empty){
              const group=empty.closest('fieldset');
              empty.value=row.title;
              group.querySelector('[data-plan-field="step"]').value=row.firstStep;
              if(P.timeOk(row.when))group.querySelector('[data-plan-field="when"]').value=row.when;
            } else if(!addTomorrow(form,row))break;
            added++;
          }
          return toast(added?'已提取，可以继续修改':'没有新增重点，可检查现有项或移除后再提取');
        }
        const inChat = b.closest?.('#v1-chat, .chat-choices');
        paint();
        if(inChat){
          const chat=document.getElementById('v1-chat');
          if(chat)chat.scrollTop=chat.scrollHeight;
        }
      } catch (error) { toast(error.message); }
    });
    document.addEventListener('change', e => {
      const el=e.target,v=vNow();
      if(el.matches('[data-tomorrow-remind]')){
        el.form.elements.nextDayTime.disabled=!el.checked;
        return;
      }
      if(el.matches('[data-coach-style]') && el.checked && coachStyles.some(([value])=>value===el.value)){
        getState().settings.style=el.value;
        save();
        return;
      }
      if (el.matches('[data-reminder-time]')) sortReminderRows(el);
      if (el.id==='v1-review-date' && el.value) {if(day!==el.value)cancelSpeech();day=el.value;paint();}
      if (el.id==='v1-memory-on') {v.settings.memory=el.checked;save();}
      if (el.matches('[data-v1-quote]')) {v.preferences[el.dataset.v1Quote]=el.value;paint();}
    });
    document.addEventListener('input',e=>{
      if (e.target.name !== 'volume' || e.target.form?.dataset.v1Form !== 'settings') return;
      document.getElementById('v1-volume-value').textContent = e.target.value + '%';
    });
    document.addEventListener('submit',e=>{
      const form=e.target;
      if (!form.dataset.v1Form) return;
      e.preventDefault();
      const v=vNow(),state=getState(),data=Object.fromEntries(new FormData(form));
      try {
        switch(form.dataset.v1Form) {
          case 'deepseek': return void connectDeepSeek(form,data.key);
          case 'coach-guide': {
            const key = coachGuideKey();
            if (!key || key !== form.dataset.guideOwner) throw Error('账号已切换，请重新打开设置');
            const guide = P.clean(data.guide,8000);
            if (guide) localStorage.setItem(key,guide);
            else localStorage.removeItem(key);
            toast(guide?'个人教练指导已保存':'个人教练指导已清除');
            break;
          }
          case 'schedule':
            if (configureSchedule(data) === false) return;
            break;
          case 'settings': configureRewards(data); break;
          case 'chat': {
            const writingReview=Boolean(V.activeReview(v));
            const text=P.clean(data.message,500);
            if(!text || (!writingReview && (!modelEnabled || modelSending)))return;
            form.reset();
            void reply(text,writingReview);
            return;
          }
          case 'follow': if(!V.setFollow(v,data.minutes)) toast('当前无法约定时间'); break;
          case 'timer': V.timerAction(v,'start',data.mode,data.custom); break;
          case 'daily':
            lastReview=P.clean(data.note,1500);
            v.reviews[day]={note:lastReview,summary:V.dailyText(v,day)};
            V.finishReview(v,'daily/'+day);
            V.achievements(state,new Date());toast('复盘已保存');break;
          case 'tomorrow': {
            const now=new Date(),planDay=data.planDay;
            if(planDay!==P.shiftDate(P.dateKey(now),1))return toast('日期已变化，请刷新后再保存。');
            const remind=Boolean(data.nextDayRemind);
            if(remind && !P.timeOk(data.nextDayTime))return toast('请填写有效的提示时间');
            const rows=[0,1,2].map(i=>({title:P.clean(data['title'+i],80),when:data['when'+i],firstStep:P.clean(data['step'+i],150)}))
              .filter(row=>row.title||row.firstStep);
            const old=state.plans[planDay], previous=old?.items??[];
            if(!rows.length)P.clearPlan(state,planDay,now);
            else if(rows.length!==previous.length || rows.some((row,i)=>['title','firstStep','when'].some(key=>row[key]!==previous[i][key]))) {
              P.savePlan(state,planDay,rows,lastReview||old?.reflection||'',now,old?.progress??[]);
            }
            state.settings.nextDayRemind=remind;
            if(P.timeOk(data.nextDayTime))state.settings.nextDayTime=data.nextDayTime;
            toast('明日重点已保存'); break;
          }
          case 'quote': if(data.theme.trim()&&data.a.trim()&&data.b.trim()) v.customQuotes.push({id:P.uid(),theme:data.theme.trim(),lines:[data.a.trim(),data.b.trim()]});break;
          case 'quoteSchedule': {
            const available = [...V.catalog.quotes,...v.customQuotes].filter(row=>!['hidden','dislike'].includes(v.preferences[row.id]));
            const thisWeek = V.monday(date());
            const weeks = v.scheduledQuotes ??= {};
            for (const [target, selection] of [[thisWeek,data.thisWeek],[P.shiftDate(thisWeek,7),data.nextWeek]]) {
              if (available.some(row=>row.id===selection)) weeks[target] = selection;
              else if (Object.hasOwn(weeks,target)) {
                delete weeks[target];
                if (target === thisWeek) delete v.quoteByWeek[thisWeek];
              }
            }
            V.chooseQuote(v,date());
            toast('晨间语录安排已保存');
            break;
          }
          case 'idea': if(data.text.trim()){v.ideas.push({id:P.uid(),text:P.clean(data.text,500),at:Date.now()});V.message(v,'灵感已保存。我们可以回到原来那件事，先打开需要用的材料。');selectTab('chat');}break;
          case 'memory': {
            if (!data.text.trim()) break;
            const index=v.memory.findIndex(r=>r.id===data.id);
            const item={id:v.memory[index]?.id??P.uid(),text:P.clean(data.text,320),scene:data.scene};
            if(index<0)v.memory.push(item);else v.memory[index]=item;
            break;
          }
        }
        paint();
      } catch(error){toast(error.message);}
    });
    window.addEventListener('pagehide',cancelSpeech);
    if (api) void checkConnection();
    return {
      screen, selectTab, clock, cancelSpeech, playReminderSound, playCompletionSound, remindersAudible, refreshUsage,
      reconcileTasks:()=>V.reconcileTasks(getState()),refreshChat:paint,
      tick: now => {
        const v = vNow();
        const count = v.messages.length;
        if (!V.tick(getState(), now)) return;
        const fresh = v.messages.slice(count);
        const sleepSent = fresh.some(row=>row.source==='schedule' && row.reminderId==='sleep');
        const alerts = fresh.filter(row=>row.source==='schedule' ||
          (row.source==='review' && (row.reviewKind==='weekly' || !sleepSent)));
        const played = alerts.map((_,index)=>playReminderSound(index*.32)).some(Boolean);
        save();
        if (page() === 'v1') paint();
        if (page() === 'v1reminders') updateReminderStatuses(v);
        if (page() !== 'v1' && v.messages.length > count) toast('小星有一条新提醒，可到主动对话查看');
        if (fresh.length && window.Notification?.permission === 'granted') {
          try { new Notification('小步星球 · 小星', { body: '打开对话查看你的日程提醒。',
            silent:played || !alerts.length || !remindersAudible() }); } catch { /* In-page message persists. */ }
        }
      },
    };
  }
  window.PlanetV1View = { mount };
})();
