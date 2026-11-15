(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  let client=null,user=null,familyId=null,ready=false,connecting=null,syncing=null,authBusy=false;
  let realtime=null;
  const BUCKET="family-archive";
  const say=(text)=>{const el=$("[data-status]");if(el)el.textContent=text;};
  const archiveStatus=(text)=>{const el=$("#archiveConnectionStatus");if(el)el.textContent=text;};
  const showConnectButton=show=>{const el=$("[data-connect-archive]");if(el)el.hidden=!show;};
  const emitUpdated=()=>window.dispatchEvent(new CustomEvent("gs:cloud-updated"));
  const uuid=()=>crypto.randomUUID();
  const asBlob=async value=>{
    if(!value)return null;
    if(value instanceof Blob)return value;
    if(typeof value==="string"&&value.startsWith("data:"))return await (await fetch(value)).blob();
    if(typeof value==="string"&&(value.startsWith("blob:")||value.startsWith("http")))return await (await fetch(value)).blob();
    return null;
  };
  const dataUrl=blob=>new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);
  });
  async function transcribeAudio(blob){
    const response=await fetch("/api/transcribe",{method:"POST",headers:{"Content-Type":blob.type||"audio/webm"},body:blob});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error||"The recording could not be transcribed.");
    return (result.text||"").trim();
  }
  const getPhotos=async()=>{const v=await window.storage.get("photos");return Array.isArray(v)?v:[];};
  const putPhotos=photos=>window.storage.set("photos",photos);
  const getStories=async()=>{const v=await window.storage.get("stories");return v&&typeof v==="object"?v:{};};
  const putStories=stories=>window.storage.set("stories",stories);
  async function uploadPhoto(photo){
    if(!user||!familyId||photo.cloudAssetId)return photo;
    if(!photo.custom||!photo.src||!photo.src.startsWith("data:"))return photo;
    const id=uuid(),blob=await asBlob(photo.src),key=familyId+"/"+id+"/original.jpg";
    if(!blob)throw Error("This photograph could not be prepared for archive upload.");
    let r=await client.from("media_assets").upsert({id,family_id:familyId,asset_type:"photo",title:photo.title||"Family photograph",created_by:user.id},{onConflict:"id,family_id"});
    if(r.error)throw r.error;
    r=await client.storage.from(BUCKET).upload(key,blob,{contentType:blob.type||"image/jpeg",upsert:true});
    if(r.error)throw r.error;
    r=await client.from("media_files").upsert({family_id:familyId,media_asset_id:id,variant:"original",storage_provider:"supabase",bucket_name:BUCKET,object_key:key,mime_type:blob.type||"image/jpeg",byte_size:blob.size,created_by:user.id},{onConflict:"storage_provider,bucket_name,object_key"});
    if(r.error)throw r.error;
    return Object.assign({},photo,{cloudAssetId:id});
  }
  async function syncPhotos(){
    if(!user||!familyId)return;
    let deleted=await window.storage.get("deletedCloudAssets");
    deleted=Array.isArray(deleted)?deleted:[];
    for(const assetId of deleted){
      const {data:files,error:fileError}=await client.from("media_files").select("object_key").eq("family_id",familyId).eq("media_asset_id",assetId);
      if(fileError)throw fileError;
      const keys=(files||[]).filter(file=>file.object_key).map(file=>file.object_key);
      if(keys.length){const removed=await client.storage.from(BUCKET).remove(keys);if(removed.error)throw removed.error;}
      let result=await client.from("media_files").delete().eq("family_id",familyId).eq("media_asset_id",assetId);
      if(result.error)throw result.error;
      result=await client.from("story_media").delete().eq("family_id",familyId).eq("media_asset_id",assetId).eq("relationship","cover");
      if(result.error)throw result.error;
      result=await client.from("media_assets").delete().eq("family_id",familyId).eq("id",assetId);
      if(result.error)throw result.error;
      deleted=deleted.filter(id=>id!==assetId);
      await window.storage.set("deletedCloudAssets",deleted);
    }
    let local=await getPhotos(),changed=false;
    for(let i=0;i<local.length;i++){
      if(local[i].custom&&!local[i].cloudAssetId&&local[i].src&&local[i].src.startsWith("data:")){
        local[i]=await uploadPhoto(local[i]);changed=true;
      }
    }
    if(changed)await putPhotos(local);
    const {data:assets,error}=await client.from("media_assets").select("id,title,created_at").eq("family_id",familyId).eq("asset_type","photo").order("created_at",{ascending:true});
    if(error)throw error;
    if(!assets||!assets.length)return;
    const ids=assets.map(a=>a.id);
    const {data:files,error:fileError}=await client.from("media_files").select("media_asset_id,object_key,mime_type").eq("family_id",familyId).eq("variant","original").in("media_asset_id",ids);
    if(fileError)throw fileError;
    const byAsset=new Map((files||[]).map(f=>[f.media_asset_id,f]));
    local=await getPhotos();
    const known=new Set(local.map(p=>p.cloudAssetId).filter(Boolean));
    for(const asset of assets){
      if(known.has(asset.id))continue;
      const file=byAsset.get(asset.id);if(!file)continue;
      const signed=await client.storage.from(BUCKET).createSignedUrl(file.object_key,3600);
      if(signed.error)throw signed.error;
      const response=await fetch(signed.data.signedUrl);if(!response.ok)throw Error("A family photograph could not be downloaded.");
      const image=await response.blob();
      local.push({id:"cloud-"+asset.id,cloudAssetId:asset.id,title:asset.title||"Family photograph",year:"",prompt:"Tell me about this time...",src:await dataUrl(image),custom:true});
      known.add(asset.id);
    }
    await putPhotos(local);
  }
  async function uploadStory(photo,entry){
    if(!user||!familyId||entry.cloudStoryId)return entry;
    const storyId=uuid();
    const payload={id:storyId,family_id:familyId,title:(photo&&photo.title||"A family story").slice(0,240),original_text:entry.text||"",status:"draft",created_by:user.id,updated_by:user.id};
    let r=await client.from("stories").upsert(payload,{onConflict:"id,family_id"});
    if(r.error)throw r.error;
    if(photo&&photo.cloudAssetId){
      r=await client.from("story_media").upsert({family_id:familyId,story_id:storyId,media_asset_id:photo.cloudAssetId,relationship:"cover"},{onConflict:"story_id,media_asset_id,relationship",ignoreDuplicates:true});
      if(r.error)throw r.error;
    }
    let updated=Object.assign({},entry,{cloudStoryId:storyId,cloudSyncedText:entry.text||""});
    if(entry.audio){
      const blob=await asBlob(entry.audio);
      if(blob&&blob.size){
        const audioId=uuid(),isMp4=(blob.type||"").includes("mp4"),ext=isMp4?"m4a":"webm",mime=isMp4?"audio/mp4":"audio/webm";
        const key=familyId+"/"+audioId+"/original."+ext;
        r=await client.from("media_assets").upsert({id:audioId,family_id:familyId,asset_type:"audio",title:(photo&&photo.title||"Family story")+" — recording",created_by:user.id},{onConflict:"id,family_id"});
        if(r.error)throw r.error;
        r=await client.storage.from(BUCKET).upload(key,blob,{contentType:mime,upsert:true});
        if(r.error)throw r.error;
        r=await client.from("media_files").upsert({family_id:familyId,media_asset_id:audioId,variant:"original",storage_provider:"supabase",bucket_name:BUCKET,object_key:key,mime_type:mime,byte_size:blob.size,created_by:user.id},{onConflict:"storage_provider,bucket_name,object_key"});
        if(r.error)throw r.error;
        r=await client.from("story_media").upsert({family_id:familyId,story_id:storyId,media_asset_id:audioId,relationship:"audio_narration"},{onConflict:"story_id,media_asset_id,relationship",ignoreDuplicates:true});
        if(r.error)throw r.error;
        updated.cloudAudioAssetId=audioId;
      }
    }
    return updated;
  }
  async function syncStories(){
    if(!user||!familyId)return;
    const stories=await getStories(),photos=await getPhotos();
    const photoById=new Map(photos.map(p=>[p.id,p]));
    let changed=false;
    for(const photoId of Object.keys(stories)){
      const photo=photoById.get(photoId);
      const entries=Array.isArray(stories[photoId])?stories[photoId]:[];
      for(let i=0;i<entries.length;i++){
        // Only sync stories attached to a real cloud-backed photograph.
        // This keeps the UI prototype's sample stories local.
        if(!entries[i].cloudStoryId&&photo&&photo.cloudAssetId){
          entries[i]=await uploadStory(photo,entries[i]);changed=true;
        }else if(entries[i].cloudStoryId&&photo&&photo.cloudAssetId&&(entries[i].text||"").trim()&&entries[i].cloudSyncedText!==entries[i].text){
          const updated=await client.from("stories").update({original_text:entries[i].text,updated_by:user.id}).eq("family_id",familyId).eq("id",entries[i].cloudStoryId);
          if(updated.error)throw updated.error;
          entries[i].cloudSyncedText=entries[i].text;changed=true;
        }
      }
    }
    if(changed)await putStories(stories);
    const {data:rows,error}=await client.from("stories").select("id,title,original_text,created_at").eq("family_id",familyId).order("created_at",{ascending:false});
    if(error)throw error;
    if(!rows||!rows.length)return;
    const ids=rows.map(r=>r.id);
    const {data:links,error:linkError}=await client.from("story_media").select("story_id,media_asset_id,relationship").eq("family_id",familyId).in("story_id",ids);
    if(linkError)throw linkError;
    const audioIds=[...new Set((links||[]).filter(l=>l.relationship==="audio_narration").map(l=>l.media_asset_id))];
    const audioResult=audioIds.length?await client.from("media_files").select("media_asset_id,object_key,mime_type").eq("family_id",familyId).eq("variant","original").in("media_asset_id",audioIds):{data:[],error:null};
    if(audioResult.error)throw audioResult.error;
    const audioById=new Map((audioResult.data||[]).map(f=>[f.media_asset_id,f]));
    const existing=await getStories(),known=new Set(Object.values(existing).flat().map(e=>e.cloudStoryId).filter(Boolean));
    const currentPhotos=await getPhotos(),byCloudId=new Map(currentPhotos.map(p=>[p.cloudAssetId,p.id]));
    let localChanged=false;
    for(const row of rows){
      const localEntry=Object.values(existing).flat().find(entry=>entry.cloudStoryId===row.id);
      const audioLink=(links||[]).find(l=>l.story_id===row.id&&l.relationship==="audio_narration");
      const audioFile=audioLink&&audioById.get(audioLink.media_asset_id);
      let audio=null;
      const needsAudio=!known.has(row.id)||!!(localEntry&&!localEntry.audio);
      const needsTranscript=!(row.original_text||"").trim();
      if(audioFile&&(needsAudio||needsTranscript)){
        const signed=await client.storage.from(BUCKET).createSignedUrl(audioFile.object_key,3600);
        if(signed.error)throw signed.error;
        const response=await fetch(signed.data.signedUrl);if(!response.ok)throw Error("A saved story recording could not be downloaded.");
        audio=await response.blob();
      }
      let text=row.original_text||"";
      if(needsTranscript&&audio){
        try{
          const transcript=await transcribeAudio(audio);
          if(transcript){
            const updated=await client.from("stories").update({original_text:transcript,updated_by:user.id}).eq("family_id",familyId).eq("id",row.id);
            if(updated.error)throw updated.error;
            text=transcript;row.original_text=transcript;
          }
        }catch(error){
          console.warn("Story audio transcription is still pending",row.id,error);
        }
      }
      if(known.has(row.id)){
        if(localEntry&&audio&&!localEntry.audio){
          localEntry.audio=await dataUrl(audio);
          localChanged=true;
        }
        if(localEntry&&text.trim()&&!(localEntry.text||"").trim()){
          localEntry.text=text;
          localEntry.cloudSyncedText=text;
          localChanged=true;
        }
        continue;
      }
      const cover=(links||[]).find(l=>l.story_id===row.id&&l.relationship==="cover");
      const photoId=cover?byCloudId.get(cover.media_asset_id):null;
      if(!photoId)continue;
      const entry={text,created:row.created_at,cloudStoryId:row.id,cloudSyncedText:text,audio:audio?await dataUrl(audio):null};
      existing[photoId]=existing[photoId]||[];existing[photoId].push(entry);known.add(row.id);
      localChanged=true;
    }
    if(localChanged)await putStories(existing);
  }
  async function syncAll(){
    if(!ready||syncing||!navigator.onLine)return syncing;
    syncing=(async()=>{await syncPhotos();await syncStories();archiveStatus("Private family archive connected. Photos and stories are saved online.");emitUpdated();})().catch(error=>{
      console.error("Family archive sync failed",error);
      archiveStatus("Some items are still waiting to back up. We’ll retry when the connection is available.");
    }).finally(()=>{syncing=null;});
    return syncing;
  }
  async function connectFamily(nextUser){
    if(!nextUser||!client)return;
    if(connecting)return connecting;
    connecting=(async()=>{
      user=nextUser;ready=false;
      archiveStatus("Connecting to your private family archive…");
      const membership=await client.from("family_members").select("family_id,role").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
      if(membership.error)throw membership.error;
      familyId=membership.data&&membership.data.family_id;
      if(!familyId){
        const created=await client.rpc("create_family",{p_name:"Grandma’s Stories"});
        if(created.error)throw created.error;
        familyId=created.data;
      }
      await syncPhotos();
      await syncStories();
      ready=true;
      showConnectButton(false);
      archiveStatus("Private family archive connected. Photos and stories are saved online.");
      const sent=$("[data-state='sent']");if(sent){sent.hidden=false;$("[data-state='form']").hidden=true;const msg=sent.querySelector("p");if(msg)msg.textContent="Your private family archive is connected. Photos and stories are syncing across devices.";}
      emitUpdated();
      if(location.hash==="#/signin")location.hash="#/album";
    })().catch(error=>{
      ready=false;showConnectButton(true);archiveStatus("Archive connection needs attention: "+(error.message||"Please try again."));
      const err=$("[data-error]");if(err){err.hidden=false;err.textContent=error.message||"We could not connect your family archive.";}
      console.error("Family archive connection failed",error);
    }).finally(()=>{connecting=null;});
    return connecting;
  }
  async function sendLink(email,isResend){
    if(authBusy)return;
    if(!client){const el=$("[data-error]");if(el){el.hidden=false;el.textContent="The secure sign-in service is still loading. Please try again in a moment.";}return;}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){const e=$("[data-error]");if(e)e.hidden=false;return;}
    authBusy=true;
    const button=$("button[type='submit']",$("#archiveSignInForm")||document);
    try{
      const {error}=await client.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname,shouldCreateUser:true}});
      if(error)throw error;
      const form=$("[data-state='form']"),sent=$("[data-state='sent']");
      if(form)form.hidden=true;if(sent)sent.hidden=false;
      const target=$("[data-sent-email]");if(target)target.textContent=email;
      const message=sent&&sent.querySelector("p");if(message)message.textContent="Your secure sign-in link is on its way to "+email+".";
    }catch(error){
      const el=$("[data-error]");if(el){el.hidden=false;el.textContent=error.message||"We could not send the sign-in link. Please try again.";}
    }finally{authBusy=false;if(button)button.disabled=false;}
  }
  async function init(){
    try{
      if(window.gsAppHydrated)await window.gsAppHydrated;
      const configResponse=await fetch("/api/config",{cache:"no-store"});
      const config=await configResponse.json();
      if(!configResponse.ok||!config.url||!config.publishableKey)throw Error(config.error||"Family sign-in is not configured yet.");
      if(!window.supabase||!window.supabase.createClient)throw Error("The secure sign-in library did not load.");
      client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      client.auth.onAuthStateChange((event,session)=>{
        if(event==="SIGNED_OUT"){user=null;familyId=null;ready=false;showConnectButton(true);archiveStatus("Saved on this device until the family archive is connected.");}
        if(event==="SIGNED_IN"&&session&&session.user){showConnectButton(false);Promise.resolve().then(()=>connectFamily(session.user));}
      });
      const session=await client.auth.getSession();
      if(session.error)throw session.error;
      if(session.data.session&&session.data.session.user){showConnectButton(false);await connectFamily(session.data.session.user);}else{showConnectButton(true);}
      const form=$("[data-form='signin']");
      if(form)form.addEventListener("submit",event=>{
        event.preventDefault();event.stopImmediatePropagation();
        const input=$("#email"),email=input&&input.value.trim();
        if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
          const err=$("[data-error]");if(err)err.hidden=false;if(input)input.focus();return;
        }
        sendLink(email,false);
      },true);
      const resend=$("[data-action='resend']");
      if(resend)resend.addEventListener("click",event=>{
        event.preventDefault();event.stopImmediatePropagation();
        const email=$("[data-sent-email]")?.textContent||"";
        sendLink(email,true);
      },true);
      window.addEventListener("gs:local-change",()=>{
        if(!ready)return;
        clearTimeout(window.__gsSyncTimer);
        window.__gsSyncTimer=setTimeout(()=>syncAll(),500);
      });
      window.addEventListener("online",syncAll);
      document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncAll();});
      // Retry pending story transcripts every 30 seconds while the archive is connected.
      window.setInterval(()=>{if(ready)syncAll();},30000);
      window.gsCloud={sync:syncAll,isReady:()=>ready};
      if(!ready)archiveStatus("Your photos and stories are saved on this device. Connect your family archive to back them up online.");
    }catch(error){
      showConnectButton(true);
      console.warn("Family archive setup unavailable",error);
      archiveStatus("Family archive connection is not available right now. Your stories remain saved on this device.");
    }
  }
  const realtimeAudio=()=>{
    let audio=$("#gsRealtimeAudio");
    if(!audio){audio=document.createElement("audio");audio.id="gsRealtimeAudio";audio.autoplay=true;audio.playsInline=true;audio.hidden=true;document.body.appendChild(audio);}
    return audio;
  };
  const blobDataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
  async function startRealtime(photo,callbacks){
    if(realtime)throw Error("A voice conversation is already running.");
    if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection||!window.MediaRecorder)throw Error("Live voice conversations are not supported in this browser.");
    const session={pc:null,dc:null,stream:null,recorder:null,chunks:[],lines:[],callbacks:callbacks||{},active:true};
    realtime=session;
    const status=message=>session.callbacks.onStatus&&session.callbacks.onStatus(message);
    const transcript=()=>{
      const text=session.lines.map(line=>(line.who==="user"?"Betty":"A gentle thought")+": "+line.text).join("\n\n");
      if(session.callbacks.onTranscript)session.callbacks.onTranscript(text);
    };
    try{
      status("Getting the microphone ready…");
      session.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      session.recorder=new MediaRecorder(session.stream);
      session.recorder.ondataavailable=e=>{if(e.data&&e.data.size)session.chunks.push(e.data);};
      session.recorder.start(1000);
      session.pc=new RTCPeerConnection();
      session.pc.addTrack(session.stream.getAudioTracks()[0],session.stream);
      session.pc.ontrack=e=>{const audio=realtimeAudio();audio.srcObject=e.streams[0];audio.play().catch(()=>{});};
      session.dc=session.pc.createDataChannel("oai-events");
      session.dc.onmessage=e=>{
        let d;try{d=JSON.parse(e.data);}catch(_){return;}
        if(d.type==="response.output_audio_transcript.done"||d.type==="response.output_text.done"){
          const text=d.transcript||d.text;if(text){session.lines.push({who:"ai",text});transcript();}
        }
        if(d.type==="conversation.item.input_audio_transcription.completed"){
          if(d.transcript){session.lines.push({who:"user",text:d.transcript});transcript();}
        }
        if(d.type==="input_audio_buffer.speech_started")status("I hear you…");
        if(d.type==="response.created")status("Thinking about that…");
        if(d.type==="output_audio_buffer.started")status("I’m speaking…");
        if(d.type==="output_audio_buffer.stopped")status("Whenever you’re ready, I’m listening.");
      };
      const offer=await session.pc.createOffer();await session.pc.setLocalDescription(offer);
      const response=await fetch("/api/session",{method:"POST",headers:{"Content-Type":"application/sdp"},body:offer.sdp});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||"The voice service is not ready yet.");}
      await session.pc.setRemoteDescription({type:"answer",sdp:await response.text()});
      await new Promise((resolve,reject)=>{
        if(session.dc.readyState==="open")return resolve();
        const timer=setTimeout(()=>reject(Error("The voice connection took too long to open.")),15000);
        session.dc.addEventListener("open",()=>{clearTimeout(timer);resolve();},{once:true});
        session.dc.addEventListener("error",()=>{clearTimeout(timer);reject(Error("The voice connection could not be opened."));},{once:true});
      });
      let imageUrl=photo.src;
      if(!imageUrl.startsWith("data:"))imageUrl=await blobDataUrl(await (await fetch(imageUrl)).blob());
      session.dc.send(JSON.stringify({type:"conversation.item.create",item:{type:"message",role:"user",content:[{type:"input_image",image_url:imageUrl}]}}));
      session.dc.send(JSON.stringify({type:"response.create",response:{instructions:"You are sharing this family photograph with Grandma. Look carefully at the image, but do not guess identities, relationships, dates, locations or details you cannot know. Begin with one gentle observation about something clearly visible and one open question. Listen closely. After each substantive answer, reflect one specific detail she shared and ask one natural follow-up question based on it. Ask one question at a time. Keep your responses short, warm and unhurried. Follow her tangents. Do not correct, quiz or pressure her. If she says stop or seems tired, thank her and close gently.",modalities:["audio","text"]}}));
      status("Whenever you’re ready, I’m listening.");
      return true;
    }catch(error){
      await stopRealtime(false);
      throw error;
    }
  }
  async function stopRealtime(save){
    const session=realtime;if(!session)return;
    realtime=null;session.active=false;
    try{if(session.dc)session.dc.close();}catch(_){}
    try{if(session.pc)session.pc.close();}catch(_){}
    if(session.stream)session.stream.getTracks().forEach(track=>track.stop());
    const audio=realtimeAudio();audio.pause();audio.srcObject=null;
    let blob=null;
    if(session.recorder&&session.recorder.state!=="inactive"){
      blob=await new Promise(resolve=>{
        session.recorder.addEventListener("stop",()=>resolve(session.chunks.length?new Blob(session.chunks,{type:session.recorder.mimeType||"audio/webm"}):null),{once:true});
        session.recorder.stop();
      });
    }else if(session.chunks.length)blob=new Blob(session.chunks,{type:"audio/webm"});
    if(save&&session.callbacks.onComplete){
      const text=session.lines.map(line=>(line.who==="user"?"Betty":"A gentle thought")+": "+line.text).join("\n\n");
      const audioData=blob?await blobDataUrl(blob):null;
      await session.callbacks.onComplete({text,audio:audioData});
    }
  }
  window.gsRealtime={start:startRealtime,stop:()=>stopRealtime(true),isActive:()=>!!realtime};
  window.gsAppReady=Promise.resolve().then(init);
})();