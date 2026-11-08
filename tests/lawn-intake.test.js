import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import XLSX from 'xlsx';
import {normalizeLawnRows,lawnWorkbookRows,createLawnTemplate} from '../lib/lawn-intake.js';
import {importLawnRows} from '../lib/lawn.js';
import {createServer} from '../server.js';
const fixture=async()=>JSON.parse(await fs.readFile(new URL('../data/lawn-routing-sample.json',import.meta.url),'utf8'));
const fromMatrix=matrix=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(matrix),'Customers');return wb;};

for(const bookType of ['xlsx','xls'])test(`${bookType} roundtrip keeps Excel booleans, numeric prices, phones and selected worksheet`,async()=>{
 const wb=fromMatrix([['Client Name','Client Address','Client Phone','Email','Mowing','Edging','Job Price','Estimated Minutes','Crew'],['Sample Excel Person','44 Sample Road','0202-555-0101','excel@example.com',true,false,92.75,50,'Clover crew']]);
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Unrelated notes']]),'Notes');
 const reread=XLSX.read(XLSX.write(wb,{type:'buffer',bookType}),{type:'buffer',sheetRows:102,cellFormula:true});
 const {rows}=lawnWorkbookRows(reread,'Customers',XLSX),result=importLawnRows(rows,await fixture()),job=result.jobs[0];
 assert.equal(result.jobs.length,1);assert.equal(job.price,'92.75');assert.equal(job.minutes,50);assert.equal(job.mow,true);assert.equal(job.edge,false);assert.equal(job.phone,'0202-555-0101');assert.equal(job.crew,'B');assert.equal(job.source,'Excel · Customers · row 2');
 assert.equal(lawnWorkbookRows(reread,'Notes',XLSX).rows.length,0);
});

test('manual and spreadsheet rows use the same validation and preserve unknown prices',async()=>{
 const rows=normalizeLawnRows([{'Client Name':'Sample Manual Person','Address':'90 Sample Lane',Mowing:true,Edging:true,'Job Price':'','Estimated Minutes':'',Crew:'A'}]);
 const data=await fixture(),result=importLawnRows(rows,data);
 assert.equal(result.jobs[0].price,null);assert.equal(result.jobs[0].minutes,45);assert.ok(result.issues.some(i=>i.message.includes('defaults')));
 data.jobs.push(result.jobs[0]);assert.equal(importLawnRows(rows,data).jobs.length,0);
 assert.equal(importLawnRows([{...rows[0],client_name:'Other',mow:false,edge:false}],await fixture()).jobs.length,0);
});

test('Excel row numbers survive blank lines and duplicate headers are rejected',async()=>{
 const wb=fromMatrix([['Client Name','Address','Mowing'],[],['','Bad address','yes'],['Valid Person','10 Sample Rd','yes']]);
 const result=importLawnRows(lawnWorkbookRows(wb,'Customers',XLSX).rows,await fixture());
 assert.equal(result.issues.find(i=>i.severity==='error').row,3);assert.match(result.jobs[0].source,/row 4/);
 for(const headers of [['Client Name','Client Name','Address','Mowing'],['Client Name','Name','Address','Mowing']])assert.throws(()=>lawnWorkbookRows(fromMatrix([headers,['A','B','C','yes']]),'Customers',XLSX),/same field/);
 assert.throws(()=>normalizeLawnRows([{Name:'A',Address:'B'}]),/Mowing or Edging/);
});

test('formula cached values require review and missing values block rows',async()=>{
 const wb=fromMatrix([['Client Name','Address','Mowing','Job Price'],['Formula Person','1 Sample Road',true,80]]);
 wb.Sheets.Customers.D2={t:'n',f:'40*2',v:80};
 let extracted=lawnWorkbookRows(wb,'Customers',XLSX);assert.equal(extracted.warnings.length,1);assert.equal(importLawnRows(extracted.rows,await fixture()).jobs[0].price,'80.00');
 delete wb.Sheets.Customers.D2.v;
 extracted=lawnWorkbookRows(wb,'Customers',XLSX);const result=importLawnRows(extracted.rows,await fixture());assert.equal(result.jobs.length,0);assert.match(result.issues[0].message,/no saved result/);
});

test('oversize worksheets are rejected instead of silently truncating an import',()=>{
 const wb=fromMatrix([['Client Name','Address','Mowing'],...Array.from({length:101},(_,i)=>['Sample '+i,'Address '+i,true])]);
 const reread=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer',sheetRows:102});
 assert.throws(()=>lawnWorkbookRows(reread,'Customers',XLSX),/100 job rows/);
});

test('download template contains importable sample jobs with an optional price',async()=>{
 const wb=createLawnTemplate(XLSX),result=importLawnRows(lawnWorkbookRows(wb,'Customers',XLSX).rows,await fixture());
 assert.deepEqual(wb.SheetNames,['Customers','Instructions']);assert.equal(result.jobs.length,2);assert.equal(result.jobs[0].price,'85.00');assert.equal(result.jobs[1].price,null);
});

test('built Excel reader and app load from allowed assets under the server content policy',async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(base+'/lawn.html'),content=await response.text(),policy=response.headers.get('content-security-policy');
  const scripts=[...content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([,attributes])=>!attributes.includes('application/json'));
  assert.equal(scripts.length,3);assert.ok(policy.includes("script-src 'self'"));assert.ok(policy.includes("style-src 'self'"));
  for(const [,attributes,inline]of scripts){
   assert.equal(inline,'');const path=attributes.match(/src="([^"]+)"/)?.[1];assert.ok(path?.startsWith('/'));
   const asset=await fetch(base+path);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
   const script=await asset.text();assert.ok(script.length>1000);if(path==='/vendor/xlsx.js')assert.doesNotThrow(()=>new vm.Script(script));
  }
  assert.equal((await fetch(base+'/lawn.css')).status,200);assert.equal((await fetch(base+'/assets/lawn-intake.js')).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
