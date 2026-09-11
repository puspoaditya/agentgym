import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verificationCommands } from './core.js';

function workflowFiles(cwd){
  const dir=join(cwd,'.github','workflows');
  if(!existsSync(dir))return[];
  return readdirSync(dir).filter(name=>/\.ya?ml$/i.test(name)).map(name=>join(dir,name));
}

function unquote(value){
  const text=String(value||'').trim();
  if((text.startsWith('"')&&text.endsWith('"'))||(text.startsWith("'")&&text.endsWith("'")))return text.slice(1,-1);
  return text;
}

function major(value){const m=String(value||'').match(/(?:^|[^0-9])(\d{1,2})(?:\.x|\.|\b)/);return m?Number(m[1]):null;}
function indentOf(line){return line.match(/^\s*/)?.[0].length||0;}

export function extractWorkflowRunCommands(text=''){
  const lines=String(text).split(/\r?\n/),commands=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i],match=line.match(/^(\s*)(?:-\s*)?run:\s*(.*)$/);
    if(!match)continue;
    const indent=match[1].length,rest=match[2].trim();
    if(rest&&rest!=='|'&&rest!=='>'){commands.push(unquote(rest));continue;}
    if(rest==='|'||rest==='>'){
      const block=[];
      for(i=i+1;i<lines.length;i++){
        const next=lines[i],trimmed=next.trim();
        if(!trimmed){if(block.length)block.push('');continue;}
        const nextIndent=indentOf(next);
        if(nextIndent<=indent){i--;break;}
        block.push(trimmed);
      }
      const command=block.filter(Boolean).join(rest==='>'?' ':'\n').trim();
      if(command)commands.push(command);
    }
  }
  return commands;
}

function isVerificationCommand(command){
  const c=command.trim();
  if(/^(npm|pnpm|yarn|bun)\s+test(?:\s|$)/i.test(c))return true;
  if(/^(npm|pnpm|yarn|bun)\s+run\s+(?:test|lint|typecheck|type-check|check|verify)(?::[\w.-]+)*(?:\s|$)/i.test(c))return true;
  if(/^(?:npx\s+)?(?:ava|xo|tsd|eslint|jest|vitest|mocha|tsc)(?:\s|$)/i.test(c))return true;
  if(/^node\s+--test(?:\s|$)/i.test(c))return true;
  if(/^deno\s+(?:test|task\s+(?:test|lint|check))(?:\s|$)/i.test(c))return true;
  return false;
}

function isPortableVerificationCommand(command){
  if(!isVerificationCommand(command))return false;
  const c=command.toLowerCase();
  if(/(?:browser|smoke|e2e|end-to-end|integration)/.test(c))return false;
  return true;
}

