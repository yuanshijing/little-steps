((root, factory) => {
  if (typeof module !== 'undefined') module.exports = factory(require('./model'));
  else root.PlanetScheduler = factory(root.Planet);
})(globalThis, P => {
  'use strict';
  const minute = 60000;
  function addNotice(state, entry, now) {
    if (entry.taskId && ['scheduled', 'followup'].includes(entry.kind)) {
      for (const previous of state.inbox) {
        if (previous.taskId === entry.taskId && previous.taskDay === entry.taskDay &&
            ['scheduled', 'followup'].includes(previous.kind)) previous.read = true;
      }
    }
    const notice = { ...entry, id: P.uid(), at: now.toISOString(), read: false };
    state.inbox.push(notice);
    P.event(state, entry.kind, now, { taskId: entry.taskId, taskDay: entry.taskDay, fromTaskId: entry.fromTaskId });
    return notice;
  }
  function addTransition(state, next, message, fromTaskId, now = new Date()) {
    const { task, item } = next;
    return addNotice(state, {
      kind: 'transition_prompt', title: '活动衔接', prompt: message,
      taskId: task.id, taskDay: item.day, fromTaskId,
    }, now);
  }
  function tick(state, now = new Date()) {
    const settings = state.settings;
    const time = now.getTime();
    const day = P.dateKey(now);
    if (!settings.remind || settings.pausedUntil > time ||
        (state.timer?.mode === 'deep' && state.timer.endsAt > time)) return null;
    const candidates = P.schedule(state, day);
    const previousDeferred = Object.values(state.instances).filter(item =>
      item.day < day && item.status === 'deferred' && P.dateKey(new Date(item.deferUntil)) === day);
    for (const item of previousDeferred) {
      const task = state.tasks.find(row => row.id === item.taskId && !row.archived);
      if (task) candidates.push({ task, item });
    }
    // Follow-ups begin from delivery. Old due tasks do not trigger a burst when the app opens late.
    const eligible = candidates.find(({ task, item }) => {
      if (!['pending', 'deferred'].includes(item.status) || item.acknowledged || P.blocked(state, task, item.day)) return false;
      if (item.noticeAt != null) {
        return item.followCount < P.bounded(settings.max, 0, 3, 2) &&
          time - item.noticeAt >= P.bounded(settings.follow, 1, 60, 15) * minute;
      }
      const due = item.deferUntil ?? P.dueAt(item.day, task.when);
      return time >= due && time - due < 30 * minute;
    });
    const plan = state.plans[day];
    if (plan && !plan.deliveredAt && (eligible || time >= P.dueAt(day, settings.nextDayTime))) {
      plan.deliveredAt = now.toISOString();
      const list = plan.items.map(row => row.when + ' ' + row.title + '｜' + row.firstStep);
      return addNotice(state, { kind: 'handoff', title: '昨晚确认的今日重点', list }, now);
    }
    if (!eligible) return null;
    const { task, item } = eligible;
    const follow = item.noticeAt != null;
    if (follow) item.followCount++;
    item.noticeAt = time;
    const intros = { brief: '请确认状态', gentle: '有空时看看这一件', active: '到点确认一下' };
    return addNotice(state, {
      kind: follow ? 'followup' : 'scheduled', taskId: task.id, taskDay: item.day,
      title: (follow ? '还有一步需要确认' : (intros[settings.style] ?? intros.active)) + ' · ' + task.title,
      prompt: task.category === 'leisure' ? '到计划结束时间了。可以先锁屏，把手机放到伸手够不到的地方。' :
        (task.firstStep ? '第一步：' + task.firstStep : '现在适合开始、延期，还是跳过？'),
    }, now);
  }
  function acknowledge(state, id, now = new Date()) {
    const notice = state.inbox.find(row => row.id === id);
    if (!notice || notice.read) return false;
    notice.read = true;
    const item = state.instances[notice.taskDay + '/' + notice.taskId];
    if (item) item.acknowledged = true;
    P.event(state, 'notice_acknowledged', now, { taskId: notice.taskId, taskDay: notice.taskDay });
    return true;
  }
  function startTimer(state, duration, mode, segments, now = new Date()) {
    if (state.timer && state.timer.endsAt > now.getTime()) throw new Error('请先结束当前计时');
    const first = P.bounded(duration, 10, 7200, 0);
    if (!first || !['simple', 'deep', 'segments'].includes(mode)) throw new Error('请输入 10 秒至 120 分钟的计时');
    const durations = Array.from({ length: mode === 'segments' ? P.bounded(segments, 2, 6, 2) : 1 }, () => first);
    state.timer = { mode, durations, index: 0, startedAt: now.getTime(), endsAt: now.getTime() + first * 1000 };
    P.event(state, 'timer_started', now, { mode });
    return state.timer;
  }
  function timerTick(state, now = new Date()) {
    const timer = state.timer;
    if (!timer || timer.endsAt > now.getTime()) return null;
    while (timer.endsAt <= now.getTime() && timer.index < timer.durations.length - 1) {
      timer.index++;
      timer.endsAt += timer.durations[timer.index] * 1000;
    }
    if (timer.endsAt > now.getTime()) return 'segment';
    state.timer = null;
    state.stars += 5;
    P.event(state, 'timer_finished', new Date(timer.endsAt), { mode: timer.mode });
    return 'finished';
  }
  return { tick, acknowledge, addTransition, startTimer, timerTick };
});
