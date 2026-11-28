const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const P=require('../js/model');
const V=require('../js/v1');
const D=require('../js/dashboard');
const S=require('../js/scheduler');
const Sync=require('../js/settings-sync');
const at=(day,hour=10,minute=0)=>new Date(2026,10,day,hour,minute);
const day='2026-11-27';
function create(){
  const state=P.createState(at(27)),v=V.init(state);
  for(const id of V.ids)v.settings.times[id].enabled=false;
  return {state,v};
}
const save=(state,input,now=at(27))=>P.upsertTask(state,{title:'写报告',day,when:'10:00',...input},now);
const select=(state,v,id,now=at(27))=>V.choose(state,v.active.revision,id,now);

test('empty defaults and migration only archives unused, unchanged starter tasks',()=>{
  const state=P.createState(at(27));
  assert.deepEqual(state.tasks,[]);
  const defaults=[
    {id:'wake-original',title:'离开床铺并洗漱',when:'09:00',minutes:5,firstStep:'把双脚放到地上'},
    {id:'work-used',title:'专注工作15分钟',when:'14:00',minutes:15,firstStep:'打开今天要用的文件'},
    {id:'room-edited',title:'整理房间5分钟',when:'19:30',minutes:5,firstStep:'先收衣服'},
  ];
  state.tasks=defaults.map(task=>({...task,day,repeat:'daily',category:'routine',priority:2,steps:[],archived:false}));
  P.transition(state,state.tasks[1],day,'completed',at(27));
  const updated=P.migrate(state,at(27));
  assert.deepEqual(updated.tasks.map(task=>task.archived),[true,false,false]);
  assert.equal(updated.instances[day+'/work-used'].status,'completed');
});

test('legacy reminder and matching daily task migrate once while keeping check-ins and chain',()=>{
  const state=P.createState(at(27)),task=save(state,{repeat:'daily',chain:'旧行为链'});
  const v=V.init(state);
  delete v.tasksUnified;
  v.settings.times['custom-old']={title:task.title,time:task.when,addedDay:day,enabled:true};
  v.records[day+'/custom-old']={key:day+'/custom-old',id:'custom-old',day,completedAt:at(27).getTime(),history:[]};
  V.init(state);
  V.init(state);
  assert.equal(state.tasks.length,1);
  assert.equal(V.reminderId(task),'custom-old');
  assert.equal(task.chain,'旧行为链');
  assert.equal(state.instances[day+'/'+task.id].status,'completed');
  assert.equal(V.checkTask(state,task,day,'completed',at(27)).reward,0);
});

test('repeat dates, pause, restore, archive and edits preserve historical task names and check-ins',()=>{
  const {state,v}=create();
  const once=save(state,{repeat:'once'}), daily=save(state,{title:'每天',repeat:'daily'});
  const weekdays=save(state,{title:'工作日',repeat:'weekdays'}), weekly=save(state,{title:'每周',repeat:'weekly'});
  assert.equal(P.occurs(once,'2026-11-28'),false);
  assert.equal(P.occurs(daily,'2026-11-28'),true);
  assert.equal(P.occurs(weekdays,'2026-11-28'),false);
  assert.equal(P.occurs(weekdays,'2026-11-30'),true);
  assert.equal(P.occurs(weekly,'2026-12-04'),true);
  assert.equal(P.occurs(weekly,'2026-11-28'),false);
  V.checkTask(state,daily,day,'completed',at(27));
  P.setTaskState(daily,'pause',at(28));
  assert.equal(P.occurs(daily,'2026-11-28'),false);
  P.setTaskState(daily,'resume',at(29));
  assert.equal(P.occurs(daily,'2026-11-29'),true);
  save(state,{...daily,title:'改名',when:'11:00'},at(29));
  P.setTaskState(daily,'archive',at(30));
  V.reconcileTasks(state,at(30));
  assert.equal(P.occurs(daily,'2026-12-01'),false);
  const old=V.dailyRows(v,day).find(row=>row.id===V.reminderId(daily));
  assert.equal(old.title,'每天');
  assert.equal(old.status,'已完成');
  assert.equal(V.dailyRows(v,day).find(row=>row.id==='wake').status,'当天无须执行');
  const report=V.weekly(v,'2026-11-30').stats.find(row=>row.id===V.reminderId(once));
  assert.equal(report.notScheduled,6);
  assert.equal(report.missing,1);
});

