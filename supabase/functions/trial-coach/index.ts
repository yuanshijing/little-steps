const P={clean:(value,n)=>String(value??'').trim().slice(0,n),bounded:(v,min,max,fallback)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback,shiftDate:(s)=>new Date(s+'T12:00:00Z').toISOString().slice(0,10)};
  const SYSTEM = "你是小步星球的小星，一名 ADHD 友好型执行功能陪伴教练。你提供日常行动引导、科研任务拆解、偏航恢复、行为复盘和适度情绪支持。用自然中文，简短、准确、温暖、平等、务实，不说教。\n优先照顾身体健康、睡眠和基本生活，再推进用户已确认的高优先级目标（如博士论文和毕业）、必要事务及可灵活安排的兴趣。以用户最新明确的需求为准，保留用户选择权。允许分心、休息和重新选择，帮助用户及时回到重要任务，重视持续性。\n以本次消息、已确认计划、最近相关对话和个人指导资料作为依据。个人背景、过去观察和时间安排是参考，行为机制是待验证假设。区分已专注、尚未开始、开始后走神和有意识休息，不重复询问已知信息；只补问一个行动所必需的未知点。不捏造已发生的行为、进度或工具能力。\n启动或回科研时，优先接续已经确定的研究任务，跳过已完成的步骤。给一个马上可做、回答具体学术问题并能留下可复用产出的动作；例如从已打开的研究原文记录一条实验组反馈规则和出处。有需要时实质性帮助核对文献来源、判断方法、设计研究框架和干预对照，区分给定证据与待核实内容。用短时间降低启动门槛，已进入专注就减少对话，不打断。\n偏航时，简短识别原任务、诱因、当前活动和退出障碍，区分事实和假设。优先退出干扰，接回一个真实动作；新想法先记极少关键词。用户主动选择临时事项或确实需要现在处理时，尊重选择，约定明确收尾点后接回原任务。留意高即时反馈、决策不确定、社交反刍、环境干扰和把规划或改进工具变成拖延；仅在用户希望反思时展开分析。\n尊重用户主动安排的吃饭、洗澡、休息、社交与兴趣；必要时帮她选一个现实退出点或完成后的衔接。计时视作可选工具，参考实际经历调整；不把旧作息或用时当硬性要求。可选地使用短音频或其他低负担过渡办法，保护正在进行的专注。奖励要对应可见产出与实际进展。\n用户表达焦虑、委屈、后悔或关系困扰时，先回应具体事实和感受，按用户需要决定是否回到任务。不要读心、简单站队、羞辱或把疲惫时的感受当作重大决定。可帮助命名感受、允许存在、延迟冲动和自主选择。涉及严重失眠、重复拔发等持续损害时适度建议专业帮助，不作诊断；有紧急安全风险时优先建议联系当地紧急服务及可信任的人。\n睡前可按已报告的科研产出和偏航，简短整理明天最多三项重要任务和各自第一步，尽量上床前结束。很晚或很困时睡眠优先，不通过熬夜补偿。提醒、同步、存储、记忆写入和更改计划须经用户授权并由实际系统执行，只能提供建议，不能宣称已完成。常规起床引导帮助用户离床，避免给出延迟起床选项。\n监督时按需使用当前状态、关键判断、现在只做、完成标志、后续衔接，无需逐项输出。用户只请求启动时，直接给一个具体动作，不先复述或长篇分析。返回 JSON 对象，字段 reply、quickReplies（固定为空数组）、nextAction、barrierType、followUpMinutes（1 到 120 或 null）。没有合适动作时 nextAction 留空。";
  const REVIEW_SYSTEM = "你是小步星球的 ADHD 友好型执行功能复盘教练。将任务记录、偏航案例、用户补充和个人指导资料作为资料。区分已记录事实、用户自述、真实完成、未确认进展及待验证假设，未记录不能当作未完成，不编造数据。\n每日简短回顾已确认的实际行为、科研微产出和主要偏航。用户提供了明日意向时，整理最多三项重点、优先次序和各自第一步；不要求重报，睡眠优先。每周依据当周真实证据分析进步、有效衔接、典型偏航链、睡眠与环境、回归成败、提示失效和有记录的策略；最多给两项可验证的微调，保留已定核心目标。\n用自然中文，简短、温和、具体、不责备。不得诊断、虚构数据、调整任务、写入记忆，或宣称已经设置提醒。返回 JSON 对象，summary 是一到三段纯文本，总计不超过 600 字。";
  const wakeProhibited = /再睡|多睡|继续睡|补觉|回笼觉|赖床|晚点起|延迟.{0,6}起床|推迟.{0,6}起床|睡.{0,8}(分钟|小时)|snooze|sleep in/i;
  function fixedGuidance(input) {
    const id = input.reminderId;
    const validId = ['wake','am','pm','check','dinner','bath','night','sleep','return'].includes(id) ||
      (typeof id==='string' && /^custom-[A-Za-z0-9-]{1,73}$/.test(id));
    if (!validId) return {};
    return {
      reminderId: input.reminderId,
      actualTask: P.clean(input.actualTask,160),
      userState: P.clean(input.userState,500),
      fixedTurns: (Array.isArray(input.fixedTurns)?input.fixedTurns:[]).slice(0,2).map(turn=>({
        stage:P.clean(turn?.stage,60),question:P.clean(turn?.question,2400),
        selection:P.clean(turn?.selection,500),response:P.clean(turn?.response,700),
      })),
      confirmedPlan: P.clean(input.plan,2400),
      strategies: (Array.isArray(input.strategies)?input.strategies:[]).slice(-4).map(row=>P.clean(row,300)),
    };
  }
  function sanitize(input) {
    if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 500) return null;
    return {
      ...fixedGuidance(input),
      text: P.clean(input.text, 500), scene: P.clean(input.scene, 24), status: P.clean(input.status, 50),
      profile: { style: P.clean(input.style, 20), schedule: P.clean(JSON.stringify(input.schedule ?? {}), 430) },
      plan: P.clean(input.plan, 1200),
      coachGuide: P.clean(input.coachGuide, 8000),
      recent: (Array.isArray(input.recent) ? input.recent : []).slice(-8).map(row => ({ role: P.clean(row?.role, 12), text: P.clean(row?.text, 460) })),
      memories: (Array.isArray(input.memories) ? input.memories : []).slice(-4).map(row => ({ source: P.clean(row?.source, 20), text: P.clean(row?.text, 180) })),
    };
  }
  function verify(value, scene) {
    if (!value || typeof value.reply !== 'string' || !value.reply.trim() || value.reply.length > 460) throw new Error('模型回复不符合格式');
    const nextAction = P.clean(value.nextAction, 160);
    if (scene === 'wake' && [value.reply, nextAction].some(text => wakeProhibited.test(text))) {
      throw new Error('起床建议未通过验证');
    }
    return { reply: value.reply, quickReplies: [], nextAction, barrierType: P.clean(value.barrierType, 35),
      followUpMinutes: P.bounded(value.followUpMinutes, 1, 120, null) };
  }
  function sanitizeReview(input) {
    if (!input || !['daily','weekly'].includes(input.kind) || typeof input.day !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.day) || P.shiftDate(input.day,0) !== input.day ||
        !Array.isArray(input.records) || !Array.isArray(input.cases)) return null;
    const lines = (rows, count, limit) => rows.slice(0,count).map(line => P.clean(line,limit)).filter(Boolean);
    return {kind:input.kind,day:input.day, records:lines(input.records,30,100),
      cases:lines(input.cases,6,160), note:P.clean(input.note,700), coachGuide:P.clean(input.coachGuide,8000)};
  }
  function verifyReview(value) {
    if (typeof value?.summary !== 'string' || !value.summary.trim() || value.summary.length > 650) {
      throw new Error('复盘内容不符合格式');
    }
    return {summary:value.summary.trim()};
  }

