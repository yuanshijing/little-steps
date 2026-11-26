((root, factory) => {
  if (typeof module !== 'undefined') module.exports = factory(require('./model'), require('./v1-data'));
  else root.PlanetV1 = factory(root.Planet, root.PlanetV1Data);
})(globalThis, (P, catalog) => {
  'use strict';
  const { data, rewards, phases, customOptions } = catalog;
  const ids = ['wake', 'am', 'pm', 'check', 'dinner', 'bath', 'night', 'sleep'];
  const schedule = ['07:30', '09:00', '14:00', '16:00', '18:30', '20:00', '20:45', '22:45'];
  const work = ['am', 'pm', 'night'];
  const M = 60000;
  const transitions = {wake:'am',am:'pm',pm:'dinner',dinner:'bath',bath:'night',night:'sleep'};
  const intervals = { wake: 3, rise: 2, wash: 10, start: 5, switch: 5, returning: 5, bedtime: 5, unanswered: 15 };
  const star = { wake: '晨光星', am: '行动星', pm: '行动星', night: '行动星', bath: '效率星', sleep: '休憩星', return: '回归星' };
  const dialogueVersion = 3;
  function init(state) {
    const v = state.v1 ??= {
      settings: { times: Object.fromEntries(ids.map((id, index) => [id, { time: schedule[index], enabled: true }])),
        intervals: { ...intervals }, basic: 10, advanced: 20, wakeLimit: 10, startLimit: 15, focusMin: 10,
        sleepLimit: 10, returnLimit: 10, returnMin: 5, weekDay: 0, weekTime: '14:00', sound: true, memory: true,
        wrapTimes: { am: '11:50', pm: '18:15' } },
      records: {}, events: [], active: null, queue: [], messages: [], points: {}, usedQuotes: [],
      quoteByWeek: {}, preferences: {}, customQuotes: [], ideas: [], memory: [], timer: null,
      timers: [], achievements: {}, reviews: {}, weekly: {}, rewardHistory: [],
    };
    const a=v.active;
    if (a && a.dialogueVersion !== dialogueVersion) {
      a.stage=a.stage==='initial'||Object.hasOwn(phases,a.stage)?a.stage:'initial';
      if(a.id==='wake' && a.stage==='wait'){
        a.stage=v.records[a.key]?.completedAt?'morningProgress':'rise';
        a.due=null;
      }
      Object.assign(a,{revision:P.uid(),thread:P.uid(),dialogueVersion});
      delete a.fixedTrace;
      delete a.modelGuided;
    }
    return v;
  }
  function monday(day) {
    const offset = (new Date(day + 'T12:00:00').getDay() + 6) % 7;
    return P.shiftDate(day, -offset);
  }
  const isCustom = (v, id) => typeof id === 'string' && id.startsWith('custom-') && Object.hasOwn(v.settings.times, id);
  const allReminderIds = v => [...ids, ...Object.keys(v.settings.times).filter(id => isCustom(v, id))];
  const reminderIds = v => allReminderIds(v).filter(id => !v.settings.times[id].removed);
  function reminderTimeOrder(time) {
    if (!P.timeOk(time)) return Infinity;
    const [hours, minutes] = time.split(':').map(Number);
    return (hours*60 + minutes - 6*60 + 24*60) % (24*60);
  }
  function manualReminderOrder(v) {
    const order=v.settings.reminderOrder;
    if(!Array.isArray(order))return [];
    const visible=new Set(reminderIds(v));
    return [...new Set(order)].filter(id=>visible.has(id));
  }
  function displayReminderIds(v) {
    const timed=reminderIds(v).sort((a,b)=>reminderTimeOrder(v.settings.times[a].time)-reminderTimeOrder(v.settings.times[b].time));
    const manual=manualReminderOrder(v), positioned=new Set(manual);
    return [...manual,...timed.filter(id=>!positioned.has(id))];
  }
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
  function planText(state, day, night = false, timeBudget = Infinity, scene) {
    const confirmed = state.plans[day]?.items;
    const rows = confirmed?.length ? confirmed : P.schedule(state, day).filter(({item, task}) =>
      !P.isLegacyWakeTask(task) && !P.outcomes.includes(item.status) && (!night || task.minutes <= 20))
      .map(({ task }) => ({ ...task, firstStep: task.firstStep || '打开相关材料' }));
    return rows.filter(row=>row.title!=='离开床铺并洗漱' &&
      (!row.id || !P.outcomes.includes(state.instances[day+'/'+row.id]?.status)) &&
      (!scene || inWorkPeriod(init(state),scene,row.when)) &&
      (!night || !Number.isFinite(row.minutes) || row.minutes<=timeBudget))
      .sort((a,b)=>(a.priority ?? 1)-(b.priority ?? 1)).slice(0,3)
      .map(row => row.title + '（' + (['', '高', '普通', '低'][row.priority] || '重点') + '） · 第一步：' + row.firstStep).join('\n');
  }
  function inWorkPeriod(v,scene,time) {
    if(!work.includes(scene) || !P.timeOk(time))return true;
    const start=reminderTimeOrder(time), afternoon=reminderTimeOrder(v.settings.times.pm.time);
    const evening=reminderTimeOrder(v.settings.times.dinner.time);
    if(evening<=afternoon)return true;
    return (start<afternoon?'am':start<evening?'pm':'night')===scene;
  }
  function open(state, id, now = new Date(), source = 'manual') {
    const v = init(state);
    const day = P.dateKey(now);
    if (!ids.includes(id) && !isCustom(v, id) && id !== 'return') return false;
    if (v.settings.times[id]?.removed) return false;
    const item = record(v, day, id);
    const unansweredManual = source === 'schedule' && item.notifiedAt == null && !item.history.length &&
      ['暂时延迟','未记录'].includes(item.status) &&
      v.events.findLast(event=>event.type==='reminder' && event.key===item.key)?.source === 'manual';
    if (source !== 'manual' && ((!unansweredManual && item.status !== '待执行') || !v.settings.times[id]?.enabled)) return false;
    if (v.active?.id === id && v.active.day === day) return false;
    if (item.completedAt && id !== 'return' && !work.includes(id)) return false;
    if (id === 'return' && v.rewardHistory.some(row => row.id === 'return' && now.getTime() - row.at < M)) {
      message(v, '不久前的回归已记录。可以先继续刚才重新开始的任务。');
      return true;
    }
    const passive = v.active && ['sustain', 'wrap', 'backHold'].includes(v.active.stage);
    if (source !== 'manual' && v.active && !passive) {
      const queued = v.queue.find(entry => entry.id === id && entry.day === day);
      if (!queued) v.queue.push({ id, day, source });
      if (source === 'schedule' || queued?.source === 'schedule') announceScheduled(v,item,now);
      return true;
    }
    if (source === 'manual') v.queue = v.queue.filter(entry=>entry.id!==id || entry.day!==day);
    const usesOrigin = (id==='return' && v.active?.id!=='return') || (id==='check' && work.includes(v.active?.id));
    const originKey = usesOrigin ? v.active?.key : null;
    if (v.active) park(v, '暂时延迟');
    if (originKey) item.originKey=originKey;
    if (id === 'return') {
      const key = day + '/return';
      if (item.completedAt) {
        const it = {key:key+'/'+P.uid(),day,id,status:'待执行',history:[],points:0,originKey};
        v.records[it.key] = it;
        return activate(state, it, now, source);
      }
    } else if (item.completedAt) {
      v.active = { id, key: item.key, day, stage: 'sustain', due: null, attempts: 0, revision: P.uid(), thread: P.uid(), dialogueVersion };
      message(v, '你已确认启动。可以补充实际专注时长或确认收尾。');
      return true;
    }
    return activate(state, item, now, source);
  }
  function reminderText(state,v,item, now = new Date()) {
    const intro = isCustom(v, item.id) ? '我们来确认一下「' + title(v, item.id) + '」。现在做到哪一步了？'
      : item.id === 'return' ? phases.recovery.question : data[item.id].intro;
    const quote = item.id === 'wake' ? chooseQuote(v, item.day)?.lines.join('\n') : '';
    const timeBudget=item.id==='night'?bedMinutes(v,item.day,now):Infinity;
    const list=item.id==='night' && timeBudget<=10 ? '如果快到休息时间，只做必要的收尾。'
      : ['wake','am','pm','night'].includes(item.id) ? planText(state,item.day,item.id==='night',timeBudget,item.id) : '';
    return [intro, quote, list].filter(Boolean).join('\n\n');
  }
  function announceScheduled(v,item,now,queued = true) {
    if (item.notifiedAt != null) return false;
    item.notifiedAt = now.getTime();
    message(v, '「' + title(v,item.id) + '」的定时提醒到了。' + (queued ? '可以点下方按钮处理这条提醒。' : '可以在当前对话里回复。'),
      'coach', {source:'schedule',reminderId:item.id,at:item.notifiedAt});
    event(v,queued ? 'reminder_queued' : 'reminder',now,{id:item.id,key:item.key,source:'schedule'});
    return true;
  }
  function activate(state, item, now, source) {
    const v = init(state);
    item.status = '待回复';
    item.remindedAt = now.getTime();
    v.active = { id: item.id, key: item.key, day: item.day, stage: item.id === 'return' ? 'recovery' : 'initial',
      due: now.getTime() + v.settings.intervals.unanswered * M, attempts: 0, revision: P.uid(), thread: P.uid(), dialogueVersion };
    const alreadyAnnounced = source === 'schedule' && item.notifiedAt != null;
    if (source === 'schedule' && !alreadyAnnounced) item.notifiedAt = now.getTime();
    v.active.initialPrompt = reminderText(state,v,item,now);
    message(v, v.active.initialPrompt, 'coach', {source:alreadyAnnounced ? 'queued' : source,reminderId:item.id,at:now.getTime()});
    event(v, 'reminder', now, { id: item.id, key: item.key, source });
    return true;
  }
  function park(v, status) {
    const item = v.records[v.active?.key];
    if (item && !item.completedAt && !(item.backAt != null && ['未记录','暂时延迟'].includes(status))) item.status = status;
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
    message(v, text, 'coach', {source:'review',reviewKind:kind,at:now.getTime()});
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
      revision: P.uid(), prompt: null, ...extra });
  }
  function options(v) {
    const a = v.active;
    if (!a) return [];
    if (a.stage === 'initial') return isCustom(v,a.id) ? customOptions : data[a.id]?.options ?? [];
    const rows=phases[a.stage]?.options ?? [];
    if(a.stage==='otherActivity' && ['pm','night'].includes(a.id)) {
      const label=a.id==='pm'?'吃饭、午休或其他计划内活动':'洗澡、整理或其他计划内事项';
      return rows.map(row=>row.id==='necessary'?{...row,label}:row);
    }
    if(a.stage==='sleepReady' && v.reviews[a.day]) return rows.filter(row=>row.id==='ready');
    if(a.stage==='sleepInBed' && v.reviews[a.day]) {
      return rows.map(row=>row.id==='skip'?{...row,label:'今晚直接休息',next:'@bed'}:row);
    }
    return rows;
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
  function bedMinutes(v, day, now) {
    const s = v.settings.times.sleep;
    if (!s?.enabled || s.removed) return Infinity;
    let due = P.dueAt(day,s.time);
    if (s.time < '06:00' && now.getHours() >= 6) due = P.dueAt(P.shiftDate(day,1),s.time);
    return (due-now.getTime())/M;
  }
  function handoff(state, now) {
    const v = init(state), {id,day} = v.active;
    const nightIsLate = id==='bath' && bedMinutes(v,day,now)<30;
    const next = nightIsLate ? 'sleep' : transitions[id];
    park(v,'已完成');
    if (!next || P.dateKey(now)!==day) return;
    const setting=v.settings.times[next], existing=v.records[day+'/'+next];
    if (!setting?.enabled || setting.removed || (existing && existing.status!=='待执行')) return;
    const lead={am:15,pm:15,dinner:15,bath:60,night:30,sleep:30}[next];
    const left=next==='sleep'?bedMinutes(v,day,now):(P.dueAt(day,setting.time)-now.getTime())/M;
    if (left>lead) return;
    v.queue=v.queue.filter(row=>row.id!==next || row.day!==day);
    open(state,next,now,'transition');
  }
  function confirmedPlan(state, day) {
    return (state.plans[day]?.items ?? []).filter(row=>row.title!=='离开床铺并洗漱');
  }
  function actualTask(state,v,a) {
    const item=v.records[a.key];
    if (item.originalTask) return item.originalTask;
    const scene=v.records[item.originKey]?.id ?? a.id;
    if (!work.includes(scene) && !['check','return'].includes(scene)) return {title:title(v,scene)};
    const associated=P.schedule(state,a.day).find(({task,item})=>
      !P.isLegacyWakeTask(task) && ['active','interrupted'].includes(item.status));
    if (associated) return associated.task;
    const planned=confirmedPlan(state,a.day).filter(row=>
      inWorkPeriod(v,scene==='check'?'pm':scene,row.when) &&
      (!row.id || !P.outcomes.includes(state.instances[a.day+'/'+row.id]?.status)));
    return planned.length===1 ? planned[0] : null;
  }
  function modelContext(state,text) {
    const v=init(state),a=v.active,item=a && v.records[a.key],task=a && actualTask(state,v,a);
    const scenes=[a?.id,v.records[item?.originKey]?.id,'all'];
    const strategies=a ? v.events.filter(row=>row.type==='return').map(row=>v.records[row.key])
      .filter(row=>row?.strategy && (row.scene===a.id || row.barrier===item.barrier))
      .slice(-3).map(row=>row.strategy+'（已确认回归）') : [];
    if(item?.strategy) strategies.push(item.strategy+'（本次建议，效果待确认）');
    return {text,scene:a?.id ?? 'all',reminderId:a?.id,status:a?.stage ?? '',
      actualTask:task ? [task.title,task.firstStep].filter(Boolean).join(' · ') : '当前任务（名称未确认）',
      fixedTurns:a?.fixedTrace ?? [],userState:text,
      plan:a ? confirmedPlan(state,a.day).map(row=>[row.title,row.firstStep].filter(Boolean).join(' · ')).join('\n') : '',
      style:state.settings.style, strategies,
      recent:a?.thread ? v.messages.filter(row=>row.thread===a.thread).slice(-8) : v.messages.slice(-5),
      memories:v.settings.memory ? v.memory.filter(row=>scenes.includes(row.scene)).slice(-4) : []};
  }
  function waitFor(v,resume,now) {
    go(v,'wait',now,null,{resume});
  }
  function detour(state,v,item,now,stage) {
    if (!item.detourAt || item.backAt) {
      item.detourAt=now.getTime();
      item.backAt=null;
      item.returnKey=null;
      item.originalTask=actualTask(state,v,v.active);
      event(v,'interrupted',now,{key:item.key,source:'用户确认'});
    }
    if (!item.completedAt) item.status='偏航';
    go(v,stage,now,v.settings.intervals.returning);
  }
  function returned(state,item,now) {
    const v=init(state);
    item.backAt=now.getTime();
    if (!item.completedAt) item.status='已回归';
    const original=v.records[item.originKey];
    if (original) original.backAt=item.backAt;
    const rewardItem=item.id==='return' ? item : {
      key:item.key+'/return/'+(item.detourAt ?? now.getTime()),day:item.day,id:'return',
      status:'已回归',points:0,history:[],detourAt:item.detourAt ?? now.getTime(),
    };
    Object.assign(rewardItem,{strategy:item.strategy,barrier:item.barrier,scene:original?.id ?? item.id,backAt:item.backAt});
    v.records[rewardItem.key]=rewardItem;
    item.returnKey=rewardItem.key;
    grant(state,rewardItem,1,now);
    event(v,'return',now,{key:rewardItem.key,barrier:item.barrier,strategy:item.strategy});
    go(v,'backHold',now,null);
  }
  function choose(state,revision,optionId,now=new Date()) {
    const v=init(state),a=v.active;
    if (!a || a.revision!==revision) return false;
    const choice=options(v).find(row=>row.id===optionId);
    if (!choice) return false;
    const stage=a.stage,item=v.records[a.key],s=v.settings,task=actualTask(state,v,a);
    const [action,target]=choice.next.split(':');
    const reply=choice.reply.replace('{task}',()=>task?.title || '当前任务')
      .replace('{firstStep}',()=>task?.firstStep || '先打开当前任务需要的一份材料。');
    const question=a.prompt ?? (stage==='initial'?a.initialPrompt ?? reminderText(state,v,item):phases[stage]?.question ?? '');
    const trace=[...(a.fixedTrace ?? []),{stage,question,selection:choice.label,response:reply}].slice(0,2);
    a.fixedTrace=trace;
    item.history.push({at:now.getTime(),stage,response:choice.label});
    if (!item.completedAt && !['偏航','已回归'].includes(item.status)) item.status='准备执行';
    const detail={thread:a.thread,reminderId:a.id}, before=v.rewardHistory.length;
    message(v,choice.label,'you',detail);
    if (reply) message(v,reply,'coach',detail);
    const delays={rise:stage==='initial'?s.intervals.wake:s.intervals.rise,wash:s.intervals.wash,
      begin:s.intervals.start,barrier:s.intervals.start,back:s.intervals.returning,bedtime:s.intervals.bedtime};
    const advance=next=>go(v,next,now,delays[next]??null);
    function skipReview() {
      v.reviews[item.day] ??= {skipped:true};
      finishReview(v,'daily/'+item.day);
    }
    switch (action) {
      case '@wake':
        startReward(state,item,now);
        if (!item.backInBed && now.getTime()<=item.planned+s.wakeLimit*M) grant(state,item,2,now);
        advance('morningProgress'); break;
      case '@backInBed': item.backInBed=true; advance('rise'); break;
      case '@pause':
        state.settings.pausedUntil=now.getTime()+60*M;
        park(v,'暂时延迟'); break;
      case '@start':
        if (work.includes(a.id)) { startReward(state,item,now); advance('sustain'); }
        else { item.startedAt ??= now.getTime(); taskCompleted(v,item,now); park(v,'已完成'); }
        break;
      case '@focusTarget':
        if (!Number.isFinite(item.startedAt) || now.getTime()-item.startedAt<s.focusMin*M) message(v,'持续时间还没到进阶标准，先安心专注。');
        else {
          if (item.startedAt<=item.planned+s.startLimit*M && !item.focusInterrupted) grant(state,item,2,now);
          message(v,'已记录这段专注。');
        }
        advance('sustain'); break;
      case '@wrap':
        item.wrappedAt ??= now.getTime();
        if (a.id==='am') { advance('lunch'); message(v,'现在可以去吃午饭或按计划休息。'); }
        else handoff(state,now);
        break;
      case '@wait': waitFor(v,target,now); break;
      case '@stayWait': waitFor(v,a.resume,now); break;
      case '@resume': advance(a.resume ?? 'initial'); break;
      case '@barrier':
        item.barrier=choice.label; item.strategy=reply;
        event(v,'barrier',now,{key:item.key,value:choice.label,source:'用户自述'});
        advance(target); break;
      case '@detour':
        if (stage==='sustain') item.focusInterrupted=true;
        detour(state,v,item,now,target); break;
      case '@strategy':
        item.detourAt ??= now.getTime();
        item.originalTask ??= task;
        item.barrier=choice.label; item.strategy=reply;
        event(v,'detour',now,{key:item.key,obstacle:choice.label,strategy:reply,source:'用户自述'});
        advance('back'); break;
      case '@returned': returned(state,item,now); break;
      case '@returnTarget':
      case '@returnBrief': {
        const rec=v.records[item.returnKey];
        if (action==='@returnTarget' && rec && now.getTime()-rec.backAt<s.returnMin*M) {
          message(v,'已回归。达到目标时长后，再确认这段持续时间。');
          advance('backHold');
        } else {
          if (action==='@returnTarget' && rec && rec.backAt-rec.detourAt<=s.returnLimit*M) grant(state,rec,2,now);
          park(v,'已回归');
        }
        break;
      }
      case '@dinner': taskCompleted(v,item,now); advance('afterDinner'); break;
      case '@bath': {
        const timing=endTimer(v,now,false);
        startReward(state,item,now);
        if (timing?.key===item.key && timing.actual<=timing.target) grant(state,item,2,now);
        handoff(state,now); break;
      }
      case '@bedSkip':
      case '@bed':
        if(action==='@bedSkip')skipReview();
        item.readyForRestAt ??= now.getTime();
        startReward(state,item,now);
        if(now.getTime()<=item.planned+s.sleepLimit*M)grant(state,item,2,now);
        park(v,'已完成'); break;
      case '@review':
        promptReview(v,'daily',item.day,now);
        startReview(v,'daily/'+item.day);
        advance('bedtime'); break;
      case '@skipReview': skipReview(); advance('bedtime'); break;
      case '@handoff': handoff(state,now); break;
      case '@check':
      case '@complete': taskCompleted(v,item,now); park(v,'已完成'); break;
      default: advance(action);
    }
    const same=v.active?.thread===a.thread;
    if (same && reply.endsWith('？')) v.active.prompt=reply;
    const guidance=same && trace.length===2 && choice.guide
      ? {input:modelContext(state,choice.label),revision:v.active.revision}:null;
    return {award:v.rewardHistory.length>before ? v.rewardHistory.at(-1):null,guidance};
  }
  function setFollow(v, minutes, now = new Date()) {
    if (!v.active || v.active.id === 'wake' || v.active.stage !== 'wait') return false;
    const delay = P.bounded(minutes, 1, 1440, 0);
    if (!delay) return false;
    v.active.due = now.getTime() + delay * M;
    v.active.revision = P.uid();
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
    const deepFocus = state.timer?.mode === 'deep' && state.timer.endsAt > time;
    const a = v.active;
    if (!deepFocus && a?.due != null && time >= a.due) {
      if (a.attempts >= 2) park(v, '未记录');
      else {
        a.attempts++;
        a.due = time + v.settings.intervals.unanswered * M;
        message(v, (phases[a.stage]?.question ?? '现在怎么样了？可以选一个当前状态。'));
        event(v, 'followup', now, { key: a.key, attempts: a.attempts });
      }
      changed = true;
    }
    const active = v.active;
    if (!deepFocus && active?.stage === 'sustain' && ['am', 'pm'].includes(active.id)) {
      const wrap = v.settings.wrapTimes?.[active.id];
      if (P.timeOk(wrap) && t >= wrap && !v.records[active.key].wrapPromptAt) {
        v.records[active.key].wrapPromptAt = time;
        go(v, 'wrap', now, v.settings.intervals.unanswered);
        message(v, '到了约定的收尾时间。现在可以结束这段工作了吗？');
        changed = true;
      }
    }
    const week = monday(day);
    if (now.getDay() === v.settings.weekDay && t >= v.settings.weekTime && !v.weekly[week]) {
      const report = weekly(v, day);
      v.weekly[week] = report;
      promptReview(v, 'weekly', day, now);
      changed = true;
    }
    v.queue = v.queue.filter(row => {
      const setting = v.settings.times[row.id];
      if (row.day !== day || !setting?.enabled || setting.removed) return false;
      const delay = time - P.dueAt(day, setting.time);
      return delay < 60*M && (row.source !== 'schedule' || delay >= 0);
    });
    if (v.queue.length && (!v.active || ['sustain','wrap','backHold'].includes(v.active.stage))) {
      const next = v.queue.shift();
      changed = open(state,next.id,now,next.source) || changed;
    }
    for (const id of reminderIds(v)) {
      const setting = v.settings.times[id];
      const due = P.dueAt(day, setting.time);
      if (!setting.enabled || time < due || time >= due + 30*M) continue;
      const pending = v.queue.find(row=>row.id===id && row.day===day);
      const recordForToday = v.records[day+'/'+id];
      if (pending) changed = announceScheduled(v,record(v,day,id),now) || changed;
      else if (v.active?.id === id && v.active.day === day && recordForToday && !recordForToday.history.length && !recordForToday.completedAt) {
        changed = announceScheduled(v,recordForToday,now,false) || changed;
      } else changed = open(state,id,now,'schedule') || changed;
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
      if (v.active?.id !== 'bath' || v.active.stage !== 'bathTimer') return false;
      const stages = mode === 'combined' ? [30, 10] : mode === 'custom' ? [P.bounded(custom, 1, 180, 20)] : [20];
      v.timer = { key: v.active.key, stages, target: stages.reduce((a, b) => a + b, 0) * M,
        elapsed: 0, runningSince: time, startedAt: time, alerted: false };
      go(v,'bathResult',now,null);
      return true;
    }
    if (!v.timer) return false;
    if (type === 'pause' && v.timer.runningSince != null) {
      v.timer.elapsed = elapsed(v.timer, time); v.timer.runningSince = null; return true;
    }
    if (type === 'resume' && v.timer.runningSince == null) { v.timer.runningSince = time; return true; }
    if (type === 'end') {
      const key=v.timer.key;
      endTimer(v, now);
      if (v.active?.id === 'bath' && v.active.key===key) go(v,'bathResult',now,v.settings.intervals.unanswered);
      return true;
    }
    return false;
  }
  function endTimer(v, now, manual = true) {
    if (v.timer && (manual || v.timer.key === v.active?.key)) {
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
  const achievementPoints = Object.freeze({
    '晨间小达人':30, '行动启动大师':30, '时间掌控者':30, '月光守护者':30,
    '轨道修复大师':50, '闪耀的一天':30, '闪耀节奏':50, '成长中的星球':100,
  });
  function achievements(state, now) {
    const v = init(state);
    const day = P.dateKey(now);
    const records = Object.values(v.records);
    const count = (id, level) => records.filter(row => (id === row.id || id === 'work' && work.includes(row.id)) && (row.level ?? 0) >= level).length;
    const earned = [['晨间小达人', count('wake', 2) >= 7], ['行动启动大师', count('work', 2) >= 10],
      ['时间掌控者', count('bath', 2) >= 7], ['月光守护者', count('sleep', 2) >= 7],
      ['轨道修复大师', count('return', 1) >= 10],
      ['闪耀的一天', Object.keys(star).filter(id => id !== 'return').every(id => v.records[day + '/' + id]?.level >= 1)],
      ['闪耀节奏', Object.keys(star).filter(id => id !== 'return').every(id => v.records[day + '/' + id]?.level >= 2)],
      ['成长中的星球', Object.values(v.reviews).filter(r => !r.skipped).length >= 30]];
    for (const [name, unlocked] of earned) {
      if (!unlocked || v.achievements[name]) continue;
      const points=achievementPoints[name];
      v.achievements[name] = day; state.stars += points;
      message(v, '解锁「' + name + '」 ⭐ +' + points);
    }
  }
  function free(state, input, now = new Date()) {
    const v = init(state);
    const text = P.clean(input, 500);
    if (!text) return null;
    const a=v.active, detail=a?{thread:a.thread,reminderId:a.id}:{};
    message(v,text,'you',detail);
    if (/自杀|不想活|伤害自己|伤害别人|结束生命/.test(text)) {
      state.settings.pausedUntil = now.getTime() + 60 * M;
      park(v, '暂时延迟');
      message(v, '你的安全比计划重要。如果你或他人可能马上受伤，请立即联系当地急救服务，并请身边可信任的人来陪你。现在可以先去有人陪伴的地方。');
      return 'urgent';
    }
    if (/暂停|不想被提醒|停止监督/.test(text)) {
      state.settings.pausedUntil = now.getTime() + 60 * M;
      park(v,'暂时延迟');
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
    if(a?.id==='wake' && /身体不适|身体不舒服|头晕|胸痛|发烧|身体疼/.test(text)){
      go(v,'wakeCare',now,null);
      message(v,'先照顾身体。需要的话可以暂停这次监督。','coach',detail);
      return 'local';
    }
    const delay = text.match(/(\d{1,4})\s*分钟/);
    if (delay && a?.stage === 'wait' && setFollow(v, Number(delay[1]), now)) return 'local';
    if (a) {
      v.records[a.key].history.push({ at: now.getTime(), stage: a.stage, response: text });
      a.attempts = 0;
      if (a.due != null) a.due = now.getTime() + v.settings.intervals.unanswered * M;
    }
    const emotion = /难受|焦虑|沮丧|心烦|失败|烂透|完蛋|一无是处|生气|难过/.test(text);
    const bedtime = a?.id === 'sleep';
    const remaining = a?.id==='wake' && v.records[a.key]?.completedAt ? '按你已经完成的步骤继续，只做下一项晨间准备。'
      : a?.stage==='sleepInBed' ? '你可以留在床上，把最挂念的一句话暂存后休息。' : '';
    const fallback = remaining || (emotion ? (bedtime
      ? '听起来这件事让你很不好受。先把最挂念的一句话写下来，剩下的明天再看。'
      : '听起来你卡在一种很难受的感受里。试着写下刚才实际发生的一件事，先把它和对自己的评价分开。')
      : ({
          wake:'先把上半身坐起来，做得到就只做这一步。',
          am:'先打开上午任务所需的一份材料。',
          pm:'回到下午任务，把需要的材料摆到手边。',
          check:'先打开原任务的页面，找到中断前的那一行。',
          dinner:'先保存当前进度，再准备晚饭。',
          bath:'确认洗澡或整理有哪一步还没做，就从那一步继续。',
          night:'选一件今晚可以收尾的小事，先打开它的材料。',
          sleep:'把未完成的下一步记一行，然后准备休息。',
        })[a?.id] ?? '先选一个现在做得到的动作，或者用下方选项确认状态。');
    message(v,fallback,'coach',detail);
    event(v, emotion ? 'emotion' : 'free_reply', now, { key: a?.key, source: '用户自述' });
    return 'fallback';
  }
  return { ids, intervals, star, data, phases, init, modelContext, monday, chooseQuote, isCustom, reminderIds, allReminderIds, displayReminderIds, manualReminderOrder, reminderTimeOrder, title, record, message, open, options, choose, park,
    tick, startReview, finishReview, setFollow, agreeTime, elapsed, timerAction, dailyRows, dailyText, weekly, achievements, achievementPoints, free, planText, catalog };
});
