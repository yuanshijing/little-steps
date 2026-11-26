const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../js/model');
const V=require('../js/v1');
const Data=require('../js/account-data');

const blank=()=>P.createState(new Date('2026-11-27T12:00:00'));
const copy=value=>JSON.parse(JSON.stringify(value));
test('account snapshot round trips user data and excludes credentials and active timers',()=>{
  const state=blank(), v=V.init(state);
  state.settings.style='gentle';
  state.settings.apiKey='secret';
  state.timer={mode:'focus'};
  v.timer={key:'bath'};
  v.settings.memory=false;
  v.messages.push({role:'user',text:'过去的对话'});
  v.memory.push({id:'preference',text:'给我一步',scene:'all'});
  v.reviews['2026-11-27']={text:'当日复盘'};
  state.plans['2026-11-28']={items:[{title:'明日重点'}]};
  const payload=Data.snapshot(state);
  assert.equal(JSON.stringify(payload).includes('secret'),false);
  assert.equal(payload.timer,undefined);
  assert.equal(payload.v1.timer,undefined);
  const second=blank();
  assert.equal(Data.apply(second,payload),true);
  assert.equal(V.init(second).settings.memory,false);
  assert.deepEqual(Data.snapshot(second),payload);
});

test('concurrent chat and preferences merge, and a deletion survives remote changes',()=>{
  const state=blank(), v=V.init(state);
  v.memory.push({id:'old',text:'旧记忆'});
  const base=Data.snapshot(state), local=copy(base), cloud=copy(base);
  local.v1.memory=[];
  local.v1.settings.memory=false;
  local.v1.messages.push({syncId:'phone',text:'手机新增',at:10});
  cloud.v1.memory.push({id:'new',text:'电脑新增'});
  cloud.v1.messages.push({syncId:'desktop',text:'电脑新增',at:20});
  cloud.v1.reviews['2026-11-27']={text:'保存每日复盘'};
  const result=Data.merge(base,local,cloud);
  assert.deepEqual(result.v1.memory,[{id:'new',text:'电脑新增'}]);
  assert.deepEqual(result.v1.messages.map(row=>row.syncId),['phone','desktop']);
  assert.equal(result.v1.settings.memory,false);
  assert.ok(result.v1.reviews['2026-11-27']);
  assert.deepEqual(local.v1.memory,[]);
});

test('finishing the same reminder on two devices awards only once',()=>{
  const base=Data.snapshot(blank()), local=copy(base), cloud=copy(base), key='2026-11-27/am';
  local.v1.records[key]={key,id:'am',points:10,completedAt:1,history:[]};
  cloud.v1.records[key]={key,id:'am',points:10,completedAt:2,history:[]};
  local.v1.rewardHistory.push({key,id:'am',level:1,at:1,bonus:10});
  cloud.v1.rewardHistory.push({key,id:'am',level:1,at:2,bonus:10});
  const result=Data.merge(base,local,cloud), state=blank();
  assert.equal(Data.apply(state,result),true);
  assert.equal(state.stars,30);
  assert.equal(result.v1.records[key].points,10);
  assert.equal(result.v1.rewardHistory.length,1);
});

test('same-account sync preserves data across a revision conflict and separates local account baselines',async()=>{
  const baseState=blank(), second=blank();
  let state=baseState, row=null, conflict=false;
  const kept=new Map();
  function query() {
    let payload, revision, update=false;
    const run=async()=>{
      if(update && conflict){
        conflict=false;
        row.payload.v1.memory.push({id:'other-device',text:'冲突时写入'});
        row.revision++;
        return {data:null};
      }
      if(payload)row={payload:copy(payload),revision};
      return {data:row&&copy(row)};
    };
    return {select(){return this;},eq(){return this;},maybeSingle:run,single:run,
      insert(data){({payload,revision}=data);return this;},update(data){update=true;return this.insert(data);}};
  }
  const sync=Data.mount({state:()=>state,client:()=>({from:query}),
    storage:{getItem:key=>kept.get(key),setItem:(key,value)=>kept.set(key,value)},redraw(){},changed(){}});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  sync.changeAccount('same');
  await settle();
  assert.equal(row,null);
  V.init(state).memory.push({id:'local',text:'第一台设备'});
  await sync.refresh(true);
  assert.equal(sync.enabled(),true);
  conflict=true;
  V.init(state).memory.push({id:'later',text:'同一账号的离线编辑'});
  await sync.refresh();
  await new Promise(resolve=>setTimeout(resolve,450));
  assert.deepEqual(row.payload.v1.memory.map(x=>x.id).sort(),['later','local','other-device']);
  state=second;
  row=null;
  sync.changeAccount('different');
  await settle();
  assert.equal(sync.enabled(),false);
  assert.deepEqual(V.init(second).memory,[]);
});