const headers={'Access-Control-Allow-Origin':'https://yuanshijing.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});
const api=Deno.env.get('SUPABASE_URL');
const maxRequestBytes=56*1024;
async function rpc(name,args){
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const res=await fetch(api+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args)});
 if (!res.ok) throw Error('storage');
 return res.status===204?null:res.json();
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return json({},405);
 const authorization=req.headers.get('Authorization');
 if(!authorization?.startsWith('Bearer '))return json({},401);
 try {
   const auth=await fetch(api+'/auth/v1/user',{headers:{apikey:Deno.env.get('SUPABASE_ANON_KEY'),Authorization:authorization}});
   if(!auth.ok)return json({},401);
   const user=await auth.json();
   if(!user.id || !user.email || !user.email_confirmed_at)return json({},403);
   if(Number(req.headers.get('Content-Length'))>maxRequestBytes)return json({},413);
   const reader=req.body?.getReader(); if(!reader)return json({},400);
   let raw='',size=0; const decoder=new TextDecoder();
   for(;;){ const {done,value}=await reader.read(); if(done)break; size+=value.length;
     if(size>maxRequestBytes){await reader.cancel();return json({},413);} raw+=decoder.decode(value,{stream:true}); }
   let payload; try{payload=JSON.parse(raw+decoder.decode());}catch{return json({},400);}
   const {route,input}=payload||{};
   if(!['status','coach','review'].includes(route))return json({},400);
   const review=route==='review';
   let data; if(route!=='status'){
     try {data=review?(input?.consent===true&&sanitizeReview(input)):sanitize(input);}catch{}
     if(!data)return json({},400);
   }
   const key=Deno.env.get('DEEPSEEK_API_KEY');
   const access=await rpc('trial_access',{uid:user.id,member_email:user.email,reserve:Boolean(key)&&route!=='status'});
   if(route==='status')return json({...access,ready:Boolean(key)&&access.eligible});
   if(!access.eligible)return json({},403);
   if(!key)return json({},503);
   if(access.limited)return json({},429);
   const result=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
     headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
     body:JSON.stringify({model:'deepseek-flash',max_tokens:640,thinking:{type:'disabled'},response_format:{type:'json_object'},
       messages:[{role:'system',content:review?REVIEW_SYSTEM:SYSTEM},{role:'user',content:JSON.stringify(data)}]})});
   if(!result.ok)return json({},502);
   const response=await result.json();
   const consumed=response.usage?.total_tokens;
   if(Number.isSafeInteger(consumed)&&consumed>=0)await rpc('trial_report',{uid:user.id,usage_day:access.day,consumed});
   const value=JSON.parse(response.choices?.[0]?.message?.content||'null');
   return json(review?verifyReview(value):verify(value,data.scene));
 }catch{return json({},503);}
});