function splitSimpleCommand(command){
  if(/[;&|<>`]|\$\(/.test(command))return null;
  const words=command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(unquote)||[];
  if(!words.length)return null;
  return[words[0],words.slice(1)];
}

function commandName(command,index){
  const c=command.trim(),pm=c.match(/^(npm|pnpm|yarn|bun)\s+(?:run\s+)?([^\s]+)/i);
  if(pm)return`ci:${pm[2].toLowerCase()}`;
  const deno=c.match(/^deno\s+(?:task\s+)?([^\s]+)/i);if(deno)return`ci:deno-${deno[1].toLowerCase()}`;
  const direct=c.match(/^(?:npx\s+)?([^\s]+)/i);
  return`ci:${direct?.[1]?.toLowerCase()||`check-${index+1}`}`;
}

function jobBlocks(text=''){
  const lines=String(text).split(/\r?\n/),jobsIndex=lines.findIndex(line=>/^\s*jobs:\s*$/.test(line));
  if(jobsIndex<0)return[];
  const jobsIndent=indentOf(lines[jobsIndex]),blocks=[];let current=null;
  for(let i=jobsIndex+1;i<lines.length;i++){
    const line=lines[i],trimmed=line.trim(),indent=indentOf(line);
    if(trimmed&&indent<=jobsIndent)break;
    const header=line.match(new RegExp(`^\\s{${jobsIndent+2}}([A-Za-z0-9_.-]+):\\s*$`));
    if(header){if(current)blocks.push(current);current={id:header[1],lines:[line]};continue;}
    if(current)current.lines.push(line);
  }
  if(current)blocks.push(current);
  return blocks;
}

function parseNeeds(text){
  const match=text.match(/^\s+needs:\s*(.+)$/m);if(!match)return[];
  const value=unquote(match[1]).trim();if(!value)return[];
  if(value.startsWith('[')&&value.endsWith(']'))return value.slice(1,-1).split(',').map(x=>unquote(x).trim()).filter(Boolean);
  return[value];
}

function parseToolchain(text){
  const hasNode=/uses:\s*actions\/setup-node@/i.test(text),hasBun=/uses:\s*oven-sh\/setup-bun@/i.test(text),hasDeno=/uses:\s*denoland\/setup-deno@/i.test(text);
  if(hasBun&&!hasNode)return'bun';
  if(hasDeno&&!hasNode)return'deno';
  if(hasNode)return'node';
  return'default';
}

function parseNodeMajor(text){
  const matches=[...text.matchAll(/^\s+node-version:\s*['"]?([^\n#'"]+)/gmi)];
  for(const match of matches){if(match[1].includes('${{'))continue;const n=major(match[1]);if(n)return n;}
  return null;
}

export function extractWorkflowJobs(text='',file='workflow.yml'){
  return jobBlocks(text).map(block=>{
    const body=block.lines.join('\n'),name=unquote(body.match(/^\s+name:\s*(.+)$/m)?.[1]||block.id),needs=parseNeeds(body),toolchain=parseToolchain(body),nodeMajor=parseNodeMajor(body),usesDownloadArtifact=/uses:\s*actions\/download-artifact@/i.test(body);
    const commands=[];
    for(const commandText of extractWorkflowRunCommands(body)){
      if(!isVerificationCommand(commandText))continue;
      const parsed=splitSimpleCommand(commandText);if(!parsed)continue;
      commands.push({name:commandName(commandText,commands.length),command:parsed,commandText,portable:isPortableVerificationCommand(commandText)});
    }
    return{id:block.id,name,file,needs,toolchain,nodeMajor,dependent:needs.length>0||usesDownloadArtifact,commands};
  });
}

function jobScore(job){
  const portable=job.commands.filter(x=>x.portable).length;
  return portable*10+(job.toolchain==='node'?8:job.toolchain==='default'?4:0)+(job.dependent?0:8)+(/(?:build|test|ci|unit)/i.test(`${job.id} ${job.name}`)?3:0);
}

export function historicalVerificationJobs(cwd){
  const jobs=[];
  for(const file of workflowFiles(cwd)){
    let text='';try{text=readFileSync(file,'utf8');}catch{continue;}
    jobs.push(...extractWorkflowJobs(text,file));
  }
  return jobs;
}

export function historicalVerificationCommands(cwd){
  const jobs=historicalVerificationJobs(cwd),replayable=jobs
    .filter(job=>!job.dependent&&['node','default'].includes(job.toolchain)&&job.commands.some(x=>x.portable))
    .sort((a,b)=>jobScore(b)-jobScore(a)||a.id.localeCompare(b.id));
  if(replayable.length){
    const selected=replayable[0],seen=new Set(),commands=[];
    for(const item of selected.commands.filter(x=>x.portable)){
      const key=item.commandText.trim();if(seen.has(key))continue;seen.add(key);
      commands.push({...item,source:'historical-ci-job',jobId:selected.id,jobName:selected.name,toolchain:selected.toolchain});
    }
    return{source:'historical-ci-job',jobId:selected.id,jobName:selected.name,toolchain:selected.toolchain,nodeMajor:selected.nodeMajor,commands,jobs:jobs.map(job=>({id:job.id,name:job.name,toolchain:job.toolchain,nodeMajor:job.nodeMajor,needs:job.needs,dependent:job.dependent,verificationCommands:job.commands.map(x=>x.commandText),portableCommands:job.commands.filter(x=>x.portable).map(x=>x.commandText)})),omittedJobs:jobs.filter(job=>job.id!==selected.id).map(job=>job.id)};
  }
  return{source:'package-scripts',jobId:null,jobName:null,toolchain:'default',nodeMajor:null,commands:verificationCommands(cwd).map(item=>({...item,commandText:item.command.flat().join(' '),source:'package-scripts'})),jobs,omittedJobs:[]};
}

export function classifyVerificationFailure(result={}){
  const text=`${result.commandText||''}\n${result.stdout||''}\n${result.stderr||''}`.toLowerCase();
  if(/\b(xo|eslint|lint(?:ing)?)\b/.test(text))return'lint';
  if(/\b(tsd|typescript|tsc|typecheck|type-check|type error)\b/.test(text))return'types';
  if(/\b(ava|jest|vitest|mocha|tap|node --test|bun test|deno test|test failed|failing test)\b/.test(text))return'test';
  if(/syntaxerror|parse error|unexpected token/.test(text))return'syntax';
  if(/unsupported engine|ebadengine|module not found|cannot find module|unknown option|not found|enoent/.test(text))return'tooling';
  return'verification-command';
}

export function verificationOutputSnippet(result={},limit=500){
  const raw=`${result.stderr||''}\n${result.stdout||''}`.replace(/\u001b\[[0-9;]*m/g,'').replace(/\s+/g,' ').trim();
  return raw.length>limit?`${raw.slice(0,limit-1)}…`:raw;
}
