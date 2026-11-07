const $=id=>document.getElementById(id);
const screens=['welcome','cloudAuth','addPanel','stories','consent','live','saving','saved','error'];
let db,photos=[],selectedFiles=[],currentPhoto=null,pc=null,dc=null,stream=null,recorder=null,chunks=[],lines=[],started=0,tick=null,sessionPhase='idle',photoQueue=[],lastPhotoId=null,supabaseClient=null,cloudUser=null,cloudFamilyId=null,authBusy=false;
function show(id){screens.forEach(name=>$(name).classList.toggle('hidden',name!==id));document.body.classList.toggle('home-mode',id==='welcome');document.body.classList.toggle('live-mode',id==='live');window.scrollTo({top:0,behavior:'smooth'});}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('grandmas-stories-local',2);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('stories'))d.createObjectStore('stories',{keyPath:'id'});if(!d.objectStoreNames.contains('photos'))d.createObjectStore('photos',{keyPath:'id'});};req.onsuccess=()=>{db=req.result;resolve(db)};req.onerror=()=>reject(req.error)});}
function store(name,mode,work){return new Promise((resolve,reject)=>{const tx=db.transaction(name,mode);const result=work(tx.objectStore(name));tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});}
function allPhotos(){return new Promise((resolve,reject)=>{const req=db.transaction('photos').objectStore('photos').getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)});}
function allStories(){return new Promise((resolve,reject)=>{const req=db.transaction('stories').objectStore('stories').getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)});}
function readAsDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file)});}
function compressImage(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{const scale=Math.min(1,1400/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not prepare this photograph.')),'image/jpeg',.82)};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('This photograph could not be opened.'))};img.src=url;});}

const SUPABASE_URL='https://zxsumrlxfuqnjjuaszbs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_LtISsb2h1FDOayTDinoZ2g_PDmqfzbb';
async function connectCloudSession(user){
  cloudUser=user;
  $('cloudAuthTitle').textContent='Your family archive is connected.';
  $('cloudAuthDescription').textContent='Signed in as '+user.email+'. Your private family space is being prepared.';
  $('archiveEmail').value=user.email||'';
  $('archiveEmail').classList.add('hidden');
  $('sendArchiveLink').classList.add('hidden');
  $('cloudAuthStatus').textContent='Checking your family space…';
  const {data:membership,error:memberError}=await supabaseClient.from('family_members').select('family_id,role').eq('user_id',user.id).eq('status','active').limit(1).maybeSingle();
  if(memberError)throw memberError;
  if(membership){cloudFamilyId=membership.family_id;}
  else{
    const {data:familyId,error:createError}=await supabaseClient.rpc('create_family',{p_name:"Grandma’s Stories"});
    if(createError)throw createError;
    cloudFamilyId=familyId;
  }
  $('cloudAuthStatus').textContent='Your private family space is ready. Cloud photo and story syncing is the next step.';
  $('cloudAuthDescription').textContent='Signed in as '+user.email+'.';
  $('connectArchive').textContent='Family archive connected';
}
async function initCloudAuth(){
  if(!window.supabase?.createClient)return;
  supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data:{session},error}=await supabaseClient.auth.getSession();
  if(error)console.warn('Could not restore family archive session',error);
  if(session?.user){try{await connectCloudSession(session.user)}catch(e){$('cloudAuthStatus').textContent='We could not prepare the family space: '+(e.message||'Please try again.');}}
  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){cloudUser=null;cloudFamilyId=null;$('connectArchive').textContent='Connect our private family archive';}
    if(event==='SIGNED_IN'&&session?.user)setTimeout(()=>connectCloudSession(session.user).catch(e=>{$('cloudAuthStatus').textContent='We could not prepare the family space: '+(e.message||'Please try again.');}),0);
  });
}
$('connectArchive').onclick=()=>{if(cloudUser){$('cloudAuthTitle').textContent='Your family archive is connected.';$('cloudAuthDescription').textContent='Signed in as '+cloudUser.email+'.';$('archiveEmail').classList.add('hidden');$('sendArchiveLink').classList.add('hidden');$('cloudAuthStatus').textContent='Your family space is ready. Cloud syncing is being built.';}else{$('cloudAuthTitle').textContent='Connect our family archive.';$('cloudAuthDescription').textContent='A secure sign-in link will arrive by email. No password to remember.';$('archiveEmail').classList.remove('hidden');$('sendArchiveLink').classList.remove('hidden');$('cloudAuthStatus').textContent='';}show('cloudAuth');};
$('closeCloudAuth').onclick=()=>show('welcome');
$('sendArchiveLink').onclick=async()=>{
  if(authBusy||!supabaseClient){$('cloudAuthStatus').textContent='The secure sign-in service is not ready. Please try again shortly.';return;}
  const email=$('archiveEmail').value.trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){$('cloudAuthStatus').textContent='Please enter a valid email address.';return;}
  authBusy=true;$('sendArchiveLink').disabled=true;$('cloudAuthStatus').textContent='Sending your secure sign-in link…';
  try{
    const {error}=await supabaseClient.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin+window.location.pathname,shouldCreateUser:true}});
    if(error)throw error;
    $('cloudAuthStatus').textContent='Check '+email+' for your sign-in link. Open it on this device to connect your family archive.';
  }catch(e){$('cloudAuthStatus').textContent=e.message||'We could not send the email. Please try again.';}
  finally{authBusy=false;$('sendArchiveLink').disabled=false;}
};
async function refreshPhotos(){photos=await allPhotos();photos.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));$('startSession').disabled=!photos.length;$('photoCount').textContent=photos.length?photos.length+' photograph'+(photos.length===1?'':'s')+' in our family album.':'Your family album is waiting for its first photographs.';document.body.classList.toggle('no-photos',!photos.length);$('homeMessage').textContent='Real stories. Lasting memories.';$('homeHint').textContent=photos.length?'A quiet moment, one photograph at a time.':'Add family photographs with the ＋ button above.';if(photos.length)$('emptyAlbumPrompt').classList.add('hidden');renderAlbumPhotos();}
function renderAlbumPhotos(){const grid=$('albumPhotoGrid'),section=$('albumPreview');grid.innerHTML='';section.classList.toggle('hidden',!photos.length);$('albumPhotoHeading').textContent=photos.length?'In our album':'';$('uploadTitle').textContent=photos.length?'Add more photographs':'Choose photographs';for(const photo of photos){const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=URL.createObjectURL(photo.image);img.alt=photo.title||'Family photograph';caption.textContent=photo.title||'Family photograph';figure.append(img,caption);grid.append(figure);}}
async function renderStories(){const list=$('storyList');list.innerHTML='';const stories=(await allStories()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));$('storiesHeading').textContent=stories.length?'The stories we’ve gathered':'Our stories';$('storiesEmpty').classList.toggle('hidden',stories.length>0);for(const story of stories){const card=document.createElement('article');card.className='story-card';const heading=document.createElement('h2');heading.textContent=story.photoTitle||'A family photograph';const date=document.createElement('p');date.className='story-date';date.textContent=new Date(story.createdAt).toLocaleString(undefined,{dateStyle:'long',timeStyle:'short'});card.append(heading,date);const photo=photos.find(p=>p.id===story.photoId);if(photo?.image){const img=document.createElement('img');img.className='story-photo';img.src=URL.createObjectURL(photo.image);img.alt=story.photoTitle||'Photograph connected to this story';card.append(img);}const transcript=document.createElement('div');transcript.className='story-transcript';for(const line of story.lines||[]){if(!line.text)continue;const p=document.createElement('p'),speaker=document.createElement('strong');speaker.textContent=line.who==='user'?'Betty':'A gentle thought';p.append(speaker,document.createTextNode(line.text));transcript.append(p);}if(transcript.childElementCount)card.append(transcript);if(story.audio){const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=URL.createObjectURL(story.audio);audio.setAttribute('aria-label','Listen to this recorded story');card.append(audio);}else{const note=document.createElement('p');note.className='story-date';note.textContent='No audio recording was saved for this story.';card.append(note);}list.append(card);}}
function chooseRandomPhoto(){if(!photos.length)return null;const available=new Set(photos.map(p=>p.id));photoQueue=photoQueue.filter(id=>available.has(id));if(!photoQueue.length){photoQueue=photos.map(p=>p.id);for(let i=photoQueue.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[photoQueue[i],photoQueue[j]]=[photoQueue[j],photoQueue[i]];}if(photoQueue.length>1&&photoQueue[photoQueue.length-1]===lastPhotoId)[photoQueue[0],photoQueue[photoQueue.length-1]]=[photoQueue[photoQueue.length-1],photoQueue[0]];}const id=photoQueue.pop();lastPhotoId=id;return photos.find(p=>p.id===id)||null;}
function addLine(who,text){if(!text)return;lines.push({who,text,at:new Date().toISOString()});const p=document.createElement('p'),label=document.createElement('strong');label.textContent=who==='ai'?'A gentle thought':'Betty';p.append(label,document.createTextNode(text));$('transcript').append(p);$('transcript').scrollTop=$('transcript').scrollHeight;}
function setVoiceStatus(text,state='listening'){$('voiceStatus').lastElementChild.textContent=text;$('live').dataset.audioState=state;const record=$('turntable').querySelector('.record-disc');if(record)record.classList.toggle('is-spinning',state==='listening');$('turntable').setAttribute('aria-label','Audio status: '+state);}
function cleanup(){clearInterval(tick);tick=null;if(recorder&&recorder.state!=='inactive'){try{recorder.stop()}catch{}}if(stream)stream.getTracks().forEach(t=>t.stop());if(pc)pc.close();pc=null;dc=null;stream=null;sessionPhase='idle';}
async function saveStory(blob){const story={id:crypto.randomUUID(),photoId:currentPhoto?.id||null,photoTitle:currentPhoto?.title||'Family photograph',lines,createdAt:new Date().toISOString(),audio:blob||null};await store('stories','readwrite',s=>s.put(story));}
async function end(advance=false){if(sessionPhase!=='live')return;sessionPhase='saving';if(!advance)show('saving');else setVoiceStatus('Saving this story…','thinking');let blob=null;try{if(recorder&&recorder.state!=='inactive')await new Promise(resolve=>{recorder.addEventListener('stop',resolve,{once:true});recorder.stop()});if(chunks.length)blob=new Blob(chunks,{type:recorder?.mimeType||'audio/webm'});cleanup();await saveStory(blob);if(advance){currentPhoto=chooseRandomPhoto();if(currentPhoto){$('timer').textContent='0:00';$('transcript').innerHTML='';start();return;}}const thumb=$('savedPhoto');thumb.innerHTML='';if(currentPhoto){const img=document.createElement('img');img.src=URL.createObjectURL(currentPhoto.image);img.alt='The photograph connected to this story';thumb.append(img)}show('saved')}catch(e){cleanup();$('errorText').textContent='We could not save this story on the iPad. Please keep this page open and ask a family member for help.';show('error')}}
async function start(){if(!currentPhoto)return;
  // Go straight to the photograph. The connection happens in place; there is no
  // separate "getting ready" page between the album and the conversation.
  $('transcript').innerHTML='';
  $('livePhoto').src=URL.createObjectURL(currentPhoto.image);
  $('liveQuestion').textContent='Tell me about this time…';
  $('stop').disabled=true;$('nextPhoto').disabled=true;
  setVoiceStatus('Getting things ready…','thinking');
  show('live');sessionPhase='connecting';
  $('livePhotoWrap').classList.remove('photo-enter');void $('livePhotoWrap').offsetWidth;$('livePhotoWrap').classList.add('photo-enter');
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
$('addFromHome').onclick=async()=>{await refreshPhotos();$('emptyAlbumPrompt').classList.add('hidden');show('addPanel')};
$('openStories').onclick=async()=>{await refreshPhotos();await renderStories();show('stories')};
$('storiesHome').onclick=()=>show('welcome');
$('photoFiles').onchange=async e=>{const files=[...e.target.files].filter(f=>f.type.startsWith('image/'));e.target.value='';if(!files.length)return;const label=$('uploadTitle'),hint=$('uploadHint');label.textContent='Adding photographs…';hint.classList.remove('hidden');hint.textContent='Placing your photographs in the album…';try{let added=0;for(const file of files){const image=await compressImage(file);await store('photos','readwrite',s=>s.put({id:crypto.randomUUID(),title:file.name.replace(/\.[^.]+$/,''),notes:'',image,createdAt:new Date().toISOString()}));added++;}photoQueue=[];await refreshPhotos();label.textContent='Add more photographs';hint.classList.remove('hidden');hint.textContent=added+' photograph'+(added===1?'':'s')+' added to our album.';}catch(e){await refreshPhotos();label.textContent='Add more photographs';hint.classList.remove('hidden');hint.textContent=e.message||'We could not add those photographs. Please try again.';}};
$('savePhotos').onclick=async()=>{await refreshPhotos();show('welcome')};
$('startSession').onclick=async()=>{try{await refreshPhotos();if(!photos.length){$('emptyAlbumPrompt').classList.remove('hidden');show('addPanel');return;}$('emptyAlbumPrompt').classList.add('hidden');currentPhoto=chooseRandomPhoto();if(!currentPhoto)return;if(localStorage.getItem('grandmas-stories-consent-v1')==='yes'){start();}else{show('consent');}}catch(e){$('errorText').textContent='We could not open the family album on this iPad.';show('error');}};
$('accept').onclick=()=>{localStorage.setItem('grandmas-stories-consent-v1','yes');start();};$('notnow').onclick=()=>show('welcome');
$('stop').onclick=()=>end(false);$('nextPhoto').onclick=()=>end(true);$('retry').onclick=start;$('errorBack').onclick=()=>show('welcome');$('anotherStory').onclick=()=>{$('timer').textContent='0:00';currentPhoto=chooseRandomPhoto();if(currentPhoto)start();else show('welcome');};$('finish').onclick=()=>show('welcome');
(async()=>{try{await openDB();await refreshPhotos();show('welcome');await initCloudAuth();}catch(e){$('errorText').textContent='We could not open the family album on this iPad.';show('error');}})();
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));