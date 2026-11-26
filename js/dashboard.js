((root, factory) => {
  if (typeof module !== 'undefined') module.exports = factory(require('./model'), require('./v1'));
  else root.PlanetDashboard = factory(root.Planet, root.PlanetV1);
})(globalThis, (P, V) => {
  'use strict';
  const stars = [
    ['晨光星', '🌅', 'sunrise', '确认早上离床'],
    ['行动星', '⭐', 'action', '确认开始上午、下午或晚间的学习或工作'],
    ['专注星', '🎯', 'focus', '完成一次启动或专注计时'],
    ['效率星', '⚡', 'energy', '完成洗澡，在目标内完成可获进阶奖励'],
    ['回归星', '🪐', 'return', '偏航后确认回到原来的任务'],
    ['休憩星', '🌙', 'rest', '确认已上床休息'],
    ['成长星', '🌱', 'growth', '保存一次每日复盘'],
    ['关爱星', '💗', 'care', '确认完成晨间洗漱或吃完早餐'],
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]);
  const badge = ([name, icon, color]) => `<span class="star-badge color-${color}" aria-hidden="true">${icon}</span>`;
  const localDate = day => new Date(day + 'T12:00:00').toLocaleDateString('zh-CN', {month:'long', day:'numeric'});

  function collection(state) {
    const v = V.init(state);
    const entries = new Map();
    const add = (name, key, day, at, label) => {
      const id = name + '/' + key;
      if (!entries.has(id) || at < entries.get(id).at) entries.set(id, {name, day, at, label});
    };
    for (const award of v.rewardHistory) {
      add(award.star, award.key, award.day, award.at, V.data[award.id]?.title || (award.id === 'return' ? '偏航回归' : '任务奖励'));
    }
    for (const event of state.events) {
      if (event.type === 'timer_finished') add('专注星', event.id, event.date, Date.parse(event.at), '完成计时');
      if (event.type==='checkin' && event.status==='completed' && event.taskId && event.pointsEarned>0) {
        add('行动星',event.taskDay+'/'+event.taskId,event.taskDay,Date.parse(event.at),event.title);
      }
    }
    for (const [day, review] of Object.entries(v.reviews)) {
      if (!review.skipped) add('成长星', day, day, P.dueAt(day, '23:59'), '保存每日复盘');
    }
    for (const item of Object.values(v.records)) {
      if (item.id !== 'wake') continue;
      const history = item.history ?? [];
      const breakfast = history.find(row => ['已经吃了', '已经吃完早餐'].includes(row.response));
      const wash = history.find(row => ['已经洗漱完成','已经洗漱完毕','已洗漱','已洗漱，还在准备'].includes(row.response));
      if (wash) add('关爱星', item.day + '/wash', item.day, wash.at, '完成晨间洗漱');
      if (breakfast) add('关爱星', item.day + '/breakfast', item.day, breakfast.at, '吃完早餐');
    }
    return [...entries.values()].sort((a, b) => b.at - a.at);
  }


  function reminderStatus(v, day, id) {
    const row = v.records[day + '/' + id];
    if (v.active?.id === id && v.active.day === day) return '对话中';
    if (!v.settings.times[id].enabled && (!row || row.status === '待执行')) return '已关闭';
    if (row?.status && row.status !== '待执行') return row.status;
    if (row?.notifiedAt != null && v.queue.some(entry=>entry.day===day && entry.id===id)) return '已提醒 · 待处理';
    return '尚未提醒';
  }

  function reminders(state, now = new Date()) {
    const v = V.init(state);
    const day = P.dateKey(now);
    return `<fieldset class="reminder-group"><legend>固定提醒</legend>
      <div class="reminder-order-controls">
        <p class="subtle" id="reminder-reorder-help">拖动左侧把手调整顺序，也可以用键盘的上、下方向键。</p>
        <button type="button" class="secondary small" data-v1="reminderTimeSort">按时间排序</button>
      </div>
      <p class="subtle reminder-order-status" id="reminder-order-status" role="status">${V.manualReminderOrder(v).length?'当前按手动顺序排列。':'当前按时间排序，从早上 06:00 开始。'}</p>
      <div id="reminder-list">${V.displayReminderIds(v).filter(id=>V.ids.includes(id)).map(id => {
      const {time, enabled} = v.settings.times[id];
      const title = esc(V.title(v,id));
      const custom = V.isCustom(v,id);
      const active = v.active?.id === id && v.active.day === day;
      return `<div class="reminder-row" data-saved-reminder="${esc(id)}">
        <button type="button" class="reminder-grip" data-reminder-grip aria-label="调整${title}的顺序" aria-describedby="reminder-reorder-help"><span aria-hidden="true">⠿</span></button>
        <div class="reminder-task"><label class="reminder-toggle">
        <input type="checkbox" name="enabled_${id}" aria-label="启用${title}提醒" ${enabled ? 'checked' : ''}>
        ${custom ? '<span>启用提醒</span>' : '<strong>' + title + '</strong>'}</label>
        ${custom ? `<input class="field reminder-name" name="title_${id}" aria-label="自定义任务名称" value="${title}" maxlength="60" required>` : ''}</div>
        <span class="rhythm-status" data-reminder-status="${id}">${esc(reminderStatus(v, day, id))}</span>
        <input type="time" class="field" data-reminder-time name="time_${id}" aria-label="${title}的提醒时间" value="${esc(time)}" required>
        <button type="button" class="secondary small reminder-open" data-v1="open" data-value="${esc(id)}" aria-label="${title} · ${active ? '继续对话' : '现在聊聊'}">${active ? '继续对话' : '现在聊聊'}</button>
        <button type="button" class="reminder-minus" data-v1="removeReminder" aria-label="移除${title}">−</button>
        </div>`;
    }).join('')}</div></fieldset>`;
  }

  function pointsByDay(state) {
    const v=V.init(state), totals=new Map(), seen=new Set();
    const add=(day,points)=> {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day ?? '') && Number.isFinite(points) && points>0) {
        totals.set(day,(totals.get(day) ?? 0)+points);
      }
    };
    for (const row of v.rewardHistory) add(Number.isFinite(row.at)?P.dateKey(new Date(row.at)):row.day,row.bonus);
    for (const [name,day] of Object.entries(v.achievements)) add(day,V.achievementPoints[name]);
    for (const event of state.events) {
      if(event.type==='timer_finished'){add(event.date,5); continue;}
      if(event.type==='recovery_result' && event.result==='resumed'){add(event.date,3); continue;}
      if (!['started','checkin'].includes(event.type)) continue;
      const base={active:3,completed:15,partial:5}[event.status];
      if(!base) continue;
      const key=event.taskDay+'/'+event.taskId, marker=key+'/'+event.status;
      const legacy=seen.has(marker) ? 0 : base+(event.status==='completed' && state.instances[key]?.rewards?.routine?2:0);
      seen.add(marker);
      add(event.date, Number.isFinite(event.pointsEarned) ? event.pointsEarned : legacy);
    }
    return totals;
  }
  const periodName={day:'按日',week:'按周',month:'按月'};
  function rewardStatistics(state, period='day', anchor=P.dateKey(), entries=collection(state)) {
    const mode=Object.hasOwn(periodName,period)?period:'day';
    const count={day:7,week:8,month:6}[mode];
    const monthStart=(offset)=>{
      const date=new Date(anchor+'T12:00:00');
      date.setDate(1);
      date.setMonth(date.getMonth()+offset);
      return P.dateKey(date);
    };
    const boundary=offset=>mode==='month' ? monthStart(offset)
      : P.shiftDate(mode==='week'?V.monday(anchor):anchor, offset*(mode==='week'?7:1));
    const points=pointsByDay(state);
    const starCount=new Map();
    for(const row of entries){
      const day=Number.isFinite(row.at)?P.dateKey(new Date(row.at)):row.day;
      starCount.set(day,(starCount.get(day)??0)+1);
    }
    return Array.from({length:count},(_,index)=>{
      const offset=index-count+1, start=boundary(offset), after=boundary(offset+1);
      const sum=map=>[...map].reduce((total,[day,value])=>day>=start&&day<after&&day<=anchor?total+value:total,0);
      const label=mode==='month'?start.slice(0,7):mode==='week'?start.slice(5)+' 至 '+P.shiftDate(after,-1).slice(5):start.slice(5);
      return {start,after,label,points:sum(points),stars:sum(starCount)};
    });
  }
  function rewardAxis(peak) {
    const raw=Math.max(1,peak/4);
    const magnitude=10**Math.floor(Math.log10(raw));
    const step=magnitude*[1,2,2.5,5,10].find(size=>size*magnitude>=raw && Number.isInteger(size*magnitude));
    return [4,3,2,1,0].map(level=>level*step);
  }
  function rewardChart(state, entries, period, anchor) {
    const rows=rewardStatistics(state,period,anchor,entries);
    function plot(kind,title,unit) {
      const ticks=rewardAxis(Math.max(...rows.map(row=>row[kind])));
      return `<section class="reward-series reward-series-${kind}" aria-labelledby="reward-title-${kind}">
        <h3 id="reward-title-${kind}">${title}</h3>
        <div class="reward-plot-scroll"><div class="reward-plot">
          <div class="reward-axis"><b>${unit}</b><div class="reward-axis-ticks">
            ${ticks.map(value=>`<span>${value}</span>`).join('')}</div></div>
          <div class="reward-plot-main">
            <div class="reward-gridlines" aria-hidden="true">${ticks.map(()=>'<span></span>').join('')}</div>
            <ol class="reward-periods">${rows.map(row=>{
              const value=row[kind], label=esc(row.label), detail='reward-value-'+kind+'-'+row.start;
              return `<li>
                <button type="button" class="reward-column" data-act="reward-value" aria-label="${label}的${title}"
                  aria-expanded="false" aria-controls="${detail}" style="--column-height:${value/ticks[0]*100}%">
                  <span class="reward-column-fill" aria-hidden="true"></span>
                  <span class="reward-column-value" id="${detail}" hidden>${value} ${unit}</span>
                </button>
                <time datetime="${row.start}">${label}</time>
              </li>`;
            }).join('')}</ol>
            <div class="reward-axis-date">日期</div>
          </div>
        </div></div>
      </section>`;
    }
    return `<section class="surface reward-chart" aria-label="获得记录">
      <div class="hrow"><h2 class="section-title">获得记录</h2><div class="controls" role="group" aria-label="统计周期">
      ${Object.entries(periodName).map(([id,label])=>`<button type="button" class="${period===id?'primary':'secondary'} small" data-act="star-period" data-value="${id}" aria-pressed="${period===id}">${label}</button>`).join('')}</div></div>
      <label class="reward-stat-date">查看截至 <input type="date" class="field" data-star-stat-date value="${esc(anchor)}" max="${P.dateKey()}"></label>
      <p class="subtle reward-chart-help">点按任一柱子查看数值。</p>
      ${plot('points','积分统计','积分')}
      ${plot('stars','星星统计','颗')}
      ${rows.every(row=>!row.points&&!row.stars)?'<p class="subtle">这段时间还没有获得记录。</p>':''}
      </section>`;
  }
  function sky(state, period='day', anchor=P.dateKey()) {
    const v = V.init(state);
    const entries = collection(state);
    const types = new Set(entries.map(row => row.name));
    const tiles = stars.map(star => {
      const [name,, color, rule] = star;
      const count = entries.filter(row => row.name === name).length;
      return `<article class="star-tile color-${color}"><div>${badge(star)}<span>${count ? count + ' 颗' : '待点亮'}</span></div>
        <h2>${name}</h2><p>${rule}</p></article>`;
    }).join('');
    return `<section class="sky-summary"><div><h2>我的星空</h2><p>每一颗星都对应一次你实际记录的行动。</p></div>
      <dl><div><dt>累计积分</dt><dd>${state.stars}</dd></div><div><dt>收藏星星</dt><dd>${entries.length}</dd></div><div><dt>点亮种类</dt><dd>${types.size} <small>/ 8</small></dd></div></dl></section>
      <div class="star-grid">${tiles}</div>
      <section class="surface star-history"><h2>最近点亮</h2>${entries.length ? entries.slice(0, 8).map(entry =>
        `<div class="v1-line">${badge(stars.find(star => star[0] === entry.name))}<span><b>${entry.name}</b> · ${entry.label}</span><time datetime="${entry.day}">${localDate(entry.day)}</time></div>`).join('')
        : '<p class="subtle">完成并记录一个行动后，这里就会留下第一颗星。</p>'}
      ${Object.keys(v.achievements).length ? '<h3>已解锁成就</h3><p>' + Object.keys(v.achievements).map(esc).join(' · ') + '</p>' : ''}</section>
      ${rewardChart(state,entries,period,anchor)}`;
  }
  return { collection, pointsByDay, rewardStatistics, reminders, reminderStatus, sky };
});
