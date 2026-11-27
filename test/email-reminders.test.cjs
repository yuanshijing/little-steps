const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {stripTypeScriptTypes}=require('node:module');
const {runInNewContext}=require('node:vm');

test('scheduled reminder subjects use the message text and test mail keeps its own title',async()=>{
  const jobs=[
    {reminder_id:'wake'},
    {reminder_id:'custom-read',reminder_title:'阅读\n十分钟'},
    {test:true},
  ].map(job=>({recipient:'test@example.test',...job}));
  const sent=[];
  let handle;
  const source=readFileSync('supabase/functions/email-reminders/index.ts','utf8').split('\n').slice(1).join('\n');
  runInNewContext(stripTypeScriptTypes(source),{
    Deno:{env:{get:key=>({
      SUPABASE_URL:'https://fixture.example.test',
      REMINDER_SMTP_USER:'sender@example.test',
      REMINDER_SMTP_PASSWORD:'fixture',
    })[key]},serve:fn=>{handle=fn;}},
    nodemailer:{createTransport:()=>({
      sendMail:async mail=>{sent.push(mail);return {accepted:[mail.to]};},
      close(){},
    })},
    fetch:async url=>url.endsWith('/claim_reminder_email_content')?Response.json(jobs):new Response(null,{status:204}),
    AbortSignal,Response,
  });
  const result=await handle(new Request('https://fixture.example.test',{method:'POST',
    headers:{'x-reminder-token':'a'.repeat(72)}}));
  assert.deepEqual(await result.json(),{queued:3,sent:3});
  assert.equal(sent[0].subject,'早安呀！☀️ 新的一天开始啦。你现在起床了吗？');
  assert.ok(sent[0].text.startsWith(sent[0].subject+'\n\n'));
  assert.equal(sent[1].subject,'我们来确认一下「阅读 十分钟」。现在做到哪一步了？');
  assert.equal(sent[2].subject,'小步星球 · 邮件提醒测试');
  for(const mail of sent)assert.match(mail.text,/https:\/\/yuanshijing\.github\.io\/little-steps\//);
});
