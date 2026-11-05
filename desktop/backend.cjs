'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function listening(port){
  return new Promise(resolve=>{
    const socket=net.createConnection({host:'127.0.0.1',port});
    const finish=value=>{socket.destroy();resolve(value)};
    socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(1000,()=>finish(true));
  });
}
async function verify(port,root){
  const response=await fetch(`http://127.0.0.1:${port}/api/desktop/status`,{signal:AbortSignal.timeout(1500)});
  if(!response.ok)throw Error('Quit the previous StudyDash from its tray menu, then open StudyDash again.');
  const status=await response.json();
  if(status.app!=='StudyDash'||path.resolve(status.root).toLowerCase()!==path.resolve(root).toLowerCase())throw Error('Another StudyDash copy is running. Quit it from its tray menu, then open StudyDash again.');
  return status;
}
async function ensureBackend({root,executable,dataDirectory,port,environment=process.env}){
  if(await listening(port))return verify(port,root);
  fs.mkdirSync(dataDirectory,{recursive:true});
  const database=path.join(dataDirectory,'studydash.db');
  if(fs.existsSync(database)){
    const {DatabaseSync,backup}=require('node:sqlite'),source=new DatabaseSync(database,{readOnly:true});
    const backups=path.join(dataDirectory,'backups');fs.mkdirSync(backups,{recursive:true});
    try{await backup(source,path.join(backups,'before-desktop-'+new Date().toISOString().replace(/[:.]/g,'-')+'.db'))}finally{source.close()}
  }
  const child=spawn(executable,[path.join(root,'app.js'),'--background'],{
    cwd:root,detached:true,windowsHide:true,stdio:'ignore',
    env:{...environment,ELECTRON_RUN_AS_NODE:'1',STUDYDASH_DESKTOP_EXE:executable,STUDYDASH_DATA:dataDirectory,STUDYDASH_PORT:String(port)},
  });
  let failure;
  child.on('error',error=>{failure=error});
  child.once('exit',code=>{failure ||= Error(`StudyDash could not start (exit ${code}). Check studydash.log in the existing app data folder.`)});
  child.unref();
  for(let attempt=0;attempt<100;attempt++){
    if(failure)throw failure;
    try{return await verify(port,root)}catch(error){
      if(error.message.startsWith('Another StudyDash')||error.message.startsWith('Quit the previous'))throw error;
    }
    await delay(150);
  }
  child.kill();
  throw Error('StudyDash took too long to start. Check studydash.log in the existing app data folder.');
}
module.exports={ensureBackend};
