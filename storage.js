(function(){
  "use strict";
  const DB="grandmas-stories-ui", STORE="kv";
  let dbPromise;
  let namespace = "";
  const scopedKey = key => namespace + key;
  function setNamespace(familyId) { namespace = familyId ? "family:" + familyId + ":" : ""; }
  function open(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB,1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:"key"});};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
    return dbPromise;
  }
  async function get(key){
    try{
      const db=await open();
      const value=await new Promise((resolve,reject)=>{
        const req=db.transaction(STORE,"readonly").objectStore(STORE).get(scopedKey(key));
        req.onsuccess=()=>resolve(req.result?req.result.value:undefined);
        req.onerror=()=>reject(req.error);
      });
      if(value!==undefined)return value;
      const raw=localStorage.getItem("gs:"+scopedKey(key));
      if(raw!==null){
        const migrated=JSON.parse(raw);
        await set(key,migrated);
        return migrated;
      }
      return null;
    }catch(e){
      try{const raw=localStorage.getItem("gs:"+scopedKey(key));return raw===null?null:JSON.parse(raw);}catch(_){return null;}
    }
  }
  async function set(key,value){
    try{
      const db=await open();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,"readwrite");
        tx.objectStore(STORE).put({key:scopedKey(key),value});
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
      return true;
    }catch(e){
      try{localStorage.setItem("gs:"+scopedKey(key),JSON.stringify(value));return true;}catch(_){return false;}
    }
  }
  window.storage={get,set,setNamespace};
})();