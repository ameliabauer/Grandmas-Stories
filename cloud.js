(function(){
  "use strict";
  const $=s=>document.querySelector(s);
  let client=null,user=null,familyId=null,familyRole=null,ready=false,connecting=null,syncing=null,authBusy=false,inviteToken=null,inviteInfo=null,inviteSlug=null,invitationToken=null,familySlug=null;
  let realtime=null,memberDisplayName="Family member";
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
    const {data:rows,error}=await client.from("stories").select("id,title,original_text,created_at,created_by").eq("family_id",familyId).order("created_at",{ascending:false});
    if(error)throw error;
    if(!rows||!rows.length)return;
    const ids=rows.map(r=>r.id);
    const {data:links,error:linkError}=await client.from("story_media").select("story_id,media_asset_id,relationship").eq("family_id",familyId).in("story_id",ids);
    if(linkError)throw linkError;
    const audioIds=[...new Set((links||[]).filter(l=>l.relationship==="audio_narration").map(l=>l.media_asset_id))];
    const audioResult=audioIds.length?await client.from("media_files").select("media_asset_id,object_key,mime_type").eq("family_id",familyId).eq("variant","original").in("media_asset_id",audioIds):{data:[],error:null};
    if(audioResult.error)throw audioResult.error;
    const audioById=new Map((audioResult.data||[]).map(f=>[f.media_asset_id,f]));
    const {data:memberRows,error:memberError}=await client.from("family_members").select("user_id,display_name").eq("family_id",familyId).eq("status","active");
    if(memberError)throw memberError;
    const memberNames=new Map((memberRows||[]).map(m=>[m.user_id,m.display_name||"Family member"]));
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
        if(localEntry&&row.created_by){const currentName=memberNames.get(row.created_by)||"Family member";if(localEntry.authorName!==currentName){localEntry.authorName=currentName;localChanged=true;}}
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
      const entry={text,created:row.created_at,authorName:memberNames.get(row.created_by)||"Family member",cloudStoryId:row.id,cloudSyncedText:text,audio:audio?await dataUrl(audio):null};
      existing[photoId]=existing[photoId]||[];existing[photoId].push(entry);known.add(row.id);
      localChanged=true;
    }
    if(localChanged)await putStories(existing);
  }
  async function getStoriesForPhoto(photoId){
    if(!ready||!user||!familyId)return [];
    const photos=await getPhotos();
    const photo=photos.find(item=>item.id===photoId||item.cloudAssetId===photoId||(item.cloudAssetId&&"cloud-"+item.cloudAssetId===photoId));
    // Cloud-backed album cards use the stable route id "cloud-<asset UUID>".
    // Resolve the asset directly from that route as a fallback: local photo
    // metadata can be absent/stale even while the archive link is valid.
    const assetId=(photo&&photo.cloudAssetId)||(typeof photoId==="string"&&photoId.startsWith("cloud-")?photoId.slice(6):photoId);
    if(!assetId)return [];
    const {data:links,error:linkError}=await client.from("story_media").select("story_id").eq("family_id",familyId).eq("media_asset_id",assetId).eq("relationship","cover");
    if(linkError)throw linkError;
    const ids=[...new Set((links||[]).map(link=>link.story_id))];
    if(!ids.length)return [];
    const {data:rows,error}=await client.from("stories").select("id,original_text,created_at,created_by").eq("family_id",familyId).in("id",ids).order("created_at",{ascending:true});
    if(error)throw error;
    const {data:members,error:memberError}=await client.from("family_members").select("user_id,display_name").eq("family_id",familyId).eq("status","active");
    if(memberError)throw memberError;
    const names=new Map((members||[]).map(member=>[member.user_id,member.display_name||"Family member"]));
    return (rows||[]).map(row=>({cloudStoryId:row.id,text:row.original_text||"",created:row.created_at,authorName:names.get(row.created_by)||"Family member",cloudSyncedText:row.original_text||""}));
  }
  async function syncAll(){
    if(!ready||syncing||!navigator.onLine)return syncing;
    syncing=(async()=>{await syncPhotos();await syncStories();archiveStatus("Private family archive connected. Photos and stories are saved online.");emitUpdated();})().catch(error=>{
      console.error("Family archive sync failed",error);
      archiveStatus("Some items are still waiting to back up. We’ll retry when the connection is available.");
    }).finally(()=>{syncing=null;});
    return syncing;
  }
  function familyStatus(message,isError){
    const el=$("[data-family-status]");
    if(!el)return;
    el.hidden=!message;
    el.textContent=message||"";
    el.classList.toggle("is-error",!!isError);
  }
  function familyPanel(mode){
    const choice=$("[data-family-choice]"),create=$("[data-family-create]"),join=$("[data-family-join]"),created=$("[data-family-created]"),access=$("[data-family-access]");
    if(choice)choice.hidden=mode!=="choice";
    if(create)create.hidden=mode!=="create";
    if(join)join.hidden=mode!=="join";
    if(created)created.hidden=mode!=="created";
    if(access)access.hidden=mode!=="access";
    const noLink=$("[data-join-no-link]"),credentials=$("[data-join-credentials]");
    if(noLink)noLink.hidden=mode!=="join"||!!invitationToken;
    if(credentials)credentials.hidden=mode!=="join"||!invitationToken;
    familyStatus("");
  }
  function showFamilySetup(token){
    inviteToken=token||null;
    familyPanel(token?"join":"choice");
    if(location.hash!=="#/family"&&!token)location.hash="#/family";
  }
  function makeInviteToken(){
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes).map(value=>value.toString(16).padStart(2,"0")).join("");
  }
  async function loadInvite(token){
    inviteToken=token;
    familyPanel("join");
    const name=$("[data-invite-family-name]");
    if(name)name.textContent="this family";
    const question=$("[data-join-recovery-question]");
    if(question)question.textContent="";
    const {data,error}=await client.rpc("get_family_invite_info",{p_invite_token:token});
    if(error)throw error;
    inviteInfo=data;
    if(name)name.textContent=data.family_name||"this family";
    if(question)question.textContent=data.recovery_question||"";
    familyStatus("");
  }
  async function loadFamilyInvitation(token){
    invitationToken=token;inviteToken=null;inviteSlug=null;inviteInfo=null;
    familyPanel("join");
    const name=$("[data-invite-family-name]");
    if(name)name.textContent="this family";
    const {data,error}=await client.rpc("get_family_invite_info_by_token",{p_token:token});
    if(error)throw error;
    if(!data)throw Error("This invitation link has already been used or has expired. Ask the family owner for a new one.");
    inviteInfo=data;
    if(name)name.textContent=data.family_name||"this family";
    familyStatus("");
  }
  async function createFamilyInvitation(){
    const token=makeInviteToken();
    const {data,error}=await client.rpc("create_family_invitation",{p_token:token});
    if(error)throw error;
    if(!data||!data.ok)throw Error("A new family invitation could not be created.");
    const family=await client.from("families").select("slug").eq("id",familyId).single();
    if(family.error)throw family.error;
    familySlug=family.data.slug;
    return location.origin+"/joinafamily/"+familySlug+"?invite="+token;
  }
  async function loadFamilySlug(slug){
    inviteSlug=slug;inviteToken=null;inviteInfo=null;
    familyPanel("join");
    const name=$("[data-invite-family-name]"),question=$("[data-join-recovery-question]");
    if(name)name.textContent="this family";
    if(question)question.textContent="";
    const {data,error}=await client.rpc("get_family_invite_info_by_slug",{p_slug:slug});
    if(error)throw error;
    if(!data)throw Error("This family link is invalid.");
    inviteInfo=data;
    if(name)name.textContent=data.family_name||"this family";
    if(question)question.textContent=data.recovery_question||"";
    familyStatus("");
  }
  async function connectFamily(nextUser,options){
    if(!nextUser||!client)return;
    if(connecting)return connecting;
    options=options||{};
    connecting=(async()=>{
      user=nextUser;ready=false;
      archiveStatus("Checking this device's family connection…");
      const membership=await client.from("family_members").select("family_id,role,display_name").eq("user_id",user.id).eq("status","active").limit(1).maybeSingle();
      if(membership.error)throw membership.error;
      familyId=membership.data&&membership.data.family_id;
      familyRole=membership.data&&membership.data.role;
      memberDisplayName=membership.data&&membership.data.display_name||"Family member";
      const settingsLink=$("[data-family-settings-link]");
      if(settingsLink)settingsLink.hidden=false;
      if(!familyId){
        showConnectButton(false);
        if(invitationToken||inviteSlug){familyPanel("join");}else{showFamilySetup(inviteToken||((location.hash.match(/^#\/join\/([^/]+)/)||[])[1]||null));}
        archiveStatus("Choose a family to create or join on this device.");
        return false;
      }
      if(window.storage&&window.storage.setNamespace)window.storage.setNamespace(familyId);
      await syncPhotos();
      await syncStories();
      ready=true;
      showConnectButton(false);
      archiveStatus("Private family archive connected. Photos and stories are saved online.");
      emitUpdated();
      if(location.hash==="#/family")await loadFamilySettings();
      if(options.redirect||location.hash.startsWith("#/join/")||location.hash==="#/signin")location.hash="#/album";
      return true;
    })().catch(error=>{
      ready=false;
      showConnectButton(false);
      familyStatus(error.message||"We could not connect this family archive.",true);
      archiveStatus("Archive connection needs attention: "+(error.message||"Please try again."));
      console.error("Family archive connection failed",error);
      throw error;
    }).finally(()=>{connecting=null;});
    return connecting;
  }
  async function loadFamilySettings(){
    if(!client||!user||!ready)return;
    const {data,error}=await client.rpc("get_my_family_access_status");
    if(error)throw error;
    familyPanel("access");
    const memberNameInput=$("#member-display-name");
    if(memberNameInput)memberNameInput.value=memberDisplayName||"";
    const memberNameSaved=$("[data-member-name-saved]");
    if(memberNameSaved)memberNameSaved.hidden=true;
    const form=$("[data-family-access-form]");
    const readonly=$("[data-family-access-readonly]");
    const owner=data&&data.role==="owner";
    if(form)form.hidden=!owner;
    if(readonly)readonly.hidden=owner;
    const saved=$("[data-family-access-saved]");
    if(saved)saved.hidden=true;
    const share=$("[data-family-share-message]");
    const copyShare=$("[data-family-action='copy-family-share']");
    familySlug=null;
    if(owner){
      const family=await client.from("families").select("slug").eq("id",familyId).single();
      if(family.error)throw family.error;
      familySlug=family.data.slug;
      const url=await createFamilyInvitation();
      if(share)share.value="You’re invited to our family archive!\n\nOpen this personal invitation link to join: "+url+"\n\nThe link can be used once and expires in 7 days.";
      if(copyShare)copyShare.hidden=false;
    }else{if(share)share.value="";if(copyShare)copyShare.hidden=true;}
    const title=$("[data-family-access] h2");
    if(title&&data&&data.family_name)title.textContent=data.family_name+" sharing settings";
    const link=$("[data-family-settings-link]");
    if(link)link.hidden=false;
  }
  async function saveMemberDisplayName(event){
    if(event)event.preventDefault();
    if(authBusy||!client||!user||!ready)return;
    const form=$("[data-member-name-form]");
    const name=(form.elements.displayName.value||"").trim();
    if(!name||name.length>80){familyStatus("Please enter a name between 1 and 80 characters.",true);return;}
    authBusy=true;
    const button=form.querySelector("button[type='submit']");
    if(button)button.disabled=true;
    try{
      const {data,error}=await client.rpc("set_my_family_display_name",{p_display_name:name});
      if(error)throw error;
      if(!data||!data.ok)throw Error(data&&data.error||"Your name could not be updated.");
      memberDisplayName=name;
      const saved=$("[data-member-name-saved]");
      if(saved)saved.hidden=false;
      familyStatus("Your name has been updated for this device.");
      await syncStories();
      emitUpdated();
    }catch(error){familyStatus(error.message||"Your name could not be updated.",true);}
    finally{authBusy=false;if(button)button.disabled=false;}
  }
  async function saveFamilyAccess(event){
    if(event)event.preventDefault();
    if(authBusy||!client||!user)return;
    const form=$("[data-family-access-form]");
    const password=makeInviteToken()+makeInviteToken();
    const selected=form.elements.recoveryQuestion.value;
    const question=selected==="custom"?form.elements.customQuestion.value.trim():selected;
    const answer=form.elements.recoveryAnswer.value.trim();
    if(!question||!answer){familyStatus("Please complete the recovery question and answer.",true);return;}
    authBusy=true;
    const button=form.querySelector("button[type='submit']");
    if(button)button.disabled=true;
    try{
      const {data,error}=await client.rpc("set_family_access",{p_password:password,p_recovery_question:question,p_recovery_answer:answer,p_invite_token:makeInviteToken()});
      if(error)throw error;
      if(!data||!data.ok)throw Error("Family access settings could not be saved.");
      const saved=$("[data-family-access-saved]");
      if(saved)saved.hidden=false;
      const codeWrap=$("[data-family-code-wrap]");
      const copyCode=$("[data-copy-family-code]");
      if(codeWrap)codeWrap.hidden=true;
      if(copyCode)copyCode.hidden=true;
      form.reset();
      const custom=$("[data-access-custom-question]");
      if(custom)custom.hidden=true;
      familyStatus("Family recovery settings saved. Existing invitations remain valid until used or expired.");
    }catch(error){
      familyStatus(error.message||"We could not save family access settings.",true);
    }finally{
      authBusy=false;if(button)button.disabled=false;
    }
  }
  async function createFamily(event){
    if(event)event.preventDefault();
    if(authBusy)return;
    if(!client||!user){
      familyStatus("Family setup is still connecting. Please wait a moment and try again. If this continues, refresh the page.",true);
      return;
    }
    const form=$("[data-family-create]");
    const name=form.elements.familyName.value.trim();
    const password=makeInviteToken()+makeInviteToken();
    const selected=form.elements.recoveryQuestion.value;
    const question=selected==="custom"?form.elements.customQuestion.value.trim():selected;
    const answer=form.elements.recoveryAnswer.value.trim();
    if(!name||!question||!answer){
      familyStatus("Please complete the family name and recovery question and answer.",true);return;
    }
    authBusy=true;
    const token=makeInviteToken();
    const button=form.querySelector("button[type='submit']");
    if(button)button.disabled=true;
    try{
      const {data,error}=await client.rpc("create_family_with_access",{
        p_name:name,p_password:password,p_recovery_question:question,p_recovery_answer:answer,p_invite_token:token
      });
      if(error)throw error;
      familyId=data;
      if(window.storage&&window.storage.setNamespace)window.storage.setNamespace(familyId);
      await connectFamily(user,{stay:true});
      const family=await client.from("families").select("slug").eq("id",familyId).single();
      if(family.error)throw family.error;
      familySlug=family.data.slug;
      const link=await createFamilyInvitation();
      const input=$("#family-invite-link");
      if(input)input.value=link;
      familyPanel("created");
      familyStatus("Your family is ready. Share the invitation link with relatives. It can be used once and expires in 7 days.");
    }catch(error){
      familyStatus(error.message||"We could not create your family. Please try again.",true);
    }finally{
      authBusy=false;if(button)button.disabled=false;
    }
  }
  async function joinFamily(event){
    if(event)event.preventDefault();
    if(authBusy||!client||!user||!invitationToken){familyStatus("Open a current personal invitation link from your family to continue.",true);return;}
    const form=$("[data-family-join]");
    authBusy=true;
    const button=form.querySelector("button[type='submit']");
    if(button)button.disabled=true;
    try{
      const displayName=($("#join-member-name")?.value||"").trim();
      if(!displayName){familyStatus("Please enter your name so your stories can be attributed to you.",true);return;}
      const {data,error}=await client.rpc("redeem_family_invitation",{p_token:invitationToken,p_display_name:displayName});
      if(error)throw error;
      if(!data||!data.ok)throw Error(data&&data.error||"We could not join this family.");
      await connectFamily(user,{redirect:true});
    }catch(error){
      familyStatus(error.message||"We could not join this family. Please try again.",true);
    }finally{
      authBusy=false;if(button)button.disabled=false;
    }
  }
  async function recoverFamily(){
    if(authBusy||!client||!user||invitationToken||(!inviteToken&&!inviteSlug))return;
    const answer=$("#join-recovery-answer").value.trim();
    if(!answer){familyStatus("Enter the answer to the family's recovery question.",true);return;}
    authBusy=true;
    const button=$("[data-family-action='recover']");
    if(button)button.disabled=true;
    try{
      const {data,error}=inviteSlug?await client.rpc("recover_family_by_slug_with_question",{p_slug:inviteSlug,p_answer:answer}):await client.rpc("recover_family_with_question",{p_invite_token:inviteToken,p_answer:answer});
      if(error)throw error;
      if(!data||!data.ok)throw Error(data&&data.error||"We could not recover this family.");
      await connectFamily(user,{redirect:true});
    }catch(error){
      familyStatus(error.message||"We could not recover this family. Please try again.",true);
    }finally{
      authBusy=false;if(button)button.disabled=false;
    }
  }
  function wireFamilyForms(){
    const create=$("[data-family-create]"),join=$("[data-family-join]");
    if(create)create.addEventListener("submit",createFamily);
    if(join)join.addEventListener("submit",joinFamily);
    const access=$("[data-family-access-form]");
    if(access)access.addEventListener("submit",saveFamilyAccess);
    const memberName=$("[data-member-name-form]");
    if(memberName)memberName.addEventListener("submit",saveMemberDisplayName);
    const question=$("#family-recovery-question"),custom=$("[data-custom-question]");
    if(question&&custom)question.addEventListener("change",()=>{custom.hidden=question.value!=="custom";});
    const accessQuestion=$("#access-recovery-question"),accessCustom=$("[data-access-custom-question]");
    if(accessQuestion&&accessCustom)accessQuestion.addEventListener("change",()=>{accessCustom.hidden=accessQuestion.value!=="custom";});
    document.addEventListener("click",async event=>{
      const mode=event.target.closest("[data-family-mode]");
      if(mode){familyPanel(mode.getAttribute("data-family-mode"));return;}
      const back=event.target.closest("[data-family-back]");
      if(back){if(inviteToken||inviteSlug){location.hash="#/home";}else familyPanel("choice");return;}
      const action=event.target.closest("[data-family-action]");
      if(!action)return;
      const type=action.getAttribute("data-family-action");
      if(type==="recover-toggle"){
        const panel=$("[data-family-recovery]");
        if(panel)panel.hidden=!panel.hidden;
      }
      if(type==="recover")recoverFamily();
      if(type==="load-invite"){
        const value=$("#join-invite-link").value.trim();
        try{
          const parsed=new URL(value,location.origin);
          const token=parsed.searchParams.get("invite");
          if(token&&/^[a-f0-9]{64}$/i.test(token)){await loadFamilyInvitation(token);}
          else{familyStatus("That invitation link is missing its personal invite token. Ask the family owner to create a new invitation.",true);}
        }catch(error){familyStatus(error.message||"That invitation link could not be opened.",true);}
      }
      if(type==="copy-family-share"){
        const value=$("[data-family-share-message]")?.value||"";
        try{await navigator.clipboard.writeText(value);familyStatus("Family invitation message copied. Send it to your relative.");}
        catch(_){const field=$("[data-family-share-message]");field.focus();field.select();document.execCommand("copy");familyStatus("Family invitation message copied. Send it to your relative.");}
      }
      if(type==="copy-invite"){
        const input=$("#family-invite-link");
        try{await navigator.clipboard.writeText(input.value);familyStatus("Invitation link copied. Send it to your relative.");}
        catch(_){input.select();document.execCommand("copy");familyStatus("Invitation link copied. Send it to your relative.");}
      }
      if(type==="open-album")location.hash="#/album";
    });
  }
  async function init(){
    // Wire family forms immediately so setup errors are visible rather than leaving the primary action inert.
    wireFamilyForms();
    try{
      if(window.gsAppHydrated)await window.gsAppHydrated;
      const configResponse=await fetch("/api/config",{cache:"no-store"});
      const config=await configResponse.json();
      if(!configResponse.ok||!config.url||!config.publishableKey)throw Error(config.error||"Family archive is not configured yet.");
      if(!window.supabase||!window.supabase.createClient)throw Error("The secure archive service did not load.");
      client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
      client.auth.onAuthStateChange((event,session)=>{
        if(event==="SIGNED_OUT"){
          user=null;familyId=null;familyRole=null;ready=false;
          if(window.storage&&window.storage.setNamespace)window.storage.setNamespace(null);
          showConnectButton(false);showFamilySetup(null);
        }
        if(event==="SIGNED_IN"&&session&&session.user){
          user=session.user;
          Promise.resolve().then(()=>connectFamily(session.user)).catch(()=>{});
        }
      });
      let sessionResult=await client.auth.getSession();
      if(sessionResult.error)throw sessionResult.error;
      if(!sessionResult.data.session){
        const signed=await client.auth.signInAnonymously();
        if(signed.error)throw signed.error;
        user=signed.data.user;
      }else{
        user=sessionResult.data.session.user;
      }
      const familyPath=location.pathname.match(/^\/joinafamily\/([^/]+)\/?$/i);
      const routeMatch=location.hash.match(/^#\/join\/([^/]+)/);
      inviteToken=routeMatch?decodeURIComponent(routeMatch[1]):null;
      const invitationFromUrl=familyPath?new URLSearchParams(location.search).get("invite"):null;
      if(familyPath&&invitationFromUrl){location.hash="#/family";await loadFamilyInvitation(invitationFromUrl);}
      else if(familyPath){location.hash="#/family";inviteSlug=decodeURIComponent(familyPath[1]);familyPanel("join");familyStatus("This is a family address, not an invitation. Ask the owner to send you a personal invitation link.",true);}
      else if(inviteToken)await loadInvite(inviteToken);
      await connectFamily(user,{redirect:!!(inviteToken||inviteSlug||invitationToken)});
      window.addEventListener("gs:local-change",()=>{
        if(!ready)return;
        clearTimeout(window.__gsSyncTimer);
        window.__gsSyncTimer=setTimeout(()=>syncAll(),500);
      });
      window.addEventListener("online",syncAll);
      window.addEventListener("hashchange",()=>{if(location.hash==="#/family"&&ready)loadFamilySettings().catch(error=>familyStatus(error.message||"Family settings could not be loaded.",true));});
      document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncAll();});
      window.setInterval(()=>{if(ready)syncAll();},30000);
      window.gsCloud={sync:syncAll,isReady:()=>ready,getFamilyId:()=>familyId,getDisplayName:()=>memberDisplayName,getStoriesForPhoto};
      if(!ready)archiveStatus("Create a family or open an invitation link to join one.");
    }catch(error){
      showConnectButton(false);
      console.warn("Family device authentication unavailable",error);
      showFamilySetup(null);
      if(location.hash!=="#/family")location.hash="#/family";
      familyStatus(error.message||"Family setup is not available right now. Please refresh and try again.",true);
      archiveStatus("Family archive connection is not available right now.");
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