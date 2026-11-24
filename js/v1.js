((root, factory) => {
  if (typeof module !== 'undefined') module.exports = factory(require('./model'), require('./v1-data'));
  else root.PlanetV1 = factory(root.Planet, root.PlanetV1Data);
})(globalThis, (P, catalog) => {
  'use strict';
  const { data, rewards } = catalog;
  const ids = ['wake', 'am', 'pm', 'check', 'dinner', 'bath', 'night', 'sleep'];
  const schedule = ['07:30', '09:00', '14:00', '16:00', '18:30', '20:00', '20:45', '22:45'];
  const work = ['am', 'pm', 'night'];
  const M = 60000;
  const intervals = { wake: 3, rise: 2, wash: 10, start: 5, switch: 5, returning: 5, bedtime: 5, unanswered: 15 };
  const star = { wake: '晨光星', am: '行动星', pm: '行动星', night: '行动星', bath: '效率星', sleep: '休憩星', return: '回归星' };
  const customOptions = [
    ['已经完成了', '收到，已经帮你记下这次完成。'],
    ['正在做', '继续做手头这一步，我稍后再确认。'],
    ['还没开始', '先准备好这件事要用的一样东西，就从这里开始。'],
    ['晚一点提醒我', '你想过多少分钟再确认？'],
    ['这次跳过', '这次先跳过，明天仍按你的设置提醒。'],
  ];
  const phases = {
    wash: ['洗漱进行得怎么样？', [['已经洗漱完成', '来准备早餐吧。'], ['正在洗漱', '慢慢来，我稍后确认。'], ['还没开始', '先走到洗手间。']]],
    breakfast: ['早餐进行得怎么样？', [['已经吃了', '看一下今天的重点，准备开始。'], ['正在吃', '先安心吃完。'], ['还没吃', '先准备一份简单的早餐。'], ['今天不吃早餐', '好，我们直接看今日重点。']]],
    rise: ['离床这一步进展怎么样？', data.rise.options],
    wakeCare: ['如果身体不舒服，可以暂停。现在你想怎么安排？', [['我需要暂停监督', '好，先照顾自己。'], ['可以先坐起来', '把双脚靠近床边。']]],
    barrier: ['现在最难的是哪一步？', data.barrier.options],
    begin: ['先做一个最小动作。现在可以开始了吗？', [['已经开始', '启动成功，按自己的节奏继续。'], ['还没有开始', '让我看看哪里卡住了。'], ['需要调整安排', '说说你的安排，稍后再确认。']]],
    sustain: ['只在你方便时确认实际专注时长。', [['我已连续专注', '已记录。'], ['还在专注', '我先不打扰你。'], ['已经中断', '我们可以从现在重新找方向。'], ['我已收尾', '已记录收尾。']]],
    wrap: ['现在可以收尾了吗？', [['已经收尾', '把下一步记下来，去吃饭吧。'], ['还没收尾', '我们约一个下次确认时间。']]],
    detour: ['是什么把注意力带走了？', data.detour.options],
    back: ['刚才我们说好要回到原来的任务，现在怎么样？', [['已经回到原任务', '欢迎回来！'], ['正在切换，还没有完成', '只打开原任务的页面。'], ['还是没能停下来', '我们再看看现在卡在哪里。'], ['我需要调整计划', '给自己一个新的可行时间。']]],
    backHold: ['如果你持续做了一小段，可以回来确认。', [['我已持续回到原任务', '这次回归有了实际进展。'], ['这次只回归了一会儿', '能回归已经值得记录。']]],
    afterDinner: ['晚饭后你现在在哪里？', [...data.afterDinner.options, ['我是在家吃饭', '可以直接准备洗澡。']]],
    homeCheck: ['你现在已经回来了吗？', [['已经回来了', '回来啦。我们准备洗澡。'], ['正在回家的路上', '约一个到家时间。'], ['还在散步', '你想什么时候再确认？'], ['临时有其他安排', '我们重新约一个时间。']]],
    bathTimer: ['先在下方选好模式，开启计时器，再开始洗浴。', [['已经全部完成', '来记录一下结果。'], ['还在做其他事', '可以约一个时间再提醒。']]],
    bathResult: ['洗澡和整理进行得怎么样？', data.bathResult.options],
    sleepBarrier: ['是什么让现在的收尾有点困难？', data.sleepBarrier.options],
    bedtime: ['现在的准备进展怎么样？', [['已放下手机并上床', '晚安，把剩下的事交给明天。'], ['正在洗漱或收尾', '接下来只做一个必要步骤。'], ['我已躺下，今天跳过详细复盘', '可以直接休息。']]],
    recovery: ['你现在遇到了什么情况？', [['一直在刷手机', '先关掉当前页面。'], ['被新的想法吸引了', '把想法保存到灵感暂存。'], ['陷入情绪或反复思考', '先承认这份感受，再写下一个可以暂放的问题。'], ['不知道该做什么', '先找到原来要推进的一个问题。'], ['知道该做什么，但无法开始', '只打开原来那项任务的材料。']]],
  };
  function init(state) {
    return state.v1 ??= {
      settings: { times: Object.fromEntries(ids.map((id, index) => [id, { time: schedule[index], enabled: true }])),
        intervals: { ...intervals }, basic: 10, advanced: 20, wakeLimit: 10, startLimit: 15, focusMin: 10,
        sleepLimit: 10, returnLimit: 10, returnMin: 5, weekDay: 0, weekTime: '14:00', sound: true, memory: true,
        wrapTimes: { am: '11:50', pm: '18:15' } },
      records: {}, events: [], active: null, queue: [], messages: [], points: {}, usedQuotes: [],
      quoteByWeek: {}, preferences: {}, customQuotes: [], ideas: [], memory: [], timer: null,
      timers: [], achievements: {}, reviews: {}, weekly: {}, rewardHistory: [],
    };
  }
  function monday(day) {
    const offset = (new Date(day + 'T12:00:00').getDay() + 6) % 7;
    return P.shiftDate(day, -offset);
  }
  const isCustom = (v, id) => typeof id === 'string' && id.startsWith('custom-') && Object.hasOwn(v.settings.times, id);
  const allReminderIds = v => [...ids, ...Object.keys(v.settings.times).filter(id => isCustom(v, id))];
  const reminderIds = v => allReminderIds(v).filter(id => !v.settings.times[id].removed);
  const title = (v, id) => isCustom(v, id) ? v.settings.times[id].title : id === 'return' ? '偏航回归' : data[id]?.title;
  function chooseQuote(v, day, replace = false) {
    const week = monday(day);
    const pool = [...catalog.quotes, ...v.customQuotes].filter(q => !['hidden', 'dislike'].includes(v.preferences[q.id]));
    const previous = v.quoteByWeek[week];
    const planned = pool.find(q => q.id === v.scheduledQuotes?.[week]);
    if (planned) {
      v.quoteByWeek[week] = planned.id;
      if (!v.usedQuotes.includes(planned.id)) v.usedQuotes.push(planned.id);
      return planned;
    }
    if (!pool.length) { delete v.quoteByWeek[week]; return null; }
    const current = pool.find(q => q.id === previous);
    if (current && !replace) return current;
    let available = pool.filter(q => !v.usedQuotes.includes(q.id));
    if (!available.length) { v.usedQuotes = []; available = pool; }
    if (available.length > 1) available = available.filter(q => q.id !== previous);
    const selected = available.find(q => v.preferences[q.id] === 'favorite') ?? available[0];
    v.quoteByWeek[week] = selected.id;
    v.usedQuotes.push(selected.id);
    return selected;
  }
  function record(v, day, id) {
    const key = day + '/' + id;
    return v.records[key] ??= { key, day, id, status: '待执行',
      planned: v.settings.times[id] ? P.dueAt(day, v.settings.times[id].time) : null, history: [], points: 0 };
  }
  function event(v, type, now, payload = {}) {
    v.events.push({ type, at: now.getTime(), day: P.dateKey(now), ...payload });
  }
  function message(v, text, role = 'coach', detail = {}) { v.messages.push({ role, text, ...detail }); }
  function planText(state, day, night = false) {
    const confirmed = state.plans[day]?.items;
    const rows = confirmed?.length ? confirmed : P.schedule(state, day).filter(({item, task}) =>
      !P.outcomes.includes(item.status) && (!night || task.minutes <= 20))
      .map(({ task }) => ({ ...task, firstStep: task.firstStep || '打开相关材料' }));
    return rows.slice().sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1)).slice(0, 3)
      .map(row => row.title + '（' + (['', '高', '普通', '低'][row.priority] || '重点') + '） · 第一步：' + row.firstStep).join('\n');
  }
  function open(state, id, now = new Date(), source = 'manual') {
    const v = init(state);
    const day = P.dateKey(now);
    if (!ids.includes(id) && !isCustom(v, id) && id !== 'return') return false;
    if (v.settings.times[id]?.removed) return false;
    const item = record(v, day, id);
    if (source !== 'manual' && (item.status !== '待执行' || !v.settings.times[id]?.enabled)) return false;
    if (v.active?.id === id && v.active.day === day) return false;
    if (item.completedAt && id !== 'return' && !work.includes(id)) return false;
    if (id === 'return' && v.rewardHistory.some(row => row.id === 'return' && now.getTime() - row.at < M)) {
      message(v, '不久前的回归已记录。可以先继续刚才重新开始的任务。');
      return true;
    }
    const passive = v.active && ['sustain', 'wrap', 'backHold'].includes(v.active.stage);
    if (source !== 'manual' && v.active && !passive) {
      if (!v.queue.some(entry => entry.id === id && entry.day === day)) v.queue.push({ id, day, source });
      return true;
    }
    if (v.active) park(v, '暂时延迟');
    if (id === 'return') {
      const key = day + '/return';
      if (item.completedAt) {
        const it = { ...item, key: key + '/' + P.uid(), completedAt: null, startedAt: null, status: '待执行', history: [], points: 0 };
        v.records[it.key] = it;
        return activate(state, it, now, source);
      }
    } else if (item.completedAt) {
      v.active = { id, key: item.key, day, stage: 'sustain', due: null, attempts: 0, revision: P.uid() };
      message(v, '你已确认启动。可以补充实际专注时长或确认收尾。');
      return true;
    }
    return activate(state, item, now, source);
  }
  function activate(state, item, now, source) {
    const v = init(state);
    item.status = '待回复';
    item.remindedAt = now.getTime();
    v.active = { id: item.id, key: item.key, day: item.day, stage: item.id === 'return' ? 'recovery' : 'initial',
      due: now.getTime() + v.settings.intervals.unanswered * M, attempts: 0, revision: P.uid() };
    const intro = isCustom(v, item.id) ? '我们来确认一下「' + title(v, item.id) + '」。现在做到哪一步了？'
      : item.id === 'return' ? phases.recovery[0] : data[item.id].intro.split('\n复用')[0];
    const quote = item.id === 'wake' ? chooseQuote(v, item.day)?.lines.join('\n') : '';
    const list = ['wake', 'am', 'night'].includes(item.id) ? planText(state, item.day, item.id === 'night') : '';
    message(v, [intro, quote, list].filter(Boolean).join('\n\n'), 'coach', {source, at:now.getTime()});
    if (item.id === 'sleep') promptReview(v, 'daily', item.day, now);
    event(v, 'reminder', now, { id: item.id, key: item.key, source });
    return true;
  }
  function park(v, status) {
    const item = v.records[v.active?.key];
    if (item && !item.completedAt) item.status = status;
    v.active = null;
  }
  function promptReview(v, kind, day, now) {
    const prompts = v.reviewPrompts ??= {};
    const key = kind + '/' + (kind === 'weekly' ? monday(day) : day);
    if (prompts[key] || (kind === 'daily' && v.reviews[day])) return;
    prompts[key] = {kind, day, at:now.getTime(), pending:true};
    const text = kind === 'daily'
      ? '睡前复盘时间到了。今天有哪一步值得记下来？也可以说说哪里卡住了，或者今晚先休息。'
      : '到每周复盘时间了。这周哪一种做法最帮得上你？我们可以一起看看任务完成情况和偏航记录。';
    message(v, text, 'coach', {source:'review', at:now.getTime()});
    return true;
  }
  function startReview(v,key) {
    const row = v.reviewPrompts?.[key];
    if (!row?.pending || v.reviewSession === key) return false;
    v.reviewSession = key;
    message(v, row.kind === 'daily' ? '开始睡前复盘' : '开始每周复盘', 'you');
    message(v, row.kind === 'daily' ? '用一两句话说说今天做到了什么，或者哪一步最难。'
      : '这周有没有哪一次，你发现某种做法特别有帮助？也可以说说反复遇到的障碍。');
    return true;
  }
  function finishReview(v,key) {
    if (v.reviewPrompts?.[key]) v.reviewPrompts[key].pending = false;
    if (v.reviewSession === key) v.reviewSession = null;
  }
  function go(v, stage, now, delay, extra = {}) {
    Object.assign(v.active, { stage, attempts: 0, due: delay == null ? null : now.getTime() + delay * M,
      revision: P.uid(), ...extra });
  }
  function options(v) {
    const a = v.active;
    if (!a) return [];
    if (a.stage === 'initial') return isCustom(v, a.id) ? customOptions : data[a.id].options;
    if (a.stage === 'wait') return [['事情已经结束', '我们继续下一步。'], ['仍在进行', '重新约定时间。']];
    return phases[a.stage]?.[1] ?? [];
  }
  function taskCompleted(v, item, now) {
    if (!item.completedAt) item.completedAt = now.getTime();
    item.status = item.level === 2 ? '完成得很好' : '已完成';
  }
  function grant(state, item, level, now) {
    const v = init(state);
    if (!star[item.id] || (item.level || 0) >= level) return 0;
    const bonus = level === 1 ? v.settings.basic : Math.max(0, v.settings.advanced - (item.points || 0));
    item.level = level;
    item.points += bonus;
    taskCompleted(v, item, now);
    state.stars += bonus;
    const lines = rewards[item.id][level - 1];
    const previous = v.rewardHistory.filter(row => row.id === item.id && row.level === level).slice(-2).map(row => row.text);
    const pool = lines.filter(line => !previous.includes(line));
    const text = (pool.length ? pool : lines)[Math.floor(Math.random() * (pool.length || lines.length))];
    const award = { id: item.id, key: item.key, day: item.day, level, text, bonus, star: star[item.id], at: now.getTime() };
    v.rewardHistory.push(award);
    message(v, text + ' ⭐ +' + bonus + ' · ' + award.star);
    achievements(state, now);
    return bonus;
  }
  function startReward(state, item, now) {
    item.startedAt ??= now.getTime();
    grant(state, item, 1, now);
  }
  function handoff(state, id, now) {
    park(init(state), '未记录');
    open(state, id, now, 'transition');
  }
  function waitFor(v, resume, now) {
    go(v, 'wait', now, v.settings.intervals.switch, { resume });
    message(v, '你可以在下面约定下次确认的时间。');
  }
  function detour(v, item, now) {
    if (!item.detourAt || item.backAt) {
      item.detourAt = now.getTime();
      item.backAt = null;
      item.returnKey = null;
    }
    if (!item.completedAt) item.status = '偏航';
    go(v, 'detour', now, v.settings.intervals.returning);
  }
  function returned(state, item, now) {
    const v = init(state);
    item.backAt = now.getTime();
    const rewardItem = item.id === 'return' ? item : {
      key: item.key + '/return/' + (item.detourAt ?? now.getTime()), day: item.day,
      id: 'return', status: '已回归', points: 0, history: [], detourAt: item.detourAt ?? now.getTime(),
    };
    rewardItem.strategy = item.strategy;
    rewardItem.barrier = item.barrier;
    rewardItem.backAt = item.backAt;
    v.records[rewardItem.key] = rewardItem;
    item.returnKey = rewardItem.key;
    if (item.id !== 'return') taskCompleted(v, item, now);
    grant(state, rewardItem, 1, now);
    event(v, 'return', now, { key: rewardItem.key, barrier: item.barrier, strategy: item.strategy });
    go(v, 'backHold', now, null);
  }
  function choose(state, revision, index, now = new Date()) {
    const v = init(state);
    const a = v.active;
    const choice = options(v)[index];
    if (!a || a.revision !== revision || !choice) return false;
    const item = v.records[a.key];
    item.history.push({ at: now.getTime(), stage: a.stage, response: choice[0] });
    if (!item.completedAt) item.status = '准备执行';
    const before = v.rewardHistory.length;
    message(v, choice[0], 'you');
    message(v, choice[1]);
    const s = v.settings;
    const f = (stage, minutes, extra) => go(v, stage, now, minutes, extra);
    const defer = (resume = a.stage) => waitFor(v, resume, now);
    const finishWake = (stage) => {
      startReward(state, item, now);
      if (!item.backInBed && now.getTime() <= item.planned + s.wakeLimit * M) grant(state, item, 2, now);
      if (stage === 'done') handoff(state, 'am', now);
      else f(stage, stage === 'wash' ? s.intervals.wash : s.intervals.switch);
    };
    const finishBed = () => {
      startReward(state, item, now);
      if (now.getTime() <= item.planned + s.sleepLimit * M) grant(state, item, 2, now);
      park(v, '已完成');
    };
    switch (a.stage) {
      case 'initial':
        if (isCustom(v, a.id)) {
          if (index === 0) { taskCompleted(v, item, now); park(v, '已完成'); }
          else if (index === 1 || index === 2) f('initial', s.intervals.start);
          else if (index === 3) defer('initial');
          else park(v, '主动跳过');
        } else if (a.id === 'wake') {
          if ([0, 4, 5].includes(index)) finishWake({ 0: 'wash', 4: 'breakfast', 5: 'done' }[index]);
          else { if (index === 2) item.backInBed = true; f('rise', s.intervals.wake); }
        } else if (work.includes(a.id)) {
          if (index === 0) { startReward(state, item, now); f('sustain', null); }
          else if (index === 1) f('begin', s.intervals.start);
          else if ((a.id === 'am' && index === 3) || index === 4 && a.id !== 'am' && a.id !== 'night') f('barrier', s.intervals.start);
          else if (a.id === 'night' && index === 4) park(v, '主动跳过');
          else defer('initial');
        } else if (a.id === 'check') {
          if (index === 0) { taskCompleted(v, item, now); park(v, '已完成'); }
          else if (index === 3) defer('initial');
          else if (index === 4) f('barrier', s.intervals.start);
          else detour(v, item, now);
        } else if (a.id === 'dinner') {
          if (index === 0) { taskCompleted(v, item, now); f('afterDinner', s.intervals.switch); }
          else defer('initial');
        } else if (a.id === 'bath') {
          if (index === 1) f('bathResult', s.intervals.switch);
          else if (index === 0 || index === 2) f('bathTimer', null);
          else defer('initial');
        } else if (index === 3) {
          f('bedtime', null);
          message(v, '如果手机已经放下，可以直接确认睡前准备；也可以跳过详细复盘。');
        } else if (index === 4) f('sleepBarrier', s.intervals.bedtime);
        else f('bedtime', s.intervals.bedtime);
        break;
      case 'rise':
        if (index === 2) finishWake('wash');
        else if (index === 3) f('wakeCare', s.intervals.rise);
        else f('rise', s.intervals.rise);
        break;
      case 'wakeCare':
        if (!index) { state.settings.pausedUntil = now.getTime() + 60 * M; park(v, '暂时延迟'); }
        else f('rise', s.intervals.rise);
        break;
      case 'wash':
        f(index === 0 ? 'breakfast' : 'wash', index === 0 ? s.intervals.switch : s.intervals.wash);
        break;
      case 'breakfast':
        if ([0, 3].includes(index)) handoff(state, 'am', now);
        else f('breakfast', s.intervals.switch);
        break;
      case 'barrier':
        item.barrier = choice[0]; item.strategy = choice[1];
        event(v, 'barrier', now, { key: item.key, value: choice[0], source: '用户自述' });
        f('begin', s.intervals.start);
        break;
      case 'begin':
        if (index === 0 && work.includes(a.id)) { startReward(state, item, now); f('sustain', null); }
        else if (index === 0) { taskCompleted(v, item, now); park(v, '已完成'); }
        else if (index === 1) f('barrier', s.intervals.start);
        else defer('begin');
        break;
      case 'sustain':
        if (index === 0) {
          if (now.getTime() - item.startedAt < s.focusMin * M) { message(v, '持续时间还没到进阶标准，先安心专注。'); f('sustain', null); }
          else {
            if (item.startedAt <= item.planned + s.startLimit * M && !item.focusInterrupted) grant(state, item, 2, now);
            if (a.id === 'night') park(v, '已完成');
            else f('wrap', null);
          }
        } else if (index === 1) f('sustain', null);
        else if (index === 2) { item.focusInterrupted = true; detour(v, item, now); }
        else if (a.id === 'pm') handoff(state, 'dinner', now);
        else { if (a.id === 'am') message(v, '上午收尾啦。现在可以保存进度，出门吃午餐。'); park(v, '已完成'); }
        break;
      case 'wrap':
        if (index === 1) defer('wrap');
        else if (a.id === 'pm') handoff(state, 'dinner', now);
        else park(v, '已完成');
        break;
      case 'detour':
      case 'recovery':
        item.detourAt ??= now.getTime();
        item.barrier = choice[0]; item.strategy = choice[1];
        event(v, 'detour', now, { key: item.key, obstacle: choice[0], strategy: choice[1], source: '用户自述' });
        if (a.stage === 'detour' && index === 6) defer('back');
        else f('back', s.intervals.returning);
        break;
      case 'back':
        if (index === 0) returned(state, item, now);
        else if (index === 1) f('back', s.intervals.returning);
        else if (index === 2) detour(v, item, now);
        else defer('back');
        break;
      case 'backHold': {
        const rec = v.records[item.returnKey];
        if (index === 0 && now.getTime() - rec.backAt < s.returnMin * M) { message(v, '再保持一小段，达到持续时长后再确认。'); f('backHold', null); }
        else { if (index === 0 && rec.backAt - rec.detourAt <= s.returnLimit * M) grant(state, rec, 2, now); park(v, '已回归'); }
        break;
      }
      case 'afterDinner':
      case 'homeCheck':
        if (index === 0 || index === 4) handoff(state, 'bath', now);
        else defer('homeCheck');
        break;
      case 'bathTimer':
        if (index === 0) f('bathResult', null);
        else defer('initial');
        break;
      case 'bathResult':
        if (index === 0) {
          const timing = endTimer(v, now);
          startReward(state, item, now);
          if (timing?.key === item.key && timing.actual <= timing.target) grant(state, item, 2, now);
          const bedtime = P.dueAt(item.day, s.times.sleep.time);
          if (bedtime - now.getTime() >= 30 * M) handoff(state, 'night', now);
          else park(v, '已完成');
        } else if (index === 3) { item.barrier = '洗澡中断'; defer('bathResult'); }
        else f('bathResult', s.intervals.switch);
        break;
      case 'sleepBarrier':
        item.barrier = choice[0];
        f('bedtime', s.intervals.bedtime);
        break;
      case 'bedtime':
        if (index === 0) finishBed();
        else if (index === 1) f('bedtime', s.intervals.bedtime);
        else { v.reviews[item.day] ??= { skipped: true }; finishReview(v,'daily/'+item.day); park(v, '未记录'); }
        break;
      case 'wait':
        if (index === 0) {
          f(a.resume ?? 'initial', s.intervals.unanswered);
          message(v, phases[v.active.stage]?.[0] ?? data[a.id]?.intro ?? '现在怎么样了？');
        }
        else defer(a.resume);
        break;
    }
    return { award: v.rewardHistory.length > before ? v.rewardHistory.at(-1) : null };
  }
  function setFollow(v, minutes, now = new Date()) {
    if (!v.active || v.active.id === 'wake' || v.active.stage !== 'wait') return false;
    const delay = P.bounded(minutes, 1, 1440, 0);
    if (!delay) return false;
    v.active.due = now.getTime() + delay * M;
    v.active.attempts = 0;
    message(v, '好，' + delay + ' 分钟后我再来确认。');
    return true;
  }
  function agreeTime(v, now = new Date()) {
    if (!v.active || v.active.id === 'wake') return false;
    if (v.active.stage !== 'wait') waitFor(v, v.active.stage, now);
    return true;
  }
  function tick(state, now = new Date()) {
    const v = init(state);
    const time = now.getTime();
    const day = P.dateKey(now);
    let changed = false;
    if (v.active && v.active.day !== day && !v.timer && !(v.active.due >= time - M)) { park(v, '未记录'); changed = true; }
    if (v.timer?.runningSince != null && elapsed(v.timer, time) >= v.timer.target && !v.timer.alerted) {
      v.timer.alerted = true;
      if (v.active?.id === 'bath' && v.active.key === v.timer.key) {
        go(v, 'bathResult', now, v.settings.intervals.unanswered);
        message(v, '目标计时已到。按自己的节奏完成，再确认实际结果。');
      }
      changed = true;
    }
    if (!state.settings.remind || state.settings.pausedUntil > time) return changed;
    const t = [now.getHours(), now.getMinutes()].map(x => String(x).padStart(2, '0')).join(':');
    const q = state.settings;
    const quiet = q.quiet && (q.quietStart <= q.quietEnd ? t >= q.quietStart && t < q.quietEnd : t >= q.quietStart || t < q.quietEnd);
    if (state.timer?.mode === 'deep' && state.timer.endsAt > time) return changed;
    const a = v.active;
    if ((!quiet || ['wake', 'sleep'].includes(a?.id)) && a?.due != null && time >= a.due) {
      if (a.attempts >= 2) park(v, '未记录');
      else {
        a.attempts++;
        if (a.stage === 'wait') a.stage = a.resume ?? 'initial';
        a.due = time + v.settings.intervals.unanswered * M;
        message(v, (phases[a.stage]?.[0] ?? '现在怎么样了？可以选一个当前状态。'));
        event(v, 'followup', now, { key: a.key, attempts: a.attempts });
      }
      changed = true;
    }
    const active = v.active;
    if (!quiet && active?.stage === 'sustain' && ['am', 'pm'].includes(active.id)) {
      const wrap = v.settings.wrapTimes?.[active.id];
      if (P.timeOk(wrap) && t >= wrap && !v.records[active.key].wrapPromptAt) {
        v.records[active.key].wrapPromptAt = time;
        go(v, 'wrap', now, v.settings.intervals.unanswered);
        message(v, '到了约定的收尾时间。现在可以结束这段工作了吗？');
        changed = true;
      }
    }
    const week = monday(day);
    if (!quiet && now.getDay() === v.settings.weekDay && t >= v.settings.weekTime && !v.weekly[week]) {
      const report = weekly(v, day);
      v.weekly[week] = report;
      promptReview(v, 'weekly', day, now);
      changed = true;
    }
    v.queue = v.queue.filter(row => row.day === day && v.settings.times[row.id]?.enabled && !v.settings.times[row.id].removed &&
      time - P.dueAt(day, v.settings.times[row.id].time) < 60 * M);
    if (!quiet && (!v.active || ['sustain','wrap','backHold'].includes(v.active.stage)) && v.queue.length) {
      const next = v.queue.shift();
      changed = open(state, next.id, now, next.source) || changed;
    }
    for (const id of reminderIds(v)) {
      const setting = v.settings.times[id];
      const due = P.dueAt(day, setting.time);
      if ((!quiet || ['wake', 'sleep'].includes(id)) && setting.enabled && time >= due && time < due + 30 * M && !v.queue.some(row => row.id === id && row.day === day)) {
        changed = open(state, id, now, 'schedule') || changed;
      }
    }
    const sleep = v.settings.times.sleep;
    const sleepDue = P.dueAt(day,sleep.time);
    if (sleep.enabled && !sleep.removed && time >= sleepDue && time < sleepDue + 30*M) {
      changed = Boolean(promptReview(v,'daily',day,now)) || changed;
    }
    return changed;
  }
  const elapsed = (timer, time) => timer.elapsed + (timer.runningSince == null ? 0 : Math.max(0, time - timer.runningSince));
  function timerAction(v, type, mode, custom, now = new Date()) {
    const time = now.getTime();
    if (type === 'start' && !v.timer) {
      if (v.active?.id !== 'bath') return false;
      const stages = mode === 'combined' ? [30, 10] : mode === 'custom' ? [P.bounded(custom, 1, 180, 20)] : [20];
      v.timer = { key: v.active.key, stages, target: stages.reduce((a, b) => a + b, 0) * M,
        elapsed: 0, runningSince: time, startedAt: time, alerted: false };
      v.active.due = null;
      return true;
    }
    if (!v.timer) return false;
    if (type === 'pause' && v.timer.runningSince != null) {
      v.timer.elapsed = elapsed(v.timer, time); v.timer.runningSince = null; return true;
    }
    if (type === 'resume' && v.timer.runningSince == null) { v.timer.runningSince = time; return true; }
    if (type === 'end') {
      endTimer(v, now);
      if (v.active?.id === 'bath') go(v, 'bathResult', now, v.settings.intervals.unanswered);
      return true;
    }
    return false;
  }
  function endTimer(v, now) {
    if (v.timer) {
      const timing = v.timer;
      v.timers.push({ key: timing.key, target: timing.target, actual: elapsed(timing, now.getTime()),
        at: now.getTime(), startedAt: timing.startedAt });
      v.timer = null;
    }
    return v.timers.findLast(row => row.key === v.active?.key) ?? null;
  }
  function dailyRows(v, day) {
    return allReminderIds(v).map(id => {
      const row = v.records[day + '/' + id];
      if (!row && v.settings.times[id].removed) return null;
      if (isCustom(v, id) && !row && v.settings.times[id].addedDay > day) return null;
      const status = ['待执行', '待回复', '已提醒'].includes(row?.status) ? '未记录' : row?.status ?? '未记录';
      return {title:title(v,id),status,completedAt:row?.completedAt};
    }).filter(Boolean);
  }
  function dailyText(v, day) {
    const time = stamp => new Date(stamp).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
    return dailyRows(v, day).map(row => row.title + ' · ' + row.status + (row.completedAt ? ' ' + time(row.completedAt) : '')).join('\n');
  }
  function weekly(v, day) {
    const first = P.shiftDate(day, -6);
    const records = Object.values(v.records).filter(row => row.day >= first && row.day <= day);
    const stats = allReminderIds(v).map(id => {
      const added = v.settings.times[id].addedDay;
      const entries = records.filter(row => row.id === id);
      const period = v.settings.times[id].removed ? entries.length : !added || added <= first ? 7
        : Array.from({length:7}, (_, index) => P.shiftDate(first,index)).filter(day => day >= added).length;
      if (!period) return null;
      const completed = entries.filter(row => row.completedAt).length;
      const skipped = entries.filter(row => row.status === '主动跳过').length;
      const incomplete = entries.filter(row => row.status === '未完成').length;
      return { id, completed, advanced: entries.filter(row => row.level === 2).length, skipped, incomplete,
        missing: period - completed - skipped - incomplete, rate: completed + incomplete ? completed / (completed + incomplete) : null };
    }).filter(Boolean);
    const cases = v.events.filter(row => row.day >= first && row.day <= day && row.type === 'detour').slice(-12).map(row => ({
      ...row, outcome: records.find(record => record.key === row.key)?.backAt >= row.at ? '已确认回归' : '未确认回归',
    }));
    const delays = records.filter(row => work.includes(row.id) && row.startedAt != null)
      .map(row => Math.max(0, (row.startedAt - row.planned) / M));
    const durations = v.timers.filter(row => row.key.slice(0, 10) >= first && row.key.slice(0, 10) <= day).map(row => row.actual / M);
    const priorDay = P.shiftDate(first, -1);
    const priorStart = P.shiftDate(priorDay, -6);
    const previous = Object.values(v.records).filter(row => work.includes(row.id) && row.day >= priorStart && row.day <= priorDay && row.startedAt != null);
    const minutes = stamp => new Date(stamp).getHours() * 60 + new Date(stamp).getMinutes();
    const counts = new Map();
    for (const row of cases) counts.set(row.obstacle, (counts.get(row.obstacle) ?? 0) + 1);
    const common = [...counts].sort((a, b) => b[1] - a[1])[0];
    return { stats, cases, delays, durations,
      wakeTimes: records.filter(r => r.id === 'wake' && r.completedAt).map(r => minutes(r.completedAt)),
      bedTimes: records.filter(r => r.id === 'sleep' && r.completedAt).map(r => minutes(r.completedAt)),
      previousDelays: previous.map(r => Math.max(0, (r.startedAt - r.planned) / M)),
      returns: records.filter(row => row.id === 'return' && row.completedAt).length,
      strategies: [...new Set(cases.filter(row => row.outcome === '已确认回归').map(row => row.strategy))],
      suggested: common ? ['遇到「' + common[0] + '」时，先尝试这次记录中的一个小动作。'] : [] };
  }
  function achievements(state, now) {
    const v = init(state);
    const day = P.dateKey(now);
    const records = Object.values(v.records);
    const count = (id, level) => records.filter(row => (id === row.id || id === 'work' && work.includes(row.id)) && (row.level ?? 0) >= level).length;
    const earned = [['晨间小达人', count('wake', 2) >= 7, 30], ['行动启动大师', count('work', 2) >= 10, 30],
      ['时间掌控者', count('bath', 2) >= 7, 30], ['月光守护者', count('sleep', 2) >= 7, 30],
      ['轨道修复大师', count('return', 1) >= 10, 50],
      ['闪耀的一天', Object.keys(star).filter(id => id !== 'return').every(id => v.records[day + '/' + id]?.level >= 1), 30],
      ['闪耀节奏', Object.keys(star).filter(id => id !== 'return').every(id => v.records[day + '/' + id]?.level >= 2), 50],
      ['成长中的星球', Object.values(v.reviews).filter(r => !r.skipped).length >= 30, 100]];
    for (const [name, unlocked, points] of earned) {
      if (!unlocked || v.achievements[name]) continue;
      v.achievements[name] = day; state.stars += points;
      message(v, '解锁「' + name + '」 ⭐ +' + points);
    }
  }
  function free(state, input, now = new Date()) {
    const v = init(state);
    const text = P.clean(input, 500);
    if (!text) return null;
    message(v, text, 'you');
    if (/自杀|不想活|伤害自己|伤害别人|结束生命/.test(text)) {
      state.settings.pausedUntil = now.getTime() + 60 * M;
      park(v, '暂时延迟');
      message(v, '你的安全比计划重要。如果你或他人可能马上受伤，请立即联系当地急救服务，并请身边可信任的人来陪你。现在可以先去有人陪伴的地方。');
      return 'urgent';
    }
    if (/暂停|不想被提醒|停止监督/.test(text)) {
      state.settings.pausedUntil = now.getTime() + 60 * M;
      message(v, '已暂停监督一小时，你可以随时恢复。');
      return 'local';
    }
    const reviewKey = v.reviewSession;
    const review = v.reviewPrompts?.[reviewKey];
    const today = P.dateKey(now);
    const currentReview = review?.kind === 'daily' ? review.day === today
      : review && monday(review.day) === monday(today);
    if (review?.pending && currentReview) {
      if (review.kind === 'daily') {
        v.reviews[review.day] = {note:text,summary:dailyText(v,review.day)};
        achievements(state,now);
      } else {
        (v.weekNotes ??= {})[review.day] = text;
      }
      finishReview(v,reviewKey);
      message(v,'已把你这段反馈记进复盘。你可以打开对应的复盘查看总结。');
      return 'local';
    }
    const a = v.active;
    const delay = text.match(/(\d{1,4})\s*分钟/);
    if (delay && a?.stage === 'wait' && setFollow(v, Number(delay[1]), now)) return 'local';
    if (a) {
      v.records[a.key].history.push({ at: now.getTime(), stage: a.stage, response: text });
      a.attempts = 0;
      if (a.due != null) a.due = now.getTime() + v.settings.intervals.unanswered * M;
    }
    const emotion = /难受|焦虑|沮丧|心烦|失败|烂透|完蛋|一无是处|生气|难过/.test(text);
    const bedtime = a?.id === 'sleep';
    const fallback = emotion ? (bedtime
      ? '听起来这件事让你很不好受。先把最挂念的一句话写下来，剩下的明天再看。'
      : '听起来你卡在一种很难受的感受里。试着写下刚才实际发生的一件事，先把它和对自己的评价分开。')
      : a?.id === 'wake' ? '先把上半身坐起来，做得到就只做这一步。'
        : '我记下了。先选一个现在做得到的动作，或者用下方选项确认状态。';
    message(v, fallback);
    event(v, emotion ? 'emotion' : 'free_reply', now, { key: a?.key, source: '用户自述' });
    return 'fallback';
  }
  return { ids, intervals, star, data, phases, init, monday, chooseQuote, isCustom, reminderIds, allReminderIds, title, record, message, open, options, choose, park,
    tick, startReview, finishReview, setFollow, agreeTime, elapsed, timerAction, dailyRows, dailyText, weekly, achievements, free, planText, catalog };
});
