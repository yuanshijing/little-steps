const test=require('node:test');
const assert=require('node:assert/strict');
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
