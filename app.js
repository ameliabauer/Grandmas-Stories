/* Grandma's Stories - front-end app (no build step, no dependencies) */
(function () {
  "use strict";

  /* ---------- Storage: uses window.storage when available, else localStorage ---------- */
  var store = {
    get: async function (key) {
      if (window.storage && window.storage.get) { try { return await window.storage.get(key); } catch (e) {} }
      try { var v = localStorage.getItem("gs:" + key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    // returns true when saved, false when storage refused (e.g. full)
    set: async function (key, value) {
      if (window.storage && window.storage.set) { try { await window.storage.set(key, value); return true; } catch (e) {} }
      try { localStorage.setItem("gs:" + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    }
  };

  /* ---------- Starter photos ---------- */
  var BASE_PHOTOS = [
    { id: "beach", src: "photos/beach.webp", title: "At the beach", year: "1958", prompt: "Tell me about this day at the beach..." },
    { id: "wedding", src: "photos/wedding.webp", title: "Our wedding day", year: "1962", prompt: "What do you remember most about your wedding day?" },
    { id: "kitchen", src: "photos/kitchen.webp", title: "Baking with the grandkids", year: "1974", prompt: "What were you baking that day?" },
    { id: "roadtrip", src: "photos/roadtrip.webp", title: "The big road trip", year: "1977", prompt: "Where was the family headed on this trip?" },
    { id: "christmas", src: "photos/christmas.webp", title: "Christmas morning", year: "1979", prompt: "What made Christmas in this house so special?" },
    { id: "garden", src: "photos/garden.webp", title: "Summer harvest", year: "1985", prompt: "Tell me about your garden..." }
  ];

  // Sample story shown on first run only (before anything is saved) - delete to start empty
  var SAMPLE_STORIES = {
    beach: [{
      created: "2026-11-01T10:00:00.000Z",
      text: "That was the summer of 1958, the year before I met your grandfather. My sister and I took the early train down to the coast with a basket of egg sandwiches and a thermos of sweet tea, and we didn't come home until the sun was going down.\n\nI'd sewn that swimsuit myself from a remnant of fabric I found at the market - I was so proud of it. Your great-aunt took this picture with her new Brownie camera and made me sit still for what felt like forever. I remember the sand was so hot we had to run to the water, laughing the whole way."
    }]
  };

  // stories: { [photoId]: [ { text, created } ] } - a photo can hold several stories
  var state = { photos: BASE_PHOTOS.slice(), stories: {}, hidden: [], editing: false, index: 0, listening: false, draft: { photoId: null, idx: null }, viewId: null };

  function storiesFor(id) { return state.stories[id] || []; }
  function hasStory(id) { return storiesFor(id).length > 0; }
  function normaliseStories(raw) {
    var out = {};
    Object.keys(raw || {}).forEach(function (k) {
      var v = raw[k];
      if (Array.isArray(v)) out[k] = v.filter(function (s) { return s && (s.text || s.audio); });
      else if (v && v.text) out[k] = [{ text: v.text, created: v.updated || v.created || new Date().toISOString() }];
    });
    return out;
  }
  function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return ""; }
  }

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- Router ---------- */
  var currentPath = (location.hash || "").replace(/^#\/?/, "") || "home";
  function navigate(path) {
    currentPath = path || "home";
    try { if (location.protocol !== "about:") history.pushState(null, "", "#/" + currentPath); } catch (e) {}
    route();
  }
  function route() {
    var parts = currentPath.split("/");
    var name = parts[0];
    if (["home", "signin", "album", "story", "view"].indexOf(name) === -1) name = "home";
    if (name === "view" && parts[1] === "first") { var t = toldPhotos()[0]; if (t) parts[1] = t.id; }
    if (name === "view" && !hasStory(parts[1])) { name = "story"; }
    if ((name === "story" || name === "view") && state.photos.length === 0) { name = "album"; }
    if (name !== "album") { state.editing = false; hideToast(); }
    stopListening();
    $$("[data-screen]").forEach(function (s) { s.hidden = s.getAttribute("data-screen") !== name; });
    if (name === "album") renderAlbum();
    if (name === "story") {
      var id = parts[1];
      var i = id ? state.photos.findIndex(function (p) { return p.id === id; }) : firstUntold();
      state.index = i < 0 ? 0 : i;
      renderStory();
    }
    if (name === "view") renderView(parts[1]);
    if (name === "signin") resetSignin();
    window.scrollTo(0, 0);
    var heading = $("[data-screen='" + name + "'] h1, [data-screen='" + name + "'] h2");
    if (heading && name !== "home") { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
  }
  function firstUntold() {
    var i = state.photos.findIndex(function (p) { return !hasStory(p.id); });
    return i < 0 ? 0 : i;
  }

  /* ---------- Album ---------- */
  function renderAlbum() {
    var list = $("[data-prints]");
    list.innerHTML = "";
    var editing = !!state.editing && state.photos.length > 0;
    list.classList.toggle("editing", editing);
    $("[data-manage-hint]").hidden = !editing;
    var mb = $("[data-action='manage']");
    mb.textContent = editing ? "Done" : "Manage photos";
    mb.setAttribute("aria-pressed", editing ? "true" : "false");
    mb.hidden = state.photos.length === 0;
    $("[data-empty]").hidden = state.photos.length > 0;
    state.photos.forEach(function (p) {
      var n = storiesFor(p.id).length;
      var li = document.createElement("li");
      li.className = "print";
      li.innerHTML =
        '<a href="#/' + (n ? "view/" : "story/") + encodeURIComponent(p.id) + '">' +
          '<img loading="lazy" alt="" src="' + p.src + '">' +
          '<span class="meta"><span class="title"></span><span class="yr"></span></span>' +
          '<span class="badge' + (n ? "" : " empty") + '">' + (n ? (n === 1 ? "Read the story" : "Read " + n + " stories") : "Waiting for a story") + "</span>" +
        "</a>";
      $(".title", li).textContent = p.title;
      $(".yr", li).textContent = p.year || "";
      $("img", li).alt = p.title + (p.year ? ", " + p.year : "");
      if (editing) {
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "remove-btn";
        rm.setAttribute("data-action", "remove");
        rm.setAttribute("data-id", p.id);
        rm.setAttribute("aria-label", "Delete " + p.title);
        rm.setAttribute("title", "Delete photo");
        rm.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
        li.appendChild(rm);
        $("a", li).setAttribute("tabindex", "-1");
        $("a", li).setAttribute("aria-disabled", "true");
      }
      list.appendChild(li);
    });
  }

  /* ---------- Remove a photo (with confirm + undo) ---------- */
  var lastRemoved = null, toastTimer = null;
  function persistPhotos() {
    return Promise.all([
      store.set("photos", state.photos.filter(function (p) { return p.custom; })),
      store.set("hidden", state.hidden),
      store.set("stories", state.stories)
    ]);
  }
  function askRemove(id) {
    var p = state.photos.find(function (x) { return x.id === id; });
    if (!p) return;
    var n = storiesFor(id).length;
    var dlg = $("[data-confirm]");
    $("[data-confirm-thumb]").src = p.src;
    $("[data-confirm-thumb]").alt = p.title;
    $("[data-confirm-text]").textContent = "\"" + p.title + "\" will be taken out of the album" +
      (n ? (n === 1 ? ", along with its story." : ", along with its " + n + " stories.") : ".");
    pendingRemoveId = id;
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    $("[data-confirm-remove]").focus();
  }
  var pendingRemoveId = null;
  function closeConfirm(choice) {
    var dlg = $("[data-confirm]");
    var id = pendingRemoveId;
    pendingRemoveId = null;
    try { dlg.close(); } catch (e) { dlg.removeAttribute("open"); }
    if (choice === "remove" && id) removePhoto(id);
  }
  async function removePhoto(id) {
    var index = state.photos.findIndex(function (x) { return x.id === id; });
    if (index < 0) return;
    var photo = state.photos[index];
    lastRemoved = { photo: photo, index: index, stories: state.stories[id] || null };
    state.photos.splice(index, 1);
    delete state.stories[id];
    if (!photo.custom && state.hidden.indexOf(id) === -1) state.hidden.push(id);
    if (state.photos.length === 0) state.editing = false;
    await persistPhotos();
    renderAlbum();
    showToast("\"" + photo.title + "\" removed.");
  }
  async function undoRemove() {
    if (!lastRemoved) return;
    var r = lastRemoved; lastRemoved = null;
    state.photos.splice(Math.min(r.index, state.photos.length), 0, r.photo);
    if (r.stories) state.stories[r.photo.id] = r.stories;
    state.hidden = state.hidden.filter(function (h) { return h !== r.photo.id; });
    await persistPhotos();
    hideToast();
    renderAlbum();
  }
  function showToast(msg) {
    var t = $("[data-toast]");
    $("[data-toast-text]").textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { hideToast(); lastRemoved = null; }, 8000);
  }
  function hideToast() { $("[data-toast]").hidden = true; clearTimeout(toastTimer); }

  /* ---------- Story ---------- */
  function renderStory() {
    var p = state.photos[state.index];
    if (!p) return;
    var img = $("[data-photo]");
    img.src = p.src;
    img.alt = p.title + (p.year ? ", " + p.year : "");
    $("[data-caption]").textContent = p.title;
    $("[data-year]").textContent = p.year || "";
    $("[data-prompt]").textContent = p.prompt || "Tell me about this time...";
    $("[data-counter]").textContent = "Photo " + (state.index + 1) + " of " + state.photos.length;
    state.draft = { photoId: p.id, idx: null };
    $("[data-story-text]").value = "";
    setTyping(false);
    $("[data-live]").hidden = true;
    $("[data-live]").textContent = "";
    setStatus("");
    hideSaved();
    updateReadLink(p);
    currentPath = "story/" + p.id;
    try { if (location.protocol !== "about:") history.replaceState(null, "", "#/" + currentPath); } catch (e) {}
  }
  function go(delta) {
    saveStory(true);
    stopListening();
    state.index = (state.index + delta + state.photos.length) % state.photos.length;
    renderStory();
  }
  async function saveStory(silent) {
    var p = state.photos[state.index];
    if (!p || state.draft.photoId !== p.id) return;
    var text = $("[data-story-text]").value.trim();
    if (!text) { if (!silent) setStatus("Tell or type a story first."); return; }
    var list = storiesFor(p.id).slice();
    var idx = state.draft.idx;
    var changed = true;
    if (idx != null && list[idx]) {
      if (list[idx].text === text) changed = false;
      else list[idx] = { text: text, created: list[idx].created };
    } else {
      list.push({ text: text, created: new Date().toISOString() });
      state.draft.idx = list.length - 1;
    }
    if (changed) {
      state.stories[p.id] = list;
      await store.set("stories", state.stories);
      updateReadLink(p);
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
    var note = $("[data-saved]");
    note.hidden = false;
    note.classList.remove("pop"); void note.offsetWidth; note.classList.add("pop");
  }
  function hideSaved() { $("[data-saved]").hidden = true; }
  function updateReadLink(p) {
    var link = $("[data-read-link]");
    var n = storiesFor(p.id).length;
    link.hidden = n === 0;
    link.setAttribute("href", "#/view/" + encodeURIComponent(p.id));
    link.textContent = n === 1 ? "Read the story in the album" : "Read all " + n + " stories in the album";
  }

  /* ---------- View: read the stories attached to a photo ---------- */
  function toldPhotos() { return state.photos.filter(function (p) { return hasStory(p.id); }); }
  function renderView(id) {
    var p = state.photos.find(function (x) { return x.id === id; });
    if (!p) return;
    state.viewId = p.id;
    var told = toldPhotos();
    var pos = told.findIndex(function (x) { return x.id === p.id; });
    var img = $("[data-view-photo]");
    img.src = p.src;
    img.alt = p.title + (p.year ? ", " + p.year : "");
    $("[data-view-caption]").textContent = p.title;
    $("[data-view-year]").textContent = p.year || "";
    $("[data-view-title]").textContent = p.title;
    $("[data-view-sub]").textContent = p.year ? "Remembered from " + p.year : "";
    $("[data-view-counter]").textContent = told.length > 1 ? "Story " + (pos + 1) + " of " + told.length : "";
    $$("[data-action='view-prev'], [data-action='view-next']").forEach(function (b) { b.hidden = told.length < 2; });
    var add = $("[data-add-story]");
    add.setAttribute("href", "#/story/" + encodeURIComponent(p.id));

    var wrap = $("[data-view-entries]");
    wrap.innerHTML = "";
    var list = storiesFor(p.id);
    list.forEach(function (s, i) {
      var art = document.createElement("article");
      art.className = "entry";
      if (list.length > 1) {
        var h = document.createElement("h3");
        h.className = "entry-head";
        h.textContent = i === 0 ? "The story" : "Another memory";
        art.appendChild(h);
      }
      if (s.audio) {
        var player = document.createElement("div");
        player.className = "voice";
        var lab = document.createElement("span");
        lab.className = "voice-label";
        lab.textContent = "Listen to the story";
        var au = document.createElement("audio");
        au.controls = true;
        au.preload = "metadata";
        au.src = s.audio;
        player.appendChild(lab);
        player.appendChild(au);
        art.appendChild(player);
      }
      (s.text || "").split(/\n{2,}|\r\n\r\n/).forEach(function (para) {
        var t = para.trim();
        if (!t) return;
        var pEl = document.createElement("p");
        pEl.textContent = t;
        art.appendChild(pEl);
      });
      var meta = document.createElement("p");
      meta.className = "entry-meta";
      meta.textContent = (s.audio ? "Told " : "Written ") + formatDate(s.created) + (s.audio && !s.text ? " - voice recording" : "");
      art.appendChild(meta);
      wrap.appendChild(art);
    });
    $(".story-page").scrollTop = 0;
    $("[data-view-entries]").scrollTop = 0;
    currentPath = "view/" + p.id;
    try { if (location.protocol !== "about:") history.replaceState(null, "", "#/" + currentPath); } catch (e) {}
  }
  function goView(delta) {
    var told = toldPhotos();
    if (told.length < 2) return;
    var pos = told.findIndex(function (x) { return x.id === state.viewId; });
    var next = told[(pos + delta + told.length) % told.length];
    renderView(next.id);
  }
  function setStatus(msg) { $("[data-status]").textContent = msg; }

  /* ---------- Typing (secondary option) ---------- */
  function setTyping(open, keepFocus) {
    var notes = $("[data-notes]");
    notes.hidden = !open;
    $("[data-album-page]").classList.toggle("typing", open);
    $("[data-screen='story']").classList.toggle("typing", open);
    var t = $("[data-action='toggle-type']");
    t.setAttribute("aria-expanded", open ? "true" : "false");
    t.textContent = open ? "Close typing and use the microphone" : "Prefer to type? Write it instead";
    if (open) { hideSaved(); $("[data-story-text]").focus(); }
    else if (keepFocus) $("[data-action='listen']").focus({ preventScroll: true });
  }

  /* ---------- Recording: voice is the main way to tell a story ---------- */
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var MAX_SECONDS = 300;
  var rec = null, recorder = null, stream = null, chunks = [], transcript = "", recPhotoId = null, timerId = null, startedAt = 0;

  function setListeningUI(on) {
    state.listening = on;
    $("[data-action='listen']").setAttribute("aria-pressed", on ? "true" : "false");
    $("[data-record]").classList.toggle("spinning", on);
    clearInterval(timerId);
    if (on) {
      startedAt = Date.now();
      $("[data-timer]").textContent = "0:00";
      timerId = setInterval(function () {
        var s = Math.floor((Date.now() - startedAt) / 1000);
        $("[data-timer]").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
        if (s >= MAX_SECONDS) stopListening();
      }, 250);
    }
  }
  var starting = false;
  async function startListening() {
    if (starting) return;
    starting = true;
    try { await beginListening(); } finally { starting = false; }
  }
  async function beginListening() {
    var p = state.photos[state.index];
    if (!p) return;
    recPhotoId = p.id; transcript = ""; chunks = [];
    hideSaved();
    var live = $("[data-live]");
    live.textContent = ""; live.hidden = true;

    var gotMic = false;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = finishRecording;
        recorder.start();
        gotMic = true;
      } catch (e) { recorder = null; stream = null; }
    }
    if (Recognition) {
      try {
        rec = new Recognition();
        rec.lang = navigator.language || "en-AU";
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = function (e) {
          var finalText = "", interim = "";
          for (var i = 0; i < e.results.length; i++) {
            if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
            else interim += e.results[i][0].transcript;
          }
          transcript = (finalText + interim).trim();
          live.textContent = transcript;
          live.hidden = !transcript;
        };
        rec.onerror = function () {};
        rec.onend = function () { if (state.listening && !recorder) stopListening(); };
        rec.start();
        gotMic = true;
      } catch (e) { rec = null; }
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
    setListeningUI(false);
    if (rec) { try { rec.stop(); } catch (e) {} rec = null; }
    if (recorder && recorder.state !== "inactive") { recorder.stop(); }
    else finishRecording();
  }
  async function finishRecording() {
    var photoId = recPhotoId;
    var text = transcript;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    var audio = null;
    if (chunks.length) {
      var blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || "audio/webm" });
      audio = await new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { res(null); }; r.readAsDataURL(blob); });
    }
    recorder = null; chunks = [];
    if (!audio && !text) { setStatus("I didn't catch anything that time. Tap the microphone to try again."); return; }
    await addEntry(photoId, { text: text, audio: audio });
  }
  async function addEntry(photoId, entry) {
    var list = storiesFor(photoId).slice();
    entry.created = new Date().toISOString();
    list.push(entry);
    state.stories[photoId] = list;
    var ok = await store.set("stories", state.stories);
    if (!ok && entry.audio) {
      entry.audio = null;
      if (!entry.text) { list.pop(); state.stories[photoId] = list; setStatus("There isn't enough room to save that recording. Try a shorter one, or type it instead."); return; }
      await store.set("stories", state.stories);
      setStatus("Saved the words, but the recording was too large to keep.");
    } else {
      showSaved("Story saved - thank you for sharing.");
    }
    var p = state.photos.find(function (x) { return x.id === photoId; });
    if (p && state.photos[state.index] === p) updateReadLink(p);
  }

  /* ---------- Sign in (front-end only: wire submit to your auth provider) ---------- */
  function resetSignin() {
    $("[data-state='form']").hidden = false;
    $("[data-state='sent']").hidden = true;
    $("[data-error]").hidden = true;
  }
  function onSignin(e) {
    e.preventDefault();
    var input = $("#email");
    var email = input.value.trim();
    var ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    $("[data-error]").hidden = ok;
    input.setAttribute("aria-invalid", ok ? "false" : "true");
    if (!ok) { input.focus(); return; }
    $("[data-sent-email]").textContent = email;
    $("[data-state='form']").hidden = true;
    $("[data-state='sent']").hidden = false;
  }

  /* ---------- Add a photo (resized in the browser, saved locally) ---------- */
  function pickPhoto() { $("[data-file]").click(); }
  function onFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = async function () {
        var size = 900, c = document.createElement("canvas");
        var s = Math.min(img.width, img.height);
        c.width = c.height = size;
        c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        var title = (prompt("What should we call this photo?", "A special day") || "A special day").slice(0, 60);
        var year = (prompt("Roughly what year was it taken? (optional)", "") || "").slice(0, 10);
        var photo = { id: "p" + Date.now(), src: c.toDataURL("image/jpeg", 0.8), title: title, year: year, prompt: "Tell me about this time...", custom: true };
        state.photos.push(photo);
        var custom = state.photos.filter(function (p) { return p.custom; });
        await store.set("photos", custom);
        navigate("story/" + photo.id);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  /* ---------- Wire up ---------- */
  document.addEventListener("click", function (e) {
    var link = e.target.closest("a[href^='#/']");
    if (link) {
      e.preventDefault();
      if (link.getAttribute("aria-disabled") === "true") return;
      navigate(link.getAttribute("href").slice(2)); return;
    }
    var choice = e.target.closest("[data-choice]");
    if (choice) { closeConfirm(choice.getAttribute("data-choice")); return; }
    if (e.target.matches && e.target.matches("[data-confirm]")) { closeConfirm("cancel"); return; }
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var a = btn.getAttribute("data-action");
    if (a === "prev") go(-1);
    if (a === "next") go(1);
    if (a === "listen") state.listening ? stopListening() : startListening();
    if (a === "save") saveStory();
    if (a === "toggle-type") setTyping($("[data-notes]").hidden);
    if (a === "view-prev") goView(-1);
    if (a === "view-next") goView(1);
    if (a === "add-photo") pickPhoto();
    if (a === "manage") { state.editing = !state.editing; hideToast(); renderAlbum(); }
    if (a === "remove") askRemove(btn.getAttribute("data-id"));
    if (a === "undo") undoRemove();
    if (a === "resend") { btn.textContent = "Link sent again"; setTimeout(function () { btn.textContent = "Resend link"; }, 2500); }
  });
  document.addEventListener("keydown", function (e) {
    if (/TEXTAREA|INPUT/.test(document.activeElement.tagName)) return;
    var d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!d) return;
    if (!$("[data-screen='story']").hidden) go(d);
    else if (!$("[data-screen='view']").hidden) goView(d);
  });
  $("[data-form='signin']").addEventListener("submit", onSignin);
  $("[data-file]").addEventListener("change", onFile);
  $("[data-story-text]").addEventListener("blur", function () { saveStory(true); });
  window.addEventListener("popstate", function () { currentPath = (location.hash || "").replace(/^#\/?/, "") || "home"; route(); });

  var hydrated = false, drawn = false;
  function firstDraw() { if (!drawn) { drawn = true; route(); } }
  (async function init() {
    try {
      var saved = await store.get("stories");
      var norm = normaliseStories(saved);
      state.stories = Object.keys(norm).some(function (k) { return norm[k].length; }) ? norm : SAMPLE_STORIES;
      var custom = (await store.get("photos")) || [];
      state.hidden = (await store.get("hidden")) || [];
      state.photos = BASE_PHOTOS.filter(function (p) { return state.hidden.indexOf(p.id) === -1; }).concat(custom);
    } catch (e) { state.stories = SAMPLE_STORIES; }
    hydrated = true;
    if (drawn) {
      var current = currentPath.split("/")[0];
      if (current === "album") renderAlbum();
      if (current === "view") renderView(currentPath.split("/")[1]);
    } else firstDraw();
  })();
  setTimeout(function () { if (!hydrated) { state.stories = SAMPLE_STORIES; firstDraw(); } }, 900);
})();
