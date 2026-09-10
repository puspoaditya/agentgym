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
        const nextIndent=next.match(/^\s*/)[0].length;
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
  if(/^(npm|pnpm|yarn|bun)\s+(?:test|run\s+(?:test|lint|typecheck|type-check|check|verify))(?:\s|$)/i.test(c))return true;
  if(/^(?:npx\s+)?(?:ava|xo|tsd|eslint|jest|vitest|mocha|tsc)(?:\s|$)/i.test(c))return true;
  if(/^node\s+--test(?:\s|$)/i.test(c))return true;
  return false;
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
  const direct=c.match(/^(?:npx\s+)?([^\s]+)/i);
  return`ci:${direct?.[1]?.toLowerCase()||`check-${index+1}`}`;
}

export function historicalVerificationCommands(cwd){
  const discovered=[];
  for(const file of workflowFiles(cwd)){
    let text='';
    try{text=readFileSync(file,'utf8');}catch{continue;}
    for(const command of extractWorkflowRunCommands(text)){
      if(!isVerificationCommand(command))continue;
      const parsed=splitSimpleCommand(command);
      if(!parsed)continue;
      discovered.push({commandText:command,command:parsed});
    }
  }
  const seen=new Set(),commands=[];
  for(const item of discovered){
    const key=item.commandText.trim();
    if(seen.has(key))continue;
    seen.add(key);
    commands.push({name:commandName(key,commands.length),command:item.command,commandText:key,source:'historical-ci'});
  }
  if(commands.length)return{source:'historical-ci',commands};
  return{source:'package-scripts',commands:verificationCommands(cwd).map(item=>({...item,commandText:item.command.flat().join(' '),source:'package-scripts'}))};
}

export function classifyVerificationFailure(result={}){
  const text=`${result.commandText||''}\n${result.stdout||''}\n${result.stderr||''}`.toLowerCase();
  if(/\b(xo|eslint|lint(?:ing)?)\b/.test(text))return'lint';
  if(/\b(tsd|typescript|tsc|typecheck|type-check|type error)\b/.test(text))return'types';
  if(/\b(ava|jest|vitest|mocha|tap|node --test|test failed|failing test)\b/.test(text))return'test';
  if(/syntaxerror|parse error|unexpected token/.test(text))return'syntax';
  if(/unsupported engine|ebadengine|module not found|cannot find module|unknown option|not found|enoent/.test(text))return'tooling';
  return'verification-command';
}

export function verificationOutputSnippet(result={},limit=500){
  const raw=`${result.stderr||''}\n${result.stdout||''}`.replace(/\u001b\[[0-9;]*m/g,'').replace(/\s+/g,' ').trim();
  return raw.length>limit?`${raw.slice(0,limit-1)}…`:raw;
}
