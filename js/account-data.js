((root,factory)=>{
  if (typeof module !== 'undefined') module.exports=factory(require('./model'),require('./v1'),require('./dashboard'));
  else root.PlanetAccountData=factory(root.Planet,root.PlanetV1,root.PlanetDashboard);
})(globalThis,(P,V,D)=>{
  'use strict';
  const fields=['name','tasks','instances','events','recoveries','plans','switches','chat','memory'];
  const settings=['style','follow','max','pausedUntil','nextDayTime','nextDayRemind'];
  const coachFields=['records','events','messages','usedQuotes','quoteByWeek','ideas','memory','timers',
    'achievements','reviews','weekly','rewardHistory','reviewPrompts','reviewSummaries','weekNotes'];
  const coachSettings=['basic','advanced','wakeLimit','startLimit','focusMin','sleepLimit','returnLimit','returnMin','memory'];
  const copy=value=>JSON.parse(JSON.stringify(value));
  const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  function same(a,b) {
    if(a===b)return true;
    if(Array.isArray(a) && Array.isArray(b))return a.length===b.length && a.every((value,i)=>same(value,b[i]));
    if(!object(a)||!object(b))return false;
    const keys=Object.keys(a);
    return keys.length===Object.keys(b).length && keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
  }
  const select=(source,keys)=>Object.fromEntries(keys.filter(key=>source[key]!==undefined).map(key=>[key,source[key]]));
  function total(state) {
    return [...D.pointsByDay(state).values()].reduce((sum,n)=>sum+n,0);
  }
  function snapshot(state) {
    const v=V.init(state);
    const tasks=state.tasks.filter(task=>!pristineTask(task,state));
    const localStarters=new Set(state.tasks.filter(task=>!tasks.includes(task)).map(task=>task.id));
    const instances=Object.fromEntries(Object.entries(state.instances).filter(([,row])=>!localStarters.has(row.taskId)));
    return copy({...select(state,fields),tasks,instances,settings:select(state.settings,settings),
      untrackedPoints:Math.max(0,state.stars-total(state)),
      v1:{...select(v,coachFields),settings:select(v.settings,coachSettings)}});
  }
  const defaults=P.createState().tasks;
  const taskShape=({id,day,...task})=>task;
  function pristineTask(task,state) {
    // Fresh browsers create their own starter tasks. Share them only after they have user data.
    return defaults.some(row=>same(taskShape(row),taskShape(task))) &&
      !state.tasks.some(row=>row.dependsOn===task.id) &&
      !Object.values(state.instances).some(row=>row.taskId===task.id && row.status!=='pending') &&
      !state.events.some(row=>row.taskId===task.id);
  }
  function valid(data) {
    return object(data) && Array.isArray(data.tasks) && Array.isArray(data.events) &&
      Array.isArray(data.chat) && object(data.instances) && object(data.settings) && object(data.v1) && object(data.v1.settings) &&
      ['records','events','messages','memory','timers','achievements','reviews','rewardHistory'].every(key=>data.v1[key]!==undefined) &&
      coachFields.every(key=>data.v1[key]===undefined || (['events','messages','usedQuotes','ideas','memory','timers','rewardHistory'].includes(key)
        ? Array.isArray(data.v1[key]) : object(data.v1[key])));
  }
  function apply(state,data) {
    if(!valid(data))return false;
    const incoming=copy(data), v=V.init(state);
    const starters=state.tasks.filter(task=>pristineTask(task,state) &&
      !incoming.tasks.some(row=>row.title===task.title && row.category===task.category));
    const starterIds=new Set(starters.map(row=>row.id));
    const localInstances=Object.fromEntries(Object.entries(state.instances).filter(([,row])=>starterIds.has(row.taskId)));
    Object.assign(state,select(incoming,fields),{tasks:[...incoming.tasks,...starters],instances:{...localInstances,...incoming.instances}});
    Object.assign(state.settings,select(incoming.settings,settings));
    for (const key of coachFields) {
      if(Object.hasOwn(incoming.v1,key))v[key]=incoming.v1[key];
      else delete v[key]; // Optional review metadata may have been removed on another device.
    }
    Object.assign(v.settings,select(incoming.v1.settings,coachSettings));
    if(v.active && (!v.records[v.active.key] || v.records[v.active.key].completedAt))v.active=null;
    v.queue=v.queue.filter(row=>!v.records[row.day+'/'+row.id]?.completedAt);
    state.stars=total(state)+Math.max(0,Number(incoming.untrackedPoints)||0);
    return true;
  }
  function keyFor(row,path) {
    if(!object(row))return JSON.stringify(row);
    if(path==='v1.rewardHistory')return row.key+'/'+row.level;
    if(path==='events' && ['started','checkin'].includes(row.type) && row.taskId &&
      ['active','completed','partial'].includes(row.status) && row.pointsEarned!==0) {
      return [row.type,row.taskDay,row.taskId,row.status].join('/');
    }
    return row.syncId ?? (path==='v1.events'?undefined:row.id) ??
      JSON.stringify(row,(_,value)=>object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
  }
  function indexed(rows,path) {
    const seen=new Map();
    return new Map(rows.map(row=>{
      const key=keyFor(row,path), count=seen.get(key)??0;
      seen.set(key,count+1);
      return [key+'#'+count,row];
    }));
  }
  function mergeArray(base,left,right,path) {
    const before=indexed(base,path), local=indexed(left,path), cloud=indexed(right,path);
    const keys=new Set([...cloud.keys(),...local.keys()]);
    const result=[];
    for(const key of keys){
      const a=local.get(key), b=cloud.get(key);
      if(a===undefined || b===undefined){
        if(!before.has(key))result.push(a??b);
      } else if(path==='v1.rewardHistory' && before.get(key)===undefined) {
        result.push((a.at??Infinity)<(b.at??Infinity)?a:b);
      } else result.push(mergeValue(before.get(key),a,b,path+'[]'));
    }
    if(['chat','events','v1.messages','v1.events','v1.rewardHistory','v1.timers'].includes(path)){
      const date=row=>typeof row?.at==='number'?row.at:Date.parse(row?.at)||0;
      result.sort((a,b)=>date(a)-date(b));
    }
    return result;
  }
  function mergeValue(base,local,cloud,path='') {
    if(same(local,base))return cloud;
    if(same(cloud,base) || same(local,cloud))return local;
    if(local===undefined || cloud===undefined)return base===undefined ? local??cloud : undefined;
    if(path==='untrackedPoints')return Math.max(local,cloud);
    if(Array.isArray(local)&&Array.isArray(cloud)){
      if(['tasks','events','recoveries','switches','chat','v1.events',
        'v1.messages','v1.usedQuotes','v1.ideas','v1.memory','v1.timers','v1.rewardHistory'].includes(path) ||
        /^v1\.records\.[^.]+\.history$/.test(path))return mergeArray(Array.isArray(base)?base:[],local,cloud,path);
      return local;
    }
    if(object(local)&&object(cloud)){
      const keys=new Set([...Object.keys(cloud),...Object.keys(local)]);
      return Object.fromEntries([...keys].filter(key=>!['__proto__','prototype','constructor'].includes(key)).map(key=>
        [key,mergeValue(base?.[key],local[key],cloud[key],path?path+'.'+key:key)]).filter(([,value])=>value!==undefined));
    }
    return local;
  }
  function merge(base,local,cloud) {
    const merged=copy(mergeValue(base,local,cloud));
    // Concurrent basic and advanced awards refer to a single task; rebuild its recorded points from the ledger.
    const awards=new Map();
    for(const row of merged.v1.rewardHistory??[]){
      const history=awards.get(row.key)??[];
      history.push(row);awards.set(row.key,history);
    }
    for(const [key,rows] of awards){
      const record=merged.v1.records?.[key];
      if(record)record.points=rows.reduce((sum,row)=>sum+(Number(row.bonus)||0),0);
    }
    return merged;
  }
  function mount({state,client,storage,changed,redraw}) {
    let account=null, version=0, base=null, revision=null, ready=false, busy=false, retry=false, dirty=false, timer;
    let status='';
    const key=id=>'little-steps-account-base/'+id;
    function changeAccount(id) {
      clearTimeout(timer);
      account=id;version++;ready=false;busy=false;retry=false;dirty=false;revision=null;base=null;status='';
      if(!id)return;
      try{const data=JSON.parse(storage.getItem(key(id))); if(valid(data))base=data;}catch{/* Offline sync can recover from the cloud. */}
      void refresh();
    }
    function remember(data) {
      base=copy(data);
      try{storage.setItem(key(account),JSON.stringify(base));}catch{/* Main state remains available in this session. */}
    }
    async function refresh(enable=false) {
      if(!account || busy)return;
      const id=account, generation=version;
      busy=true;ready=false;retry=false;status='正在同步账号数据…';redraw();
      try{
        const table=client().from('planet_account_data');
        const result=await table.select('payload,revision').eq('user_id',id).maybeSingle();
        if(generation!==version)return;
        if(result.error)throw result.error;
        const row=result.data;
        if(!row && !enable && revision===null){status='';return;}
        if(row && !valid(row.payload))throw Error('Invalid cloud data');
        const local=snapshot(state());
        let data=local;
        if(row){
          if(base)data=merge(base,local,row.payload);
          else data=merge(snapshot(P.createState()),local,row.payload);
        }
        if(!row || !same(row.payload,data)){
          const write=row
            ? await table.update({payload:data,revision:row.revision+1}).eq('user_id',id).eq('revision',row.revision).select('revision').maybeSingle()
            : await table.insert({user_id:id,payload:data,revision:1}).select('revision').single();
          if(generation!==version)return;
          if(write.error?.code==='23505' || (!write.error&&!write.data)){
            status='正在合并另一台设备的更新…';retry=true;return;
          }
          if(write.error)throw write.error;
          revision=write.data.revision;
        } else revision=row.revision;
        const current=snapshot(state());
        if(!same(data,local))apply(state(),merge(local,current,data));
        remember(data);
        ready=true;status='账号数据已同步';
        if(!same(data,local))changed();
        dirty=!same(snapshot(state()),base);
      } catch {
        if(generation===version)status='账号数据同步暂不可用，当前设备的记录已保留。';
      } finally {
        if(generation===version){
          busy=false;redraw();
          if(retry || dirty){dirty=false;clearTimeout(timer);timer=setTimeout(()=>void refresh(enable),350);}
        }
      }
    }
    function onSave() {
      if(!account || (base && same(snapshot(state()),base)))return;
      if(busy){dirty=true;return;}
      if(!ready)return;
      clearTimeout(timer);
      timer=setTimeout(()=>void refresh(),500);
    }
    function update(data) {
      const origin=snapshot(P.createState());
      apply(state(),merge(origin,snapshot(state()),data));
      const saved=changed();
      if(!ready)void refresh(true);
      return saved;
    }
    return {changeAccount,refresh,onSave,update,status:()=>status,enabled:()=>revision!==null||base!==null,busy:()=>busy};
  }
  return {snapshot,apply,merge,mount};
});
