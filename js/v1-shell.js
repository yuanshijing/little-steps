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
    coach: '自定义任务教练', plan: '已有的自定义任务',
    growth: '看看行动留下的线索', settings: '你的节奏，你决定',
    recover: '回到正轨', focus: '启动与专注计时', review: '睡前外化与次日计划', v1: '小星对话',
    v1review: '日周复盘', v1stars: '星空收藏', v1settings: '设置', v1library: '晨间语录', v1reminders: '定时提醒',
    v1memory: '长期记忆', v1ideas: '灵感暂存',
  };
  const home = byId('view');
  const inbox = document.createElement('section');
  inbox.id = 'supervision';
  inbox.setAttribute('aria-label', '主动监督提醒');
  home.before(inbox);
  let state;
  try { state = P.read(localStorage); }
  catch { state = P.createState(); }
  let page = 'v1';
  let editId = '';
  let selectedDay = P.dateKey();
  let context = null;
  let lastObservedDay = P.dateKey();
  let lastQuoteWeek;
  let toastTimer;
  let modelAvailable = false;
  let modelPending = false;

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
  }
  function chat(role, text) {
    state.chat.push({ role, text });
  }
  function go(next) {
    page = next;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function render() {
    byId('starcount').textContent = state.stars;
    byId('todaylabel').textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
    byId('pagetitle').textContent = headings[page];
    const navPage = ({focus:'v1', coach:'v1', recover:'v1', growth:'v1review', review:'v1review',
      v1memory:'v1review', v1ideas:'v1', settings:'v1settings', plan:'v1settings'})[page] ?? page;
    document.querySelectorAll('#nav button').forEach(button => {
      const current = button.dataset.page === navPage;
      button.classList.toggle('active', current);
      if (current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    home.dataset.screen = page;
    home.innerHTML = views[page]();
    renderInbox();
    updateTimer();
    v1View.clock();
    const box = byId('v1-chat') ?? byId('chatbox');
    if (box) box.scrollTop = box.scrollHeight;
  }
  function controls(task, item) {
    const data = taskData(task, item);
    if (P.outcomes.includes(item.status)) return '';
    if (P.blocked(state, task, item.day)) return '<p class="subtle">等待前置任务完成</p>';
    return `<div class="controls">${item.status === 'active'
      ? action('interrupt', '记录中断', data)
      : action('start', item.status === 'interrupted' ? '我重新开始了' : '我开始了', data, 'primary')}
      ${action('help', '给我一个最小行动', data)}
      ${action('defer', '推迟 15 分钟', data)}
      ${action('check', '完成', data + ' data-value="completed"')}</div>`;
  }
  function planList(items) {
    return '<ol>' + items.map(row => `<li>${esc(row.when)} <strong>${esc(row.title)}</strong><br><span class="subtle">${esc(row.firstStep)}</span></li>`).join('') + '</ol>';
  }
  function planView() {
    const rows = P.schedule(state, selectedDay);
    const editing = state.tasks.find(task => task.id === editId);
    const t = editing ?? { title: '', day: selectedDay, when: '14:00', minutes: 5, repeat: 'once', priority: 2, steps: [] };
    const dependencies = state.tasks.filter(row => !row.archived && row.id !== editing?.id);
    const confirmed = state.plans[selectedDay]?.items ?? [];
    return (confirmed.length ? card('已确认的重点', planList(confirmed)) : '') +
      card('按日查看计划', `<label for="plan-date">日期</label><input class="field" id="plan-date" type="date" value="${esc(selectedDay)}">` +
      (rows.length ? rows.map(({ task, item }) => `<article class="task ${item.status === 'completed' ? 'done' : ''}"><div class="task-body">
        <div class="task-name">${esc(task.title)}</div><div class="task-info">${esc(task.when)} · ${task.minutes} 分钟 · 优先级 ${task.priority} · ${P.STATUSES[item.status]}
        ${task.chain ? ' · ' + esc(task.chain) : ''}${item.deferUntil && item.status === 'deferred' ? ' · 延期至 ' + new Date(item.deferUntil).toLocaleString('zh-CN') : ''}</div>
        ${task.firstStep ? `<p class="subtle">第一步 ${esc(task.firstStep)}</p>` : ''}
        ${task.steps?.length ? '<ol>' + task.steps.map((step, i) => `<li><label><input type="checkbox" data-step="${i}" ${taskData(task, item)} ${item.doneSteps.includes(i) ? 'checked' : ''}> ${esc(step)}</label></li>`).join('') + '</ol>' : ''}
        ${selectedDay <= P.dateKey() ? controls(task, item) + `<div class="controls"><label>打卡 <select class="field" data-outcome ${taskData(task, item)}>${option('', '选择结果', '')}
        ${P.outcomes.map(status => option(status, P.STATUSES[status], item.status)).join('')}</select></label></div>` : ''}
        <div class="controls">${action('edit', '编辑', taskData(task, item))}${action('archive', '移出计划', taskData(task, item))}</div>
        </div></article>`).join('') : '<p>这天还没有计划。</p>')) +
      card(editing ? '编辑任务或固定作息' : '添加任务或固定作息', `<form id="task-form">
        <div class="setting"><label>任务名称 <input class="field" name="title" required maxlength="80" value="${esc(t.title)}"></label></div>
        <div class="cols"><label>日期 <input class="field" type="date" name="day" required value="${esc(t.day)}"></label>
        <label>提醒时间 <input class="field" type="time" name="when" required value="${esc(t.when)}"></label>
        <label>预计分钟 <input class="field" type="number" name="minutes" min="1" max="720" required value="${t.minutes}"></label>
        <label>频率 <select class="field" name="repeat">${[['once', '一次'], ['daily', '每天'], ['weekdays', '工作日'], ['weekly', '每周同一天']].map(([k, v]) => option(k, v, t.repeat)).join('')}</select></label>
        <label>类型 <select class="field" name="category">${[['task', '任务'], ['routine', '固定作息'], ['transition', '活动衔接'], ['leisure', '娱乐结束提醒']].map(([k, v]) => option(k, v, t.category ?? 'task')).join('')}</select></label>
        <label>优先级 <select class="field" name="priority">${[1, 2, 3].map((n, i) => option(String(n), ['高', '普通', '低'][i], String(t.priority))).join('')}</select></label>
        <label>前置任务 <select class="field" name="dependsOn">${option('', '无', '')}${dependencies.map(row => option(row.id, row.title, t.dependsOn)).join('')}</select></label>
        <label>行为链 <input class="field" name="chain" maxlength="35" placeholder="例：晨间例程" value="${esc(t.chain)}"></label></div>
        <label>具体第一步 <input class="field" name="firstStep" maxlength="150" value="${esc(t.firstStep)}" placeholder="例：打开文档并找到上次写到的位置"></label>
        <label>拆解步骤（每行一步） <textarea class="field" name="steps" rows="4" maxlength="1850">${esc((t.steps ?? []).join('\n'))}</textarea></label>
        <div class="controls"><button class="primary" type="submit">保存任务</button>${editing ? action('cancel-edit', '取消编辑') : ''}</div>
      </form>`);
  }
  function contextTask() {
    if (context) {
      const task = state.tasks.find(row => row.id === context.id && !row.archived);
      if (task) return { task, item: P.openInstance(state, task, context.day) };
    }
    return P.nextTask(state, P.dateKey());
  }
  function coachView() {
    const target = contextTask();
    return card('小星 · 行动教练', `<p class="subtle">${target ? '当前任务：' + esc(target.task.title) : '当前没有指定任务'}。规则教练会给一个能立即尝试的行动。</p>
      <div class="chatbox" id="chatbox" aria-live="polite">${state.chat.slice(-35).map(row => `<div class="bubble ${row.role === 'you' ? 'you' : 'ai'}">${esc(row.text)}</div>`).join('')}</div>
      <div class="chips">${Object.entries(C.quick).map(([key, label]) => action('quick', label, `data-value="${key}"`, 'soft small')).join('')}</div>
      ${target ? controls(target.task, target.item) : ''}
      <form id="chat-form"><div class="composer"><input class="field" name="message" autocomplete="off" required maxlength="500" aria-label="描述当前状态" placeholder="用一句话说说你现在的状态"><button class="primary" name="mode" value="local">发送</button></div>
      <div id="model-send" ${modelAvailable ? '' : 'hidden'}><button name="mode" value="model" class="secondary" ${modelPending ? 'disabled' : ''}>把本条消息发给 OpenAI</button>
      <p class="subtle">仅发送输入框中的文字和所选教练风格。请勿填写身份或健康隐私信息。</p></div></form>
      ${notice('默认使用本地规则教练。可能的障碍会标为推测，任务结果以你的确认为准。')}`);
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
  function settingsView() {
    const s = state.settings;
    return card('我的教练', `<form id="settings-form">
      <label>昵称 <input class="field" name="name" maxlength="24" value="${esc(state.name)}"></label>
      <label>教练风格 <select class="field" name="style">${[['active', '主动监督'], ['gentle', '温柔陪伴'], ['brief', '简洁指令']].map(([key, label]) => option(key, label, s.style)).join('')}</select></label>
      <label>我偏好的通用启动动作 <input class="field" name="preferredStep" maxlength="150" placeholder="例：先写下一件两分钟内能做的事" value="${esc(state.memory.preferredStep)}"></label>
      <div class="cols"><label>跟进间隔（分钟） <input class="field" name="follow" type="number" min="1" max="60" value="${s.follow}" required></label>
      <label>最多追加提醒 <input class="field" name="max" type="number" min="0" max="3" value="${s.max}" required></label>
      <label>次日清单默认提示时间 <input class="field" name="nextDayTime" type="time" value="${esc(s.nextDayTime)}" required></label></div>
      <div class="setting"><label><input type="checkbox" name="remind" ${s.remind ? 'checked' : ''}> 启用打开页面时的提醒</label></div>
      <div class="controls"><button class="primary">保存设置</button>${action('notification', '启用浏览器通知')}</div>
      </form><p>${s.pausedUntil > Date.now() ? '已暂停至 ' + esc(new Date(s.pausedUntil).toLocaleString('zh-CN')) : '监督未暂停'}</p>
      <div class="controls">${action('pause', '暂停监督 1 小时')}${action('resume', '恢复监督')}</div>`) +
      card('数据与能力', notice('数据保存在当前浏览器。关闭网页后的主动通知、设备级应用限制和内置语音识别尚未接入。可使用系统键盘听写输入。') +
      '<p>真实模型需要本机服务配置。明确选择发送给 OpenAI 时，模型才接收当前消息与教练风格。</p>' +
      '<p>浏览器通知依赖 HTTPS 或 localhost 和授权，实际送达还取决于系统设置。教练提供行动支持，不提供 ADHD 诊断或治疗。</p>' +
      `<div class="controls">${action('export', '导出 JSON')}${action('reset', '清除本地数据', '', 'danger')}</div>`);
  }
  const views = { coach: coachView, plan: planView, growth: growthView, settings: settingsView,
    recover: recoverView, focus: focusView, review: reviewView, v1: () => v1View.screen('chat'),
    v1review: () => v1View.screen('review'), v1stars: () => window.PlanetDashboard.sky(state),
    v1reminders: () => v1View.screen('schedule'), v1settings: () => v1View.screen('settings'), v1library: () => v1View.screen('library'),
    v1memory: () => v1View.screen('memory'), v1ideas: () => v1View.screen('ideas') };

  function renderInbox() {
    if (page !== 'v1' || window.PlanetV1.init(state).active) { inbox.innerHTML = ''; return; }
    const pending = state.inbox.filter(row => !row.read && (!row.taskId || (() => {
      const item = state.instances[row.taskDay + '/' + row.taskId];
      return !item?.acknowledged;
    })())).slice(-3).reverse();
    inbox.innerHTML = pending.map(row => {
      const task = state.tasks.find(t => t.id === row.taskId && !t.archived);
      const item = task && state.instances[row.taskDay + '/' + row.taskId];
      const data = item ? taskData(task, item) : '';
      return card(row.title, (row.list ? '<ul>' + row.list.map(line => `<li>${esc(line)}</li>`).join('') + '</ul>' :
        `<p>${esc(row.prompt)}</p>`) + `<div class="controls">${item ? action('start', '我开始了', data, 'primary') +
        action('help', '给我一个最小行动', data) + action('defer', '推迟 15 分钟', data) +
        action('check', '跳过', data + ' data-value="skipped"') : ''}
        ${action('ack', '已读', `data-id="${esc(row.id)}"`)}</div>`);
    }).join('');
  }
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
    const row = !window.PlanetV1.init(state).active && S.tick(state, now);
    if (row) {
      save();
      renderInbox();
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
      if (page === 'growth') render();
    }
    updateTimer();
  }
  function help(message, target = contextTask()) {
    const task = target?.task;
    const preferred = state.memory.preferredStep;
    const candidate = preferred && !(task?.firstStep || task?.steps?.length)
      ? { ...task, firstStep: preferred } : task;
    const reply = C.suggest(message, candidate, state.settings.style);
    chat('you', message);
    chat('ai', reply.text);
    P.event(state, 'advice', new Date(), { ...reply });
    save();
    go('coach');
  }
  function refreshChatAfterModel(message) {
    if (page !== 'coach') return;
    const unsent = byId('chat-form')?.elements.message.value;
    render();
    if (unsent !== message && unsent) byId('chat-form').elements.message.value = unsent;
  }
  async function modelHelp(message, button) {
    if (!modelAvailable || modelPending) return;
    modelPending = true;
    const snapshot = state;
    const target = contextTask();
    button.disabled = true;
    try {
      const response = await fetch('/api/coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true, message, style: state.settings.style }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('模型不可用');
      const advice = await response.json();
      if (typeof advice.action !== 'string' || advice.action.length > 150 || !advice.action.trim()) throw new Error('模型结果无效');
      if (state !== snapshot) return;
      const obstacle = C.obstacles.find(([key]) => key === advice.obstacle)?.[1];
      chat('you', message);
      chat('ai', '大模型建议：' + (obstacle ? '可能遇到了' + obstacle + '。' : '') + advice.action);
      P.event(state, 'advice', new Date(), { taskId: target?.task.id, action: advice.action,
        origin: 'model', evidence: obstacle ? 'inferred' : 'none', obstacle });
      save();
      refreshChatAfterModel(message);
    } catch {
      if (state !== snapshot) return;
      const rule = C.suggest(message, target?.task, state.settings.style);
      chat('you', message);
      chat('ai', '模型暂不可用。本地建议：' + rule.text);
      P.event(state, 'advice', new Date(), rule);
      save();
      refreshChatAfterModel(message);
      if (page === 'coach') toast('网络模型未返回建议，已改用本地规则。');
    } finally {
      modelPending = false;
      const control = byId('model-send')?.querySelector('button');
      if (control) control.disabled = false;
    }
  }
  function markTask(task, day, kind, value) {
    if (!task) throw new Error('找不到任务');
    const status = kind === 'check' ? value : kind;
    const result = P.transition(state, task, day, status);
    if (!result.changed) return;
    if (status === 'completed') v1View.playCompletionSound();
    if (status === 'defer' || P.outcomes.includes(status) || status === 'start') {
      for (const row of state.inbox) {
        if (row.taskId === task.id && row.taskDay === day) row.read = true;
      }
    }
    if ((status === 'completed' || status === 'partial') && !P.outcomes.includes(result.previous) && day === P.dateKey()) {
      const next = P.nextTask(state, day, task);
      if (next) {
        const message = '接下来可以切换到「' + next.task.title + '」。先做这一步：' + C.firstStep(next.task);
        chat('ai', message);
        S.addTransition(state, next, message, task.id);
        toast(message);
      } else toast('已记下' + P.STATUSES[status]);
    } else toast(status === 'start' ? '实际启动已记录' : status === 'defer' ? '已推迟 15 分钟' : '已记下' + P.STATUSES[result.item.status]);
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
    page: ({ target }) => { if (Object.hasOwn(views, target)) go(target); },
    help: (data, task) => {
      context = task ? { id: task.id, day: data.day } : null;
      help('给我一个最小行动');
    },
    quick: ({ value }) => help(C.quick[value]),
    edit: ({ id }) => { editId = id; go('plan'); byId('task-form').scrollIntoView({ behavior: 'smooth' }); },
    'cancel-edit': () => { editId = ''; render(); },
    archive: (_, task) => {
      if (!task || !confirm('将任务从后续计划移除，已有打卡会保留。确定吗？')) return;
      if (state.tasks.some(row => row.dependsOn === task.id && !row.archived)) throw new Error('请先调整依赖这项任务的前置设置');
      task.archived = true;
      P.event(state, 'task_archived', new Date(), { taskId: task.id });
      save(); render();
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
    ack: ({ id }) => { if (S.acknowledge(state, id)) { save(); renderInbox(); } },
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
      const task = P.upsertTask(state, { ...data, id: editId || undefined });
      selectedDay = task.day; editId = ''; save(); render(); toast('已保存任务');
    },
    'chat-form': ({ message }) => { if (message.trim()) help(message.trim()); },
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
    'settings-form': data => {
      state.name = P.clean(data.name, 24) || '冒险家';
      state.memory.preferredStep = P.clean(data.preferredStep, 150);
      Object.assign(state.settings, {
        style: data.style, follow: P.bounded(data.follow, 1, 60, 15), max: P.bounded(data.max, 0, 3, 2),
        remind: Boolean(data.remind), nextDayTime: data.nextDayTime,
      });
      save(); render(); toast('设置已保存');
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
      else await handlers[act]?.(button.dataset, task);
    } catch (error) { toast(error.message); }
  });
  document.addEventListener('submit', e => {
    const form = e.target;
    if (!forms[form.id] && !form.dataset.proposal) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      if (form.id === 'chat-form' && e.submitter?.value === 'model') {
        if (data.message.trim()) void modelHelp(data.message.trim(), e.submitter);
        return;
      }
      if (form.dataset.proposal) {
        if (C.applyProposal(state, form.dataset.proposal, P.dateKey(), data.taskId)) {
          save(); render(); toast('已执行你确认的调整');
        }
      } else forms[form.id](data);
    } catch (error) { toast(error.message); }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'plan-date' && el.value) {
      selectedDay = el.value; editId = ''; render(); return;
    }
    const task = state.tasks.find(row => row.id === el.dataset.id && !row.archived);
    if (!task) return;
    try {
      if (Object.hasOwn(el.dataset, 'outcome') && el.value) markTask(task, el.dataset.day, 'check', el.value);
      if (Object.hasOwn(el.dataset, 'step')) {
        const item = P.openInstance(state, task, el.dataset.day);
        const step = Number(el.dataset.step);
        item.doneSteps = el.checked ? [...new Set([...item.doneSteps, step])] : item.doneSteps.filter(i => i !== step);
        save();
      }
    } catch (error) { toast(error.message); }
  });
  const v1View = window.PlanetV1View.mount({ state: () => state, page: () => page, save, render, go, toast });
  render();
  save();
  setInterval(loop, 1000);
  window.addEventListener('focus', loop);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    fetch('/api/capabilities').then(response => response.ok ? response.json() : null).then(capabilities => {
      modelAvailable = capabilities?.model === true;
      const modelControl = byId('model-send');
      if (modelControl) modelControl.hidden = !modelAvailable;
    }).catch(() => {});
  }
  loop();
})();
