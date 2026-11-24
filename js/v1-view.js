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

  const routes = {chat:'v1', schedule:'v1reminders', review:'v1review', library:'v1library', memory:'v1memory', ideas:'v1ideas'};
  function mount({ state: getState, page, save, render, go, toast }) {
    const vNow = () => V.init(getState());
    const date = () => P.dateKey();
    const api = location.protocol !== 'file:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
    let day = date();
    let lastReview = '';
    let modelOptions = [];
    let modelStatus = api ? '检测本机模型连接中' : '基础教练模式 · 当前站点使用预设分支';
    let modelEnabled = false;
    let reviewPending = '';
    let draftSequence = 0;
    let dragSort;
    let audio;
    async function armAudio() {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!vNow().settings.sound || !Context) return false;
      audio ??= new Context();
      if (audio.state === 'suspended') await audio.resume().catch(() => {});
      return audio.state === 'running';
    }
    function playSound(level = 1) {
      if (!vNow().settings.sound || audio?.state !== 'running') return;
      const notes = [
        [659, 0, .044, .18], [784, .045, .035, .22], [1047, .095, .038, .26],
        [1319, .13, .020, .21], [1568, .155, .015, .19], [2093, .24, .010, .17],
        [1760, .303, .009, .23], [2637, .37, .006, .19],
      ];
      if (level === 2) notes.push([1047, .24, .022, .40], [3136, .41, .006, .24]);
      for (const [frequency, offset, volume, duration] of notes) {
        const start = audio.currentTime + offset;
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + .008);
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
        void armAudio().then(ready => { if (ready) playSound(award.level); }).catch(() => {});
      }
      document.body.append(el);
      setTimeout(() => el.remove(), 3700);
    }
    function chatPage(v) {
      const a = v.active;
      const controls = a ? V.options(v).map(([label], i) => btn('choice', label, a.revision + '/' + i)).join('') : '';
      const due = a?.due ? '下次跟进约 ' + new Date(a.due).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) : '';
      const custom = a?.stage === 'wait' ? `<form data-v1-form="follow">${number('minutes','多少分钟后确认',10,1,1440)}<button class="secondary">确认时间</button></form>` : '';
      const timer = a?.id === 'bath' || v.timer ? timerView(v) : '';
      const paused = getState().settings.pausedUntil > Date.now();
      const reviewPrompts = Object.entries(v.reviewPrompts ?? {})
        .filter(([,row]) => row.kind === 'daily' ? row.day === date() : V.monday(row.day) === V.monday(date()));
      return `<div class="coach-layout"><div>` + card('消息', `<p class="subtle">${esc(modelStatus)}${paused ? ' · 监督已暂停' : ''}</p>
        <div id="v1-chat" class="chatbox" aria-live="polite">${v.messages.slice(-35).map(row =>
          `<div class="bubble ${row.role === 'you' ? 'you' : 'ai'}"><span class="bubble-speaker">${row.role === 'you' ? '我' : '小星'}${Object.hasOwn(messageSources, row.source) ? ' · ' + messageSources[row.source] + ' · ' + new Date(row.at).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'}) : ''}</span>${esc(row.text)}</div>`).join('') || '<p class="subtle">小星会在设定时间主动发消息。你也可以随时主动发消息或求助。</p>'}</div>
        ${v.queue.filter(row=>row.day===date() && v.records[row.day+'/'+row.id]?.notifiedAt != null).map(row=>
          `<div class="review-prompt"><strong>${esc(V.title(v,row.id))} · 待处理</strong>
          ${btn('open','处理这条提醒',row.id)}</div>`).join('')}
        ${reviewPrompts.map(([key,row])=>`<div class="review-prompt"><strong>${row.kind==='daily'?'睡前复盘':'每周复盘'}</strong>
        <div class="controls">${row.pending && v.reviewSession!==key ? btn('startReview','开始复盘',key,true) : ''}
        ${row.pending ? btn('dismissReview','暂时跳过',key) : ''}${btn('openReview','查看复盘总结',key)}</div></div>`).join('')}
        ${a ? `<p><b>${esc(V.title(v, a.id))}</b> <span class="subtle">${esc(due)}</span></p>
        ${a.stage !== 'initial' ? `<p>${esc(V.phases[a.stage]?.[0] ?? '')}</p>` : ''}
        <div class="controls">${controls}${a.id==='wake'||a.stage==='wait'?'':btn('agreeTime','约定下次确认时间')}
        ${btn('outcome','跳过本次','主动跳过')}${btn('outcome','记为未完成','未完成')}${btn('remindOff','关闭该环节提醒')}</div>${custom}` : ''}
        ${modelOptions.length ? '<div class="controls">' + modelOptions.map(text => btn('modelOption', text, text)).join('') + '</div>' : ''}
        <form data-v1-form="chat"><label>告诉小星你现在的状态<textarea id="v1-input" class="field" name="message" rows="2" maxlength="500" required></textarea></label>
        <div class="controls"><button class="primary">发给小星</button>${voice ? btn('voice','语音输入','v1-input') : ''}
        ${api ? '<button name="mode" value="model" class="secondary">用已配置模型分析本条消息</button>' : ''}</div></form>
        ${api ? '<p class="subtle">使用模型按钮会发送本条消息、今日重点、近期对话和你允许检索的相关记忆。</p>' : ''}
        ${voice ? '<p class="subtle">语音转文字由浏览器提供，可能使用浏览器的在线服务。转写后可先检查再发送。</p>' : '<p class="subtle">当前浏览器未提供语音识别，可使用设备键盘听写。</p>'}
        ${a?.id === 'sleep' ? btn('tab','查看每日复盘','review') : ''}`) + timer +
        `</div><aside>` + card('对话工具', `<div class="section-links">${btn('open','回到正轨','return')}${btn('emotion','梳理此刻的情绪')}${btn('tab','记个灵感','ideas')}
          <button type="button" class="secondary small" data-act="page" data-target="focus">启动与专注计时</button>
          ${btn('tab','查看定时提醒','schedule')}
          ${paused ? btn('resume','恢复监督') : btn('pause','暂停监督一小时')}</div>`) +
        '</aside></div>';
    }
    function timerView(v) {
      return card('洗澡计时', v.timer ? `<p id="v1-timer" class="timer">00:00</p><p id="v1-timer-stage"></p>
      <div class="controls">${btn('timer',v.timer.runningSince == null ? '继续' : '暂停',v.timer.runningSince == null ? 'resume' : 'pause')}${btn('timer','结束并记录用时','end',true)}</div>` :
        `<form data-v1-form="timer"><label>计时模式<select class="field" name="mode"><option value="bath">仅洗澡 · 20 分钟</option><option value="combined">洗澡 30 分钟＋整理 10 分钟</option><option value="custom">自定义</option></select></label>
        ${number('custom','自定义分钟',20,1,180)}<button class="primary">开始计时</button></form>`);
    }
    function schedulePage(v) {
      const state = getState();
      const removed = V.allReminderIds(v).filter(id => v.settings.times[id].removed);
      return card('固定提醒和自定义任务', `<p class="notice">保持网页打开，小星会在设定时间主动发消息。你也可以点「现在聊聊」提前进入对应对话。后台标签页可能延迟，关闭网页后暂时无法推送。${state.settings.pausedUntil > Date.now() ? ' 监督目前已暂停。' : !state.settings.remind ? ' 自动提醒目前已关闭。' : ''}</p>
        ${state.settings.quiet ? `<p class="subtle">免打扰时段 ${esc(state.settings.quietStart)}–${esc(state.settings.quietEnd)}。需要在这段时间提醒，可单独勾选对应任务。</p>` : ''}
        <form data-v1-form="schedule">${window.PlanetDashboard.reminders(state)}
        <fieldset class="reminder-group reminder-add"><legend>新增每天提醒的任务</legend>
        <div id="reminder-drafts"></div>${btn('addReminder','＋ 添加一项')}<p class="subtle">可连续添加多项。最后点「保存提醒」统一生效。</p></fieldset>
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
      return card('奖励与音效', `<form data-v1-form="settings">
        <label><input type="checkbox" name="sound" ${v.settings.sound ? 'checked' : ''}> 播放奖励音效</label>
        <div class="controls">${btn('soundDemo','试听撒星星音效','normal')}</div><p class="subtle">睡前奖励为静音。</p>
        <details class="reminder-details"><summary>积分和进阶条件</summary><div class="cols">${Object.entries(levelName).map(([key,label]) => number(key,label,v.settings[key],1,1000)).join('')}</div></details>
        <button class="primary">保存奖励设置</button></form>`) +
        card('教练偏好与数据', `<div class="controls">
          <button type="button" class="secondary small" data-act="page" data-target="settings">教练风格、免打扰与数据导出</button>
          ${getState().tasks.some(task => !task.archived) ? '<button type="button" class="secondary small" data-act="page" data-target="plan">管理已有的自定义任务</button>' : ''}</div>`) +
        card('模型连接', `<p>${esc(modelStatus)}</p>${api ? (modelEnabled ? btn('connection','测试已配置模型') : '') +
          `<form method="post" data-v1-form="deepseek" autocomplete="off"><label>DeepSeek API Key
          <input class="field" type="password" name="key" placeholder="sk-…" required maxlength="223" autocomplete="off" spellcheck="false"></label>
          <p class="subtle">测试只发送一条示例问题。密钥保存在本机服务的内存中，关闭服务后需要重新填写。</p>
          <button class="primary">连接并测试 DeepSeek</button></form>` : '<p>公开静态站使用基础教练。本机版可连接 DeepSeek。</p>'}`);
    }
    function reviewInput(v,kind,reviewDay,note) {
      const stats = kind === 'weekly' ? V.weekly(v,reviewDay) : null;
      const cases = stats?.cases ?? v.events.filter(row=>row.type==='detour' && row.day===reviewDay);
      return {kind,day:reviewDay,note:note ?? (kind === 'daily' ? v.reviews[reviewDay]?.note : v.weekNotes?.[reviewDay]) ?? '',
        records:stats ? stats.stats.map(row=>V.title(v,row.id) + '：完成 ' + row.completed + '，未完成 ' + row.incomplete +
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
        ${modelEnabled ? `<p class="subtle">生成会把相关任务记录、偏航案例和复盘补充发送给已配置的模型。</p>
        ${reviewPending === key ? '<p class="subtle" role="status">小星正在整理……</p>' : btn('generateReview',stored?'重新生成大模型总结':'用大模型生成总结',kind)}`
          : '<p class="subtle">当前未连接大模型服务。</p>'}</section>`;
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
        const response = await fetch('/api/v1/review',{method:'POST',headers:{'Content-Type':'application/json'},
          signal:AbortSignal.timeout(25000),body:JSON.stringify({...content,consent:true})});
        const result = await response.json();
        if (!response.ok || typeof result.summary !== 'string') throw new Error();
        if (state !== getState()) return;
        (v.reviewSummaries ??= {})[key] = {text:result.summary,at:Date.now()};
        save();
      } catch {
        toast('大模型总结暂时不可用，可以稍后重试');
      } finally {
        reviewPending = '';
        refresh();
      }
    }
    function reviewPage(v) {
      const row = v.reviews[day];
      const report = V.weekly(v, day);
      const dayRows = V.dailyRows(v, day);
      const todayCases = v.events.filter(event => event.day === day && event.type === 'detour');
      const tomorrow = P.shiftDate(date(), 1);
      const plan = getState().plans[tomorrow]?.items ?? [];
      const stamp = xs => xs.map(n => String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0')).join('、') || '暂无记录';
      return `<nav class="review-navigation" aria-label="复盘入口"><a class="secondary small" href="#daily-review">每日复盘</a>
        <a class="secondary small" href="#tomorrow-plan">明日重点</a><a class="secondary small" href="#weekly-review">每周复盘</a>
        ${btn('tab','查看长期记忆','memory')}</nav>` +
        '<div id="daily-review">' +
        card('每日复盘', `<label class="review-date">查看日期<input class="field" type="date" id="v1-review-date" value="${esc(day)}"></label>
        ${reviewSummary(v,'daily',day)}
        <h3>任务记录</h3><ul class="daily-records">${dayRows.map(task => `<li><strong>${esc(task.title)}</strong><span>${task.completedAt ? new Date(task.completedAt).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'}) + ' · ' : ''}${esc(task.status)}</span></li>`).join('')}</ul>
        <div class="review-note"><h3>偏航与恢复 · ${todayCases.length} 次</h3>
        ${todayCases.length ? '<ul>' + todayCases.map(c=>'<li>' + esc(c.obstacle + ' · 尝试 ' + c.strategy) + '</li>').join('') + '</ul>' : '<p>暂无偏航记录</p>'}
        <p>${esc(todayCases[0] ? '明天可以先试：' + todayCases[0].strategy : '明天可以先选一件重要的小事。')}</p></div>
        <form data-v1-form="daily"><label>补充复盘或口述草稿<textarea id="v1-reflection" class="field" maxlength="1500" rows="3" name="note">${esc(row?.note)}</textarea></label>
        <div class="controls"><button class="primary">保存复盘</button>${btn('skipReview','跳过详细复盘')}${voice ? btn('voice','语音输入','v1-reflection') : ''}</div></form>
        ${row ? '<p class="subtle">' + (row.skipped ? '已跳过详细复盘' : '复盘已保存') + '</p>' : ''}`) +
        '</div><div id="tomorrow-plan">' +
        card('明日重点 · ' + tomorrow, `<form data-v1-form="tomorrow"><p class="subtle">最多三项，次日起床或上午提醒会附上。也可以在复盘里分行写「明天：任务」，再提取。</p>
        ${btn('extract','从复盘提取明日重点')}${[0,1,2].map(i => `<fieldset><legend>重点 ${i+1}</legend>
          ${input('title'+i,'任务',plan[i]?.title,'maxlength="80"')}${when('when'+i,'时间',plan[i]?.when ?? '09:00')}
          ${input('step'+i,'第一步',plan[i]?.firstStep,'maxlength="150"')}</fieldset>`).join('')}<button class="primary">确认明日清单</button></form>`) +
        '</div><div id="weekly-review">' +
        card('每周复盘 · 最近七天', `${reviewSummary(v,'weekly',day)}${v.weekNotes?.[day] ? '<p><strong>你在对话中补充</strong> · '+esc(v.weekNotes[day])+'</p>' : ''}
        <p>平均启动延迟 ${readDuration(report.delays)} · 上一周 ${readDuration(report.previousDelays)} · 平均洗澡用时 ${readDuration(report.durations)}</p>
        <p>起床时间 ${esc(stamp(report.wakeTimes))}</p><p>上床时间 ${esc(stamp(report.bedTimes))}</p>
        <p>偏航记录 ${report.cases.length} · 确认回归 ${report.returns}</p>
        <h3>任务完成情况</h3><ul class="weekly-records">${report.stats.map(s => `<li><strong>${esc(V.title(v,s.id))}</strong><span>普通 ${s.completed - s.advanced} · 进阶 ${s.advanced} · 未完成 ${s.incomplete} · 跳过 ${s.skipped} · 未记录 ${s.missing} · 完成率 ${s.rate == null ? '暂无' : Math.round(s.rate*100)+'%'}</span></li>`).join('')}</ul>
        <h3>代表性案例</h3>${report.cases.slice(-4).map(e => `<p>${esc(e.day+' · '+e.obstacle+'（'+e.source+'） · '+e.strategy+' · '+e.outcome)}
        ${v.settings.memory && e.outcome==='已确认回归' ? btn('rememberCase','存入长期记忆',e.at) : ''}</p>`).join('') || '<p>暂无案例</p>'}
        <h3>已确认回归时尝试的策略</h3><p>${esc(report.strategies.join('；') || '暂无记录')}</p>
        <h3>下一周可试</h3><p>${esc(report.suggested.join('；') || '先记录一次真实的中断和恢复过程。')}</p>`) + '</div>';
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
        <div class="controls"><button class="primary">保存并回到原任务</button>${voice ? btn('voice','语音记录','v1-idea') : ''}</div></form>
        ${v.ideas.slice().reverse().map(row => `<div class="v1-line"><span>${esc(row.text)}</span>${btn('removeIdea','删除',row.id)}</div>`).join('')}`);
    }
    function memoryPage(v) {
      return card('小星记住的内容', `<label><input type="checkbox" id="v1-memory-on" ${v.settings.memory ? 'checked' : ''}> 启用长期记忆检索</label>
        <p class="subtle">确认后才保存。你可以修改类别、文字或删除。仅在明确调用模型时提供相关条目。</p>
        ${[...v.memory,{id:'',text:'',source:'用户自述',scene:'all'}].map(row=>`<form data-v1-form="memory" class="v1-memory-row">
          <input type="hidden" name="id" value="${esc(row.id)}">${input('text',row.id?'编辑记忆':'添加记忆',row.text,'required maxlength="320"')}
          <div class="cols"><label>来源<select class="field" name="source">${['已确认事实','用户自述','待验证假设'].map(x=>`<option ${row.source===x?'selected':''}>${x}</option>`).join('')}</select></label>
          <label>相关环节<select class="field" name="scene"><option value="all">通用</option>${V.ids.map(id=>`<option value="${id}" ${row.scene===id?'selected':''}>${esc(V.data[id].title)}</option>`).join('')}</select></label></div>
          <div class="controls"><button class="secondary">${row.id?'保存修改':'确认添加'}</button>${row.id?btn('deleteMemory','删除',row.id):''}</div></form>`).join('')}`);
    }
    function screen(section) {
      const v = vNow();
      return ({chat:chatPage,schedule:schedulePage,settings:settingsPage,review:reviewPage,library:libraryPage,memory:memoryPage,ideas:ideasPage}[section])(v);
    }
    function paint() {
      const draft = document.getElementById('v1-input')?.value;
      render();
      const chat = document.getElementById('v1-chat');
      if (chat) chat.scrollTop = chat.scrollHeight;
      const field = document.getElementById('v1-input');
      if (field && draft) field.value = draft;
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
        const status = window.PlanetDashboard.reminderStatus(v, date(), id, getState().settings);
        node.textContent = status;
        const button = node.parentElement.querySelector('.reminder-open');
        const label = status === '对话中' ? '继续对话' : '现在聊聊';
        button.textContent = label;
        button.setAttribute('aria-label', V.title(v,id) + ' · ' + label);
      }
    }
    function selectTab(next) { go(routes[next]); }
    function configureSchedule(data, form) {
      const v = vNow(), s = v.settings;
      const ids = V.reminderIds(v).filter(id => !data['remove_'+id]);
      const rescheduled = new Set(ids.filter(id=>s.times[id].time!==data['time_'+id]));
      const drafts = Object.keys(data).filter(key=>/^new_title_\d+$/.test(key)).map(key=>({
        title:P.clean(data[key],60),time:data[key.replace('title','time')],
      }));
      const error = ids.some(id => !P.timeOk(data['time_'+id])) ? '请填写有效提醒时间'
        : ids.some(id => V.isCustom(v,id) && !P.clean(data['title_'+id],60)) ? '请填写自定义任务名称'
        : drafts.some(row=>!row.title || !P.timeOk(row.time)) ? '新增的每项任务都需要名称和提醒时间'
        : '';
      if (error) { toast(error); return false; }
      for (const id of ids) {
        const time = data['time_'+id];
        const enabled = Boolean(data['enabled_'+id]);
        const setting = s.times[id];
        if (setting.enabled && !enabled && v.active?.id === id) V.park(v,'主动跳过');
        Object.assign(setting,{time,enabled,allowQuiet:Boolean(data['quiet_'+id])});
        if (V.isCustom(v,id)) setting.title = P.clean(data['title_'+id],60);
      }
      for (const id of V.allReminderIds(v)) {
        if (data['remove_'+id]) {
          Object.assign(s.times[id],{removed:true,enabled:false});
          if (v.active?.id === id) V.park(v,'未记录');
        } else if (data['restore_'+id] && s.times[id].removed) {
          Object.assign(s.times[id],{removed:false,enabled:true});
        }
      }
      v.queue = v.queue.filter(row=>s.times[row.id]?.enabled && (row.source!=='schedule' || !rescheduled.has(row.id)));
      for (const id of rescheduled) {
        const record = v.records[date()+'/'+id];
        if (record?.status === '待执行') {
          delete record.notifiedAt;
          record.planned = P.dueAt(date(),s.times[id].time);
        }
      }
      for (const row of drafts) s.times['custom-'+P.uid()] = {...row,enabled:true,addedDay:date()};
      s.reminderOrder = Array.from(form.querySelectorAll('[data-saved-reminder]'),row=>row.dataset.savedReminder);
      for (const key of Object.keys(values)) s.intervals[key] = P.bounded(data['interval_'+key],1,120,s.intervals[key]);
      s.weekDay = P.bounded(data.weekDay,0,6,0);
      if (P.timeOk(data.weekTime)) s.weekTime = data.weekTime;
      if (P.timeOk(data.wrap_am) && P.timeOk(data.wrap_pm)) s.wrapTimes = {am:data.wrap_am,pm:data.wrap_pm};
      getState().settings.remind = Boolean(data.remind);
      toast(drafts.length ? '已新增 ' + drafts.length + ' 项提醒' : '提醒设置已保存');
    }
    function addReminderDraft() {
      const container = document.getElementById('reminder-drafts');
      const index = ++draftSequence;
      container.insertAdjacentHTML('beforeend', `<div class="reminder-add-fields" data-draft-reminder>
        ${input('new_title_'+index,'任务名称','','required maxlength="60" placeholder="例如：出门散步"')}
        ${input('new_time_'+index,'提醒时间','','type="time" required')}
        <button type="button" class="reminder-minus" data-v1="removeReminder" aria-label="移除此新增任务">−</button></div>`);
      container.lastElementChild.querySelector('input').focus();
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
    function moveReminderRow(button,direction) {
      const row = button.closest('[data-saved-reminder]');
      const neighbor = direction === 'up' ? row.previousElementSibling : row.nextElementSibling;
      if (!neighbor) return;
      if (direction === 'up') neighbor.before(row);
      else neighbor.after(row);
      button.focus({preventScroll:true});
      toast('顺序已调整，保存提醒后生效');
    }
    document.addEventListener('pointerdown',event=>{
      const grip = event.target.closest('.reminder-grip');
      if (!grip || !event.isPrimary || event.button !== 0) return;
      const row = grip.closest('[data-saved-reminder]');
      const list = row.parentElement;
      list.setPointerCapture(event.pointerId);
      dragSort = {row,list,pointerId:event.pointerId,startY:event.clientY,moved:false};
      row.classList.add('is-dragging');
      event.preventDefault();
    });
    document.addEventListener('pointermove',event=>{
      if (dragSort?.pointerId !== event.pointerId || Math.abs(event.clientY-dragSort.startY) < 5 && !dragSort.moved) return;
      const {row,list} = dragSort;
      const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-saved-reminder]');
      if (!target || target === row || target.parentElement !== list) return;
      const bounds = target.getBoundingClientRect();
      if (event.clientY < (bounds.top+bounds.bottom)/2) target.before(row);
      else target.after(row);
      dragSort.moved = true;
    });
    const finishDrag = event=>{
      if (dragSort?.pointerId !== event.pointerId) return;
      dragSort.row.classList.remove('is-dragging');
      if (dragSort.moved) toast('顺序已调整，保存提醒后生效');
      dragSort = undefined;
    };
    document.addEventListener('pointerup',finishDrag);
    document.addEventListener('pointercancel',finishDrag);
    document.addEventListener('lostpointercapture',finishDrag);
    function configureRewards(data) {
      const s = vNow().settings;
      if (Number(data.advanced) < Number(data.basic)) return toast('进阶总积分至少等于完成积分');
      for (const key of Object.keys(levelName)) s[key] = P.bounded(data[key],1,1000,s[key]);
      s.sound = Boolean(data.sound);
      toast('奖励设置已保存');
    }
    function recognize(id) {
      const el = document.getElementById(id);
      if (!voice || !el) return;
      const speech = new voice();
      speech.lang = 'zh-CN';
      speech.onresult = e => { el.value = (el.value + ' ' + e.results[0][0].transcript).trim(); };
      speech.onerror = () => toast('未收到语音，请检查麦克风权限或改用文字');
      speech.start();
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
      if (!api) return;
      const button = form.querySelector('button');
      button.disabled = true;
      button.textContent = '正在测试 DeepSeek…';
      form.reset();
      try {
        const response = await fetch('/api/v1/deepseek/connect',{method:'POST',headers:{'Content-Type':'application/json'},
          signal:AbortSignal.timeout(24000),body:JSON.stringify({key})});
        const result = await response.json();
        if (!response.ok || !result.enabled) {
          toast(result.error || '未能连接 DeepSeek');
          return;
        }
        modelEnabled = true;
        modelStatus = 'DeepSeek 已连接并测试成功 · ' + result.model;
        if (['v1','v1settings','v1review'].includes(page())) paint();
        toast('DeepSeek 连接成功');
      } catch {
        toast('未能完成连接，请检查本机服务和网络后重试');
      } finally {
        button.disabled = false;
        button.textContent = '连接并测试 DeepSeek';
      }
    }
    async function reply(text, useModel) {
      const v = vNow();
      const result = V.free(getState(), text);
      if (!result) return;
      modelOptions = [];
      const fallback = v.messages.at(-1);
      const current = v.active?.revision;
      if (!api || !useModel || result !== 'fallback') return;
      try {
        const scene = v.active?.id ?? 'all';
        const memories = v.settings.memory ? v.memory.filter(m=>m.scene===scene || m.scene==='all').slice(-4) : [];
        const response = await fetch('/api/v1/coach',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(25000),
          body:JSON.stringify({text, scene:V.isCustom(v,scene) ? 'all' : scene, status:v.active?.stage || '', style:getState().settings.style,
            schedule:v.settings.times, plan:V.planText(getState(),date()), recent:v.messages.slice(-5,-1), memories})});
        const value = await response.json();
        if (!response.ok || typeof value.reply !== 'string') throw new Error();
        if (vNow() !== v || v.active?.revision !== current) return;
        fallback.text = value.reply;
        modelOptions = Array.isArray(value.quickReplies) ? value.quickReplies : [];
      } catch { fallback.text = '模型暂不可用，已切回基础教练。\n' + fallback.text; }
      finally { if (page() === 'v1') paint(); else save(); }
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-v1]');
      if (!b) return;
      const {v1: name,value} = b.dataset, v = vNow(), state = getState();
      try {
        if (name === 'tab') return selectTab(value);
        if (name === 'addReminder') return addReminderDraft();
        if (name === 'removeReminder') return removeReminderRow(b);
        if (name === 'moveReminder') return moveReminderRow(b,value);
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
        if (name === 'dismissReview') V.finishReview(v,value);
        if (name === 'emotion') {
          const field = document.getElementById('v1-input');
          field.placeholder = '比如：我现在觉得很烦，脑子里总在想……';
          field.focus();
          return;
        }
        if (name === 'voice') return recognize(value);
        if (name === 'connection') return void checkConnection(true);
        if (name === 'soundDemo') {
          if (!v.settings.sound) return toast('请先启用并保存奖励音效设置');
          return void armAudio().then(ready => {
            if (ready) playSound();
            else toast('浏览器未能播放音效');
          }).catch(() => toast('浏览器未能播放音效'));
        }
        if (name === 'notify') {
          if (!window.Notification || !isSecureContext) return toast('浏览器未提供通知权限');
          return void Notification.requestPermission().then(r=>toast(r==='granted'?'浏览器通知已授权':'当前未授权浏览器通知'));
        }
        if (name === 'open') {
          const opened = V.open(state,value);
          modelOptions=[];
          if (!opened && v.active?.id !== value) toast('这个环节今天已经记录了');
          if (page() !== 'v1') selectTab('chat');
        }
        if (name === 'choice') {
          const [revision,index]=value.split('/');
          const r=V.choose(state,revision,Number(index));
          if (r?.award) reward(r.award);
          modelOptions=[];
        }
        if (name === 'outcome') { V.park(v,value); V.message(v,'已记录「'+value+'」。'); }
        if (name === 'remindOff' && v.settings.times[v.active?.id]) { v.settings.times[v.active.id].enabled=false; V.park(v,'主动跳过'); }
        if (name === 'pause') { state.settings.pausedUntil = Date.now()+3600000; toast('已暂停监督一小时'); }
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
            v.memory.push({id:'case-'+value,source:'已确认事实',scene:v.records[rec.key]?.id ?? 'all',
              text:P.clean('当「'+rec.obstacle+'」发生时，使用「'+rec.strategy+'」后确认回归。',320)});
            toast('回归案例已存入记忆');
          }
        }
        if (name === 'removeIdea') v.ideas=v.ideas.filter(row=>row.id!==value);
        if (name === 'modelOption') void reply(value,true);
        if (name === 'extract') {
          const form=document.querySelector('[data-v1-form="tomorrow"]');
          const draft=C.draft(document.getElementById('v1-reflection')?.value || lastReview);
          draft.items.forEach((row,i)=>{form.elements['title'+i].value ||= row.title; form.elements['step'+i].value ||= row.firstStep;});
          return toast(draft.items.length?'已提取，可以继续修改':'可以分行写「明天：任务」');
        }
        paint();
      } catch (error) { toast(error.message); }
    });
    document.addEventListener('change', e => {
      const el=e.target,v=vNow();
      if (el.id==='v1-review-date' && el.value) {day=el.value; paint();}
      if (el.id==='v1-memory-on') {v.settings.memory=el.checked;save();}
      if (el.matches('[data-v1-quote]')) {v.preferences[el.dataset.v1Quote]=el.value;paint();}
    });
    document.addEventListener('submit',e=>{
      const form=e.target;
      if (!form.dataset.v1Form) return;
      e.preventDefault();
      const v=vNow(),state=getState(),data=Object.fromEntries(new FormData(form));
      try {
        switch(form.dataset.v1Form) {
          case 'deepseek': return void connectDeepSeek(form,data.key);
          case 'schedule':
            if (configureSchedule(data,form) === false) return;
            break;
          case 'settings': configureRewards(data); break;
          case 'chat': void reply(data.message,e.submitter?.value==='model'); form.reset(); break;
          case 'follow': if(!V.setFollow(v,data.minutes)) toast('当前无法约定时间'); break;
          case 'timer': V.timerAction(v,'start',data.mode,data.custom); break;
          case 'daily':
            lastReview=P.clean(data.note,1500);
            v.reviews[day]={note:lastReview,summary:V.dailyText(v,day)};
            V.finishReview(v,'daily/'+day);
            V.achievements(state,new Date());toast('复盘已保存');break;
          case 'tomorrow': {
            const rows=[0,1,2].map(i=>({title:data['title'+i],when:data['when'+i],firstStep:data['step'+i]})).filter(row=>row.title.trim());
            P.savePlan(state,P.shiftDate(date(),1),rows,lastReview);
            toast('明日任务清单已确认'); break;
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
            const previous=v.memory.find(r=>r.id===data.id);
            const item={id:previous?.id??P.uid(),text:P.clean(data.text,320),source:data.source,scene:data.scene};
            if(previous)Object.assign(previous,item);else v.memory.push(item);
            break;
          }
        }
        paint();
      } catch(error){toast(error.message);}
    });
    if (api) void checkConnection();
    return {
      screen, selectTab, clock,
      tick: now => {
        const v = vNow();
        const count = v.messages.length;
        if (!V.tick(getState(), now)) return;
        save();
        if (page() === 'v1') paint();
        if (page() === 'v1reminders') updateReminderStatuses(v);
        if (page() !== 'v1' && v.messages.length > count) toast('小星有一条新提醒，可到主动对话查看');
        if (v.messages.length > count && window.Notification?.permission === 'granted') {
          try { new Notification('小步星球 · 小星', { body: '打开对话查看你的日程提醒。' }); } catch { /* In-page message persists. */ }
        }
      },
    };
  }
  window.PlanetV1View = { mount };
})();
