import { spawn } from 'node:child_process';
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
  const bundle=html.match(/src="(main-[^"]+\.js)"/);assert.ok(bundle);const js=await fetch(`http://127.0.0.1:3000/${bundle[1]}`);assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);
  const dashboard=await (await fetch('http://127.0.0.1:3000/api/dashboard')).json();assert.equal(dashboard.transactionCount,0);
  const demo=await (await fetch('http://127.0.0.1:3000/api/dashboard?demo=1')).json();assert.ok(demo.value>0);
  const csv=await fetch('http://127.0.0.1:3000/plantilla-movimientos.csv');assert.equal(csv.status,200);assert.match(await csv.text(),/costBasis/);
  console.log('Production smoke passed: compiled server, Angular entry and assets, local API, isolated demo, CSV template.');
}finally{
  if(child.exitCode===null)child.kill('SIGTERM');await exited;rmSync(directory,{recursive:true,force:true});
}
