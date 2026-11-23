((root, factory) => {
  if (typeof module !== 'undefined') module.exports = factory(require('./model'));
  else root.PlanetCoach = factory(root.Planet);
})(globalThis, P => {
  'use strict';
  const obstacles = [
    ['phone', '手机干扰', /手机|刷屏|短视频|刷视频|社交媒体|刷手机/, '把手机翻面放到伸手够不到的地方。'],
    ['social', '社交打断', /被打断|同事|家人|聊天|来电|消息/, '写下刚才做到的那一小步。'],
    ['energy', '疲劳', /疲惫|好累|很累|没精力|困了|睡不够/, '先坐下来，慢慢喝两口水。'],
    ['emotion', '情绪干扰', /焦虑|紧张|生气|难过|烦躁|慌|沮丧/, '把注意力放在双脚接触地面的感觉上，停十秒。'],
    ['rumination', '反复纠结', /反复|纠结|完美|怕做错|犹豫/, '在纸上写下一个可逆的小决定。'],
    ['clarity', '目标不清', /不知道|不清楚|没头绪|从哪|什么都/, '写下你希望十分钟后看到的一个结果。'],
    ['difficulty', '任务太难', /太难|复杂|做不了|工作量|压力大/, '只打开相关材料，暂时不要求完成。'],
    ['transition', '活动转换', /切换|转换|停不下来|结束不了/, '把手头活动停在一个能回来继续的位置。'],
    ['distracted', '注意力偏移', /走神|分心|偏航|注意力/, '找回刚才停在的页面或位置。'],
  ];
  const quick = {
    start: '帮我开始', hard: '任务太难', distract: '刚刚走神了',
    tired: '有点疲惫', next: '下一步做什么', emotion: '我有点焦虑', transition: '我很难切换活动',
  };
  function firstStep(task) {
    return task?.firstStep || task?.steps?.[0] || (task ? '只打开「' + task.title + '」要用的页面或材料。' : '写下一件现在可以做的小事。');
  }
  function suggest(input, task, style) {
    const match = obstacles.find(([, , pattern]) => pattern.test(input));
    const intro = style === 'brief' ? '' : style === 'gentle' ? '先给自己留一点空间。' : '我们先确认眼前这一步。';
    const action = match ? match[3] : firstStep(task);
    const context = match ? '可能遇到了' + match[1] + '。' : '';
    return { version: 1, kind: 'next_action', taskId: task?.id ?? null, action,
      obstacle: match?.[1] ?? null, evidence: match ? 'inferred' : 'none',
      text: intro + context + '试试这一步：' + action };
  }
  function draft(text) {
    const lines = P.clean(text, 1500).split(/[\n；;。]+/).map(line => line.trim()).filter(Boolean);
    const summary = [];
    const items = [];
    for (const line of lines) {
      if (/明天|次日|明早|明晚|待办/.test(line)) {
        const title = line.replace(/^\s*[-\d.、]*\s*(明天|次日|明早|明晚|待办)[：:\s]*/, '').trim();
        if (title && items.length < 3 && !items.some(item => item.title === title)) {
          items.push({ title: P.clean(title, 80), firstStep: firstStep({ title }), when: '09:00' });
        }
      } else summary.push(line);
    }
    return { items, summary };
  }
  function review(state, day, days = 7) {
    const first = P.shiftDate(day, 1 - days);
    const events = state.events.filter(event => event.date >= first && event.date <= day);
    const instances = Object.values(state.instances).filter(item => item.day >= first && item.day <= day);
    const totals = Object.fromEntries(P.outcomes.map(status => [status, 0]));
    const obstacleCounts = new Map();
    const strategies = new Map();
    const delays = [];
    const durations = [];
    const startsByTask = new Map();
    let transitions = 0;
    let recovered = 0;
    let recoveryCount = 0;
    let interrupted = 0;
    for (const row of instances) totals[P.outcomes.includes(row.status) ? row.status : 'unrecorded']++;
    for (const event of events) {
      if (!event.legacy && Number.isFinite(event.delayMinutes)) {
        delays.push(event.delayMinutes);
        const samples = startsByTask.get(event.taskId) ?? [];
        samples.push(event.delayMinutes);
        startsByTask.set(event.taskId, samples);
      }
      if (event.type === 'transition_prompt') transitions++;
      if (event.type === 'interrupted') interrupted++;
      if (event.obstacle && event.evidence === 'self_report' && event.type !== 'interrupted') {
        obstacleCounts.set(event.obstacle, (obstacleCounts.get(event.obstacle) ?? 0) + 1);
      }
      if (event.type !== 'recovery_result') continue;
      recoveryCount++;
      if (event.result === 'resumed') recovered++;
      if (Number.isFinite(event.duration)) durations.push(event.duration / 60000);
      const stats = strategies.get(event.strategy) ?? { attempts: 0, restarts: 0 };
      stats.attempts++;
      if (event.result === 'resumed') stats.restarts++;
      strategies.set(event.strategy, stats);
    }
    const ranked = [...obstacleCounts].sort((a, b) => b[1] - a[1]);
    const recentlyApplied = (kind, taskId) => events.some(event => event.type === 'adjustment_applied' &&
      event.kind === kind && (!taskId || event.taskId === taskId));
    const proposal = [];
    if (ranked[0]?.[1] >= 2 && ranked[0][0] === '手机干扰' && !recentlyApplied('firstStep')) {
      proposal.push({ kind: 'firstStep', text: '试行一周：把开始前移开手机作为所选任务的第一步。' });
    }
    if (events.filter(event => event.type === 'followup').length >= 3 && state.settings.max > 0 && !recentlyApplied('reduceFollow')) {
      proposal.push({ kind: 'reduceFollow', text: '试行一周：每项任务的跟进上限减少一次，观察提醒是否更合适。' });
    }
    const delayed = state.tasks.find(task => !task.archived && task.repeat !== 'once' && task.when < '23:45' && !recentlyApplied('laterStart', task.id) &&
      (startsByTask.get(task.id) ?? []).filter(value => value >= 10).length >= 3);
    if (delayed && proposal.length < 2) {
      const later = new Date(P.dueAt(day, delayed.when) + 15 * 60000);
      const time = [later.getHours(), later.getMinutes()].map(value => String(value).padStart(2, '0')).join(':');
      proposal.push({ kind: 'laterStart', taskId: delayed.id, time,
        text: '「' + delayed.title + '」已有至少三次启动延迟。试将计划时间改为 ' + time + '，观察一周。' });
    }
    const recorded = totals.completed + totals.partial + totals.incomplete;
    return { totals, recorded, events, transitions, interrupted, recovered, recoveryCount, ranked, proposal,
      strategies: [...strategies], delays, durations };
  }
  function applyProposal(state, kind, reviewDay, taskId, now = new Date()) {
    const key = reviewDay + '/' + kind + '/' + (taskId || '');
    if (state.events.some(row => row.type === 'adjustment_applied' && row.adjustmentKey === key)) return false;
    const suggestion = review(state, reviewDay).proposal.find(item => item.kind === kind);
    if (!suggestion) throw new Error('当前数据没有这项调整建议');
    if (kind === 'reduceFollow') state.settings.max--;
    if (kind === 'firstStep') {
      const task = state.tasks.find(row => row.id === taskId && !row.archived);
      if (!task) throw new Error('请选择要调整的任务');
      P.upsertTask(state, { ...task, firstStep: '把手机翻面放到伸手够不到的地方。' }, now);
    }
    if (kind === 'laterStart') {
      if (taskId !== suggestion.taskId) throw new Error('调整建议对应的任务已变更');
      const task = state.tasks.find(row => row.id === taskId && !row.archived);
      P.upsertTask(state, { ...task, when: suggestion.time }, now);
    }
    P.event(state, 'adjustment_applied', now, { adjustmentKey: key, kind, taskId });
    return true;
  }
  return { obstacles, quick, firstStep, suggest, draft, review, applyProposal };
});
