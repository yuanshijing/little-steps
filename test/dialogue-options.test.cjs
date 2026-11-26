const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const P=require('../js/model');
const V=require('../js/v1');
const D=require('../js/dashboard');
const C=require('../js/coach');
const Sync=require('../js/settings-sync');
const S=require('../js/scheduler');

const now=(hour,minute=0,day=26)=>new Date(2026,10,day,hour,minute);
const due={wake:now(7,30),am:now(9),pm:now(14),check:now(16),dinner:now(18,30),bath:now(20),night:now(20,45),sleep:now(22,45)};
function start(id, at=due[id] ?? now(15)) {
  const state=P.createState(at),v=V.init(state);
  state.stars=0;
  v.settings.times['custom-test']={title:'喝水',time:'15:00',enabled:true};
  assert.equal(V.open(state,id,at),true);
  return {state,v,at,item:v.records[v.active.key]};
}
function pick(x,id,at=x.at) {
  const r=V.choose(x.state,x.v.active.revision,id,at);
  assert.ok(r,'missing '+id+' in '+x.v.active?.stage);
  return r;
}
function assertSafe(x, since=0) {
  const messages=x.v.messages.slice(since).map(row=>row.text).join('\n');
  assert.doesNotMatch(messages,/\{(?:task|firstStep)\}|→|离开床铺并洗漱|undefined/);
  if(x.item.id!=='wake')assert.doesNotMatch(messages,/双脚落地|先去洗手间，完成洗漱/);
}
for(const id of [...V.ids,'custom-test']) {
  const first=start(id);
  const rows=V.options(first.v);
  test(id+' — first level',()=>{
    assert.equal(rows.length,id==='wake'||id.startsWith('custom-')?3:4);
    assert.equal(new Set(rows.map(row=>row.id)).size,rows.length);
  });
  for(const one of rows) {
    test(id+' / '+one.id,()=>{
      const session=start(id),revision=session.v.active.revision;
      assert.equal(pick(session,one.id).guidance,null);
      assert.equal(V.choose(session.state,revision,one.id,session.at),false);
      assertSafe(session);
      const next=session.v.active;
      if(!next || next.id!==id || next.stage==='sustain')return;
      const second=V.options(session.v);
      assert.ok(second.length>=2&&second.length<=3);
      for(const choice of second) {
        const x=start(id);
        pick(x,one.id);
        const r=pick(x,choice.id);
        const hasSameThread=x.v.active?.id===id;
        assert.equal(Boolean(r.guidance),Boolean(choice.guide&&hasSameThread),choice.id);
        if(r.guidance){
          assert.equal(r.guidance.input.fixedTurns.length,2);
          assert.equal(r.guidance.input.fixedTurns[0].selection,one.label);
          assert.equal(r.guidance.input.fixedTurns[1].selection,choice.label);
        }
        assertSafe(x);
      }
    });
  }
}
const scenes={
  rise:'wake',wakeCare:'wake',morningProgress:'wake',wash:'wake',breakfast:'wake',
  barrier:'am',otherActivity:'am',begin:'am',sustain:'am',wrap:'night',lunch:'am',
  attention:'check',checkBreak:'check',detour:'pm',recovery:'return',back:'check',backHold:'return',
  afterDinner:'dinner',homeCheck:'dinner',dinnerStart:'dinner',dinnerEating:'dinner',
  dinnerReady:'dinner',dinnerBusy:'dinner',dinnerWrap:'dinner',bathBusy:'bath',bathSwitch:'bath',
  bathTimer:'bath',bathResult:'bath',sleepBarrier:'sleep',sleepInBed:'sleep',sleepReady:'sleep',
  sleepBusy:'sleep',bedtime:'sleep',wait:'pm',customHelp:'custom-test',
};
for(const [stage,phase] of Object.entries(V.phases)) {
  for(const choice of phase.options) {
    test(stage+' / '+choice.id,()=>{
      const x=start(scenes[stage]);
      Object.assign(x.v.active,{stage,resume:'begin'});
      if(stage==='backHold') {
        x.item.returnKey=x.item.key;
        x.item.detourAt=x.at.getTime()-8*60000;
        x.item.backAt=x.at.getTime()-6*60000;
      }
      const before=x.v.messages.length;
      pick(x,choice.id);
      assert.ok(!x.v.active || x.v.active.stage==='initial' || V.phases[x.v.active.stage]);
      assertSafe(x,before);
    });
  }
}
test('wake: reward once, knows washed, no timer delay, health pause',()=>{
  const x=start('wake');
  pick(x,'back_in_bed');
  pick(x,'up',now(7,33));
  assert.equal(x.state.stars,10);
  pick(x,'washed');
  assert.equal(x.v.active.stage,'breakfast');
  assert.equal(V.agreeTime(x.v),false);
  pick(x,'ready',now(7,50));
  assert.equal(x.v.active,null);
  assert.equal(x.state.stars,10);
  const y=start('wake');
  pick(y,'in_bed');
  assert.ok(pick(y,'stuck').guidance);
  assert.equal(V.free(y.state,'身体不舒服',now(7,34)),'local');
  pick(y,'pause');
  assert.ok(y.state.settings.pausedUntil>now(7,34).getTime());
});
test('focus: confirmed start and target preserve sustain, actual handoff requires wrap and lunch',()=>{
  const x=start('am');
  pick(x,'started');
  assert.equal(x.v.active.due,null);
  pick(x,'target',now(9,5));
  assert.equal(x.state.stars,10);
  pick(x,'target',now(9,10));
  assert.equal(x.state.stars,20);
  assert.equal(x.v.active.stage,'sustain');
  assert.equal(x.item.wrappedAt,undefined);
  pick(x,'wrapped',now(12));
  assert.equal(x.v.active.stage,'lunch');
  pick(x,'finished',now(13,48));
  assert.equal(x.v.active.id,'pm');
});
test('check: planned break and distraction left at original task do not create deviation',()=>{
  for(const [first,second] of [['planned_break','later'],['distracted','still'],['distracted','unclear']]){
    const x=start('check');pick(x,first);pick(x,second);
    assert.equal(x.item.detourAt,undefined);
    assert.ok(!x.item.completedAt);
  }
});
test('deviation: explicit return does not mark the original task complete',()=>{
  const x=start('check');
  x.state.plans[x.item.day]={items:[{title:'写论文',firstStep:'打开提纲'}]};
  pick(x,'distracted');
  assert.match(pick(x,'switched').guidance.input.actualTask,/写论文.*打开提纲/);
  pick(x,'phone');
  pick(x,'returned',now(16,3));
  assert.equal(x.item.completedAt,undefined);
  assert.equal(x.state.stars,10);
  pick(x,'target',now(16,5));
  assert.equal(x.state.stars,10);
  pick(x,'target',now(16,8));
  assert.equal(x.state.stars,20);
  assert.equal(x.item.status,'已回归');
});
test('dinner and bath chain, timed completion and near-bedtime',()=>{
  const dinner=start('dinner',now(19,20));pick(dinner,'finished');pick(dinner,'home');
  assert.equal(dinner.v.active.id,'bath');
  const bath=start('bath',now(20,20));pick(bath,'ready');
  assert.equal(V.timerAction(bath.v,'start','combined',0,now(20,20)),true);
  assert.deepEqual(bath.v.timer.stages,[30,10]);
  const restored=P.migrate(JSON.parse(JSON.stringify(bath.state)));
  const v=V.init(restored);
  assert.equal(V.elapsed(v.timer,now(20,45).getTime()),25*60000);
  V.choose(restored,v.active.revision,'finished',now(20,45));
  assert.equal(restored.stars,20);
  assert.equal(v.active.id,'night');
  const noTimer=start('bath',now(22,20));pick(noTimer,'ready');pick(noTimer,'no_timer');pick(noTimer,'finished');
  assert.equal(noTimer.state.stars,10);
  assert.equal(noTimer.v.timers.length,0);
  assert.equal(noTimer.v.active.id,'sleep');
  const eating=start('dinner');pick(eating,'eating');pick(eating,'eating');
  assert.equal(eating.v.active.due,null);
  assert.equal(eating.item.completedAt,undefined);
});
test('bedtime: review can be skipped, user may remain in bed, reward confirms rest only',()=>{
  const x=start('sleep');
  assert.equal(x.v.reviewPrompts,undefined);
  const saved={note:'已有复盘',summary:'保留'};
  x.v.reviews[x.item.day]=saved;
  pick(x,'in_bed');assert.ok(pick(x,'stuck').guidance);
  pick(x,'skip');
  assert.equal(x.v.reviews[x.item.day],saved);
  assert.ok(x.item.readyForRestAt);
  assert.equal(x.item.asleepAt,undefined);
  assert.equal(x.v.active,null);
  assert.equal(x.state.stars,20);
  const y=start('sleep');pick(y,'ready');pick(y,'skip');
  assert.equal(y.v.reviews[y.item.day].skipped,true);
  assert.equal(y.item.completedAt,undefined);
  pick(y,'bed');
});
test('scheduled reminders remain independent and unacknowledged is not failed',()=>{
  const x=start('am');
  x.v.settings.times.pm.time='09:05';
  assert.equal(V.tick(x.state,now(9,5)),true);
  assert.ok(x.v.messages.some(row=>row.source==='schedule' && row.reminderId==='pm'));
  V.tick(x.state,now(9,15));V.tick(x.state,now(9,31));V.tick(x.state,now(9,47));
  assert.equal(x.item.status,'未记录');
});
test('old revision and old wake wait cannot run new actions',()=>{
  const x=start('wake');
  x.v.active.dialogueVersion=2;
  x.v.active.stage='wait';
  const previous=x.v.active.revision;
  const loaded=JSON.parse(JSON.stringify(x.state)),v=V.init(loaded);
  assert.equal(v.active.stage,'rise');
  assert.notEqual(previous,v.active.revision);
  assert.equal(V.choose(loaded,previous,'up',now(7,34)),false);
  assert.equal(loaded.stars,0);
  assert.equal(V.setFollow(v,10,now(7,34)),false);
});
test('confirmed work plans use the current time period, and completed plan rows stay out',()=>{
  const x=start('pm');
  V.park(x.v,'未记录');
  const day=x.item.day;
  x.state.plans[day]={items:[
    {id:'morning',title:'上午文献',when:'09:15',firstStep:'找到目录'},
    {id:'afternoon',title:'下午提纲',when:'14:30',firstStep:'打开提纲'},
    {id:'completed',title:'下午已完成',when:'15:30',firstStep:'记录成果'},
    {id:'evening',title:'晚上阅读',when:'20:45',firstStep:'翻到书签'},
  ]};
  x.state.instances[day+'/completed']={status:'completed'};
  V.open(x.state,'pm',now(14,1));
  assert.match(x.v.active.initialPrompt,/下午提纲/);
  assert.doesNotMatch(x.v.active.initialPrompt,/上午文献|下午已完成|晚上阅读/);
  pick(x,'difficulty');
  assert.match(pick(x,'unclear').guidance.input.actualTask,/下午提纲.*打开提纲/);
});
test('agreed follow-up asks for status before resuming, and a disabled target stays closed',()=>{
  const x=start('dinner',now(19,15));
  pick(x,'finished');pick(x,'outside');
  assert.equal(V.setFollow(x.v,5,now(19,20)),true);
  V.tick(x.state,now(19,25));
  assert.equal(x.v.active.stage,'wait');
  pick(x,'done',now(19,25));
  assert.equal(x.v.active.stage,'homeCheck');
  x.v.settings.times.bath.enabled=false;
  pick(x,'home',now(19,25));
  assert.equal(x.v.active,null);
  assert.equal(x.v.records[x.item.day+'/bath'],undefined);
});
test('bath after midnight routes to a near bedtime without changing reminder times',()=>{
  const x=start('bath',now(0,5,27));
  x.v.settings.times.sleep.time='00:25';
  pick(x,'finished');
  assert.equal(x.v.active.id,'sleep');
  assert.equal(x.v.settings.times.sleep.time,'00:25');
});
test('statistics: daily, ISO weeks and months use recorded earnings without duplicate collectible stars',()=>{
  const x=start('wake');
  pick(x,'up');
  V.message(x.v,'test only');
  x.v.achievements['晨间小达人']='2026-11-26';
  P.event(x.state,'timer_finished',now(9,0,25),{mode:'simple'});
  x.v.reviews['2026-10-31']={note:'review'};
  assert.deepEqual(D.rewardStatistics(x.state,'day','2026-11-26').slice(-2).map(r=>[r.points,r.stars]),[[5,1],[50,1]]);
  assert.deepEqual(D.rewardStatistics(x.state,'week','2026-11-26').at(-1),
    {start:'2026-11-23',after:'2026-11-30',label:'11-23 至 11-29',points:55,stars:2});
  const months=D.rewardStatistics(x.state,'month','2026-11-26');
  assert.deepEqual(months.slice(-2).map(r=>[r.label,r.points,r.stars]),[['2026-10',0,1],['2026-11',55,2]]);
  assert.equal(D.rewardStatistics(x.state,'month','2026-11-25').at(-1).points,5);
  assert.match(D.sky(x.state,'month','2026-11-26'),/aria-pressed="true">按月/);
  const chart=D.sky(x.state,'day','2026-11-26');
  assert.match(chart,/id="reward-title-points">积分统计<\/h3>/);
  assert.match(chart,/id="reward-title-stars">星星统计<\/h3>/);
  assert.match(chart,/class="reward-axis-date">日期/);
  assert.match(chart,/id="reward-value-points-2026-11-26" hidden>50 积分<\/span>/);
  assert.match(chart,/id="reward-value-stars-2026-11-26" hidden>1 颗<\/span>/);
  assert.equal((chart.match(/data-act="reward-value"/g)??[]).length,14);
  assert.ok(chart.indexOf('最近点亮')<chart.indexOf('积分统计'));
});
test('stats: legacy and newly recorded points are counted once and the chart is empty before earnings',()=>{
  const x=start('pm');
  const day=x.item.day;
  assert.ok(D.rewardStatistics(x.state,'month',day).every(row=>row.points===0&&row.stars===0));
  P.event(x.state,'started',now(14),{taskId:'legacy',taskDay:day,status:'active'});
  P.event(x.state,'started',now(14,2),{taskId:'legacy',taskDay:day,status:'active'});
  P.event(x.state,'checkin',now(14,5),{taskId:'new',taskDay:day,status:'completed',pointsEarned:15});
  P.event(x.state,'checkin',now(14,10),{taskId:'new',taskDay:day,status:'completed',pointsEarned:0});
  assert.equal(D.rewardStatistics(x.state,'day',day).at(-1).points,18);
  assert.equal(D.rewardStatistics(x.state,'day',day).at(-1).stars,0);
});
test('account settings still round-trip across devices with custom timing and options',()=>{
  const from=start('pm'),to=start('wake');
  from.v.settings.times.pm.time='15:05';
  from.v.settings.times['custom-test'].time='09:30';
  from.v.settings.times.wake.enabled=false;
  from.v.settings.volume=160;
  const payload=Sync.snapshot(from.state);
  assert.equal(Sync.apply(to.state,payload),true);
  assert.equal(to.v.settings.times.pm.time,'15:05');
  assert.equal(to.v.settings.times['custom-test'].title,'喝水');
  assert.equal(to.v.settings.times['custom-test'].time,'09:30');
  assert.equal(to.v.settings.times.wake.enabled,false);
  assert.equal(to.v.settings.volume,160);
});
test('manual reminder order syncs, leaves times unchanged and preserves chronological default',()=>{
  const x=start('pm'),y=start('pm');
  x.v.settings.times['custom-test'].time='01:15';
  assert.equal(V.displayReminderIds(x.v).at(-1),'custom-test');
  x.v.settings.reminderOrder=['custom-test','night','night','unknown'];
  assert.deepEqual(V.displayReminderIds(x.v).slice(0,2),['custom-test','night']);
  assert.deepEqual(Sync.snapshot(x.state).reminderOrder,['custom-test','night']);
  Sync.apply(y.state,Sync.snapshot(x.state));
  assert.deepEqual(V.displayReminderIds(y.v),V.displayReminderIds(x.v));
  assert.equal(y.v.settings.times['custom-test'].time,'01:15');
  assert.match(D.reminders(y.state),/data-reminder-grip/);
  delete x.v.settings.reminderOrder;
  Sync.apply(y.state,Sync.snapshot(x.state));
  assert.equal(V.displayReminderIds(y.v).at(-1),'custom-test');
});
test('scheduled email and website use identical opening copy for all eight reminders',()=>{
  const email=readFileSync('supabase/functions/email-reminders/index.ts','utf8');
  const openings=new Map(email.split('\n').filter(line=>line.trim().startsWith('["'))
    .map(line=>JSON.parse(line.trim().replace(/,$/,''))));
  for(const id of V.ids)assert.equal(openings.get(id),V.data[id].intro);
});
function mount(state,run,withModel=true,elements={},SpeechRecognition,navigator) {
  const listen={},events={};
  const window={PlanetV1:V,Planet:P,PlanetCoach:C,PlanetDashboard:D,SpeechRecognition,navigator,addEventListener:(type,fn)=>events[type]=fn,
    PlanetPublicDeepSeek:{status:()=>({enabled:withModel}),run},confirm:()=>false};
  const document={addEventListener:(type,fn)=>(listen[type]??=[]).push(fn),getElementById:id=>elements[id]??null,querySelector:()=>null};
  runInNewContext(readFileSync('js/v1-view.js','utf8'),{window,document,location:{protocol:'https:',hostname:'example.org'}});
  const api=window.PlanetV1View.mount({state:()=>state,page:()=> 'v1',save(){},render(){},go(){},syncPanel:()=>'',toast(message){throw Error(message);}});
  events['planet-trial']({detail:{ready:false}});
  const dispatch=(type,event)=>listen[type].forEach(fn=>fn({...event,type}));
  return {markup:(section='chat')=>api.screen(section),dispatch,click:(v1,value='')=>dispatch('click',{target:{closest:()=>({dataset:{v1,value}})}}),window};
}
test('voice button is icon-only and starts without pre-focusing a field',()=>{
  const x=start('pm'), feedback={}, field={value:'原有草稿',maxLength:1500,focus(){this.focused=true;}};
  let speech, starts=0;
  class Recognizer {
    constructor(){speech=this;}
    start(){starts++;}
    stop(){this.stopped=true;}
  }
  const ui=mount(x.state,undefined,false,{'v1-reflection':field,'v1-reflection-voice-feedback':feedback},Recognizer);
  assert.match(ui.markup('review'),/class="mic-icon" aria-hidden="true"/);
  assert.match(ui.markup('review'),/class="weekly-records-heading">任务完成情况/);
  assert.equal((ui.markup('review').match(/class="weekly-detail-card"/g)??[]).length,3);
  assert.doesNotMatch(ui.markup('schedule'),/保持网页打开/);
  ui.click('voice','v1-reflection');
  ui.click('voice','v1-reflection');
  assert.match(ui.markup('review'),/data-value="v1-reflection"\s+aria-label="结束语音输入" aria-pressed="true"/);
  assert.equal(starts,1);
  assert.equal(field.focused,undefined);
  speech.onstart();
  assert.match(feedback.textContent,/正在听，再按一次麦克风停止听写/);
  ui.click('voice','v1-reflection');
  assert.equal(speech.stopped,true);
  speech.onresult({resultIndex:0,results:[[{transcript:'今天读了两页'}]]});
  speech.onend();
  assert.equal(field.value,'原有草稿 今天读了两页');
  assert.equal(field.focused,true);
  assert.match(feedback.textContent,/已填入/);
  ui.click('voice','v1-reflection');
  speech.onerror({error:'not-allowed'});
  speech.onend();
  assert.match(feedback.textContent,/网站权限里允许麦克风/);
  assert.match(ui.markup('review'),/data-value="v1-reflection"\s+aria-label="开始语音输入" aria-pressed="false"/);
});
test('coach styles are visible and task controls are on their own pages',()=>{
  const x=start('pm'),ui=mount(x.state,undefined,false);
  const settings=ui.markup('settings');
  assert.equal((settings.match(/data-coach-style/g)??[]).length,3);
  assert.doesNotMatch(settings,/管理已有的自定义任务|明日重点默认提示时间|昵称/);
  ui.dispatch('change',{target:{matches:selector=>selector==='[data-coach-style]',checked:true,value:'gentle'}});
  assert.equal(x.state.settings.style,'gentle');
  assert.match(ui.markup('settings'),/data-coach-style value="gentle" checked/);
  assert.equal((ui.markup('schedule').match(/data-target="plan"/g)??[]).length,1);
  assert.match(ui.markup('schedule'),/管理计划任务与作息/);
  assert.match(ui.markup('review'),/name="nextDayRemind" data-tomorrow-remind checked/);
  assert.match(ui.markup('review'),/保存明日重点/);
  assert.doesNotMatch(ui.markup('review'),/保存时间/);
  assert.match(ui.markup('review'),/<span class="weekly-record-title">/);
  assert.match(settings,/<h2 class="section-title">长期记忆<\/h2>/);
  assert.doesNotMatch(ui.markup('review'),/查看长期记忆/);
  assert.ok(settings.indexOf('DeepSeek API Key')>=0);
  assert.ok(settings.indexOf('DeepSeek API Key')<settings.indexOf('本地数据'));
});
test('microphone honors the browser permission state for each user-initiated recording',async()=>{
  const x=start('pm'), permission={state:'denied'}, feedback={};
  let recognizer, starts=0, queries=0;
  class Voice {
    constructor(){recognizer=this;}
    start(){starts++;}
  }
  const navigator={permissions:{query:async({name})=>{assert.equal(name,'microphone');queries++;return permission;}}};
  const ui=mount(x.state,undefined,false,{'v1-input':{},'v1-input-voice-feedback':feedback},Voice,navigator);
  await wait();
  ui.click('voice','v1-input');
  assert.equal(starts,0);
  assert.match(feedback.textContent,/网站权限里允许麦克风/);
  permission.state='granted';
  ui.click('voice','v1-input');
  recognizer.onend();
  ui.click('voice','v1-input');
  assert.equal(starts,2);
  assert.equal(queries,1);
});
test('tomorrow plan time can trigger an in-page task reminder without adding an entry to timed reminders',()=>{
  const state=P.createState(now(21));
  state.tasks=[];
  P.savePlan(state,'2026-11-27',[{title:'看文献',when:'13:00',firstStep:'打开摘要'}],'',now(21));
  assert.equal(S.tick(state,now(12,50,27)).kind,'handoff');
  const notice=S.tick(state,now(13,0,27));
  assert.equal(notice.kind,'scheduled');
  assert.match(notice.title,/^计划任务提醒 · /);
  assert.equal(notice.taskId,state.plans['2026-11-27'].items[0].id);
  assert.ok(!V.displayReminderIds(V.init(state)).includes(notice.taskId));
});
test('the whole-plan switch leaves individual task reminders active',()=>{
  const state=P.createState(now(21));
  state.tasks=[];
  P.savePlan(state,'2026-11-27',[{title:'看文献',when:'08:30',firstStep:'打开摘要'}],'',now(21));
  state.settings.nextDayRemind=false;
  assert.equal(S.tick(state,now(8,30,27)).kind,'scheduled');
  assert.equal(S.tick(state,now(9,0,27)).kind,'followup');
  assert.equal(state.plans['2026-11-27'].deliveredAt,null);
  state.settings.nextDayRemind=true;
  state.settings.nextDayTime='09:15';
  assert.notEqual(S.tick(state,now(9,14,27))?.kind,'handoff');
  assert.equal(S.tick(state,now(9,15,27)).kind,'handoff');
  assert.notEqual(S.tick(state,now(9,16,27))?.kind,'handoff');
});
test('the obsolete bedtime confirmation is suppressed without suppressing other planned reminders',()=>{
  const state=P.createState(now(22));
  state.tasks=[];
  P.upsertTask(state,{title:'睡前回复今天',when:'22:00'},now(22));
  P.upsertTask(state,{title:'睡前阅读',when:'22:00'},now(22));
  assert.equal(S.obsoleteBedtimeNotice('还有一步需要确认 · 睡前回复今天'),true);
  assert.equal(S.obsoleteBedtimeNotice('睡前阅读'),false);
  assert.match(S.tick(state,now(22)).title,/睡前阅读/);
  assert.equal(S.tick(state,now(22,1)),null);
});
test('removing one tomorrow task archives it while keeping the other task ID and allows an empty list',()=>{
  const state=P.createState(now(21));
  const day='2026-11-27',first={title:'阅读',when:'08:00',firstStep:'打开文献'},second={title:'写作',when:'13:00',firstStep:'打开提纲'};
  const plan=P.savePlan(state,day,[first,second],'',now(21));
  const remaining=P.savePlan(state,day,[second],'',now(21,1));
  assert.equal(remaining.items[0].id,plan.items[1].id);
  assert.equal(state.tasks.find(row=>row.id===plan.items[0].id).archived,true);
  assert.equal(P.clearPlan(state,day,now(21,2)),true);
  assert.equal(P.clearPlan(state,day,now(21,3)),false);
  assert.equal(state.tasks.find(row=>row.id===plan.items[1].id).archived,true);
  assert.equal(state.plans[day],undefined);
});
test('dragging and keyboard move the reminder row, and reset restores time order',()=>{
  const x=start('pm'),list={children:[],append(...nodes){this.children=nodes;},insertBefore(row,target){
    this.children=this.children.filter(item=>item!==row);
    this.children.splice(target?this.children.indexOf(target):this.children.length,0,row);
  }};
  for(const id of ['wake','am','pm']){
    const row={dataset:{savedReminder:id},parentElement:list,isConnected:true,
      querySelector:()=>({value:x.v.settings.times[id].time}),
      classList:{toggle(){},remove(){}},getBoundingClientRect(){return {bottom:(list.children.indexOf(this)+1)*40};}};
    Object.defineProperty(row,'nextElementSibling',{get(){return list.children[list.children.indexOf(row)+1]??null;}});
    list.children.push(row);
  }
  const status={};
  const view=mount(x.state,undefined,false,{'reminder-list':list,'reminder-order-status':status});
  const grip={closest:()=>list.children.find(row=>row.dataset.savedReminder==='wake'),setPointerCapture(){},focus(){}};
  const event={target:{closest:()=>grip},button:0,isPrimary:true,pointerId:1};
  view.dispatch('pointerdown',{...event,clientY:20});
  view.dispatch('pointermove',{...event,clientY:104});
  view.dispatch('pointermove',{...event,clientY:22});
  view.dispatch('pointerup',event);
  assert.equal(x.v.settings.reminderOrder,undefined);
  view.dispatch('pointerdown',{...event,clientY:20});
  view.dispatch('pointermove',{...event,clientY:104});
  view.dispatch('pointerup',event);
  assert.deepEqual(Array.from(x.v.settings.reminderOrder),['am','pm','wake']);
  view.dispatch('keydown',{...event,key:'ArrowUp',preventDefault(){}});
  assert.deepEqual(Array.from(x.v.settings.reminderOrder),['am','wake','pm']);
  view.click('reminderTimeSort');
  assert.deepEqual(list.children.map(row=>row.dataset.savedReminder),['wake','am','pm']);
  assert.equal(x.v.settings.reminderOrder,undefined);
});
const wait=()=>new Promise(resolve=>setImmediate(resolve));
function loginHarness(session) {
  const actions={}, shown=[], account={textContent:''};
  const document={
    getElementById:()=>null, querySelector:()=>account, addEventListener(){},
    head:{append(){}},body:{append(){}},
    createElement(kind){
      if(kind==='script')return {addEventListener:(type,handler)=>{actions[type]=handler;}};
      const label={},events={};
      return {
        setAttribute(){},querySelector:selector=>selector==='[role="status"]'?label:{addEventListener(){}},
        addEventListener:(type,handler)=>{events[type]=handler;},
        showModal(){this.open=true;shown.push(this);},close(){this.open=false;events.close();},remove(){},
      };
    },
  };
  const window={Planet:P,PlanetV1:V,addEventListener(){},dispatchEvent(){},
    supabase:{createClient:()=>({
      auth:{onAuthStateChange(){},getSession:async()=>({data:{session}})},
      from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})}),
    })}};
  runInNewContext(readFileSync('js/settings-sync.js','utf8'),{window,globalThis:window,document,
    location:{origin:'null',pathname:'/index.html',protocol:'file:'},
    sessionStorage:{getItem:()=> 'old dismissed flag'},setTimeout:()=>1,clearTimeout(){},
    AbortSignal,CustomEvent:class{},fetch:async()=>Response.json({ready:false})});
  const state=P.createState();
  const sync=window.PlanetSettingsSync.mount({state:()=>state,save(){},redraw(){},toast(){},storage:{},
    config:{url:'https://fixture.supabase.co',key:'sb_publishable_fixture'}});
  return {actions,shown,sync,account};
}
test('guests get the login modal, can dismiss and open it again, and persisted sessions skip it',async()=>{
  const guest=loginHarness(null);
  guest.actions.load();
  await wait();
  assert.equal(guest.shown.length,1);
  assert.match(guest.shown[0].innerHTML,/登录小步星球/);
  guest.shown[0].close();
  assert.equal(guest.sync.openLogin(),true);
  assert.equal(guest.shown.length,2);
  const signed=loginHarness({user:{id:'test',email:'fixture@example.test'}});
  signed.actions.load();
  await wait();
  assert.equal(signed.shown.length,0);
  assert.equal(signed.sync.openLogin(),false);
  assert.equal(signed.account.textContent,'fixture@example.test');
  const offline=loginHarness(null);
  offline.actions.error();
  assert.equal(offline.shown.length,1);
  assert.match(offline.shown[0].innerHTML,/暂时无法加载登录服务/);
});
test('view: fixed vs dynamic options, consecutive context, no award from AI or text',async()=>{
  const x=start('pm');
  const calls=[];
  const ui=mount(x.state,async(_,input)=>{
    calls.push(input);
    return {reply:'先把材料移到眼前。',quickReplies:['已经移好了','还是卡住了','要换一个方法','第四个']};
  });
  const button=id=>ui.click('choice',x.v.active.revision+'/'+id);
  button('difficulty');
  assert.equal(calls.length,0);
  button('unclear');
  await wait();
  assert.equal(calls.length,1);
  const html=ui.markup();
  assert.match(html,/<summary>更多操作<\/summary>/);
  assert.equal((html.match(/data-v1="modelOption"/g)??[]).length,3);
  assert.doesNotMatch(html,/data-v1="choice"/);
  await ui.click('modelOption','0');
  await wait();
  assert.equal(calls.length,2);
  assert.ok(calls[1].recent.some(row=>row.text==='先把材料移到眼前。'));
  assert.equal(x.state.stars,0);
  ui.click('fixedOptions');
  assert.match(ui.markup(),/data-v1="choice"/);
  await ui.click('remindOff');
  assert.equal(x.v.settings.times.pm.enabled,true);
  ui.window.confirm=()=>true;
  await ui.click('remindOff');
  assert.equal(x.v.settings.times.pm.enabled,false);
  assert.equal(x.item.status,'未记录');
});
test('view: no config, failed model, and stale reply stay in the correct fixed scene',async()=>{
  for(const enabled of [false,true]){
    const x=start('bath'),ui=mount(x.state,async()=>{throw Error('timeout');},enabled);
    const btn=id=>ui.click('choice',x.v.active.revision+'/'+id);
    btn('busy');btn('busy');await wait();
    assert.match(ui.markup(),/data-v1="choice"/);
    assert.doesNotMatch(ui.markup(),/data-v1="modelOption"/);
  }
  const x=start('pm');
  let complete;
  const ui=mount(x.state,()=>new Promise(resolve=>complete=resolve));
  ui.click('choice',x.v.active.revision+'/difficulty');
  ui.click('choice',x.v.active.revision+'/unclear');
  V.open(x.state,'bath',now(20));
  complete({reply:'过期回复',quickReplies:['过期选项']});
  await wait();
  assert.doesNotMatch(ui.markup(),/过期回复|过期选项/);
});
test('model paths retain matching prompts and sanitize continuous context',async()=>{
  const trial=readFileSync('supabase/functions/trial-coach/index.ts','utf8');
  const personal=readFileSync('js/deepseek-public.js','utf8');
  const line=(src,key)=>src.split('\n').find(s=>s.includes('const '+key+' ='));
  for(const k of ['SYSTEM','REVIEW_SYSTEM'])assert.equal(line(trial,k),line(personal,k));
  let handle,fromTrial,fromPersonal;
  const fakeReply={reply:'测试',quickReplies:[]};
  const completion=Response.json({usage:{total_tokens:1},choices:[{message:{content:JSON.stringify(fakeReply)}}]});
  const auth={id:'test-only',email:'fixture@example.test',email_confirmed_at:'2026-11-26'};
  const env={SUPABASE_URL:'https://fixture.test',DEEPSEEK_API_KEY:'fixture'};
  const input={text:'只解释刚才的新困难',scene:'custom-test',reminderId:'custom-test',status:'customHelp',
    actualTask:'喝水',fixedTurns:[{stage:'initial',selection:'需要帮助'},{stage:'customHelp',selection:'还是没开始'}],
    recent:Array.from({length:10},(_,i)=>({role:'you',text:'对话 '+i})), strategies:['先准备水杯']};
  const context=body=>JSON.parse(JSON.parse(body).messages.at(-1).content);
  runInNewContext(stripTypeScriptTypes(trial),{Deno:{env:{get:key=>env[key]},serve:fn=>handle=fn},
    fetch:async(url,o)=>{
      if(url.endsWith('/auth/v1/user'))return Response.json(auth);
      if(url.endsWith('/trial_access'))return Response.json({eligible:true,day:'2026-11-26'});
      if(url.endsWith('/trial_report'))return new Response(null,{status:204});
      fromTrial=context(o.body);return completion.clone();
    },AbortSignal,TextDecoder,Response});
  const window={Planet:P};
  runInNewContext(personal,{window,fetch:async(_,o)=>{fromPersonal=context(o.body);return completion.clone();},AbortSignal});
  await window.PlanetPublicDeepSeek.connect('sk-fixture-123456');
  await window.PlanetPublicDeepSeek.run('coach',input);
  const req=new Request('https://fixture.test',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({route:'coach',input})});
  assert.equal((await handle(req)).status,200);
  assert.deepEqual(fromTrial,fromPersonal);
  assert.equal(fromTrial.reminderId,'custom-test');
  assert.equal(fromTrial.recent.length,8);
  assert.match(fromTrial.recent.at(-1).text,/9$/);
});
