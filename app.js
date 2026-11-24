(function () {
  "use strict";

  // The shared archive was intentionally reset. Start with an empty album;
  // never show placeholder photo URLs that are not real family uploads.
  const BASE_PHOTOS = [];
  const SAMPLE_STORIES = {};

  const state = {
    photos: BASE_PHOTOS.slice(),
    stories: {},
    hidden: [],
    deletedCloudAssets: [],
    pendingStoryIds: [],
    editing: false,
    index: 0,
    listening: false,
    draft: { photoId: null, idx: null },
    viewId: null,
    pendingRemoveId: null,
    lastRemoved: null,
    toastTimer: null
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.prototype.slice.call(root.querySelectorAll(sel));

  const store = {
    get: async function (key) {
      if (window.storage && window.storage.get) {
        try { return await window.storage.get(key); } catch (e) {}
      }
      try {
        const raw = localStorage.getItem("gs:" + key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    set: async function (key, value) {
      if (window.storage && window.storage.set) {
        try { await window.storage.set(key, value); return true; } catch (e) {}
      }
      try {
        localStorage.setItem("gs:" + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    }
  };

  function storiesFor(id) { return state.stories[id] || []; }
  function hasStory(id) { return storiesFor(id).some(story => (story.text || "").trim().length > 0); }
  function hasPendingStory(id) { return state.pendingStoryIds.indexOf(id) !== -1 || storiesFor(id).some(story => !(story.text || "").trim() && !!story.audio); }
  function toldPhotos() { return state.photos.filter(p => hasStory(p.id)); }
  function firstUntold() { return state.photos.findIndex(p => !hasStory(p.id)); }
  function normaliseStories(raw) {
    const out = {};
    Object.keys(raw || {}).forEach((k) => {
      const v = raw[k];
      if (Array.isArray(v)) {
        out[k] = v.filter(s => s && (s.text || s.audio));
      } else if (v && v.text) {
        out[k] = [{ text: v.text, created: v.updated || v.created || new Date().toISOString() }];
      }
    });
    return out;
  }
  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function navigate(path) {
    const next = (path || "home").replace(/^\/+/, "");
    location.hash = "#/" + next;
    route();
  }

  let activeRouteKey = null;

  function route() {
    const raw = (location.hash || "").replace(/^#\/?/, "") || "home";
    let [name, id] = raw.split("/");
    if (name === "join") name = "family";
    if (["home", "signin", "family", "album", "story", "view"].indexOf(name) === -1) name = "home";
    if (name === "signin") name = "family";
    if (name === "view" && !id) {
      const first = toldPhotos()[0];
      if (first) id = first.id;
    }
    if (name === "view" && id && !hasStory(id) && !hasPendingStory(id)) name = "story";
    if ((name === "story" || name === "view") && state.photos.length === 0) name = "album";
    if (name !== "album") state.editing = false;
    const nextRouteKey = name + ":" + (id || "");
    // A hashchange can fire after renderStory normalizes the URL. Only stop
    // recording when the user actually navigates to a different screen/photo.
    if (activeRouteKey !== nextRouteKey) {
      stopListening();
      activeRouteKey = nextRouteKey;
    }
    $$("[data-screen]").forEach((section) => {
      section.hidden = section.getAttribute("data-screen") !== name;
    });
    if (name === "album") renderAlbum();
    if (name === "story") {
      const idx = id ? state.photos.findIndex(p => p.id === id) : firstUntold();
      state.index = idx >= 0 ? idx : 0;
      renderStory();
    }
    if (name === "view") renderView(id);
    window.scrollTo(0, 0);
    const heading = $("[data-screen='" + name + "'] h1, [data-screen='" + name + "'] h2");
    if (heading && name !== "home") {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }

  function renderAlbum() {
    const list = $("[data-prints]");
    list.innerHTML = "";
    const editing = !!state.editing && state.photos.length > 0;
    list.classList.toggle("editing", editing);
    $("[data-manage-hint]").hidden = !editing;
    const manage = $("[data-action='manage']");
    manage.textContent = editing ? "Done" : "Manage photos";
    manage.setAttribute("aria-pressed", editing ? "true" : "false");
    manage.hidden = state.photos.length === 0;
    $("[data-empty]").hidden = state.photos.length > 0;

    state.photos.forEach((photo) => {
      const count = storiesFor(photo.id).filter(story => (story.text || "").trim()).length;
      const pending = !count && hasPendingStory(photo.id);
      const li = document.createElement("li");
      li.className = "print";
      li.innerHTML = [
        '<a href="#/' + (count || pending ? "view/" : "story/") + encodeURIComponent(photo.id) + '">',
        '<img loading="lazy" alt="" src="' + photo.src + '">',
        '<span class="meta"><span class="title"></span><span class="yr"></span></span>',
        '<span class="badge' + (count ? "" : " empty") + '">' + (count ? (count === 1 ? "Read the story" : "Read " + count + " stories") : (pending ? "Story coming soon" : "Waiting for a story")) + '</span>',
        '</a>'
      ].join("");
      const titleEl = $(".title", li);
      titleEl.textContent = photo.title;
      $(".yr", li).textContent = photo.year || "";
      $("img", li).alt = photo.title + (photo.year ? ", " + photo.year : "");

      if (editing) {
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "remove-btn";
        removeButton.setAttribute("data-action", "remove");
        removeButton.setAttribute("data-id", photo.id);
        removeButton.setAttribute("aria-label", "Delete " + photo.title);
        removeButton.setAttribute("title", "Delete photo");
        removeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
        li.appendChild(removeButton);
        $("a", li).setAttribute("tabindex", "-1");
        $("a", li).setAttribute("aria-disabled", "true");
      }
      list.appendChild(li);
    });
  }

  async function persistPhotos() {
    await store.set("photos", state.photos.filter(p => p.custom));
    await store.set("hidden", state.hidden);
    await store.set("deletedCloudAssets", state.deletedCloudAssets);
    await store.set("stories", state.stories);
    window.dispatchEvent(new CustomEvent("gs:local-change", { detail: { type: "photos" } }));
  }

  function askRemove(id) {
    const photo = state.photos.find(p => p.id === id);
    if (!photo) return;
    const count = storiesFor(id).length;
    const dlg = $("[data-confirm]");
    $("[data-confirm-thumb]").src = photo.src;
    $("[data-confirm-thumb]").alt = photo.title;
    $("[data-confirm-text]").textContent = '"' + photo.title + '" will be taken out of the album' +
      (count ? (count === 1 ? ", along with its story." : ", along with its " + count + " stories.") : ".");
    state.pendingRemoveId = id;
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    $("[data-confirm-remove]").focus();
  }

  function closeConfirm(choice) {
    const dlg = $("[data-confirm]");
    const id = state.pendingRemoveId;
    state.pendingRemoveId = null;
    try { dlg.close(); } catch (e) { dlg.removeAttribute("open"); }
    if (choice === "remove" && id) removePhoto(id);
  }

  async function removePhoto(id) {
    const index = state.photos.findIndex(p => p.id === id);
    if (index < 0) return;
    const photo = state.photos[index];
    state.lastRemoved = { photo, index, stories: state.stories[id] || null };
    state.photos.splice(index, 1);
    delete state.stories[id];
    if (!photo.custom && state.hidden.indexOf(id) === -1) state.hidden.push(id);
    if (photo.cloudAssetId && state.deletedCloudAssets.indexOf(photo.cloudAssetId) === -1) state.deletedCloudAssets.push(photo.cloudAssetId);
    if (state.photos.length === 0) state.editing = false;
    await persistPhotos();
    renderAlbum();
    showToast('"' + photo.title + '" removed.');
  }

  async function undoRemove() {
    if (!state.lastRemoved) return;
    const removed = state.lastRemoved;
    state.lastRemoved = null;
    state.photos.splice(Math.min(removed.index, state.photos.length), 0, removed.photo);
    if (removed.stories) state.stories[removed.photo.id] = removed.stories;
    state.hidden = state.hidden.filter(v => v !== removed.photo.id);
    if (removed.photo.cloudAssetId) state.deletedCloudAssets = state.deletedCloudAssets.filter(v => v !== removed.photo.cloudAssetId);
    await persistPhotos();
    hideToast();
    renderAlbum();
  }

  function showToast(msg) {
    const toast = $("[data-toast]");
    $("[data-toast-text]").textContent = msg;
    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      hideToast();
      state.lastRemoved = null;
    }, 8000);
  }

  function hideToast() {
    $("[data-toast]").hidden = true;
    clearTimeout(state.toastTimer);
  }

  function fitStoryPhoto() {
    const slot = $(".screen-story .photo-slot");
    const mount = slot && slot.querySelector(".mount");
    const img = slot && slot.querySelector("[data-photo]");
    const caption = mount && mount.querySelector("figcaption");
    if (!slot || !mount || !img || !img.naturalWidth || !img.naturalHeight || !slot.clientWidth || !slot.clientHeight) return;

    const style = getComputedStyle(mount);
    const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const captionHeight = caption ? caption.getBoundingClientRect().height : 0;
    const availableWidth = Math.max(80, slot.clientWidth - horizontalPadding - 12);
    const availableHeight = Math.max(80, slot.clientHeight - verticalPadding - captionHeight - 12);
    const scale = Math.min(availableWidth / img.naturalWidth, availableHeight / img.naturalHeight);
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);

    // Give the image explicit dimensions calculated from its intrinsic ratio.
    // This avoids percentage max-size rules forcing portrait photos into square mounts.
    img.style.setProperty("width", width + "px", "important");
    img.style.setProperty("height", height + "px", "important");
    img.style.setProperty("max-width", "none", "important");
    img.style.setProperty("max-height", "none", "important");
    img.style.setProperty("object-fit", "fill", "important");
    mount.style.setProperty("width", "max-content", "important");
    mount.style.setProperty("height", "auto", "important");
    mount.style.setProperty("max-width", "none", "important");
    mount.style.setProperty("max-height", "none", "important");
  }
  window.addEventListener("resize", fitStoryPhoto, { passive: true });

  function renderStory() {
    const photo = state.photos[state.index];
    if (!photo) return;
    const img = $("[data-photo]");
    img.alt = photo.title + (photo.year ? ", " + photo.year : "");
    img.addEventListener("load", fitStoryPhoto, { once: true });
    img.src = photo.src;
    requestAnimationFrame(fitStoryPhoto);
    if (img.complete) requestAnimationFrame(fitStoryPhoto);
    $("[data-caption]").textContent = photo.title;
    $("[data-year]").textContent = photo.year || "";
    $("[data-prompt]").textContent = photo.prompt || "Tell me about this time...";
    $("[data-counter]").textContent = "Photo " + (state.index + 1) + " of " + state.photos.length;
    state.draft = { photoId: photo.id, idx: null };
    $("[data-story-text]").value = "";
    setTyping(false);
    $("[data-live]").hidden = true;
    $("[data-live]").textContent = "";
    setStatus("");
    hideSaved();
    updateReadLink(photo);

    const path = "story/" + photo.id;
    if (location.hash !== "#/" + path) {
      location.hash = "#/" + path;
    }
  }

  function go(delta) {
    saveStory(true);
    stopListening();
    state.index = (state.index + delta + state.photos.length) % state.photos.length;
    renderStory();
  }

  async function saveStory(silent) {
    const photo = state.photos[state.index];
    if (!photo || state.draft.photoId !== photo.id) return;
    const text = $("[data-story-text]").value.trim();
    if (!text) {
      if (!silent) setStatus("Tell or type a story first.");
      return;
    }
    const list = storiesFor(photo.id).slice();
    const idx = state.draft.idx;
    let changed = true;
    if (idx != null && list[idx]) {
      if (list[idx].text === text) changed = false;
      else list[idx] = { text, created: list[idx].created };
    } else {
      list.push({ text, created: new Date().toISOString() });
      state.draft.idx = list.length - 1;
    }
    if (changed) {
      state.stories[photo.id] = list;
      await store.set("stories", state.stories);
      window.dispatchEvent(new CustomEvent("gs:local-change", { detail: { type: "stories" } }));
      updateReadLink(photo);
    }
    if (!silent) {
      $("[data-story-text]").value = "";
      state.draft.idx = null;
      setTyping(false, true);
      showSaved("Story saved - thank you for sharing.");
    }
  }

  function showSaved(msg) {
    setStatus("");
    $("[data-saved-text]").textContent = msg;
    const note = $("[data-saved]");
    note.hidden = false;
    note.classList.remove("pop");
    void note.offsetWidth;
    note.classList.add("pop");
  }

  function hideSaved() {
    $("[data-saved]").hidden = true;
  }

  function updateReadLink(photo) {
    const link = $("[data-read-link]");
    const count = storiesFor(photo.id).length;
    link.hidden = count === 0;
    link.setAttribute("href", "#/view/" + encodeURIComponent(photo.id));
    link.textContent = count === 1 ? "Read the story in the album" : "Read all " + count + " stories in the album";
  }

  function renderView(id) {
    const photo = state.photos.find(p => p.id === id);
    if (!photo) return;
    state.viewId = photo.id;
    const told = toldPhotos();
    const pos = told.findIndex(p => p.id === photo.id);

    $("[data-view-photo]").src = photo.src;
    $("[data-view-photo]").alt = photo.title + (photo.year ? ", " + photo.year : "");
    $("[data-view-caption]").textContent = photo.title;
    $("[data-view-year]").textContent = photo.year || "";
    $("[data-view-title]").textContent = photo.title;
    $("[data-view-sub]").textContent = photo.year ? "Remembered from " + photo.year : "";
    $("[data-view-counter]").textContent = told.length > 1 ? "Story " + (pos + 1) + " of " + told.length : "";
    $$("[data-action='view-prev'], [data-action='view-next']").forEach((btn) => {
      btn.hidden = told.length < 2;
    });
    $("[data-add-story]").setAttribute("href", "#/story/" + encodeURIComponent(photo.id));

    const wrap = $("[data-view-entries]");
    wrap.innerHTML = "";
    // Audio recordings are intentionally hidden from the reading interface.
    // Keep written story text visible, but omit audio-only entries.
    const list = storiesFor(photo.id).filter(story => (story.text || "").trim());
    if (!list.length && hasPendingStory(photo.id)) {
      const pending = document.createElement("p");
      pending.className = "entry-meta";
      pending.textContent = "Story coming soon — we’re getting it ready.";
      wrap.appendChild(pending);
    }
    list.forEach((story, index) => {
      const article = document.createElement("article");
      article.className = "entry";
      if (list.length > 1) {
        const heading = document.createElement("h3");
        heading.className = "entry-head";
        heading.textContent = index === 0 ? "The story" : "Another memory";
        article.appendChild(heading);
      }
      (story.text || "").split(/\n{2,}|\r\n\r\n/).forEach((para) => {
        const text = para.trim();
        if (!text) return;
        const p = document.createElement("p");
        p.textContent = text;
        article.appendChild(p);
      });
      if (story.audio) {
        const player = document.createElement("audio");
        player.className = "story-audio";
        player.controls = true;
        player.preload = "metadata";
        player.setAttribute("aria-label", "Play the original audio recording");
        if (typeof story.audio === "string") player.src = story.audio;
        else if (story.audio instanceof Blob) player.src = URL.createObjectURL(story.audio);
        if (player.src) {
          article.appendChild(player);
          const audioMeta = document.createElement("p");
          audioMeta.className = "entry-meta";
          audioMeta.textContent = "Original audio recording";
          article.appendChild(audioMeta);
        }
      }
      const meta = document.createElement("p");
      meta.className = "entry-meta";
      meta.textContent = "Written " + formatDate(story.created);
      article.appendChild(meta);
      wrap.appendChild(article);
    });

    $(".story-page").scrollTop = 0;
    $("[data-view-entries]").scrollTop = 0;
    location.hash = "#/view/" + photo.id;
  }

  function goView(delta) {
    const told = toldPhotos();
    if (told.length < 2) return;
    const currentIndex = told.findIndex(p => p.id === state.viewId);
    const next = told[(currentIndex + delta + told.length) % told.length];
    renderView(next.id);
  }

  function setStatus(msg) {
    $("[data-status]").textContent = msg;
  }

  function setTyping(open, keepFocus) {
    const notes = $("[data-notes]");
    notes.hidden = !open;
    $("[data-album-page]").classList.toggle("typing", open);
    $("[data-screen='story']").classList.toggle("typing", open);
    const toggle = $("[data-action='toggle-type']");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Close typing and use the microphone" : "Prefer to type? Write it instead";
    if (open) {
      hideSaved();
      $("[data-story-text]").focus();
    } else if (keepFocus) {
      $("[data-action='listen']").focus({ preventScroll: true });
    }
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const MAX_SECONDS = 300;
  let rec = null;
  let recorder = null;
  let stream = null;
  let chunks = [];
  let transcript = "";
  let recPhotoId = null;
  let timerId = null;
  let startedAt = 0;
  let starting = false;

  function setListeningUI(on) {
    state.listening = on;
    $("[data-action='listen']").setAttribute("aria-pressed", on ? "true" : "false");
    $("[data-record]").classList.toggle("spinning", on);
    clearInterval(timerId);
    if (on) {
      startedAt = Date.now();
      $("[data-timer]").textContent = "0:00";
      timerId = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        $("[data-timer]").textContent = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
        if (seconds >= MAX_SECONDS) stopListening();
      }, 250);
    }
  }

  async function startListening() {
    if (starting) return;
    starting = true;
    try {
      await beginListening();
    } finally {
      starting = false;
    }
  }

  async function beginListening() {
    const photo = state.photos[state.index];
    if (!photo) return;
    recPhotoId = photo.id;
    if (window.gsRealtime && window.gsRealtime.start) {
      transcript = "";
      hideSaved();
      const live = $("[data-live]");
      live.textContent = "";
      live.hidden = true;
      try {
        setListeningUI(true);
        await window.gsRealtime.start(photo, {
          onTranscript: (text) => { live.textContent = text; live.hidden = !text; },
          onStatus: (message) => setStatus(message),
          onComplete: async (entry) => {
            setListeningUI(false);
            await addEntry(photo.id, entry);
          }
        });
        setStatus("Whenever you’re ready, I’m listening.");
        return;
      } catch (error) {
        setListeningUI(false);
        setStatus((error && error.message ? error.message : "The live voice service is unavailable.") + " You can still record a story or type it instead.");
      }
    }
    transcript = "";
    chunks = [];
    hideSaved();

    const live = $("[data-live]");
    live.textContent = "";
    live.hidden = true;

    let gotMic = false;

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onstop = finishRecording;
        recorder.start();
        gotMic = true;
      } catch (e) {
        recorder = null;
        stream = null;
      }
    }

    if (Recognition) {
      try {
        rec = new Recognition();
        rec.lang = "en-NZ";
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (event) => {
          let finalText = "";
          let interim = "";
          for (let i = 0; i < event.results.length; i++) {
            if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
            else interim += event.results[i][0].transcript;
          }
          transcript = (finalText + interim).trim();
          live.textContent = transcript;
          live.hidden = !transcript;
        };
        rec.onerror = function () {};
        rec.onend = function () {
          if (state.listening && !recorder) stopListening();
        };
        rec.start();
        gotMic = true;
      } catch (e) {
        rec = null;
      }
    }

    if (!gotMic) {
      setStatus("The microphone isn't available here, so you can type the story instead.");
      setTyping(true);
      return;
    }

    setListeningUI(true);
    setStatus("Listening... take your time.");
  }

  function stopListening() {
    if (!state.listening) return;
    if (recPhotoId && state.pendingStoryIds.indexOf(recPhotoId) === -1) state.pendingStoryIds.push(recPhotoId);
    setListeningUI(false);
    if (window.gsRealtime && window.gsRealtime.isActive && window.gsRealtime.isActive()) {
      window.gsRealtime.stop().catch(error => setStatus(error.message || "The story could not be saved."));
      return;
    }
    if (rec) {
      try { rec.stop(); } catch (e) {}
      rec = null;
    }
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      finishRecording();
    }
  }

  async function finishRecording() {
    const photoId = recPhotoId;
    const text = transcript;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    let audio = null;
    if (chunks.length) {
      const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || "audio/webm" });
      audio = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    }

    recorder = null;
    chunks = [];

    if (!audio && !text) {
      state.pendingStoryIds = state.pendingStoryIds.filter(id => id !== photoId);
      setStatus("I didn't catch anything that time. Tap the microphone to try again.");
      return;
    }

    await addEntry(photoId, { text, audio });
  }

  async function addEntry(photoId, entry) {
    const list = storiesFor(photoId).slice();
    entry.created = new Date().toISOString();
    list.push(entry);
    state.stories[photoId] = list;

    const ok = await store.set("stories", state.stories);
    state.pendingStoryIds = state.pendingStoryIds.filter(id => id !== photoId);
    window.dispatchEvent(new CustomEvent("gs:local-change", { detail: { type: "stories" } }));
    if (!ok && entry.audio) {
      entry.audio = null;
      if (!entry.text) {
        list.pop();
        state.stories[photoId] = list;
        state.pendingStoryIds = state.pendingStoryIds.filter(id => id !== photoId);
        setStatus("There isn't enough room to save that recording. Try a shorter one, or type it instead.");
        return;
      }
      await store.set("stories", state.stories);
      setStatus("Saved the words, but the recording was too large to keep.");
    } else {
      showSaved("Story saved - thank you for sharing.");
    }

    const photo = state.photos.find(p => p.id === photoId);
    if (photo && state.photos[state.index] === photo) updateReadLink(photo);
  }

  function pickPhoto() {
    $("[data-file]").click();
  }

  async function onFileChange(event) {
    const files = Array.from(event.target.files || []).filter(file => file.type.startsWith("image/"));
    if (!files.length) return;
    event.target.value = "";

    const newPhotos = await Promise.all(files.map((file, index) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read " + file.name));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Could not load " + file.name));
        img.onload = () => {
          // Preserve the complete photograph and its original aspect ratio.
          // Downscale proportionally only when needed to keep uploads manageable.
          const maxDimension = 1800;
          const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const title = (file.name || "A special day").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60) || "A special day";
          resolve({
            id: "p" + Date.now() + "-" + index,
            src: canvas.toDataURL("image/jpeg", 0.86),
            width: img.width,
            height: img.height,
            title,
            year: "",
            prompt: "Tell me about this time...",
            custom: true
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    })));

    state.photos.push(...newPhotos);
    await persistPhotos();
    navigate("story/" + newPhotos[0].id);
  }

  async function hydrate() {
    try {
      const savedStories = await store.get("stories");
      const savedCustom = await store.get("photos");
      const savedHidden = await store.get("hidden");
      const savedDeletedCloudAssets = await store.get("deletedCloudAssets");
      const customArray = Array.isArray(savedCustom) ? savedCustom : [];
      state.hidden = Array.isArray(savedHidden) ? savedHidden : [];
      state.deletedCloudAssets = Array.isArray(savedDeletedCloudAssets) ? savedDeletedCloudAssets : [];
      state.stories = normaliseStories(savedStories || SAMPLE_STORIES);
      state.photos = BASE_PHOTOS.filter(p => state.hidden.indexOf(p.id) === -1).concat(customArray);
      if (!Object.keys(state.stories).length) state.stories = {};
    } catch (e) {
      state.stories = {};
      state.photos = [];
    }
  }

  document.addEventListener("click", function (event) {
    const anchor = event.target.closest("a[href^='#/']");
    if (anchor) {
      if (anchor.getAttribute("aria-disabled") === "true") return;
      event.preventDefault();
      navigate(anchor.getAttribute("href").replace(/^#/, ""));
      return;
    }

    const choice = event.target.closest("[data-choice]");
    if (choice) {
      closeConfirm(choice.getAttribute("data-choice"));
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const action = actionButton.getAttribute("data-action");
    if (action === "prev") go(-1);
    if (action === "next") go(1);
    if (action === "listen") state.listening ? stopListening() : startListening();
    if (action === "save") saveStory();
    if (action === "toggle-type") setTyping($("[data-notes]").hidden);
    if (action === "view-prev") goView(-1);
    if (action === "view-next") goView(1);
    if (action === "add-photo") pickPhoto();
    if (action === "manage") {
      state.editing = !state.editing;
      hideToast();
      renderAlbum();
    }
    if (action === "remove") askRemove(actionButton.getAttribute("data-id"));
    if (action === "undo") undoRemove();
  });

  document.addEventListener("keydown", function (event) {
    if (/TEXTAREA|INPUT/.test(document.activeElement.tagName)) return;
    if (event.key === "ArrowLeft" && !$("[data-screen='story']").hidden) go(-1);
    if (event.key === "ArrowRight" && !$("[data-screen='story']").hidden) go(1);
    if (event.key === "ArrowLeft" && !$("[data-screen='view']").hidden) goView(-1);
    if (event.key === "ArrowRight" && !$("[data-screen='view']").hidden) goView(1);
  });

  $("[data-file]").addEventListener("change", onFileChange);
  $("[data-story-text]").addEventListener("blur", function () {
    saveStory(true);
  });
  window.addEventListener("hashchange", route);

  window.gsAppHydrated = (async function init() {
    await hydrate();
    route();
    window.dispatchEvent(new Event("gs:app-hydrated"));
  })();
  window.addEventListener("gs:cloud-updated", async function () {
    await hydrate();
    route();
  });
})();
