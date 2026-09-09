import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const API_URL='https://openrouter.ai/api/v1/chat/completions';

function safePath(cwd,p='.'){
  const full=resolve(cwd,p),rel=relative(cwd,full);
  if(rel.startsWith('..')||resolve(cwd,rel)!==full)throw new Error(`Path escapes repository: ${p}`);
  return full;
}
function trimOutput(s,max=12000){s=String(s||'');return s.length>max?s.slice(0,max)+`\n… truncated ${s.length-max} chars`:s;}
function listTree(cwd,p='.'){
  const base=safePath(cwd,p);
  return readdirSync(base,{withFileTypes:true}).slice(0,200).map(e=>`${e.isDirectory()?'dir ':'file'} ${relative(cwd,resolve(base,e.name))||e.name}`).join('\n');
}
function runCommand(cwd,command){
  const r=spawnSync(process.platform==='win32'?'cmd':'sh',process.platform==='win32'?['/d','/s','/c',command]:['-lc',command],{cwd,encoding:'utf8',timeout:180000,env:process.env});
  return JSON.stringify({status:r.status??1,stdout:trimOutput(r.stdout),stderr:trimOutput(r.stderr||r.error?.message)});
}
function executeTool(cwd,name,args){
  if(name==='read_file')return trimOutput(readFileSync(safePath(cwd,args.path),'utf8'),50000);
  if(name==='write_file'){const file=safePath(cwd,args.path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,args.content,'utf8');return 'ok';}
  if(name==='list_files')return listTree(cwd,args.path||'.');
  if(name==='run_command')return runCommand(cwd,args.command);
  throw new Error(`Unknown tool: ${name}`);
}

const tools=[
  {type:'function',function:{name:'read_file',description:'Read a UTF-8 file inside the repository.',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}},
  {type:'function',function:{name:'write_file',description:'Write a UTF-8 file inside the repository. Use only when needed to solve the task.',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}}},
  {type:'function',function:{name:'list_files',description:'List files/directories inside the repository.',parameters:{type:'object',properties:{path:{type:'string'}},additionalProperties:false}}},
  {type:'function',function:{name:'run_command',description:'Run a shell command inside the isolated repository worktree, for inspection and verification.',parameters:{type:'object',properties:{command:{type:'string'}},required:['command'],additionalProperties:false}}}
];

export async function runOpenRouterTask(cwd,prompt,{model='deepseek/deepseek-v4-flash',timeout=300000,fetchImpl=globalThis.fetch}={}){
  const key=process.env.OPENROUTER_API_KEY;
  if(!key)return{ok:false,status:1,events:[],usage:null,stderr:'OPENROUTER_API_KEY is required for --agent openrouter'};
  if(typeof fetchImpl!=='function')return{ok:false,status:1,events:[],usage:null,stderr:'fetch is unavailable'};
  const messages=[
    {role:'system',content:'You are a coding agent operating inside an isolated Git worktree. Diagnose the task, inspect the repository with tools, make the smallest correct change, preserve tests, run relevant verification, and stop when the task is solved.'},
    {role:'user',content:prompt}
  ];
  let usage=null,lastText='';
  for(let turn=0;turn<16;turn++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    let res;
    try{res=await fetchImpl(API_URL,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':'https://github.com/puspoaditya/kodematik','X-Title':'Kodematik'},body:JSON.stringify({model,messages,tools,tool_choice:'auto'}),signal:controller.signal});}catch(e){clearTimeout(timer);return{ok:false,status:1,events:[],usage,stderr:e.message};}
    clearTimeout(timer);
    const data=await res.json().catch(()=>({}));
    if(!res.ok)return{ok:false,status:res.status,events:[],usage,stderr:data?.error?.message||`OpenRouter HTTP ${res.status}`};
    const msg=data?.choices?.[0]?.message;
    if(!msg)return{ok:false,status:1,events:[],usage,stderr:'OpenRouter returned no assistant message'};
    if(data.usage)usage={input_tokens:data.usage.prompt_tokens||0,output_tokens:data.usage.completion_tokens||0};
    messages.push(msg);lastText=msg.content||lastText;
    const calls=msg.tool_calls||[];
    if(!calls.length)return{ok:true,status:0,events:[{type:'turn.completed',message:lastText}],usage,stderr:''};
    for(const call of calls){let args={};try{args=JSON.parse(call.function?.arguments||'{}');}catch{}
      let content;try{content=executeTool(cwd,call.function?.name,args);}catch(e){content=`Tool error: ${e.message}`;}
      messages.push({role:'tool',tool_call_id:call.id,name:call.function?.name,content:String(content)});
    }
  }
  return{ok:false,status:1,events:[],usage,stderr:'OpenRouter agent exceeded 16 tool-call turns'};
}
