((root, factory) => {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  else root.Planet = api;
})(globalThis, () => {
  'use strict';
  const KEY = 'little-steps-planet-v01';
  const STATUSES = {
    pending: '待行动', active: '进行中', interrupted: '中断', deferred: '已延期',
    completed: '完成', partial: '部分完成', incomplete: '未完成',
    skipped: '跳过', unrecorded: '未记录',
  };
  const outcomes = ['completed', 'partial', 'incomplete', 'skipped', 'unrecorded'];
  const pad = n => String(n).padStart(2, '0');
  const uid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const dateKey = (date = new Date()) => [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
  const shiftDate = (day, offset) => {
    const date = new Date(day + 'T12:00:00');
    date.setDate(date.getDate() + offset);
    return dateKey(date);
  };
  const dueAt = (day, time) => new Date(day + 'T' + time + ':00').getTime();
  const dateOk = day => /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') && dateKey(new Date(day + 'T12:00:00')) === day;
  const timeOk = time => /^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? '');
  const bounded = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  const clean = (value, limit) => String(value ?? '').trim().slice(0, limit);
  const defaultSettings = {
    style: 'active', follow: 15, max: 2,
    remind: true, pausedUntil: 0, nextDayTime: '09:00',
  };
  function createState(now = new Date()) {
    const day = dateKey(now);
    return {
      version: 2, name: '冒险家', stars: 20, tasks: [
        ['离开床铺并洗漱', '09:00', 5, '把双脚放到地上'],
        ['专注工作15分钟', '14:00', 15, '打开今天要用的文件'],
        ['整理房间5分钟', '19:30', 5, '把离自己最近的一件物品归位'],
      ].map(([title, when, minutes, firstStep]) => ({
        id: uid(), title, when, minutes, firstStep, steps: [], day, repeat: 'daily', category: 'routine',
        priority: 2, dependsOn: '', chain: '', archived: false,
      })),
      instances: {}, events: [], recoveries: [], plans: {}, inbox: [], switches: [],
      chat: [{ role: 'ai', text: '你好，我是小星。我们可以从一个容易开始的行动做起。' }],
      settings: { ...defaultSettings }, memory: { preferredStep: '' }, timer: null,
    };
  }
  function migrate(raw, now = new Date()) {
    if (!raw || typeof raw !== 'object') return createState(now);
    const base = createState(now);
    if (raw.version === 2 && Array.isArray(raw.tasks) && Array.isArray(raw.events)) {
      return { ...base, ...raw, settings: { ...defaultSettings, ...raw.settings } };
    }
    if (!Array.isArray(raw.tasks) || !Array.isArray(raw.events)) return base;
    const day = dateOk(raw.lastDate) ? raw.lastDate : dateKey(now);
    const state = {
      ...base, name: clean(raw.name, 24) || base.name, stars: bounded(raw.stars, 0, 1e9, 20),
      events: raw.events.map(event => ({ ...event, legacy: true })),
      chat: Array.isArray(raw.chat) ? raw.chat : base.chat,
      settings: { ...defaultSettings, ...raw.settings }, tasks: [],
    };
    for (const old of raw.tasks) {
      if (!old?.title) continue;
      const task = upsertTask(state, { ...old, when: timeOk(old.when) ? old.when : '09:00',
        id: String(old.id || uid()), day, repeat: 'daily' }, now);
      const item = openInstance(state, task, day);
      if (old.done) {
        item.status = 'completed';
        item.rewards.completed = true;
      }
      const reminder = raw.lastReminder?.[task.id + '-' + day];
      if (reminder && Number.isFinite(reminder.at)) {
        item.noticeAt = reminder.at;
        item.followCount = bounded(reminder.count, 0, 100, 0);
      }
    }
    return state;
  }
  function read(storage, now = new Date()) {
    try { return migrate(JSON.parse(storage.getItem(KEY)), now); }
    catch { return createState(now); }
  }
  function write(storage, state) { storage.setItem(KEY, JSON.stringify(state)); }
  function event(state, type, now, detail = {}) {
    const entry = { id: uid(), type, at: now.toISOString(), date: dateKey(now), ...detail };
    state.events.push(entry);
    return entry;
  }
  function upsertTask(state, input, now = new Date()) {
    const id = input.id || uid();
    const prior = state.tasks.find(task => task.id === id);
    const title = clean(input.title, 80);
    if (!title || !timeOk(input.when)) throw new Error('请填写任务名称和有效时间');
    const day = input.day ?? dateKey(now);
    if (!dateOk(day)) throw new Error('请选择有效日期');
    const dependsOn = input.dependsOn || '';
    const seen = new Set([id]);
    for (let next = dependsOn; next;) {
      if (seen.has(next)) throw new Error('任务依赖不能形成循环');
      seen.add(next);
      const dependency = state.tasks.find(task => task.id === next && !task.archived);
      if (!dependency) throw new Error('找不到前置任务');
      next = dependency.dependsOn;
    }
    const steps = (Array.isArray(input.steps) ? input.steps : String(input.steps ?? '').split('\n'))
      .map(step => clean(step, 150)).filter(Boolean).slice(0, 12);
    const task = {
      id, title, when: input.when, day, minutes: bounded(input.minutes, 1, 720, 5),
      priority: bounded(input.priority, 1, 3, 2), dependsOn, chain: clean(input.chain, 35),
      category: ['routine', 'transition', 'leisure'].includes(input.category) ? input.category : 'task',
      repeat: ['once', 'daily', 'weekdays', 'weekly'].includes(input.repeat) ? input.repeat : 'once',
      firstStep: clean(input.firstStep, 150), steps, archived: prior?.archived ?? false,
    };
    if (prior) {
      const changedSteps = JSON.stringify(prior.steps ?? []) !== JSON.stringify(steps);
      for (const item of Object.values(state.instances)) {
        if (item.taskId !== id || item.day < dateKey(now) || item.startedAt || item.noticeAt || item.status !== 'pending') continue;
        item.title = title;
        item.plannedAt = dueAt(item.day, task.when);
        if (changedSteps) item.doneSteps = [];
      }
      Object.assign(prior, task);
    }
    else state.tasks.push(task);
    return prior ?? task;
  }
  function occurs(task, day) {
    if (task.archived || day < task.day) return false;
    const weekday = new Date(day + 'T12:00:00').getDay();
    return task.repeat === 'daily' || (task.repeat === 'once' && task.day === day) ||
      (task.repeat === 'weekdays' && weekday > 0 && weekday < 6) ||
      (task.repeat === 'weekly' && weekday === new Date(task.day + 'T12:00:00').getDay());
  }
  function openInstance(state, task, day) {
    const key = day + '/' + task.id;
    return state.instances[key] ??= {
      key, taskId: task.id, day, title: task.title, plannedAt: dueAt(day, task.when),
      status: 'pending', startedAt: null, noticeAt: null, followCount: 0, acknowledged: false,
      deferUntil: null, rewards: {}, doneSteps: [],
    };
  }
  function schedule(state, day) {
    return state.tasks.filter(task => occurs(task, day)).map(task => ({
      task, item: openInstance(state, task, day),
    })).sort((a, b) => (a.item.deferUntil ?? dueAt(day, a.task.when)) -
      (b.item.deferUntil ?? dueAt(day, b.task.when)) || a.task.priority - b.task.priority);
  }
  function blocked(state, task, day) {
    if (!task.dependsOn) return false;
    const parent = state.tasks.find(t => t.id === task.dependsOn);
    if (!parent || parent.archived) return true;
    const parentDay = parent.repeat === 'once' ? parent.day : day;
    return parentDay > day || state.instances[parentDay + '/' + parent.id]?.status !== 'completed';
  }
  function isLegacyWakeTask(task) {
    return task?.title === '离开床铺并洗漱' && task.when === '09:00' &&
      task.firstStep === '把双脚放到地上' && task.repeat === 'daily' && task.category === 'routine';
  }
  function nextTask(state, day, after = null) {
    const list = schedule(state, day).filter(({ task, item }) =>
      task.id !== after?.id && (!after || !isLegacyWakeTask(task)) && !outcomes.includes(item.status) && !blocked(state, task, day));
    return (after?.chain && list.find(({ task }) => task.chain === after.chain)) || list[0] || null;
  }
  function award(state, record, flag, value) {
    if (record.rewards[flag]) return 0;
    record.rewards[flag] = true;
    state.stars += value;
    return value;
  }
  function transition(state, task, day, action, now = new Date(), { delay, obstacle, strategy } = {}) {
    const item = openInstance(state, task, day);
    const previous = item.status;
    const label = { start: 'active', interrupt: 'interrupted', defer: 'deferred' }[action] ?? action;
    if (!Object.hasOwn(STATUSES, label) || label === 'pending') throw new Error('无效的任务状态');
    if (label === previous && label !== 'deferred') return { changed: false, reward: 0, item };
    if (label === 'active' && (outcomes.includes(previous) || blocked(state, task, day))) throw new Error('请先确认前置任务，或在计划中更正打卡');
    if (label === 'interrupted' && previous !== 'active') throw new Error('只能记录正在进行的任务中断');
    if (label === 'deferred' && outcomes.includes(previous)) throw new Error('记录结果后无法延期');
    if (label === 'deferred') {
      item.deferUntil = now.getTime() + bounded(delay, 1, 1440, 15) * 60000;
      item.noticeAt = null;
      item.followCount = 0;
    }
    item.status = label;
    item.acknowledged = label !== 'deferred';
    let reward = 0;
    const firstStart = label === 'active' && item.startedAt == null;
    if (firstStart) {
      item.startedAt = now.getTime();
      reward = award(state, item, 'started', 3);
    }
    if (label === 'completed') reward = award(state, item, 'completed', 15);
    if (label === 'completed' && task.category === 'routine' && [1, 2].every(offset =>
      state.instances[shiftDate(day, -offset) + '/' + task.id]?.status === 'completed')) {
      reward += award(state, item, 'routine', 2);
    }
    if (label === 'partial') reward = award(state, item, 'partial', 5);
    event(state, { active: 'started', interrupted: 'interrupted', deferred: 'deferred' }[label] ?? 'checkin', now, {
      taskId: task.id, taskDay: day, title: task.title, from: previous, status: label,
      ...(firstStart ? { delayMinutes: Math.max(0, (now.getTime() - item.plannedAt) / 60000) } : {}),
      ...(obstacle ? { obstacle, evidence: 'self_report' } : {}),
      ...(strategy ? { strategy } : {}),
    });
    return { changed: true, reward, item, previous };
  }
  function savePlan(state, day, rows, reflection, now = new Date(), progress = []) {
    if (day !== shiftDate(dateKey(now), 1)) throw new Error('请确认次日的计划日期');
    if (!rows.length || rows.length > 3) throw new Error('请填写 1 至 3 个重点');
    const normalized = rows.map(row => ({
      title: clean(row.title, 80), firstStep: clean(row.firstStep, 150), when: row.when,
    }));
    if (normalized.some(row => !row.title || !row.firstStep || !timeOk(row.when))) throw new Error('每项都需要名称、计划时间和具体第一步');
    const old = state.plans[day];
    for (const task of state.tasks.filter(task => old?.items.some(row => row.id === task.id))) task.archived = true;
    const plan = {
      reflection: clean(reflection, 1500), progress: progress.map(line => clean(line, 150)).filter(Boolean).slice(0, 10),
      confirmedAt: now.toISOString(), deliveredAt: null,
      items: normalized.map(row => {
        const task = upsertTask(state, { ...row, day, repeat: 'once', priority: 1 }, now);
        return { ...row, id: task.id };
      }),
    };
    state.plans[day] = plan;
    event(state, 'plan_confirmed', now, { planDay: day, count: plan.items.length });
    return plan;
  }
  function beginRecovery(state, input, now = new Date()) {
    if (state.recoveries.some(entry => entry.result === 'open')) throw new Error('请先结束已有的恢复记录');
    const task = state.tasks.find(t => t.id === input.taskId && !t.archived);
    const reason = clean(input.reason, 200);
    const strategy = clean(input.strategy, 150);
    if (!reason || !strategy) throw new Error('请填写偏航原因和恢复策略');
    const day = dateOk(input.taskDay) && input.taskDay <= dateKey(now) ? input.taskDay : dateKey(now);
    const entry = {
      id: uid(), taskId: task?.id ?? null, taskDay: day, taskTitle: task?.title ?? '',
      reason, strategy, startedAt: now.toISOString(), result: 'open', endedAt: null, rewards: {},
    };
    if (task && openInstance(state, task, day).status === 'active') transition(state, task, day, 'interrupt', now, { obstacle: reason });
    state.recoveries.push(entry);
    event(state, 'recovery_opened', now, { taskId: entry.taskId, obstacle: reason, strategy, evidence: 'self_report' });
    return entry;
  }
  function endRecovery(state, id, result, now = new Date()) {
    const entry = state.recoveries.find(row => row.id === id);
    if (!entry || entry.result !== 'open' || !['resumed', 'postponed', 'stopped'].includes(result)) return false;
    const task = state.tasks.find(row => row.id === entry.taskId && !row.archived);
    const item = task ? openInstance(state, task, entry.taskDay) : null;
    if (result === 'resumed' && item && !outcomes.includes(item.status)) {
      transition(state, task, entry.taskDay, 'start', now, { strategy: entry.strategy });
    }
    if (result === 'postponed' && item && !outcomes.includes(item.status)) {
      transition(state, task, entry.taskDay, 'defer', now, { delay: 15 });
    }
    entry.result = result;
    entry.endedAt = now.toISOString();
    const duration = Math.max(0, now.getTime() - Date.parse(entry.startedAt));
    if (result === 'resumed') award(state, entry, 'recovered', 3);
    event(state, 'recovery_result', now, { taskId: entry.taskId, result, duration, strategy: entry.strategy });
    return true;
  }
  return {
    KEY, STATUSES, outcomes, uid, dateKey, shiftDate, dueAt, timeOk, bounded, clean,
    createState, migrate, read, write, event, upsertTask, occurs, schedule, openInstance, isLegacyWakeTask,
    blocked, nextTask, transition, savePlan, beginRecovery, endRecovery, award,
  };
});
