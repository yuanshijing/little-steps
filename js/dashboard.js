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
  const rhythm = [
    ['上午', ['wake', 'am']],
    ['下午', ['pm', 'check']],
    ['晚上', ['dinner', 'bath', 'night', 'sleep']],
  ];
  const scenes = {
    wake: ['☀', '起床', '确认是否离床，接着洗漱和吃早餐。'],
    am: ['▷', '上午开始学习', '打开第一项任务需要的材料。'],
    pm: ['▷', '下午开始学习', '看一下下午的重点，选一个动作开始。'],
    check: ['◎', '下午状态监督', '告诉小星你是专注、休息，还是需要回到任务。'],
    dinner: ['◒', '晚上吃饭', '收好手头的工作，再安排晚饭和饭后活动。'],
    bath: ['♧', '洗澡', '准备换洗衣物，记得先打开计时器。'],
    night: ['▷', '晚上开始学习', '看看今天剩下的重要任务，从第一步开始。'],
    sleep: ['☾', '睡觉与复盘', '收好手头的事，给今天做个简短的回顾。'],
    return: ['↶', '回到正轨', '说说现在卡在哪里，我们一起找一个可以做的动作。'],
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]);
  const route = (id, text, style = 'secondary small') =>
    `<button type="button" class="${style}" data-act="page" data-target="${id}">${text}</button>`;
  const open = (id, text, style = 'secondary small', label = '') =>
    `<button type="button" class="${style}" data-v1="open" data-value="${id}"${label ? ' aria-label="' + esc(label) + '"' : ''}>${text}</button>`;
  const badge = ([name, icon, color]) => `<span class="star-badge color-${color}" aria-hidden="true">${icon}</span>`;
  const completed = ['已完成', '完成得很好'];
  const pending = ['待执行', '暂时延迟'];
  const localDate = day => new Date(day + 'T12:00:00').toLocaleDateString('zh-CN', {month:'long', day:'numeric'});

  function collection(state) {
    const v = V.init(state);
    const entries = new Map();
    const add = (name, key, day, at, label) => entries.set(name + '/' + key, {name, day, at, label});
    for (const award of v.rewardHistory) {
      add(award.star, award.key, award.day, award.at, scenes[award.id]?.[1] || '任务奖励');
    }
    for (const event of state.events) {
      if (event.type === 'timer_finished') add('专注星', event.id, event.date, Date.parse(event.at), '完成计时');
    }
    for (const [day, review] of Object.entries(v.reviews)) {
      if (!review.skipped) add('成长星', day, day, P.dueAt(day, '23:59'), '保存每日复盘');
    }
    for (const item of Object.values(v.records)) {
      if (item.id !== 'wake') continue;
      const history = item.history ?? [];
      const breakfast = history.find(row => ['已经吃了', '已经吃完早餐'].includes(row.response));
      const wash = history.find(row => ['已经洗漱完成', '已经洗漱完毕'].includes(row.response));
      if (wash) add('关爱星', item.day + '/wash', item.day, wash.at, '完成晨间洗漱');
      if (breakfast) add('关爱星', item.day + '/breakfast', item.day, breakfast.at, '吃完早餐');
    }
    return [...entries.values()].sort((a, b) => b.at - a.at);
  }

  function home(state, now = new Date()) {
    const v = V.init(state);
    const day = P.dateKey(now);
    const rows = V.ids.map(id => ({id, ...v.settings.times[id], row:v.records[day + '/' + id]}));
    const active = v.active;
    const currentMinute = Math.floor(now.getTime() / 60000) * 60000;
    const next = rows.filter(({enabled, row}) => enabled && pending.includes(row?.status ?? '待执行'))
      .sort((a, b) => a.time.localeCompare(b.time)).find(row => P.dueAt(day, row.time) >= currentMinute);
    const current = active ?? next;
    const count = rows.filter(({row}) => completed.includes(row?.status)).length;
    const goal = state.plans[day]?.items?.[0];
    const task = goal ?? P.nextTask(state, day)?.task;
    const paused = state.settings.pausedUntil > now.getTime();
    const heading = current ? scenes[current.id][1] : task ? '看看今天的重点' : '按自己的节奏继续';
    const description = active
      ? (V.phases[active.stage]?.[0] || scenes[active.id][2])
      : next ? scenes[next.id][2] : task ? esc(task.title) : '可以打开小星对话，也可以先放松一下。';
    const log = collection(state);
    const timeline = rhythm.map(([label, ids]) => `<section class="rhythm-group"><h3>${label}</h3>
      ${ids.map(id => {
        const {row, enabled, time} = rows.find(entry => entry.id === id);
        const talking = active?.id === id;
        const done = completed.includes(row?.status);
        const status = talking ? '对话中' : row?.status === '待执行' && !enabled ? '提醒已关闭'
          : row?.status ?? (enabled ? '待执行' : '提醒已关闭');
        const tone = talking ? 'current' : done ? 'done' : 'neutral';
        const verb = talking ? '继续' : '开始';
        return `<div class="rhythm-row"><time>${esc(time)}</time><span class="scene-icon" aria-hidden="true">${scenes[id][0]}</span>
          <div class="rhythm-name">${scenes[id][1]}<span class="rhythm-status ${tone}">${esc(status)}</span></div>
          ${talking || !done ? open(id, verb, 'row-button', verb + ' · ' + scenes[id][1]) : ''}</div>`;
      }).join('')}</section>`).join('');
    return `<section class="today-hero"><div class="hero-content">
      <div class="hero-label"><span></span>${active ? '当前对话' : next ? '下一项提醒 · ' + esc(next.time) : '今天的下一步'}</div>
      <h2>${heading}</h2><p>${description}</p>
      ${active ? route('v1','继续和小星对话','hero-button') : next ? open(next.id,'和小星开始','hero-button')
        : route(task ? 'plan' : 'v1',task ? '查看我的计划' : '打开小星陪伴','hero-button')}
      ${paused ? '<p class="hero-paused">监督已暂停，可以手动继续对话。</p>' : ''}</div>
      <div class="orbit-art" aria-hidden="true"><i></i><span>✦</span><span>✧</span><span>·</span><span>✦</span></div></section>
      <div class="today-grid"><section class="surface rhythm-card"><div class="dashboard-heading"><div><h2>今日节奏</h2><p>完成 ${count} / 8 项</p></div>${route('v1settings','编辑提醒','text-button')}</div>${timeline}</section>
      <aside class="today-aside">
        <section class="surface quick-card"><h2>随手行动</h2>
          ${open('return','<span aria-hidden="true">↶</span><b>回到正轨</b><small>偏航后重新启动</small>','quick-link')}
          ${route('focus','<span aria-hidden="true">◷</span><b>启动与专注计时</b><small>30 秒起步，也可自定义</small>','quick-link')}
          ${route('v1review','<span aria-hidden="true">☾</span><b>睡前复盘</b><small>回顾今天，准备明天</small>','quick-link')}</section>
        ${task ? `<section class="surface today-plan"><h2>今日重点</h2><p><b>${esc(task.title)}</b></p>
          ${task.firstStep ? '<p class="subtle">第一步 · ' + esc(task.firstStep) + '</p>' : ''}${route('plan','查看我的计划','text-button')}</section>` : ''}
        <section class="surface collection-preview"><h2>星空收藏</h2><p class="subtle">已收藏 ${log.length} 颗 · ${new Set(log.map(row => row.name)).size} / 8 种</p>
          <div class="mini-stars">${stars.map(badge).join('')}</div>${route('v1stars','打开星空收藏','text-button')}</section>
      </aside></div>`;
  }

  function sky(state) {
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
      ${Object.keys(v.achievements).length ? '<h3>已解锁成就</h3><p>' + Object.keys(v.achievements).map(esc).join(' · ') + '</p>' : ''}</section>`;
  }
  return { collection, home, sky };
});