test('soft prerequisite never blocks, strong prerequisite handles skip, removal and fixed status',()=>{
  const {state,v}=create();
  const first=save(state,{title:'准备资料'}), second=save(state,{dependsOn:first.id});
  assert.equal(P.blocked(state,second,day),false);
  save(state,{...second,strictDependency:true});
  assert.equal(P.blocked(state,second,day),true);
  assert.throws(()=>save(state,{...first,dependsOn:second.id}),/循环/);
  V.checkTask(state,first,day,'skipped',at(27));
  assert.equal(P.blocked(state,second,day),false);
  P.setTaskState(first,'archive',at(27));
  assert.equal(P.blocked(state,second,day),false);
  v.settings.times.am.enabled=true;
  save(state,{...second,dependsOn:'am',strictDependency:true});
  assert.equal(P.blocked(state,second,day),true);
  V.record(v,day,'am').completedAt=at(27).getTime();
  assert.equal(P.blocked(state,second,day),false);
  save(state,{...second,dependsOn:''});
  assert.equal(second.strictDependency,false);
});

test('explicit handoff opens eligible task promptly and yields to deep focus and future time',()=>{
  for(const scenario of ['now','future','paused','deep','done']){
    const {state,v}=create();
    const next=save(state,{title:'衔接任务',when:scenario==='future'?'12:00':'10:10',reminderEnabled:false});
    const first=save(state,{nextId:next.id});
    assert.throws(()=>save(state,{...next,nextId:first.id}),/循环/);
    if(scenario==='paused')P.setTaskState(next,'pause',at(27));
    if(scenario==='deep')S.startTimer(state,120,'deep',1,at(27));
    if(scenario==='done')V.checkTask(state,next,day,'completed',at(27));
    V.checkTask(state,first,day,'completed',at(27));
    assert.equal(v.active?.id,scenario==='now'?V.reminderId(next):undefined,scenario);
    if(scenario==='future')assert.match(v.messages.at(-1).text,/12:00/);
  }
});

test('one scheduled task, one shared task status, one reward from conversation or check-in',()=>{
  const {state,v}=create();
  const task=save(state,{firstStep:'打开草稿'});
  const id=V.reminderId(task);
  assert.equal(V.tick(state,at(27)),true);
  assert.equal(v.active.id,id);
  assert.match(v.messages.at(-1).text,/写报告/);
  assert.deepEqual(V.options(v).map(row=>row.label),['已经完成','正在进行','还没开始','遇到困难']);
  select(state,v,'help');
  assert.match(v.messages.at(-1).text,/打开草稿/);
  assert.match(V.modelContext(state,'帮我想想').actualTask,/写报告.*打开草稿/);
  const result=select(state,v,'finished');
  assert.equal(result.award.bonus,15);
  assert.equal(V.checkTask(state,task,day,'completed',at(27)).reward,0);
  V.tick(state,at(27,10,1));
  assert.equal(v.events.filter(row=>row.id===id&&row.type==='reminder').length,1);
  assert.equal(D.rewardStatistics(state,'day',day).at(-1).stars,1);
  assert.equal(V.dailyRows(v,day).filter(row=>row.id===id).length,1);
  assert.equal(S.tick(state,at(27),{wholePlanOnly:true}),null);
});

test('queue preserves time order during existing conversation and deep focus, without duplicate notification',()=>{
  const {state,v}=create(), early=save(state,{when:'10:00'}), later=save(state,{when:'10:01'});
  const firstId=V.reminderId(early), secondId=V.reminderId(later);
  S.startTimer(state,120,'deep',1,at(27));
  V.tick(state,at(27));V.tick(state,at(27,10,1));
  assert.equal(v.active,null);
  assert.deepEqual(v.queue.map(row=>row.id),[firstId,secondId]);
  V.tick(state,at(27,10,5));
  assert.equal(v.active.id,firstId);
  assert.deepEqual(v.queue.map(row=>row.id),[secondId]);
  select(state,v,'finished',at(27,10,5));
  V.tick(state,at(27,10,6));
  assert.equal(v.active.id,secondId);
  assert.equal(v.messages.filter(row=>row.source==='schedule').length,2);
});

test('a resumed page catches up missed reminders without replacing an on-time conversation',()=>{
  const {state,v}=create();
  const older=V.reminderId(save(state,{when:'10:00'}));
  const current=V.reminderId(save(state,{when:'11:30'}));
  V.setFixedReminder(v,'sleep',{enabled:true,time:'10:10'},at(27));
  V.tick(state,at(27,11,30));
  assert.equal(v.active.id,current);
  assert.deepEqual(v.queue.map(row=>row.id),[older,'sleep']);
  assert.match(v.messages.find(row=>row.reminderId===older).text,/补发 10:00/);
  assert.ok(v.messages.some(row=>row.reviewKind==='daily'));
  V.tick(state,at(27,11,31));
  assert.equal(v.messages.filter(row=>row.source==='schedule').length,3);
  assert.equal(v.messages.filter(row=>row.reviewKind==='daily').length,1);
});

