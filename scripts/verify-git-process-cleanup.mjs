// Execute the production tool library and observe owned process termination.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [requested,relativeReport]=process.argv.slice(2);
if(process.platform==='win32')throw Error('this probe requires Unix process-group observation');
if(!/^[a-f0-9]{40}$/.test(requested??'')||!relativeReport)throw Error('explicit source commit and fresh private report path required');
const reportPath=path.resolve(root,relativeReport);
if(!reportPath.startsWith(path.join(root,'.brownie/private')+path.sep)||fs.existsSync(reportPath))throw Error('fresh private observation path required');
function run(command,args,settings={}) {
 const result=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:120_000,maxBuffer:4*1024*1024,...settings});
 if(result.status!==0)throw Error(`process cleanup probe command failed: ${command} (${result.status})`);
 return result.stdout.trim();
}
const source=run('git',['rev-parse',requested+'^{commit}']);
if(source!==requested)throw Error('observed source commit differs');
const compiledPaths=['crates','Cargo.toml','Cargo.lock','.cargo','scripts/verify-git-process-cleanup.mjs'];
run('git',['diff','--exit-code',source,'--',...compiledPaths]);
if(run('git',['ls-files','--others','--exclude-standard','--',...compiledPaths]))throw Error('untracked code cannot be attributed to the observed merge');
const target=path.join(root,'.brownie/private/process-cleanup-probe-target');
run('cargo',['build','--offline','-p','brownie-tools','--example','git_process_cleanup_probe'],{
 env:{...process.env,CARGO_TARGET_DIR:target,BROWNIE_PROBE_SOURCE_COMMIT:source}
});
const binary=path.join(target,'debug/examples/git_process_cleanup_probe');
const scratch=fs.mkdtempSync(path.join(root,'.brownie/private/process-cleanup-observation-'));
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
const cases=[];
for(const scenario of ['normal_exit_descendant','oversized_exit_descendant','timeout_descendant']) {
 const workspace=path.join(scratch,scenario),bin=path.join(workspace,'bin');fs.mkdirSync(bin,{recursive:true});
 const canonical=fs.realpathSync(workspace),leaderFile=path.join(workspace,'leader.pid'),descendantFile=path.join(workspace,'descendant.pid'),traceFile=path.join(workspace,'git-invocations.txt');
 const payload=scenario==='oversized_exit_descendant'?'x'.repeat(64*1024):'## isolated fixture\n';
 const script=path.join(bin,'git');
 fs.writeFileSync(script,[
  '#!/bin/sh',
  `printf '%s\\n' "$*" >> ${quote(traceFile)}`,
  'while [ "$1" = "-c" ]; do shift; shift; done',
  `if [ "$1" = "rev-parse" ] && [ "$2" = "--show-toplevel" ]; then printf '%s\\n' ${quote(canonical)}; exit 0; fi`,
  `if [ "$1" = "rev-parse" ]; then printf '%s\\n' ${quote(source)}; exit 0; fi`,
  'if [ "$1" != "status" ]; then exit 64; fi',
  `printf '%s\\n' "$$" > ${quote(leaderFile)}`,
  '/bin/sleep 30 &',
  `printf '%s\\n' "$!" > ${quote(descendantFile)}`,
  scenario==='timeout_descendant'?'wait':`printf '%s' ${quote(payload)}`,
  'exit 0',''
 ].join('\n'),{mode:0o755});
 let leader,descendant;
 try {
  const output=JSON.parse(run(binary,[workspace],{env:{PATH:bin+path.delimiter+process.env.PATH},timeout:15_000}));
  if(output.built_source_commit!==source)throw Error('executed production-library probe was built from another source commit');
  const result=output.result,metadata=result?.output;
  leader=Number(fs.readFileSync(leaderFile,'utf8').trim());descendant=Number(fs.readFileSync(descendantFile,'utf8').trim());
  if(![leader,descendant].every(pid=>Number.isSafeInteger(pid)&&pid>1))throw Error('owned process identity was not observed');
  if(metadata?.reader_thread_joined!==true||metadata.process_tree_kill_attempted!==true||metadata.process_tree_kill_succeeded!==true)throw Error('actual production tool did not prove reader and process-group cleanup');
  if(scenario==='normal_exit_descendant'&&result.status!=='Completed')throw Error('normal bounded tool result failed');
  if(scenario!=='normal_exit_descendant'&&result.status!=='Failed')throw Error('abnormal tool execution did not fail closed');
  if(scenario==='oversized_exit_descendant'&&metadata.output_oversized!==true)throw Error('actual output bound was not exercised');
  if(scenario==='timeout_descendant'&&metadata.timed_out!==true)throw Error('actual timeout bound was not exercised');
  const deadline=Date.now()+1500;
  while((alive(leader)||alive(descendant))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  if(alive(leader)||alive(descendant))throw Error('an owned process survived the tool invocation');
  cases.push({scenario,source_commit:output.built_source_commit,leader_pid:leader,descendant_pid:descendant,
   independently_observed_remaining_processes:0,tool_status:result.status,reader_thread_joined:metadata.reader_thread_joined,
   process_tree_kill_reason:metadata.process_tree_kill_reason,output_oversized:metadata.output_oversized,timed_out:metadata.timed_out,
   git_command_count:fs.readFileSync(traceFile,'utf8').trim().split('\n').length});
 } finally {
  // Only PIDs written by this newly-created fixture can be cleaned up here.
  if(leader===undefined&&fs.existsSync(leaderFile))leader=Number(fs.readFileSync(leaderFile,'utf8').trim());
  if(Number.isSafeInteger(leader)&&leader>1){try{process.kill(-leader,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
 }
}
const observation={observed_at:new Date().toISOString(),deployed_commit:cases[0].source_commit,
 source_matches_merge:true,probe_invocations:cases.length,owned_processes_remaining:cases.reduce((total,item)=>total+item.independently_observed_remaining_processes,0),
 reader_threads_joined:cases.every(item=>item.reader_thread_joined),binary_sha256:digest(binary),cases};
fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(observation,null,2)+'\n',{flag:'wx',mode:0o600});
process.stdout.write(JSON.stringify(observation)+'\n');
