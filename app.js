// GG Notes - PWA z IndexedDB (trwały zapis offline), notatkami głosowymi i przypinaniem
const DB_NAME = 'ggnotes-db';
const DB_STORE = 'notes';

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains(DB_STORE)){
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

async function withStore(mode, fn){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(DB_STORE, mode);
    const store = tx.objectStore(DB_STORE);
    const r = fn(store);
    tx.oncomplete = ()=>res(r);
    tx.onerror = ()=>rej(tx.error);
  });
}

async function getAllNotes(){
  const notes = [];
  await withStore('readonly', store=>{
    store.openCursor().onsuccess = e=>{
      const cur = e.target.result;
      if(cur){ notes.push(cur.value); cur.continue(); }
    };
  });
  return notes.sort((a,b)=> (b.pinned?1:0)-(a.pinned?1:0) || b.updatedAt-a.updatedAt);
}

async function saveNote(note){
  if(!note.id) note.id = 'n_'+Date.now();
  if(!note.createdAt) note.createdAt = Date.now();
  note.updatedAt = Date.now();
  await withStore('readwrite', store=>store.put(note));
  return note;
}

async function deleteNote(id){
  await withStore('readwrite', store=>store.delete(id));
}

async function exportNotes(){
  const notes = await getAllNotes();
  // Nagrania głosowe (Blob) nie są eksportowane do JSON - eksport obejmuje tekst, tytuł, datę i status przypięcia.
  const plain = notes.map(({id,title,body,pinned,createdAt,updatedAt})=>({id,title,body,pinned,createdAt,updatedAt}));
  const blob = new Blob([JSON.stringify(plain, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'gg-notes-export.json';
  a.click(); URL.revokeObjectURL(url);
}

async function importNotes(file){
  const text = await file.text();
  let arr = [];
  try{ arr = JSON.parse(text); }catch(e){ alert('Nieprawidłowy plik JSON'); return; }
  for(const n of arr){ n.id = n.id || ('n_'+Date.now()+Math.random()); await saveNote(n); }
}

function formatWhen(ts){
  if(!ts) return '';
  const d = new Date(ts); const now = new Date();
  const sameDay = d.toDateString()===now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'})
    : d.toLocaleDateString('pl-PL', {day:'2-digit', month:'2-digit'});
}

// UI - elementy
const appEl = document.getElementById('app');
const searchEl = document.getElementById('search');
const listPane = document.getElementById('listPane');
const titleEl = document.getElementById('noteTitle');
const bodyEl = document.getElementById('noteBody');
const newBtn = document.getElementById('newBtn');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const backBtn = document.getElementById('backBtn');
const pinBtn = document.getElementById('pinBtn');
const themeBtn = document.getElementById('themeBtn');
const menuBtn = document.getElementById('menuBtn');
const menuDropdown = document.getElementById('menuDropdown');
const sheetBackdrop = document.getElementById('sheetBackdrop');
const searchBar = document.getElementById('searchBar');
const searchMenuBtn = document.getElementById('searchMenuBtn');
const voiceMenuBtn = document.getElementById('voiceMenuBtn');
const favMenuBtn = document.getElementById('favMenuBtn');
const favBar = document.getElementById('favBar');
const closeFavBtn = document.getElementById('closeFavBtn');
const closeSearchBtn = document.getElementById('closeSearchBtn');
const recordBtn = document.getElementById('recordBtn');
const recordStatus = document.getElementById('recordStatus');
const audioPlayerWrap = document.getElementById('audioPlayerWrap');
const audioPlayer = document.getElementById('audioPlayer');
const deleteAudioBtn = document.getElementById('deleteAudioBtn');

let notes = [];
let currentNote = null;
let saveTimeout = null;
let lastAudioUrl = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let showingFavorites = false;

function renderList(filter=''){
  listPane.innerHTML = '';
  const f = filter.toLowerCase();
  const source = showingFavorites ? notes.filter(n=>n.pinned) : notes;
  if(showingFavorites && source.length===0){
    const empty = document.createElement('div');
    empty.className = 'note-body';
    empty.style.textAlign = 'center'; empty.style.marginTop = '24px';
    empty.textContent = 'Brak ulubionych notatek. Stuknij ☆ przy notatce, aby dodać ją tutaj.';
    listPane.appendChild(empty);
    return;
  }
  for(const n of source){
    if(f && !( (n.title||'').toLowerCase().includes(f) || (n.body||'').toLowerCase().includes(f) )) continue;
    const el = document.createElement('div'); el.className = 'note-item';
    if(currentNote && n.id===currentNote.id) el.classList.add('active');

    const star = document.createElement('button');
    star.className = 'pin-star'; star.type = 'button';
    star.textContent = n.pinned ? '★' : '☆';
    star.setAttribute('aria-label', n.pinned ? 'Odepnij notatkę' : 'Przypnij notatkę');
    star.onclick = (ev)=>{ ev.stopPropagation(); togglePinForNote(n); };

    const main = document.createElement('div'); main.className = 'note-main';
    const t = document.createElement('div'); t.className='note-title'; t.textContent = n.title||'(brak tytułu)';
    const b = document.createElement('div'); b.className='note-body'; b.textContent = (n.body||'').slice(0,120);
    const meta = document.createElement('div'); meta.className='note-meta';
    meta.textContent = formatWhen(n.createdAt || n.updatedAt);
    if(n.audio){ const mic = document.createElement('span'); mic.textContent = ' 🎤'; meta.appendChild(mic); }
    main.appendChild(t); main.appendChild(b); main.appendChild(meta);

    el.appendChild(star); el.appendChild(main);
    el.onclick = ()=>{ openNote(n.id); };
    listPane.appendChild(el);
  }
}

function bindAutosave(){
  [titleEl, bodyEl].forEach(el=>el.addEventListener('input', ()=>{
    if(!currentNote) return;
    currentNote.title = titleEl.value; currentNote.body = bodyEl.value;
    if(saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(()=>doSaveActive(), 700);
  }));
}

async function doSaveActive(){
  if(!currentNote) return;
  currentNote.title = titleEl.value; currentNote.body = bodyEl.value;
  await saveNote(currentNote);
  notes = await getAllNotes(); renderList(searchEl.value);
}

function updatePinBtn(){
  pinBtn.textContent = currentNote?.pinned ? '★' : '☆';
  pinBtn.style.color = currentNote?.pinned ? '#e6a700' : '';
}

function updateAudioUI(){
  if(lastAudioUrl){ URL.revokeObjectURL(lastAudioUrl); lastAudioUrl = null; }
  if(currentNote && currentNote.audio){
    lastAudioUrl = URL.createObjectURL(currentNote.audio);
    audioPlayer.src = lastAudioUrl;
    audioPlayerWrap.classList.remove('hidden');
  } else {
    audioPlayer.removeAttribute('src');
    audioPlayerWrap.classList.add('hidden');
  }
}

function showEditorScreen(){ appEl.classList.add('editor-active'); }
function showListScreen(){
  if(isRecording) stopRecording();
  appEl.classList.remove('editor-active');
}

async function openNote(id){
  const n = notes.find(x=>x.id===id); if(!n) return;
  currentNote = n;
  titleEl.value = n.title||''; bodyEl.value = n.body||'';
  updatePinBtn(); updateAudioUI(); recordStatus.textContent = '';
  renderList(searchEl.value);
  showEditorScreen();
}

async function newNote(){
  const n = { title:'', body:'', pinned:false, audio:null, audioMime:null, id: 'n_'+Date.now() };
  await saveNote(n); notes = await getAllNotes();
  currentNote = n; titleEl.value=''; bodyEl.value='';
  updatePinBtn(); updateAudioUI(); recordStatus.textContent='';
  renderList(); showEditorScreen();
  setTimeout(()=>titleEl.focus(), 300);
}

async function togglePinForNote(note){
  note.pinned = !note.pinned;
  await saveNote(note);
  notes = await getAllNotes();
  if(currentNote && currentNote.id===note.id) updatePinBtn();
  renderList(searchEl.value);
}

async function removeActive(){
  if(!currentNote) return;
  if(!confirm('Na pewno usunąć notatkę?')) return;
  const id = currentNote.id;
  await deleteNote(id);
  notes = await getAllNotes();
  currentNote = null;
  renderList(searchEl.value);
  showListScreen();
}

// --- Notatki głosowe ---
function updateRecordUI(){
  recordBtn.classList.toggle('recording', isRecording);
  recordBtn.textContent = isRecording ? '■' : '🎤';
  recordStatus.textContent = isRecording ? 'Nagrywanie...' : '';
}

async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){
    alert('Nagrywanie audio nie jest wspierane w tej przeglądarce.');
    return;
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e=>{ if(e.data.size>0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = async ()=>{
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      stream.getTracks().forEach(t=>t.stop());
      if(currentNote){
        currentNote.audio = blob; currentNote.audioMime = blob.type;
        updateAudioUI();
        await doSaveActive();
      }
    };
    mediaRecorder.start();
    isRecording = true; updateRecordUI();
  }catch(err){
    alert('Brak dostępu do mikrofonu: ' + err.message);
  }
}

function stopRecording(){
  if(mediaRecorder && isRecording){ mediaRecorder.stop(); }
  isRecording = false; updateRecordUI();
}

function toggleRecording(){ isRecording ? stopRecording() : startRecording(); }

async function deleteAudio(){
  if(!currentNote) return;
  currentNote.audio = null; currentNote.audioMime = null;
  updateAudioUI();
  await doSaveActive();
}

// --- Motyw ciemny/jasny ---
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('gg-theme', theme);
  themeBtn.textContent = theme==='dark' ? '☀️' : '🌙';
}

function initTheme(){
  const saved = localStorage.getItem('gg-theme')
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);
}

// --- Menu (dropdown z animacją) ---
function openMenu(){
  sheetBackdrop.classList.remove('hidden');
  requestAnimationFrame(()=> menuDropdown.classList.add('open'));
}
function closeMenu(){
  menuDropdown.classList.remove('open');
  setTimeout(()=> sheetBackdrop.classList.add('hidden'), 260);
}

function openSearch(){
  closeMenu();
  closeFavorites();
  searchBar.classList.add('visible');
  setTimeout(()=> searchEl.focus(), 260);
}
function closeSearch(){
  searchBar.classList.remove('visible');
  searchEl.value = '';
  renderList('');
}

function openFavorites(){
  closeMenu();
  closeSearch();
  showingFavorites = true;
  favBar.classList.add('visible');
  renderList();
}
function closeFavorites(){
  showingFavorites = false;
  favBar.classList.remove('visible');
  renderList(searchEl.value);
}

async function quickVoiceNote(){
  closeMenu();
  await newNote();
  setTimeout(()=> startRecording(), 380);
}

async function init(){
  initTheme();
  notes = await getAllNotes();
  if(notes.length===0){
    await saveNote({id:'n_welcome', title:'Witaj w GG Notes', body:'To jest Twoja pierwsza notatka. Edytuj ją, dodaj nagranie głosowe 🎤 lub przypnij ⭐ ważne notatki.', pinned:true, audio:null, audioMime:null});
    notes = await getAllNotes();
  }
  renderList();
  bindAutosave();
}

searchEl.addEventListener('input', ()=>renderList(searchEl.value));
newBtn.addEventListener('click', newNote);
saveBtn.addEventListener('click', doSaveActive);
deleteBtn.addEventListener('click', removeActive);
backBtn.addEventListener('click', showListScreen);
pinBtn.addEventListener('click', ()=>{ if(currentNote) togglePinForNote(currentNote); });
themeBtn.addEventListener('click', ()=> applyTheme(document.documentElement.getAttribute('data-theme')==='dark' ? 'light' : 'dark'));
menuBtn.addEventListener('click', openMenu);
sheetBackdrop.addEventListener('click', closeMenu);
exportBtn.addEventListener('click', ()=>{ exportNotes(); closeMenu(); });
importBtn.addEventListener('click', ()=>{ importFile.click(); });
importFile.addEventListener('change', async (e)=>{ if(e.target.files[0]) await importNotes(e.target.files[0]); notes = await getAllNotes(); renderList(); closeMenu(); });
recordBtn.addEventListener('click', toggleRecording);
deleteAudioBtn.addEventListener('click', deleteAudio);
searchMenuBtn.addEventListener('click', openSearch);
voiceMenuBtn.addEventListener('click', quickVoiceNote);
favMenuBtn.addEventListener('click', openFavorites);
closeFavBtn.addEventListener('click', closeFavorites);
closeSearchBtn.addEventListener('click', closeSearch);

window.addEventListener('load', ()=>init());
