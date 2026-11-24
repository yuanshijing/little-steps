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
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]);
  const badge = ([name, icon, color]) => `<span class="star-badge color-${color}" aria-hidden="true">${icon}</span>`;
  const localDate = day => new Date(day + 'T12:00:00').toLocaleDateString('zh-CN', {month:'long', day:'numeric'});

  function collection(state) {
    const v = V.init(state);
    const entries = new Map();
    const add = (name, key, day, at, label) => entries.set(name + '/' + key, {name, day, at, label});
    for (const award of v.rewardHistory) {
      add(award.star, award.key, award.day, award.at, V.data[award.id]?.title || (award.id === 'return' ? '偏航回归' : '任务奖励'));
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


  function reminderStatus(v, day, id) {
    const row = v.records[day + '/' + id];
    if (v.active?.id === id && v.active.day === day) return '对话中';
    if (!v.settings.times[id].enabled && (!row || row.status === '待执行')) return '已关闭';
    if (row?.status && row.status !== '待执行') return row.status;
    return '尚未提醒';
  }

  function reminders(state, now = new Date()) {
    const v = V.init(state);
    const day = P.dateKey(now);
    const customIds = V.reminderIds(v).filter(id => V.isCustom(v, id));
    const groups = customIds.length ? [...rhythm, ['自定义任务', customIds]] : rhythm;
    return groups.map(([label, ids]) => [label, ids.filter(id => !v.settings.times[id].removed)])
      .filter(([,ids]) => ids.length).map(([label, ids]) => `<fieldset class="reminder-group"><legend>${label}</legend>${ids.map(id => {
      const {time, enabled} = v.settings.times[id];
      const title = esc(V.title(v,id));
      const custom = V.isCustom(v,id);
      const active = v.active?.id === id && v.active.day === day;
      return `<div class="reminder-row" data-saved-reminder="${esc(id)}"><div class="reminder-task"><label class="reminder-toggle">
        <input type="checkbox" name="enabled_${id}" aria-label="启用${title}提醒" ${enabled ? 'checked' : ''}>
        ${custom ? '<span>启用提醒</span>' : '<strong>' + title + '</strong>'}</label>
        ${custom ? `<input class="field reminder-name" name="title_${id}" aria-label="自定义任务名称" value="${title}" maxlength="60" required>` : ''}</div>
        <span class="rhythm-status" data-reminder-status="${id}">${esc(reminderStatus(v, day, id))}</span>
        <input type="time" class="field" name="time_${id}" aria-label="${title}的提醒时间" value="${esc(time)}" required>
        <button type="button" class="secondary small reminder-open" data-v1="open" data-value="${esc(id)}" aria-label="${title} · ${active ? '继续对话' : '现在聊聊'}">${active ? '继续对话' : '现在聊聊'}</button>
        <button type="button" class="reminder-minus" data-v1="removeReminder" aria-label="移除${title}">−</button>
        </div>`;
    }).join('')}</fieldset>`).join('');
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
  return { collection, reminders, reminderStatus, sky };
});