test('settings sync shares reminder schedule only and transports weekly weekday for email',()=>{
  const {state}=create();
  const shared=save(state,{repeat:'weekly',sharedReminder:true,firstStep:'私密草稿'});
  const privateTask=save(state,{title:'本机计划',reminderEnabled:false});
  const profile=Sync.snapshot(state);
  assert.equal(profile.times[V.reminderId(shared)].weekday,5);
  assert.equal(profile.times[V.reminderId(shared)].repeat,'weekly');
  assert.equal(profile.times[V.reminderId(privateTask)],undefined);
  assert.doesNotMatch(JSON.stringify(profile),/私密草稿|本机计划/);
  const target=P.createState(at(27));
  assert.equal(Sync.apply(target,profile),true);
  assert.equal(target.tasks[0].repeat,'weekly');
  assert.equal(target.tasks[0].firstStep,'');
});

test('my plan shows the selected date and reveals check-in choices on demand',async()=>{
  const state=P.createState(), today=P.dateKey();
  const listeners={},nav={},getState={};
  const fields={nav:{addEventListener:(type,fn)=>nav[type]=fn},view:{dataset:{}},pagetitle:{},
    todaylabel:{},starcount:{},'plan-heading-note':{},toast:{style:{}},
    'task-form':{elements:{title:{focus(){}}}}};
  const storage=new Map();
  P.write({setItem:(key,value)=>storage.set(key,value)},state);
  const window={Planet:P,PlanetV1:V,PlanetScheduler:S,
    PlanetV1View:{mount(options){getState.read=options.state;return {screen:()=>'',clock(){},tick(){},cancelSpeech(){},playCompletionSound(){}};}},
    addEventListener(){},scrollTo(){}};
  const document={getElementById:id=>fields[id]??null,querySelectorAll:()=>[],
    addEventListener:(type,fn)=>listeners[type]=fn};
  runInNewContext(readFileSync('js/v1-shell.js','utf8'),{window,document,setInterval(){},setTimeout(){},clearTimeout(){},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}});
  nav.click({target:{closest:()=>({dataset:{page:'plan'}})}});
  assert.equal(fields.pagetitle.textContent,'我的计划');
  assert.equal(fields['plan-heading-note'].hidden,false);
  assert.doesNotMatch(fields.view.innerHTML,/离开床铺|整理房间|专注工作十分钟/);
  const click=dataset=>listeners.click({target:{closest:()=>({dataset})}});
  await click({act:'new-task'});
  assert.match(fields.view.innerHTML,/placeholder="例如：专注工作十分钟" value=""/);
  await click({act:'cancel-edit'});
  const savedState=getState.read(), task=P.upsertTask(savedState,{title:'写一段笔记',day:today,when:'09:00'});
  const tomorrow=P.shiftDate(today,1);
  P.upsertTask(savedState,{title:'明天读一页',day:tomorrow,when:'10:00'});
  P.upsertTask(savedState,{title:'离开床铺并洗漱',day:today,when:'08:00',category:'routine',repeat:'daily'});
  nav.click({target:{closest:()=>({dataset:{page:'plan'}})}});
  const html=fields.view.innerHTML;
  const order=['edit','task-toggle','check','help','archive'].map(act=>html.indexOf('data-act="'+act+'"'));
  assert.ok(order.every((pos,index)=>pos>=0&&(!index||pos>order[index-1])));
  assert.match(html,/class="reminder-minus" data-act="archive"[^>]*aria-label="移出计划"[^>]*>−<\/button>/);
  assert.equal((html.match(/class="secondary small plan-checkin"/g)??[]).length,P.outcomes.length);
  assert.match(html,/<details class="plan-checkin-menu"><summary class="secondary small">打卡<\/summary>/);
  assert.doesNotMatch(html,/选择结果|data-outcome/);
  assert.doesNotMatch(html,/离开床铺并洗漱/);
  assert.match(html,/计划日期[^\n]*[\s\S]*查看当天的计划和打卡记录/);
  assert.ok(html.indexOf('写一段笔记')<html.indexOf('其他任务'));
  assert.ok(html.indexOf('其他任务')<html.indexOf('明天读一页'));
  await click({act:'check',id:task.id,day:today,value:'completed'});
  assert.equal(savedState.instances[today+'/'+task.id].status,'completed');
  assert.match(fields.view.innerHTML,/data-value="completed" aria-pressed="true"/);
  listeners.change({target:{id:'plan-date',value:tomorrow,matches:()=>false}});
  assert.ok(fields.view.innerHTML.indexOf('明天读一页')<fields.view.innerHTML.indexOf('其他任务'));
  assert.doesNotMatch(fields.view.innerHTML,/aria-pressed="true"/);
  const index=readFileSync('index.html','utf8');
  assert.match(index,/data-page="v1reminders"[^\n]*>主动提醒<\/span><\/button><button type="button" data-page="plan"/);
  assert.match(index,/id="pagetitle"[^\n]*id="plan-heading-note"[^\n]*「主动提醒」管理八项固定提醒/);
});
