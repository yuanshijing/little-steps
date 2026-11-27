(() => {
  'use strict';
  const P = window.Planet;
  const C = window.PlanetCoach;
  const S = window.PlanetScheduler;
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const option = (value, text, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(text)}</option>`;
  const action = (act, label, extra = '', style = 'secondary small') => `<button type="button" class="${style}" data-act="${act}" ${extra}>${esc(label)}</button>`;
  const taskData = (task, item) => `data-id="${esc(task.id)}" data-day="${esc(item.day)}"`;
  const card = (title, body) => `<section class="surface"><h2 class="section-title">${esc(title)}</h2>${body}</section>`;
  const notice = text => `<p class="notice">${esc(text)}</p>`;
  const headings = {
    plan: '我的计划',
    growth: '看看行动留下的线索', settings: '你的节奏，你决定',
    recover: '回到正轨', focus: '专注', review: '睡前外化与次日计划', v1: '小星对话',
    v1review: '日周复盘', v1stars: '星空收藏', v1settings: '设置', v1library: '晨间语录', v1reminders: '主动提醒',
    v1ideas: '灵感暂存',
  };
  const home = byId('view');
  let state = P.read(localStorage);
  let page = 'v1';
  let starPeriod='day', starAnchor='';
  let editId = '';
  let selectedDay = P.dateKey();
  let context = null;
  let lastObservedDay = P.dateKey();
  let lastQuoteWeek;
  let toastTimer;
  let settingsSync;

  function toast(message) {
    const node = byId('toast');
    node.textContent = message;
    node.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.style.display = 'none'; }, 4100);
  }
  function save() {
    try { P.write(localStorage, state); }
    catch { toast('浏览器保存失败，请到设置导出当前记录'); }
    settingsSync?.onSave();
  }
  function go(next) {
    if(page!==next)v1View.cancelSpeech();
    page = next;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function render() {
    const previousChat = byId('v1-chat');
    const previousOffset = previousChat?.scrollTop ?? 0;
    const readingHistory = previousChat && previousChat.scrollHeight - previousChat.clientHeight - previousOffset > 32;
    byId('starcount').textContent = state.stars;
    byId('todaylabel').textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
    byId('pagetitle').textContent = headings[page];
    byId('plan-heading-note').hidden = page !== 'plan';
    const navPage = ({focus:'v1', recover:'v1', growth:'v1review', review:'v1review',
      v1ideas:'v1', settings:'v1settings'})[page] ?? page;
    document.querySelectorAll('#nav button').forEach(button => {
      const current = button.dataset.page === navPage;
      button.classList.toggle('active', current);
      if (current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    home.dataset.screen = page;
    home.innerHTML = views[page]();
    updateTimer();
    v1View.clock();
    const box = byId('v1-chat') ?? byId('chatbox');
    if (box) box.scrollTop = box.id === 'v1-chat' && readingHistory ? previousOffset : box.scrollHeight;
  }
  function planView() {
    const V=window.PlanetV1, v=V.init(state);
    const editing=state.tasks.find(task=>task.id===editId && !task.archived);
    const t=editing ?? {title:'',day:P.dateKey(),when:'09:00',repeat:'once',priority:2,steps:[],reminderEnabled:true};
    const tasks=state.tasks.filter(task=>!task.retiredExample &&
      !(task.title==='离开床铺并洗漱' && task.category==='routine'));
    const candidates=[...V.ids.map(id=>({id,title:V.title(v,id)})),
      ...tasks.filter(task=>!task.archived && task.id!==editing?.id)];
    const selectTask=(name,label,value)=>'<label>'+label+' <select name="'+name+'" class="field">'+option('', '无', value)+
      candidates.map(task=>option(task.id,task.title,value)).join('')+'</select></label>';
    const rows=tasks.map(task=>({task,config:P.scheduleAt(task,selectedDay),scheduled:P.occurs(task,selectedDay),
      item:state.instances[selectedDay+'/'+task.id]})).sort((a,b)=>a.config.when.localeCompare(b.config.when));
    const appearsOnDate=({scheduled,item})=>scheduled || Boolean(item &&
      (item.status!=='pending' || item.acknowledged || item.doneSteps?.length));
    const daily=rows.filter(appearsOnDate);
    const other=rows.filter(row=>!row.task.archived&&!appearsOnDate(row));
    const frequencies={once:'仅一次',daily:'每天',weekdays:'工作日',weekly:'每周'};
    const form=`<form id="task-form">
      <div class="cols">
        <label>任务名称 <input class="field" name="title" required maxlength="80" placeholder="例如：专注工作十分钟" value="${esc(t.title)}"></label>
        <label>计划日期 <input class="field" type="date" name="day" required value="${esc(t.day)}"></label>
        <label>计划时间 <input class="field" type="time" name="when" required value="${esc(t.when)}"></label>
        <label>重复频率 <select class="field" name="repeat">${Object.entries(frequencies).map(([key,label])=>option(key,label,t.repeat)).join('')}</select></label>
      </div>
      <label><input type="checkbox" name="reminderEnabled" ${t.reminderEnabled!==false?'checked':''}> 开启定时提醒</label>
      <details><summary>高级设置</summary><div class="cols">
        <label>预计时长（分钟） <input class="field" type="number" name="minutes" min="1" max="720" value="${esc(t.minutes)}"></label>
        <label>优先级 <select class="field" name="priority">${[1,2,3].map((value,i)=>option(String(value),['高','普通','低'][i],String(t.priority))).join('')}</select></label>
        ${selectTask('dependsOn','前置任务',t.dependsOn)}
        ${selectTask('nextId','完成后衔接',t.nextId)}
      </div><label><input type="checkbox" name="strictDependency" ${t.strictDependency?'checked':''}> 必须先完成前置任务</label>
      <label>具体第一步 <input class="field" name="firstStep" maxlength="150" value="${esc(t.firstStep)}"></label>
      <label>拆解步骤（每行一步） <textarea class="field" name="steps" rows="3" maxlength="1850">${esc((t.steps??[]).join('\n'))}</textarea></label></details>
      <div class="controls"><button class="primary" type="submit">保存任务</button>${action('cancel-edit','取消')}</div>
    </form>`;
    const taskRow=({task,config,scheduled,item})=>{
          const data=taskData(task,{day:selectedDay}), status=item&&P.outcomes.includes(item.status)?P.STATUSES[item.status]:
            item?.status==='active'?'进行中':scheduled?'未记录':'当天无须执行';
          const live=!task.archived && scheduled && selectedDay===P.dateKey();
          const canCheck=!task.archived && scheduled && selectedDay<=P.dateKey();
          return `<article class="task"><div class="task-body"><div class="task-name">${esc(item?.title??config.title)}</div>
            <div class="task-info">${esc(config.when)} · ${frequencies[config.repeat]} · ${status}${task.paused?' · 已暂停':''}${task.archived?' · 已移出':''}</div>
            ${task.firstStep?'<p class="subtle">第一步 '+esc(task.firstStep)+'</p>':''}
            ${live&&task.steps?.length ? '<ol>'+task.steps.map((step,i)=>`<li><label><input type="checkbox" data-step="${i}" ${data} ${item?.doneSteps?.includes(i)?'checked':''}> ${esc(step)}</label></li>`).join('')+'</ol>':''}
            <div class="plan-task-controls">
              ${task.archived?'':action('edit','编辑',data)+action('task-toggle',task.paused?'恢复':'暂停',data)}
              ${canCheck?`<details class="plan-checkin-menu"><summary class="secondary small">打卡</summary>
                <div class="plan-checkins" role="group" aria-label="选择打卡结果">
                ${P.outcomes.map(value=>action('check',P.STATUSES[value],data+' data-value="'+value+
                  '" aria-pressed="'+(item?.status===value)+'"','secondary small plan-checkin')).join('')}</div></details>`:''}
              ${live&&!P.outcomes.includes(item?.status)?action('help','和小星聊聊',data,'secondary small plan-chat-action'):''}
              ${task.archived?'':action('archive','−',data+' aria-label="移出计划" title="移出计划"','reminder-minus')}
            </div>
          </div></article>`;
    };
    return `<section class="surface"><div class="controls">${action('new-task','＋ 新增任务','', 'primary')}</div>
      ${editId?'<h2 class="plan-form-title">'+(editing?'编辑任务':'新增任务')+'</h2>'+form:''}</section>` +
      card('任务与打卡', `<div class="plan-date-row"><label for="plan-date">计划日期</label>
        <input class="field" id="plan-date" type="date" value="${esc(selectedDay)}" aria-describedby="plan-date-help">
        <small id="plan-date-help" class="subtle">选择日期，查看当天的计划和打卡记录。</small></div>
        ${daily.map(taskRow).join('')||'<p>这天没有计划。</p>'}
        ${other.length?`<details class="plan-other-tasks"><summary>其他任务</summary>${other.map(taskRow).join('')}</details>`:''}`);
  }
  function contextTask() {
    if (context) {
      const task = state.tasks.find(row => row.id === context.id && !row.archived);
      if (task) return { task, item: P.openInstance(state, task, context.day) };
    }
    return P.nextTask(state, P.dateKey());
  }
  function recoverView() {
    const entry = state.recoveries.find(row => row.result === 'open');
    if (entry) return card('当前恢复行动', `<p>${esc(entry.taskTitle || '没有指定原任务')} · ${esc(entry.reason)}</p><p><strong>试这一步</strong> ${esc(entry.strategy)}</p>
      <div class="controls">${action('recovery-result', '已回到任务', `data-id="${esc(entry.id)}" data-value="resumed"`, 'primary')}
      ${action('recovery-result', '稍后再继续', `data-id="${esc(entry.id)}" data-value="postponed"`)}
      ${action('recovery-result', '这次先结束', `data-id="${esc(entry.id)}" data-value="stopped"`)}</div>`) + recoveryHistory();
    const rows = P.schedule(state, P.dateKey());
    const target = contextTask();
    if (target && !rows.some(({ task }) => task.id === target.task.id)) rows.unshift(target);
    const prior = target?.task.id;
    return card('记录这次偏航', `<form id="recovery-form">
      <label>原任务 <select class="field" name="taskId">${option('', '没有明确的原任务', '')}${rows.map(({ task }) => option(task.id, task.title, prior)).join('')}</select></label>
      <label>你感受到的原因 <select class="field" name="reason" required>${option('', '请选择', '')}${C.obstacles.map(([, label]) => option(label, label, '')).join('')}${option('不确定', '不确定', '')}</select></label>
      <label>这次要试的动作 <input name="strategy" class="field" maxlength="150" placeholder="留空时按所选原因推荐"></label>
      <button class="primary">开始恢复</button></form>`) + recoveryHistory();
  }
  function recoveryHistory() {
    const rows = state.recoveries.filter(row => row.result !== 'open').slice(-6).reverse();
    return rows.length ? card('最近恢复记录', '<ul>' + rows.map(row =>
      `<li>${esc(row.taskTitle || '未指定任务')} · ${esc(row.reason)} · ${esc({ resumed: '已恢复', postponed: '已暂缓', stopped: '已结束' }[row.result])}<br><span class="subtle">${esc(row.strategy)}</span></li>`).join('') + '</ul>') : '';
  }
  function focusView() {
    return card('启动与深度工作', `<div class="timer" id="focus-display" aria-live="off">00:00</div><p id="focus-mode" class="subtle"></p>
      <div class="controls">${[30, 180, 300].map((seconds, i) => action('timer-preset', ['30 秒启动', '3 分钟练习', '5 分钟启动'][i], `data-value="${seconds}"`)).join('')}
      ${action('timer-stop', '停止计时')}</div>
      <form id="timer-form"><div class="cols"><label>每段秒数 <input class="field" name="seconds" type="number" min="10" max="7200" value="1500" required></label>
      <label>模式 <select class="field" name="mode"><option value="simple">普通倒计时</option><option value="segments">分段计时</option><option value="deep">深度工作 · 暂停提醒</option></select></label>
      <label>分段数 <input class="field" name="segments" type="number" min="2" max="6" value="2"></label></div>
      <button class="primary">开始计时</button></form>`);
  }
  function reviewView() {
    const date = P.dateKey();
    const tomorrow = P.shiftDate(date, 1);
    const confirmed = state.plans[tomorrow];
    const report = C.review(state, date, 1);
    return card('今日记录', `<p>${Object.entries(report.totals).map(([key, value]) => P.STATUSES[key] + ' ' + value).join(' · ')}</p>
      <p class="subtle">记录中的中断 ${report.interrupted} 次 · 确认恢复 ${report.recovered} 次</p>`) +
      card('整理明天的重点', `<form id="handoff-form"><p class="subtle">用「今天……」「明天：……」分行记录。提取后可修改时间和第一步。</p>
      <label>口述稿或文字复盘 <textarea class="field" name="reflection" maxlength="1500" rows="5" placeholder="今天……&#10;明天：核对明天会议需要的文件">${esc(confirmed?.reflection)}</textarea></label>
      <div class="controls">${action('extract', '提取进展和重点')}</div><p id="draft-summary" class="subtle" aria-live="polite">${confirmed?.progress?.length ? '今日记录：' + esc(confirmed.progress.join('；')) : ''}</p>
      <input type="hidden" name="day" value="${tomorrow}">
      ${[0, 1, 2].map((i) => {
        const row = confirmed?.items[i];
        return `<fieldset class="setting"><legend>重点 ${i + 1}</legend><div class="cols">
        <label>名称 <input class="field" name="title${i}" maxlength="80" value="${esc(row?.title)}"></label>
        <label>时间 <input class="field" name="when${i}" type="time" value="${esc(row?.when ?? '09:00')}"></label></div>
        <label>具体第一步 <input class="field" name="step${i}" maxlength="150" value="${esc(row?.firstStep)}"></label></fieldset>`;
      }).join('')}<button class="primary">确认 ${tomorrow} 的重点</button>${confirmed ? '<p class="subtle">已保存，可以继续修改。</p>' : ''}</form>`);
  }
  function growthView() {
    const day = P.dateKey();
    const report = C.review(state, day);
    const mean = values => values.length ? `${(values.reduce((total, value) => total + value, 0) / values.length).toFixed(1)} 分钟（${values.length} 次）` : '暂无记录';
    const top = report.ranked.map(([reason, count]) => `<li>${esc(reason)} · ${count} 次</li>`).join('');
    const strategies = report.strategies.map(([strategy, result]) => `<li>${esc(strategy)} · 确认恢复 ${result.restarts}/${result.attempts} 次</li>`).join('');
    const proposals = report.proposal.map(suggestion => `<form id="proposal-${suggestion.kind}" data-proposal="${suggestion.kind}"><p>${esc(suggestion.text)}</p>
      ${suggestion.kind === 'firstStep' ? `<label>选择任务 <select class="field" name="taskId" required>${option('', '请选择', '')}
      ${state.tasks.filter(t => !t.archived).map(t => option(t.id, t.title, '')).join('')}</select></label>` : ''}
      ${suggestion.taskId ? `<input type="hidden" name="taskId" value="${esc(suggestion.taskId)}">` : ''}
      <button class="secondary">确认这项调整</button></form>`).join('');
    return card('最近 7 天', `<p>${Object.entries(report.totals).map(([key, value]) => P.STATUSES[key] + ' ' + value).join(' · ')}</p>
      <p class="subtle">有结果的任务完成率 ${report.recorded ? Math.round(100 * report.totals.completed / report.recorded) + '%' : '暂无记录'}。分母包括完成、部分完成和未完成。</p>
      <dl><dt>平均启动延迟</dt><dd>${mean(report.delays)}</dd><dt>中断 / 衔接提示</dt><dd>${report.interrupted} 次 / ${report.transitions} 次</dd>
      <dt>恢复结果</dt><dd>确认恢复 ${report.recovered}/${report.recoveryCount} 次 · 平均偏航时长 ${mean(report.durations)}</dd></dl>`) +
      card('障碍与策略', `<h3>用户自述</h3>${top ? '<ul>' + top + '</ul>' : '<p>暂无明确记录。</p>'}
      <h3>恢复尝试及结果</h3>${strategies ? '<ul>' + strategies + '</ul>' : '<p>暂无恢复策略样本。</p>'}`) +
      card('待验证的调整', proposals || '<p>目前记录不足，先观察已有计划。</p>') +
      card('成长奖励', `<p>⭐ ${state.stars} 颗星 · Lv.${Math.floor(state.stars / 100) + 1}</p><p class="subtle">实际启动、完成、部分完成和确认恢复可获得奖励。固定作息连续完成满三天有额外奖励。</p>`);
  }
  const views = { plan: planView, growth: growthView, settings: () => v1View.screen('settings'),
    recover: recoverView, focus: focusView, review: reviewView, v1: () => v1View.screen('chat'),
    v1review: () => v1View.screen('review'), v1stars: () => window.PlanetDashboard.sky(state,starPeriod,starAnchor || P.dateKey()),
    v1reminders: () => v1View.screen('schedule'), v1settings: () => v1View.screen('settings'), v1library: () => v1View.screen('library'),
    v1ideas: () => v1View.screen('ideas') };

  function updateTimer() {
    const timer = state.timer;
    const el = byId('focus-display');
    if (!el) return;
    const seconds = timer ? Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000)) : 0;
    el.textContent = [Math.floor(seconds / 60), seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
    byId('focus-mode').textContent = timer
      ? timer.mode === 'segments' ? `第 ${timer.index + 1} / ${timer.durations.length} 段`
        : timer.mode === 'deep' ? '深度工作进行中 · 暂停定时提醒' : '正在计时'
      : '请选择时长';
  }
  function loop() {
    const now = new Date();
    const day = P.dateKey(now);
    const V = window.PlanetV1;
    const week = V.monday(day);
    if (week !== lastQuoteWeek) {
      lastQuoteWeek = week;
      V.chooseQuote(V.init(state), day);
      save();
      if (page === 'v1library' && !document.activeElement?.closest('[data-v1-form="quote"]')) render();
    }
    const timerChange = S.timerTick(state, now);
    if (timerChange) {
      save();
      if (timerChange === 'finished') v1View.playCompletionSound();
      toast(timerChange === 'finished' ? '计时完成，已经为你记录。' : '进入下一段。');
      byId('starcount').textContent = state.stars;
      if (page === 'v1stars') render();
    }
    v1View.tick(now);
    v1View.clock();
    const row = S.tick(state, now, {wholePlanOnly:true});
    if (row) {
      V.message(V.init(state), row.title+'\n'+row.list.join('\n'));
      save();
      if(page==='v1')v1View.refreshChat();
      toast(row.title);
      const timed = ['scheduled','handoff'].includes(row.kind);
      const played = timed && v1View.playReminderSound();
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('小步星球 · 小星', { body: row.list?.join('\n') ?? row.title + '。' + row.prompt,
          silent:played || !timed || !v1View.remindersAudible() }); }
        catch { /* In-page reminder remains visible. */ }
      }
    }
    if (day !== lastObservedDay) {
      lastObservedDay = day;
      void v1View.refreshUsage();
      if (page === 'growth') render();
    }
    updateTimer();
  }
  function markTask(task, day, kind, value) {
    if (!task) throw new Error('找不到任务');
    const status = kind === 'check' ? value : kind;
    const result = window.PlanetV1.checkTask(state,task,day,status);
    if (!result.changed) return;
    if (status === 'completed') v1View.playCompletionSound();
    if (status === 'defer' || P.outcomes.includes(status) || status === 'start') {
      for (const row of state.inbox) {
        if (row.taskId === task.id && row.taskDay === day) row.read = true;
      }
    }
    toast('已记下' + P.STATUSES[result.item.status]);
    save();
    render();
  }
  function exportData() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = '小步星球-' + P.dateKey() + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const handlers = {
    'account-entry': () => { if(!settingsSync.openLogin?.())go('v1settings'); },
    'reward-value': (_,task,button) => {
      const plot=button.closest('.reward-plot');
      const open=button.getAttribute('aria-expanded')!=='true';
      for(const column of plot.querySelectorAll('[data-act="reward-value"][aria-expanded="true"]')){
        column.setAttribute('aria-expanded','false');
        byId(column.getAttribute('aria-controls')).hidden=true;
      }
      if(open){
        button.setAttribute('aria-expanded','true');
        byId(button.getAttribute('aria-controls')).hidden=false;
      }
    },
    'star-period': ({value}) => {
      if(!['day','week','month'].includes(value))return;
      starPeriod=value;
      render();
      document.querySelector('[data-act="star-period"][aria-pressed="true"]')?.focus();
    },
    page: ({ target }) => { if (Object.hasOwn(views, target)) go(target); },
    help: (_, task) => {
      if(!task)return;
      const V=window.PlanetV1;
      V.open(state,V.reminderId(task));
      save();go('v1');
    },
    'new-task': () => { editId='new'; go('plan'); byId('task-form').elements.title.focus(); },
    edit: ({ id }) => { editId = id; go('plan'); byId('task-form').scrollIntoView({ behavior: 'smooth' }); },
    'cancel-edit': () => { editId = ''; render(); },
    archive: (_, task) => {
      if (!task || !confirm('将任务从后续计划移除，已有打卡会保留。确定吗？')) return;
      P.setTaskState(task,'archive');
      v1View.reconcileTasks();
      P.event(state, 'task_archived', new Date(), { taskId: task.id });
      save(); render();
    },
    'task-toggle': (_, task) => {
      if(!task)return;
      P.setTaskState(task,task.paused?'resume':'pause');
      v1View.reconcileTasks();save();render();
    },
    interrupt: ({ day }, task) => {
      context = { id: task.id, day };
      go('recover');
    },
    'recovery-result': ({ id, value }) => {
      if (P.endRecovery(state, id, value)) { save(); toast('恢复结果已记录'); render(); }
    },
    'timer-preset': ({ value }) => { S.startTimer(state, Number(value), 'simple', 1); save(); updateTimer(); },
    'timer-stop': () => {
      if (!state.timer) return;
      P.event(state, 'timer_stopped', new Date(), { mode: state.timer.mode });
      state.timer = null; save(); updateTimer(); loop();
    },
    extract: () => {
      const form = byId('handoff-form');
      const draft = C.draft(form.elements.reflection.value);
      byId('draft-summary').textContent = draft.summary.length ? '今日记录：' + draft.summary.join('；') : '尚未提取到今日进展。';
      if (!draft.items.length) return toast('可以用「明天：任务」写在单独的一行');
      draft.items.forEach((row, i) => {
        if (form.elements['title' + i].value.trim()) return;
        form.elements['title' + i].value = row.title;
        form.elements['step' + i].value = row.firstStep;
        form.elements['when' + i].value = row.when;
      });
    },
    pause: () => { state.settings.pausedUntil = Date.now() + 3600000; save(); render(); toast('已暂停监督一小时'); },
    resume: () => { state.settings.pausedUntil = 0; save(); render(); loop(); },
    notification: async () => {
      if (!('Notification' in window) || !window.isSecureContext) return toast('当前页面不支持授权浏览器通知');
      const permission = await Notification.requestPermission();
      toast(({ granted: '浏览器已授权通知', denied: '浏览器未允许通知', default: '目前未授权' })[permission]);
    },
    export: exportData,
    reset: () => {
      if (!confirm('确定清除当前浏览器保存的任务和记录吗？')) return;
      state = P.createState(); context = null; editId = ''; lastQuoteWeek = undefined; save(); go('v1');
    },
  };
  const forms = {
    'task-form': data => {
      const task = P.upsertTask(state, { ...data, id:editId==='new'?undefined:editId,
        reminderEnabled:Boolean(data.reminderEnabled),strictDependency:Boolean(data.strictDependency),
        sharedReminder:Boolean(data.reminderEnabled) });
      v1View.reconcileTasks();
      selectedDay = task.day; editId = ''; save(); render(); toast('已保存任务');
    },
    'recovery-form': data => {
      const strategy = data.strategy.trim() || C.obstacles.find(([, text]) => text === data.reason)?.[3] ||
        C.firstStep(state.tasks.find(row => row.id === data.taskId));
      const taskDay = data.taskId === context?.id ? context.day : P.dateKey();
      P.beginRecovery(state, { ...data, strategy, taskDay }); save(); render();
    },
    'timer-form': data => { S.startTimer(state, Number(data.seconds), data.mode, Number(data.segments)); save(); updateTimer(); },
    'handoff-form': data => {
      const rows = [0, 1, 2].map(i => ({ title: data['title' + i], firstStep: data['step' + i], when: data['when' + i] }))
        .filter(row => row.title.trim() || row.firstStep.trim());
      P.savePlan(state, data.day, rows, data.reflection, new Date(), C.draft(data.reflection).summary);
      save(); render(); toast('次日清单已确认');
    },
  };
  byId('nav').addEventListener('click', e => {
    const target = e.target.closest('[data-page]');
    if (target) go(target.dataset.page);
  });
  document.addEventListener('click', async e => {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const { act, id, day, value } = button.dataset;
    const task = state.tasks.find(row => row.id === id && !row.archived);
    try {
      if (['start', 'defer', 'check'].includes(act)) markTask(task, day, act, value);
      else await handlers[act]?.(button.dataset, task, button);
    } catch (error) { toast(error.message); }
  });
  document.addEventListener('submit', e => {
    const form = e.target;
    if (!forms[form.id] && !form.dataset.proposal) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      if (form.dataset.proposal) {
        if (C.applyProposal(state, form.dataset.proposal, P.dateKey(), data.taskId)) {
          save(); render(); toast('已执行你确认的调整');
        }
      } else forms[form.id](data);
    } catch (error) { toast(error.message); }
  });
  document.addEventListener('change', e => {
    if(e.target.matches('[data-star-stat-date]')){
      const date=e.target.value;
      if(!date || !e.target.validity.valid)return;
      starAnchor=date;
      render();
      document.querySelector('[data-star-stat-date]')?.focus();
      return;
    }
    const el = e.target;
    if (el.id === 'plan-date' && el.value) {
      selectedDay = el.value; editId = ''; render(); return;
    }
    const task = state.tasks.find(row => row.id === el.dataset.id && !row.archived);
    if (!task) return;
    try {
      if (Object.hasOwn(el.dataset, 'step')) {
        const item = P.openInstance(state, task, el.dataset.day);
        const step = Number(el.dataset.step);
        item.doneSteps = el.checked ? [...new Set([...item.doneSteps, step])] : item.doneSteps.filter(i => i !== step);
        save();
      }
    } catch (error) { toast(error.message); }
  });
  settingsSync = window.PlanetSettingsSync?.mount({state:()=>state,save,toast,storage:localStorage,config:window.PLANET_SYNC_CONFIG,
    redraw:()=>{ const panel=byId('settings-sync-panel'); if(panel)panel.innerHTML=settingsSync.panel(); }}) ?? {
    panel:()=>'<p class="subtle">设置保存在当前浏览器。</p>',
    onSave(){},
  };
  const v1View = window.PlanetV1View.mount({ state: () => state, page: () => page, save, render, go, toast,
    syncPanel:()=>settingsSync.panel() });
  render();
  save();
  setInterval(loop, 1000);
  window.addEventListener('focus', loop);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
  loop();
})();
