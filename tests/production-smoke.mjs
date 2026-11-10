import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const directory=mkdtempSync(join(tmpdir(),'patrimonio-production-'));
const child=spawn(process.execPath,['dist/server/server/index.js'],{env:{...process.env,PATRIMONIO_DATA_DIR:directory},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
const exited=once(child,'exit');
try{
  await Promise.race([
    new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(output.includes('Solo acceso local')){clearInterval(timer);resolve();}else if(child.exitCode!==null){clearInterval(timer);reject(new Error(output));}},50);timer.unref();}),
    new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server start timeout')),10000);timeout.unref();})
  ]);
  const health=await fetch('http://127.0.0.1:3000/api/health');assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
  const index=await fetch('http://127.0.0.1:3000/');assert.equal(index.status,200);const html=await index.text();assert.match(html,/<app-root>/);
  assert.doesNotMatch(html,/media="print"|data-beasties-media/,'Production styles must load without an inline script blocked by CSP');
  assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)[^>]*>\s*\S/,'Production entry must not need inline scripts');
  const bundle=html.match(/src="(main-[^"]+\.js)"/);assert.ok(bundle);const js=await fetch(`http://127.0.0.1:3000/${bundle[1]}`);assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);
  const dashboard=await (await fetch('http://127.0.0.1:3000/api/dashboard')).json();assert.equal(dashboard.transactionCount,0);
  const demo=await (await fetch('http://127.0.0.1:3000/api/dashboard?demo=1')).json();assert.ok(demo.value>0);
  const csv=await fetch('http://127.0.0.1:3000/plantilla-movimientos.csv');assert.equal(csv.status,200);assert.match(await csv.text(),/costBasis/);
  const job=spawnSync(process.execPath,['dist/server/server/sync-cli.js','--scheduled'],{env:{...process.env,PATRIMONIO_DATA_DIR:directory},encoding:'utf8',timeout:10000});assert.equal(job.status,0,job.stderr);assert.match(job.stdout,/Job omitido/);
  const missingSession=await fetch('http://127.0.0.1:3000/api/connection/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Patrimonio':'local'},body:'{}'});assert.equal(missingSession.status,400);
  console.log('Production smoke passed: server, Angular assets, API, isolated demo, templates, scheduled CLI and missing-session handling.');
}finally{
  if(child.exitCode===null)child.kill('SIGTERM');await exited;rmSync(directory,{recursive:true,force:true});
}
