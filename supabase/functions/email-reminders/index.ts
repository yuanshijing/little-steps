import nodemailer from 'npm:nodemailer@7';
const sender=Deno.env.get('REMINDER_SMTP_USER')?.trim();
const site='https://yuanshijing.github.io/little-steps/';
// Keep these opening lines aligned with js/v1-data.js.
const reminderOpenings = new Map<string, string>([
  ["wake","早安呀！☀️ 新的一天开始啦。你现在起床了吗？"],
  ["am","上午的成长时间到啦！☀️ 来看看今天的重点，你现在是什么状态？"],
  ["pm","下午好呀！我们来看看下午最需要推进的事情。你现在是什么状态？"],
  ["check","小星来看看你啦！✨ 现在的你正在做什么？"],
  ["dinner","到晚饭时间啦！记得照顾好自己。你现在吃晚饭了吗？"],
  ["bath","到洗澡时间啦！🫧 如果还没开始，可以先选计时模式再去洗澡。现在进行到哪一步了？"],
  ["night","晚上的专注时间到啦！我们根据今天的进度，推进一件重要的事。现在是什么状态？"],
  ["sleep","夜深啦，🌙 今天的事情可以慢慢收尾了。你现在准备到哪一步了？"],
]);

function reminderMessage(id: string, rawTitle: unknown) {
  if (id.startsWith('custom-')) {
    const title = typeof rawTitle === 'string' ? rawTitle.trim().slice(0,60) : '';
    return '我们来确认一下「' + (title || '自定义提醒') + '」。现在做到哪一步了？';
  }
  return reminderOpenings.get(id) ?? '你设置的提醒时间到了。';
}

async function rpc(name,body){
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+key},body:JSON.stringify(body)});
 if(!response.ok)throw Error('database');
 return response.status===204?null:await response.json();
}
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response(null,{status:405});
 const token=req.headers.get('x-reminder-token');
 if(!token||token.length!==72)return new Response(null,{status:401});
 const pass=Deno.env.get('REMINDER_SMTP_PASSWORD')?.trim();
 if(!sender||!pass)return Response.json({stage:'sender_config'},{status:503});
 try{
  const test=req.headers.get('x-reminder-test')==='1';
  const jobs=await rpc('claim_reminder_email_content',{token,test_mode:test});
  if(!Array.isArray(jobs))return new Response(null,{status:401});
  const transport=nodemailer.createTransport({host:'smtp.126.com',port:465,secure:true,auth:{user:sender,pass},connectionTimeout:6000,greetingTimeout:6000,socketTimeout:7500});
  let sent=0;let smtpError=null;
  try{
   for(const job of jobs){
    let delivered=false;
    try{
     const message=job.test?'这是一封邮件提醒测试。':reminderMessage(job.reminder_id,job.reminder_title);
     const subject=job.test?'小步星球 · 邮件提醒测试':message.replace(/[\r\n\u2028\u2029]+/g,' ');
     const info=await transport.sendMail({
      from:{name:'小步星球',address:sender},to:job.recipient,subject,
      text:message+'\n\n打开小步星球与小星继续。\n'+site,disableFileAccess:true,disableUrlAccess:true,
     });
     delivered=info.accepted.length>0;if(delivered)sent++;
    }catch(error){smtpError={code:error?.code??'SMTP_ERROR',responseCode:error?.responseCode??null};}
    if(!job.test)await rpc('finish_reminder_email',{account:job.user_id,item:job.reminder_id,delivery_day:job.delivery_day,delivered});
   }
  }finally{transport.close();}
  return Response.json({queued:jobs.length,sent,...(smtpError?{smtpError}:{})});
 }catch{return Response.json({stage:'database_or_runtime'},{status:503});}
});
