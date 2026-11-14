const $=id=>document.getElementById(id);
const previewMode=new URLSearchParams(window.location.search).get('preview')==='1';
const consentKey=previewMode?'grandmas-stories-preview-consent-v1':'grandmas-stories-consent-v1';
const screens=['welcome','cloudAuth','addPanel','stories','consent','live','saving','saved','error'];
let db,photos=[],selectedFiles=[],currentPhoto=null,pc=null,dc=null,stream=null,recorder=null,chunks=[],lines=[],started=0,tick=null,sessionPhase='idle',photoQueue=[],lastPhotoId=null,photoHistory=[],navigationPhoto=null,supabaseClient=null,cloudUser=null,cloudFamilyId=null,authBusy=false,cloudConnectPromise=null,cloudConnectUserId=null,cloudSessionGeneration=0,cloudReady=false,cloudError=null,cloudSyncPromise=null;
function show(id){screens.forEach(name=>$(name).classList.toggle('hidden',name!==id));document.body.classList.toggle('home-mode',id==='welcome');document.body.classList.toggle('auth-mode',id==='cloudAuth');document.body.classList.toggle('live-mode',id==='live');document.body.classList.toggle('album-mode',id==='addPanel');window.scrollTo({top:0,behavior:'smooth'});}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(previewMode?'grandmas-stories-preview':'grandmas-stories-local',2);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('stories'))d.createObjectStore('stories',{keyPath:'id'});if(!d.objectStoreNames.contains('photos'))d.createObjectStore('photos',{keyPath:'id'});};req.onsuccess=()=>{db=req.result;resolve(db)};req.onerror=()=>reject(req.error)});}
function store(name,mode,work){return new Promise((resolve,reject)=>{const tx=db.transaction(name,mode);const result=work(tx.objectStore(name));tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});}
function allPhotos(){return new Promise((resolve,reject)=>{const req=db.transaction('photos').objectStore('photos').getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)});}
function allStories(){return new Promise((resolve,reject)=>{const req=db.transaction('stories').objectStore('stories').getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)});}
function readAsDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file)});}
function compressImage(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{const scale=Math.min(1,1400/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not prepare this photograph.')),'image/jpeg',.82)};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('This photograph could not be opened.'))};img.src=url;});}

const SUPABASE_URL='https://zxsumrlxfuqnjjuaszbs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_LtISsb2h1FDOayTDinoZ2g_PDmqfzbb';
async function uploadPhotoToCloud(photo){
  if(!cloudUser)return photo;
  if(!cloudFamilyId)throw Error('Your private family archive is still connecting. Please wait a moment and try again.');
  if(photo.cloudAssetId)return photo;
  const assetId=photo.id;
  const objectKey=cloudFamilyId+'/'+assetId+'/original.jpg';
  const {error:assetError}=await supabaseClient.from('media_assets').upsert({
    id:assetId,family_id:cloudFamilyId,asset_type:'photo',title:photo.title||'Family photograph',created_by:cloudUser.id
  },{onConflict:'id,family_id'});
  if(assetError)throw assetError;
  const {error:uploadError}=await supabaseClient.storage.from('family-archive').upload(objectKey,photo.image,{contentType:'image/jpeg',upsert:true});
  if(uploadError)throw uploadError;
  const {error:fileError}=await supabaseClient.from('media_files').upsert({
    family_id:cloudFamilyId,media_asset_id:assetId,variant:'original',storage_provider:'supabase',bucket_name:'family-archive',object_key:objectKey,mime_type:'image/jpeg',byte_size:photo.image.size,created_by:cloudUser.id
  },{onConflict:'storage_provider,bucket_name,object_key'});
  if(fileError)throw fileError;
  const updated={...photo,cloudAssetId:assetId};
  await store('photos','readwrite',st=>st.put(updated));
  return updated;
}
async function syncCloudPhotos(){
  if(!cloudUser||!cloudFamilyId)return;
  let local=await allPhotos();
  for(const photo of local){if(!photo.cloudAssetId)await uploadPhotoToCloud(photo);}
  const {data:assets,error}=await supabaseClient.from('media_assets').select('id,title,created_at').eq('family_id',cloudFamilyId).eq('asset_type','photo').order('created_at',{ascending:true});
  if(error)throw error;
  if(!assets?.length)return;
  const ids=assets.map(a=>a.id);
  const {data:files,error:fileError}=await supabaseClient.from('media_files').select('media_asset_id,object_key,mime_type').eq('family_id',cloudFamilyId).eq('variant','original').in('media_asset_id',ids);
  if(fileError)throw fileError;
  const byAsset=new Map((files||[]).map(f=>[f.media_asset_id,f]));
  local=await allPhotos();
  const localCloudIds=new Set(local.map(p=>p.cloudAssetId).filter(Boolean));
  for(const asset of assets){
    if(localCloudIds.has(asset.id))continue;
    const file=byAsset.get(asset.id);if(!file)continue;
    const {data:signed,error:signedError}=await supabaseClient.storage.from('family-archive').createSignedUrl(file.object_key,3600);
    if(signedError)throw signedError;
    const response=await fetch(signed.signedUrl);if(!response.ok)throw Error('A family photograph could not be downloaded.');
    const image=await response.blob();
    await store('photos','readwrite',st=>st.put({id:'cloud-'+asset.id,cloudAssetId:asset.id,title:asset.title||'Family photograph',notes:'',image,createdAt:asset.created_at||new Date().toISOString()}));
  }
  await refreshPhotos();
}
function transcriptForCloud(lines){
  return (lines||[]).filter(line=>line.text).map(line=>(line.who==='user'?'Betty':'A gentle thought')+': '+line.text).join('\n');
}
async function syncStoryToCloud(story){
  if(!cloudUser)return false;
  if(!cloudFamilyId)throw Error('Your private family archive is still connecting. Please wait a moment and try again.');
  const storyId=story.cloudStoryId||story.id;
  const {error:storyError}=await supabaseClient.from('stories').upsert({
    id:storyId,family_id:cloudFamilyId,title:(story.photoTitle||'A family story').slice(0,240),
    original_text:transcriptForCloud(story.lines),status:'draft',created_by:cloudUser.id,updated_by:cloudUser.id
  },{onConflict:'id,family_id'});
  if(storyError)throw storyError;
  const links=[];
  const photo=photos.find(p=>p.id===story.photoId);
  if(photo?.cloudAssetId)links.push({family_id:cloudFamilyId,story_id:storyId,media_asset_id:photo.cloudAssetId,relationship:'cover'});
  if(story.audio?.size){
    const audioAssetId=story.audioCloudAssetId||crypto.randomUUID();
    if(!story.audioCloudAssetId){
      story={...story,audioCloudAssetId:audioAssetId};
      await store('stories','readwrite',st=>st.put(story));
    }
    const isMp4=(story.audio.type||'').includes('mp4'),ext=isMp4?'m4a':'webm',audioMime=isMp4?'audio/mp4':'audio/webm';
    const objectKey=cloudFamilyId+'/'+audioAssetId+'/original.'+ext;
    const {error:assetError}=await supabaseClient.from('media_assets').upsert({
      id:audioAssetId,family_id:cloudFamilyId,asset_type:'audio',title:(story.photoTitle||'Family story')+' — recording',created_by:cloudUser.id
    },{onConflict:'id,family_id'});
    if(assetError)throw assetError;
    const {error:uploadError}=await supabaseClient.storage.from('family-archive').upload(objectKey,story.audio,{contentType:audioMime,upsert:true});
    if(uploadError)throw uploadError;
    const {error:fileError}=await supabaseClient.from('media_files').upsert({
      family_id:cloudFamilyId,media_asset_id:audioAssetId,variant:'original',storage_provider:'supabase',bucket_name:'family-archive',object_key:objectKey,mime_type:audioMime,byte_size:story.audio.size,created_by:cloudUser.id
    },{onConflict:'storage_provider,bucket_name,object_key'});
    if(fileError)throw fileError;
    links.push({family_id:cloudFamilyId,story_id:storyId,media_asset_id:audioAssetId,relationship:'audio_narration'});
  }
  for(const link of links){
    const {error:linkError}=await supabaseClient.from('story_media').upsert(link,{onConflict:'story_id,media_asset_id,relationship',ignoreDuplicates:true});
    if(linkError)throw linkError;
  }
  const updated={...story,cloudStoryId:storyId};
  await store('stories','readwrite',st=>st.put(updated));
  return true;
}
async function syncCloudStories(){
  if(!cloudUser||!cloudFamilyId)return;
  const pendingStories=await allStories();
  for(const story of pendingStories){if(!story.cloudStoryId)await syncStoryToCloud(story);}
  const {data:rows,error}=await supabaseClient.from('stories').select('id,title,original_text,created_at').eq('family_id',cloudFamilyId).order('created_at',{ascending:false});
  if(error)throw error;if(!rows?.length)return;
  const ids=rows.map(r=>r.id);
  const {data:links,error:linkError}=await supabaseClient.from('story_media').select('story_id,media_asset_id,relationship').eq('family_id',cloudFamilyId).in('story_id',ids);
  if(linkError)throw linkError;
  const assetIds=[...new Set((links||[]).filter(l=>l.relationship==='audio_narration').map(l=>l.media_asset_id))];
  const audioFiles=assetIds.length?await supabaseClient.from('media_files').select('media_asset_id,object_key,mime_type').eq('family_id',cloudFamilyId).eq('variant','original').in('media_asset_id',assetIds):{data:[],error:null};
  if(audioFiles.error)throw audioFiles.error;
  const byAsset=new Map((audioFiles.data||[]).map(f=>[f.media_asset_id,f]));
  const existing=await allStories();const known=new Set(existing.map(story=>story.cloudStoryId).filter(Boolean));
  const localPhotos=await allPhotos();
  for(const row of rows){
    if(known.has(row.id))continue;
    let audio=null;const audioLink=(links||[]).find(l=>l.story_id===row.id&&l.relationship==='audio_narration');const audioFile=audioLink&&byAsset.get(audioLink.media_asset_id);
    if(audioFile){const {data:signed,error:signedError}=await supabaseClient.storage.from('family-archive').createSignedUrl(audioFile.object_key,3600);if(signedError)throw signedError;const response=await fetch(signed.signedUrl);if(!response.ok)throw Error('A saved story recording could not be downloaded.');audio=await response.blob();}
    const storyLines=(row.original_text||'').split('\n').map(line=>{const m=line.match(/^(Betty|A gentle thought):\s*(.*)$/);return m?{who:m[1]==='Betty'?'user':'ai',text:m[2]}:{who:'user',text:line};}).filter(l=>l.text);
    const cover=(links||[]).find(l=>l.story_id===row.id&&l.relationship==='cover');
    const localPhoto=localPhotos.find(p=>p.cloudAssetId===cover?.media_asset_id);
    await store('stories','readwrite',st=>st.put({id:'cloud-story-'+row.id,cloudStoryId:row.id,photoId:localPhoto?.id||null,photoTitle:row.title,lines:storyLines,createdAt:row.created_at,audio}));
  }
}
function updateHomeActions(){const archiveReady=!!cloudUser&&cloudReady;document.body.classList.toggle('archive-connected',archiveReady);document.body.classList.toggle('archive-disconnected',!archiveReady);$('startSession').disabled=!archiveReady||!photos.length;$('openStories').disabled=!archiveReady;$('startSession').setAttribute('aria-disabled',String($('startSession').disabled));$('openStories').setAttribute('aria-disabled',String($('openStories').disabled));}
async function connectCloudSession(user){
  if(!user||!supabaseClient)return;
  if(cloudConnectPromise&&cloudConnectUserId===user.id)return cloudConnectPromise;
  const generation=++cloudSessionGeneration;
  cloudConnectUserId=user.id;
  const connectionPromise=(async()=>{
    cloudUser=user;cloudReady=false;cloudError=null;updateHomeActions();
    $('archiveConnectionStatus').textContent='Connecting to your private family archive…';
    $('cloudAuthTitle').textContent='Your family archive is connected.';
    $('cloudAuthDescription').textContent='Signed in as '+user.email+'. Your private family space is being prepared.';
    $('archiveSignInForm').classList.add('hidden');
    $('cloudAuthStatus').textContent='Checking your family space…';
    const {data:membership,error:memberError}=await supabaseClient.from('family_members').select('family_id,role').eq('user_id',user.id).eq('status','active').limit(1).maybeSingle();
    if(generation!==cloudSessionGeneration||cloudUser?.id!==user.id)return;
    if(memberError)throw memberError;
    let familyId=membership?.family_id||null;
    if(!familyId){
      const {data:createdFamilyId,error:createError}=await supabaseClient.rpc('create_family',{p_name:"Grandma’s Stories"});
      if(generation!==cloudSessionGeneration||cloudUser?.id!==user.id)return;
      if(createError)throw createError;
      familyId=createdFamilyId;
    }
    if(generation!==cloudSessionGeneration||cloudUser?.id!==user.id)return;
    cloudFamilyId=familyId;
    $('cloudAuthStatus').textContent='Syncing your family album…';
    await syncCloudPhotos();
    if(generation!==cloudSessionGeneration||cloudUser?.id!==user.id)return;
    await syncCloudStories();
    if(generation!==cloudSessionGeneration||cloudUser?.id!==user.id)return;
    cloudReady=true;updateHomeActions();
    $('cloudAuthStatus').textContent='Your private family archive is ready. Photos and stories are synced.';
    $('cloudAuthDescription').textContent='Signed in as '+user.email+'.';
    $('connectArchive').textContent='Connect to our family archive';
    $('archiveConnectionStatus').textContent='Private family archive connected. Photos and stories are saved online.';
  })().catch(error=>{
    if(generation===cloudSessionGeneration){
      cloudReady=false;cloudError=error;
      $('cloudAuthStatus').textContent='We could not prepare the family space: '+(error.message||'Please try again.');
      $('archiveConnectionStatus').textContent='Archive connection needs attention: '+(error.message||'Please try again.');
    }
    throw error;
  });
  cloudConnectPromise=connectionPromise;
  connectionPromise.finally(()=>{
    if(cloudConnectPromise===connectionPromise){cloudConnectPromise=null;cloudConnectUserId=null;}
  }).catch(()=>{});
  return connectionPromise;
}
async function retryPendingCloudSync(){
  if(!cloudReady||!cloudUser||!cloudFamilyId||!supabaseClient||!navigator.onLine)return;
  if(cloudSyncPromise)return cloudSyncPromise;
  const generation=cloudSessionGeneration,userId=cloudUser.id;
  const task=(async()=>{
    await syncCloudPhotos();
    if(generation!==cloudSessionGeneration||cloudUser?.id!==userId)return;
    await syncCloudStories();
    if(generation!==cloudSessionGeneration||cloudUser?.id!==userId)return;
    cloudError=null;
    $('archiveConnectionStatus').textContent='Private family archive connected. Photos and stories are saved online.';
  })().catch(error=>{
    if(generation===cloudSessionGeneration&&cloudUser?.id===userId){
      cloudError=error;
      $('archiveConnectionStatus').textContent='Some items are still waiting to back up. We’ll retry when the connection is available.';
    }
  }).finally(()=>{if(cloudSyncPromise===task)cloudSyncPromise=null;});
  cloudSyncPromise=task;
  return task;
}
async function initCloudAuth(){
  if(!window.supabase?.createClient)return;
  supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){
      cloudSessionGeneration++;cloudUser=null;cloudFamilyId=null;cloudReady=false;cloudError=null;cloudConnectPromise=null;cloudConnectUserId=null;cloudSyncPromise=null;updateHomeActions();
      $('connectArchive').textContent='Connect our private family archive';$('connectArchive').classList.remove('hidden');
      $('archiveConnectionStatus').textContent='Saved on this iPad only until the family archive is connected.';
    }
    if(event==='SIGNED_IN'&&session?.user){
      Promise.resolve().then(()=>connectCloudSession(session.user)).catch(()=>{});
    }
  });
  const {data:{session},error}=await supabaseClient.auth.getSession();
  if(error)console.warn('Could not restore family archive session',error);
  if(session?.user){try{await connectCloudSession(session.user)}catch(e){console.warn('Family archive connection needs attention',e);}}
}
$('connectArchive').onclick=async()=>{show('cloudAuth');if(cloudUser){$('cloudAuthTitle').textContent='Your private family archive';$('cloudAuthDescription').textContent='Signed in as '+cloudUser.email+'.';$('archiveSignInForm').classList.add('hidden');if(!cloudReady){$('cloudAuthStatus').textContent='Finishing the connection…';try{await connectCloudSession(cloudUser);}catch(e){$('cloudAuthStatus').textContent='We could not prepare your family space: '+(e.message||'Please try again.');$('archiveConnectionStatus').textContent='Archive connection needs attention: '+(e.message||'Please try again.');}}else{$('cloudAuthStatus').textContent='Your private family archive is connected. Photos and stories are saved online.';await retryPendingCloudSync();}}else{$('cloudAuthTitle').textContent='Welcome back to the family archive.';$('cloudAuthDescription').textContent="We'll email you a secure sign-in link. No password needed.";$('archiveSignInForm').classList.remove('hidden');$('sendArchiveLink').classList.remove('hidden');$('resendArchiveLink').classList.add('hidden');$('archiveEmail').value='';$('cloudAuthStatus').textContent='';$('archiveEmail').removeAttribute('aria-invalid');}};
$('closeCloudAuth').onclick=()=>show('welcome');
async function sendArchiveSignInLink(isResend=false){
  if(authBusy)return;
  if(!supabaseClient){$('cloudAuthStatus').textContent='The secure sign-in service is not ready. Please try again shortly.';return;}
  const email=$('archiveEmail').value.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    $('archiveEmail').setAttribute('aria-invalid','true');
    $('cloudAuthStatus').textContent='Please enter a valid email address.';
    $('archiveEmail').focus();
    return;
  }
  $('archiveEmail').removeAttribute('aria-invalid');
  authBusy=true;
  $('sendArchiveLink').disabled=true;
  $('resendArchiveLink').disabled=true;
  $('cloudAuthStatus').textContent=isResend?'Sending another link…':'Sending your secure sign-in link…';
  try{
    const {error}=await supabaseClient.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin+window.location.pathname,shouldCreateUser:true}});
    if(error)throw error;
    $('cloudAuthStatus').textContent='Check your inbox - your link is on its way.';
    $('sendArchiveLink').classList.add('hidden');
    $('resendArchiveLink').classList.remove('hidden');
  }catch(e){
    $('cloudAuthStatus').textContent=e.message||'We could not send the email. Please try again.';
    if(isResend)$('resendArchiveLink').classList.remove('hidden');
    else $('sendArchiveLink').classList.remove('hidden');
  }finally{
    authBusy=false;
    $('sendArchiveLink').disabled=false;
    $('resendArchiveLink').disabled=false;
  }
}
$('archiveSignInForm').addEventListener('submit',event=>{event.preventDefault();sendArchiveSignInLink(false);});
$('resendArchiveLink').addEventListener('click',()=>sendArchiveSignInLink(true));
$('archiveEmail').addEventListener('input',()=>{
  $('cloudAuthStatus').textContent='';
  $('archiveEmail').removeAttribute('aria-invalid');
  $('sendArchiveLink').classList.remove('hidden');
  $('resendArchiveLink').classList.add('hidden');
});
async function refreshPhotos(){photos=await allPhotos();photos.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));updateHomeActions();$('photoCount').textContent=photos.length?photos.length+' photograph'+(photos.length===1?'':'s')+' in our family album.':'Your family album is waiting for its first photographs.';document.body.classList.toggle('no-photos',!photos.length);$('homeMessage').textContent='Real stories. Lasting memories.';if(photos.length)$('emptyAlbumPrompt').classList.add('hidden');await renderAlbumPhotos();}
async function renderAlbumPhotos(){
 const grid=$('albumPhotoGrid'),section=$('albumPreview');grid.innerHTML='';section.classList.remove('hidden');
 const stories=await allStories();
 for(const photo of photos){
  const figure=document.createElement('figure'),img=document.createElement('img'),remove=document.createElement('button');
  img.src=URL.createObjectURL(photo.image);img.alt='Family photograph';
  const attached=stories.some(story=>story.photoId===photo.id);
  remove.className='photo-remove';remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove photograph from album');
  remove.disabled=attached;remove.title=attached?'This photograph has a story and cannot be removed':'Remove photograph';
  if(!attached)remove.onclick=()=>removePhotoFromAlbum(photo);
  figure.append(img,remove);grid.append(figure);
 }
 const add=document.createElement('button');add.type='button';add.className='album-add-tile';add.textContent='+';add.setAttribute('aria-label','Add photographs');add.addEventListener('click',()=> $('photoFiles').click());grid.append(add);
}
async function removePhotoFromAlbum(photo){
 const stories=await allStories();
 if(stories.some(story=>story.photoId===photo.id)){alert('This photograph has a story attached, so it cannot be removed.');return;}
 if(!confirm('Remove this photograph from the family album?'))return;
 if(photo.cloudAssetId&&cloudUser&&cloudFamilyId){
  const {data:links,error:linkError}=await supabaseClient.from('story_media').select('story_id').eq('family_id',cloudFamilyId).eq('media_asset_id',photo.cloudAssetId).eq('relationship','cover').limit(1);
  if(linkError)throw linkError;
  if(links?.length){alert('This photograph has a story attached, so it cannot be removed.');return;}
  const {data:files,error:fileError}=await supabaseClient.from('media_files').select('object_key').eq('family_id',cloudFamilyId).eq('media_asset_id',photo.cloudAssetId);
  if(fileError)throw fileError;
  const keys=(files||[]).map(f=>f.object_key);
  if(keys.length){const {error}=await supabaseClient.storage.from('family-archive').remove(keys);if(error)throw error;}
  const {error:metaError}=await supabaseClient.from('media_files').delete().eq('family_id',cloudFamilyId).eq('media_asset_id',photo.cloudAssetId);
  if(metaError)throw metaError;
  const {error:assetError}=await supabaseClient.from('media_assets').delete().eq('family_id',cloudFamilyId).eq('id',photo.cloudAssetId);
  if(assetError)throw assetError;
 }
 await store('photos','readwrite',st=>st.delete(photo.id));
 photoQueue=photoQueue.filter(id=>id!==photo.id);await refreshPhotos();
}
async function renderStories(){
 const list=$('storyList');list.innerHTML='';
 // Only include stories with a saved recording; transcript text alone is not an album story.
 const stories=(await allStories()).filter(story=>story.audio?.size>0).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 $('storiesHeading').textContent='Family Album';
 $('storiesEmpty').classList.toggle('hidden',stories.length>0);

 // A photograph is the organising page in the album. Every conversation
 // recorded against it is kept together beneath one copy of that photograph.
 const pages=new Map();
 for(const story of stories){
  const key=story.photoId?'photo:'+story.photoId:'story:'+story.id;
  if(!pages.has(key))pages.set(key,{photoId:story.photoId,stories:[]});
  pages.get(key).stories.push(story);
 }
 for(const page of pages.values()){
  const card=document.createElement('article');card.className='story-card';
  const photo=page.photoId?photos.find(p=>p.id===page.photoId):null;
  if(photo?.image){
   const frame=document.createElement('div');frame.className='story-photo-frame';
   const img=document.createElement('img');img.src=URL.createObjectURL(photo.image);
   img.alt='Photograph connected to these family stories';
   frame.append(img,...cornerPieces());card.append(frame);
  }
  const conversations=document.createElement('div');conversations.className='story-conversations';
  page.stories.forEach((story,index)=>{
   const entry=document.createElement('section');entry.className='story-entry';
   const date=document.createElement('p');date.className='story-date';
   date.textContent=new Date(story.createdAt).toLocaleString(undefined,{dateStyle:'long',timeStyle:'short'});
   entry.append(date);
   const transcript=document.createElement('div');transcript.className='story-transcript';
   for(const line of story.lines||[]){
    if(!line.text)continue;
    const p=document.createElement('p'),speaker=document.createElement('strong');
    speaker.textContent=line.who==='user'?'Betty':'A gentle thought';
    p.append(speaker,document.createTextNode(line.text));transcript.append(p);
   }
   if(transcript.childElementCount)entry.append(transcript);
   const audio=document.createElement('audio');audio.controls=true;audio.preload='none';
   audio.src=URL.createObjectURL(story.audio);audio.setAttribute('aria-label','Listen to this recorded story');
   entry.append(audio);
   conversations.append(entry);
  });
  card.append(conversations);list.append(card);
 }
}
function cornerPieces(){return ['tl','tr','br','bl'].map(pos=>{const span=document.createElement('span');span.className='photo-corner '+pos;return span;});}
function chooseRandomPhoto(){if(!photos.length)return null;const available=new Set(photos.map(p=>p.id));photoQueue=photoQueue.filter(id=>available.has(id));if(!photoQueue.length){photoQueue=photos.map(p=>p.id);for(let i=photoQueue.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[photoQueue[i],photoQueue[j]]=[photoQueue[j],photoQueue[i]];}if(photoQueue.length>1&&photoQueue[photoQueue.length-1]===lastPhotoId)[photoQueue[0],photoQueue[photoQueue.length-1]]=[photoQueue[photoQueue.length-1],photoQueue[0]];}const id=photoQueue.pop();lastPhotoId=id;return photos.find(p=>p.id===id)||null;}
function addLine(who,text){if(!text)return;lines.push({who,text,at:new Date().toISOString()});const p=document.createElement('p'),label=document.createElement('strong');label.textContent=who==='ai'?'A gentle thought':'Betty';p.append(label,document.createTextNode(text));$('transcript').append(p);$('transcript').scrollTop=$('transcript').scrollHeight;}
function setVoiceStatus(text,state='listening'){$('voiceStatus').lastElementChild.textContent=text;$('live').dataset.audioState=state;const record=$('turntable').querySelector('.record-disc');if(record)record.classList.toggle('is-spinning',state==='listening');$('turntable').setAttribute('aria-label','Audio status: '+state);}
function cleanup(){clearInterval(tick);tick=null;if(recorder&&recorder.state!=='inactive'){try{recorder.stop()}catch{}}if(stream)stream.getTracks().forEach(t=>t.stop());if(pc)pc.close();pc=null;dc=null;stream=null;sessionPhase='idle';}
async function saveStory(blob){
  const story={id:crypto.randomUUID(),photoId:currentPhoto?.id||null,photoTitle:currentPhoto?.title||'Family photograph',lines:[...lines],createdAt:new Date().toISOString(),audio:blob||null,syncStatus:'local'};
  await store('stories','readwrite',st=>st.put(story));
  $('savedCloudStatus').classList.remove('hidden');
  if(cloudUser&&cloudFamilyId){
    $('savedCloudStatus').textContent='Saved on this iPad. Backing up to your private family archive…';
    try{
      await syncStoryToCloud(story);
      $('savedCloudStatus').textContent='Also saved securely to your private family archive.';
    }catch(e){
      console.error('Cloud story sync failed',e);
      $('savedCloudStatus').textContent='Saved on this iPad. Cloud backup is pending and will retry when the archive reconnects: '+(e.message||'Please try again.');
    }
  }else{
    $('savedCloudStatus').textContent='Saved on this iPad only. Connect your private family archive to back it up online.';
  }
}
async function end(advance=false){if(sessionPhase!=='live')return;sessionPhase='saving';if(!advance)show('saving');else setVoiceStatus('Saving this story…','thinking');let blob=null;try{if(recorder&&recorder.state!=='inactive')await new Promise(resolve=>{recorder.addEventListener('stop',resolve,{once:true});recorder.stop()});if(chunks.length)blob=new Blob(chunks,{type:recorder?.mimeType||'audio/webm'});cleanup();await saveStory(blob);if(advance){if(navigationPhoto){currentPhoto=navigationPhoto;navigationPhoto=null;}else{if(currentPhoto)photoHistory.push(currentPhoto);currentPhoto=chooseRandomPhoto();}if(currentPhoto){$('timer').textContent='0:00';$('transcript').innerHTML='';start();return;}}const thumb=$('savedPhoto');thumb.innerHTML='';if(currentPhoto){const img=document.createElement('img');img.src=URL.createObjectURL(currentPhoto.image);img.alt='The photograph connected to this story';thumb.append(img)}show('saved')}catch(e){cleanup();$('errorText').textContent='We could not save this story on the iPad. Please keep this page open and ask a family member for help.';show('error')}}
async function start(){if(!currentPhoto)return;
  // Go straight to the photograph. The connection happens in place; there is no
  // separate "getting ready" page between the album and the conversation.
  $('transcript').innerHTML='';
  const liveFrame=document.createElement('div');liveFrame.className='live-photo-frame';const liveImg=$('livePhoto');liveImg.src=URL.createObjectURL(currentPhoto.image);liveImg.style.display='block';liveFrame.append(liveImg,...cornerPieces());const oldFrame=$('livePhotoWrap').querySelector('.live-photo-frame');if(oldFrame)oldFrame.remove();$('livePhotoWrap').querySelector('.album-paper').insertBefore(liveFrame,$('livePhotoWrap').querySelector('.album-caption'));
  $('stop').disabled=true;$('nextPhoto').disabled=true;
  setVoiceStatus('Getting things ready…','thinking');
  show('live');sessionPhase='connecting';
  $('livePhotoWrap').classList.remove('photo-enter');void $('livePhotoWrap').offsetWidth;$('livePhotoWrap').classList.add('photo-enter');
  if(previewMode){lines=[];chunks=[];sessionPhase='live';$('timer').textContent='Preview';setVoiceStatus('Preview mode — microphone and AI voice are switched off.','thinking');$('stop').disabled=false;$('nextPhoto').disabled=false;return;}
  try{
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  chunks=[];lines=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.start(1000);
  pc=new RTCPeerConnection();pc.addTrack(stream.getAudioTracks()[0],stream);pc.ontrack=e=>{$('remoteAudio').srcObject=e.streams[0];$('remoteAudio').play().catch(()=>{});};
  dc=pc.createDataChannel('oai-events');dc.onmessage=e=>{let d;try{d=JSON.parse(e.data)}catch{return}
    if(d.type==='response.output_audio_transcript.done'||d.type==='response.output_text.done')addLine('ai',d.transcript||d.text);
    if(d.type==='conversation.item.input_audio_transcription.completed')addLine('user',d.transcript);
    if(d.type==='input_audio_buffer.speech_started')setVoiceStatus('I hear you…','listening');
    if(d.type==='response.created')setVoiceStatus('Thinking about that…','thinking');
    if(d.type==='output_audio_buffer.started')setVoiceStatus('I’m speaking…','speaking');
    if(d.type==='output_audio_buffer.stopped')setVoiceStatus('Whenever you’re ready, I’m listening.','listening');
  };
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);
  const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/sdp'},body:offer.sdp});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'The voice service is not ready yet.')}
  await pc.setRemoteDescription({type:'answer',sdp:await response.text()});
  await new Promise((resolve,reject)=>{if(dc.readyState==='open')resolve();else{dc.addEventListener('open',resolve,{once:true});dc.addEventListener('error',()=>reject(Error('The voice connection could not be opened.')),{once:true});}});
  $('transcript').innerHTML='';setVoiceStatus('Whenever you’re ready, I’m listening.','listening');$('stop').disabled=false;$('nextPhoto').disabled=false;sessionPhase='live';started=Date.now();
  tick=setInterval(()=>{const seconds=Math.floor((Date.now()-started)/1000);$('timer').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');if(seconds>=720)end()},1000);
  const photoData=await readAsDataURL(currentPhoto.image);
  dc.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_image',image_url:photoData}]}}));
  const context=currentPhoto.notes?'Family-provided context (not verified): '+currentPhoto.notes+'. ':'';
  dc.send(JSON.stringify({type:'response.create',response:{instructions:`You are conducting a gentle, warm oral-history interview with Betty, using this actual family photograph as the starting point. This is an active two-way conversation, not a passive recording session. ${context}Look carefully at the image, but do not guess identities, relationships, dates, locations, or details you cannot know. Do not claim to recognise anyone. Begin by gently noticing one specific, clearly visible detail in the photograph, then ask one clear, pointed opening question. After every substantive answer, briefly acknowledge or reflect one real detail Betty has just shared, then ask exactly one natural follow-up question based on that detail. Keep the interview moving with curious, connected questions rather than repeatedly saying 'tell me more'. Prefer specific, curious follow-ups over vague invitations: if she mentions a room, ask what it felt like to be there; if she mentions a person, ask who they were or what they were like; if she describes an event, ask what happened next or how she felt. Ask only one question at a time. The normal rhythm is: Betty answers, you respond to what she actually said, then you ask one relevant follow-up. If her answer opens a new thread, follow it. Do not interrogate or keep probing if she seems finished. Avoid phrases like 'if you want, you can tell me more'. Never ask her to choose a photo or operate the app. Never tell her what the photo means. Let her lead, follow tangents, and allow pauses. Speak in short, clear sentences and avoid talking over her.`,modalities:['audio','text']}}));
}catch(e){cleanup();$('errorText').textContent=e.message||'We could not start the conversation right now.';show('error')}}
$('openStories').onclick=async()=>{await refreshPhotos();await renderAlbumPhotos();await renderStories();show('stories')};
$('storiesHome').onclick=()=>show('welcome');$('storiesHomeTop').onclick=()=>show('welcome');
$('photoFiles').onchange=async e=>{const files=[...e.target.files].filter(f=>f.type.startsWith('image/'));e.target.value='';if(!files.length)return;const hint=$('uploadHint');hint.classList.remove('hidden');hint.textContent='Adding photographs…';try{if(cloudUser&&!cloudReady)await connectCloudSession(cloudUser);let added=0;for(const file of files){const image=await compressImage(file);let photo={id:crypto.randomUUID(),title:'',notes:'',image,createdAt:new Date().toISOString()};await store('photos','readwrite',st=>st.put(photo));if(cloudUser&&cloudReady)photo=await uploadPhotoToCloud(photo);added++;}photoQueue=[];await refreshPhotos();hint.classList.remove('hidden');hint.textContent=added+' photograph'+(added===1?'':'s')+(cloudUser?' saved to your private family archive.':' added to this iPad album.');}catch(e){await refreshPhotos();label.textContent='Add more photographs';hint.classList.remove('hidden');hint.textContent=e.message||'We could not add those photographs. Please try again.';}};
$('savePhotos').onclick=async()=>{await refreshPhotos();show('welcome')};
$('startSession').onclick=async()=>{try{photoHistory=[];navigationPhoto=null;await refreshPhotos();if(!photos.length){$('emptyAlbumPrompt').classList.remove('hidden');await renderAlbumPhotos();show('stories');return;}$('emptyAlbumPrompt').classList.add('hidden');currentPhoto=chooseRandomPhoto();if(!currentPhoto)return;if(localStorage.getItem(consentKey)==='yes'){start();}else{show('consent');}}catch(e){$('errorText').textContent='We could not open the family album on this iPad.';show('error');}};
$('accept').onclick=()=>{localStorage.setItem(consentKey,'yes');start();};$('notnow').onclick=()=>show('welcome');
$('stop').onclick=()=>end(false);$('nextPhoto').onclick=()=>end(true);
// Swipe across the photograph to navigate. Left = next, right = previous.
// A swipe saves the current conversation before changing photographs.
(()=>{
 const surface=$('livePhotoWrap');let startX=0,startY=0,tracking=false;
 surface.addEventListener('touchstart',e=>{
  if(sessionPhase!=='live'||!e.touches||e.touches.length!==1)return;
  startX=e.touches[0].clientX;startY=e.touches[0].clientY;tracking=true;
 },{passive:true});
 surface.addEventListener('touchend',e=>{
  if(!tracking||sessionPhase!=='live')return;tracking=false;
  const t=e.changedTouches?.[0];if(!t)return;
  const dx=t.clientX-startX,dy=t.clientY-startY;
  if(Math.abs(dx)<65||Math.abs(dx)<Math.abs(dy)*1.25)return;
  if(dx<0){end(true);}
  else if(photoHistory.length){navigationPhoto=photoHistory.pop();end(true);}
 },{passive:true});
})();
$('retry').onclick=start;$('errorBack').onclick=()=>show('welcome');$('finish').onclick=()=>show('welcome');
(async()=>{try{await openDB();await refreshPhotos();show('welcome');if(previewMode){document.body.classList.add('preview-mode');$('previewNotice').classList.remove('hidden');$('archiveConnectionStatus').textContent='Preview only. No sign-in emails, cloud uploads or changes to your private family archive. Photos and stories stay in this browser.';$('consent').querySelector('p').textContent='This is a visual preview. Microphone access and AI voice conversations are switched off. Any sample stories you save stay in this separate preview on this device.';}else{await initCloudAuth();}}catch(e){$('errorText').textContent='We could not open the family album on this iPad.';show('error');}})();
window.addEventListener('online',()=>retryPendingCloudSync());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)retryPendingCloudSync();});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));