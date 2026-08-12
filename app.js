// GG Notes - PWA z IndexedDB (trwały zapis offline), notatkami głosowymi, przypinaniem i folderami
const DB_NAME = 'ggnotes-db';
const DB_STORE = 'notes';
const FOLDER_STORE = 'folders';

function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains(DB_STORE)){
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
      if(!db.objectStoreNames.contains(FOLDER_STORE)){
        db.createObjectStore(FOLDER_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

async function withStore(storeName, mode, fn){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const r = fn(store);
    tx.oncomplete = ()=>res(r);
    tx.onerror = ()=>rej(tx.error);
  });
}

async function getAllNotes(){
  const notes = [];
  await withStore(DB_STORE, 'readonly', store=>{
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
  if(!note.folderIds) note.folderIds = [];
  note.updatedAt = Date.now();
  await withStore(DB_STORE, 'readwrite', store=>store.put(note));
  return note;
}

async function deleteNote(id){
  await withStore(DB_STORE, 'readwrite', store=>store.delete(id));
}

// --- Foldery ---
async function getAllFolders(){
  const folders = [];
  await withStore(FOLDER_STORE, 'readonly', store=>{
    store.openCursor().onsuccess = e=>{
      const cur = e.target.result;
      if(cur){ folders.push(cur.value); cur.continue(); }
    };
  });
  return folders.sort((a,b)=> a.name.localeCompare(b.name, 'pl'));
}

async function saveFolder(folder){
  if(!folder.id) folder.id = 'f_'+Date.now();
  if(!folder.createdAt) folder.createdAt = Date.now();
  await withStore(FOLDER_STORE, 'readwrite', store=>store.put(folder));
  return folder;
}

async function deleteFolder(id){
  await withStore(FOLDER_STORE, 'readwrite', store=>store.delete(id));
  const all = await getAllNotes();
  for(const n of all){
    if(n.folderIds && n.folderIds.includes(id)){
      n.folderIds = n.folderIds.filter(fid=>fid!==id);
      await saveNote(n);
    }
  }
}

async function exportNotes(){
  const notes = await getAllNotes();
  // Nagrania głosowe (Blob) nie są eksportowane do JSON - eksport obejmuje tekst, tytuł, datę, foldery i status przypięcia.
  const plain = notes.map(({id,title,body,pinned,createdAt,updatedAt,folderIds})=>({id,title,body,pinned,createdAt,updatedAt,folderIds}));
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
const folderMenuBtn = document.getElementById('folderMenuBtn');
const foldersScreen = document.getElementById('foldersScreen');
const foldersBackBtn = document.getElementById('foldersBackBtn');
const foldersPane = document.getElementById('foldersPane');
const newFolderBtn = document.getElementById('newFolderBtn');
const folderModalBackdrop = document.getElementById('folderModalBackdrop');
const folderModal = document.getElementById('folderModal');
const folderNameInput = document.getElementById('folderNameInput');
const folderCancelBtn = document.getElementById('folderCancelBtn');
const folderCreateBtn = document.getElementById('folderCreateBtn');
const folderDetailScreen = document.getElementById('folderDetailScreen');
const folderBackBtn = document.getElementById('folderBackBtn');
const folderDetailTitle = document.getElementById('folderDetailTitle');
const folderAddNoteBtn = document.getElementById('folderAddNoteBtn');
const folderSearchAddBtn = document.getElementById('folderSearchAddBtn');
const folderNotesPane = document.getElementById('folderNotesPane');
const folderPickerScreen = document.getElementById('folderPickerScreen');
const pickerCloseBtn = document.getElementById('pickerCloseBtn');
const pickerSearch = document.getElementById('pickerSearch');
const pickerAddBtn = document.getElementById('pickerAddBtn');
const pickerNotesPane = document.getElementById('pickerNotesPane');

let notes = [];
let folders = [];
let currentFolder = null;
let pickerSelected = new Set();
let currentNote = null;
let saveTimeout = null;
let lastAudioUrl = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let showingFavorites = false;

function buildEmptyHint(text){
  const d = document.createElement('div'); d.className = 'empty-hint'; d.textContent = text;
  return d;
}

function buildNoteItemEl(n, onOpen){
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
  el.onclick = ()=> onOpen(n);
  return el;
}

function renderList(filter=''){
  listPane.innerHTML = '';
  const f = filter.toLowerCase();
  const source = showingFavorites ? notes.filter(n=>n.pinned) : notes;
  if(showingFavorites && source.length===0){
    listPane.appendChild(buildEmptyHint('Brak ulubionych notatek. Stuknij ☆ przy notatce, aby dodać ją tutaj.'));
    return;
  }
  let any = false;
  for(const n of source){
    if(f && !( (n.title||'').toLowerCase().includes(f) || (n.body||'').toLowerCase().includes(f) )) continue;
    any = true;
    listPane.appendChild(buildNoteItemEl(n, ()=> openNote(n.id)));
  }
  if(!any && f){ listPane.appendChild(buildEmptyHint('Brak wyników wyszukiwania.')); }
}

async function refreshViews(){
  notes = await getAllNotes();
  renderList(searchEl.value);
  if(currentFolder){
    const updated = folders.find(fo=>fo.id===currentFolder.id) || currentFolder;
    currentFolder = updated;
    renderFolderDetail(updated);
  }
}

// --- Foldery: renderowanie ---
function renderFoldersList(){
  foldersPane.innerHTML = '';
  if(folders.length===0){
    foldersPane.appendChild(buildEmptyHint('Brak folderów. Stuknij + aby utworzyć pierwszy folder.'));
    return;
  }
  for(const folder of folders){
    const count = notes.filter(n=>(n.folderIds||[]).includes(folder.id)).length;
    const el = document.createElement('div'); el.className = 'folder-item';

    const icon = document.createElement('div'); icon.className = 'folder-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>';

    const main = document.createElement('div'); main.className = 'folder-main';
    const name = document.createElement('div'); name.className = 'folder-name'; name.textContent = folder.name;
    const cnt = document.createElement('div'); cnt.className = 'folder-count';
    cnt.textContent = count + (count===1 ? ' notatka' : ' notatek');
    main.appendChild(name); main.appendChild(cnt);

    const del = document.createElement('button'); del.className = 'folder-delete'; del.type = 'button'; del.textContent = '🗑';
    del.setAttribute('aria-label', 'Usuń folder');
    del.onclick = async (ev)=>{
      ev.stopPropagation();
      if(confirm(`Usunąć folder "${folder.name}"? Notatki nie zostaną usunięte.`)){
        await deleteFolder(folder.id);
        await refreshFolders();
      }
    };

    el.appendChild(icon); el.appendChild(main); el.appendChild(del);
    el.onclick = ()=> openFolderDetail(folder);
    foldersPane.appendChild(el);
  }
}

function renderFolderDetail(folder){
  currentFolder = folder;
  folderDetailTitle.textContent = folder.name;
  folderNotesPane.innerHTML = '';
  const items = notes.filter(n=> (n.folderIds||[]).includes(folder.id));
  if(items.length===0){
    folderNotesPane.appendChild(buildEmptyHint('Ten folder jest pusty. Dodaj nową notatkę lub dodaj istniejące przyciskami powyżej.'));
    return;
  }
  for(const n of items){
    folderNotesPane.appendChild(buildNoteItemEl(n, ()=> openNote(n.id)));
  }
}

async function refreshFolders(){
  folders = await getAllFolders();
  renderFoldersList();
  if(currentFolder){
    const updated = folders.find(f=>f.id===currentFolder.id);
    if(updated) renderFolderDetail(updated); else closeFolderDetail();
  }
}

// --- Foldery: nawigacja ---
function openFolders(){
  closeMenu();
  refreshFolders();
  foldersScreen.classList.add('show');
}
function closeFolders(){ foldersScreen.classList.remove('show'); }

function openFolderDetail(folder){
  renderFolderDetail(folder);
  folderDetailScreen.classList.add('show');
}
function closeFolderDetail(){
  folderDetailScreen.classList.remove('show');
  currentFolder = null;
}

function openFolderModal(){
  folderNameInput.value = '';
  folderModalBackdrop.classList.remove('hidden');
  requestAnimationFrame(()=> folderModal.classList.add('open'));
  setTimeout(()=> folderNameInput.focus(), 260);
}
function closeFolderModal(){
  folderModal.classList.remove('open');
  setTimeout(()=> folderModalBackdrop.classList.add('hidden'), 220);
}
async function confirmCreateFolder(){
  const name = folderNameInput.value.trim();
  if(!name) return;
  await saveFolder({ name });
  closeFolderModal();
  await refreshFolders();
}

// --- Wybór notatek do dodania do folderu ---
function renderPickerList(filter=''){
  pickerNotesPane.innerHTML = '';
  const f = filter.toLowerCase();
  let any = false;
  for(const n of notes){
    if(f && !( (n.title||'').toLowerCase().includes(f) || (n.body||'').toLowerCase().includes(f) )) continue;
    any = true;
    const already = (n.folderIds||[]).includes(currentFolder.id);
    const selected = pickerSelected.has(n.id);
    const el = document.createElement('div');
    el.className = 'note-item pickable' + (already ? ' already' : '') + (selected ? ' selected' : '');

    const check = document.createElement('div'); check.className = 'pick-check';
    check.textContent = (already || selected) ? '✓' : '';

    const main = document.createElement('div'); main.className = 'note-main';
    const t = document.createElement('div'); t.className='note-title'; t.textContent = n.title||'(brak tytułu)';
    const b = document.createElement('div'); b.className='note-body'; b.textContent = (n.body||'').slice(0,120);
    main.appendChild(t); main.appendChild(b);

    el.appendChild(check); el.appendChild(main);
    if(!already){
      el.onclick = ()=>{
        if(pickerSelected.has(n.id)) pickerSelected.delete(n.id); else pickerSelected.add(n.id);
        renderPickerList(pickerSearch.value);
        updatePickerAddBtn();
      };
    }
    pickerNotesPane.appendChild(el);
  }
  if(!any){ pickerNotesPane.appendChild(buildEmptyHint('Brak notatek do wyświetlenia.')); }
}

function updatePickerAddBtn(){
  const n = pickerSelected.size;
  pickerAddBtn.textContent = n>0 ? `Dodaj (${n})` : 'Dodaj';
}

function openFolderPicker(){
  if(!currentFolder) return;
  pickerSelected.clear();
  pickerSearch.value = '';
  updatePickerAddBtn();
  renderPickerList('');
  folderPickerScreen.classList.add('show');
  setTimeout(()=> pickerSearch.focus(), 260);
}
function closeFolderPicker(){
  folderPickerScreen.classList.remove('show');
}

async function commitPickerAdd(){
  if(!currentFolder || pickerSelected.size===0){ closeFolderPicker(); return; }
  for(const id of pickerSelected){
    const note = notes.find(x=>x.id===id);
    if(!note) continue;
    note.folderIds = note.folderIds || [];
    if(!note.folderIds.includes(currentFolder.id)) note.folderIds.push(currentFolder.id);
    await saveNote(note);
  }
  notes = await getAllNotes();
  pickerSelected.clear();
  closeFolderPicker();
  renderFolderDetail(currentFolder);
  renderFoldersList();
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
  await refreshViews();
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

async function newNote(folderId){
  const n = { title:'', body:'', pinned:false, audio:null, audioMime:null, folderIds: folderId ? [folderId] : [], id: 'n_'+Date.now() };
  await saveNote(n);
  await refreshViews();
  currentNote = n; titleEl.value=''; bodyEl.value='';
  updatePinBtn(); updateAudioUI(); recordStatus.textContent='';
  showEditorScreen();
  setTimeout(()=>titleEl.focus(), 300);
}

async function togglePinForNote(note){
  note.pinned = !note.pinned;
  await saveNote(note);
  if(currentNote && currentNote.id===note.id) updatePinBtn();
  await refreshViews();
}

async function removeActive(){
  if(!currentNote) return;
  if(!confirm('Na pewno usunąć notatkę?')) return;
  const id = currentNote.id;
  await deleteNote(id);
  currentNote = null;
  await refreshViews();
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
newBtn.addEventListener('click', ()=> newNote());
saveBtn.addEventListener('click', doSaveActive);
deleteBtn.addEventListener('click', removeActive);
backBtn.addEventListener('click', showListScreen);
pinBtn.addEventListener('click', ()=>{ if(currentNote) togglePinForNote(currentNote); });
themeBtn.addEventListener('click', ()=> applyTheme(document.documentElement.getAttribute('data-theme')==='dark' ? 'light' : 'dark'));
menuBtn.addEventListener('click', openMenu);
sheetBackdrop.addEventListener('click', closeMenu);
exportBtn.addEventListener('click', ()=>{ exportNotes(); closeMenu(); });
importBtn.addEventListener('click', ()=>{ importFile.click(); });
importFile.addEventListener('change', async (e)=>{ if(e.target.files[0]) await importNotes(e.target.files[0]); await refreshViews(); closeMenu(); });
recordBtn.addEventListener('click', toggleRecording);
deleteAudioBtn.addEventListener('click', deleteAudio);
searchMenuBtn.addEventListener('click', openSearch);
voiceMenuBtn.addEventListener('click', quickVoiceNote);
favMenuBtn.addEventListener('click', openFavorites);
closeFavBtn.addEventListener('click', closeFavorites);
closeSearchBtn.addEventListener('click', closeSearch);
folderMenuBtn.addEventListener('click', openFolders);
foldersBackBtn.addEventListener('click', closeFolders);
newFolderBtn.addEventListener('click', openFolderModal);
folderCancelBtn.addEventListener('click', closeFolderModal);
folderModalBackdrop.addEventListener('click', closeFolderModal);
folderCreateBtn.addEventListener('click', confirmCreateFolder);
folderNameInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') confirmCreateFolder(); });
folderBackBtn.addEventListener('click', closeFolderDetail);
folderAddNoteBtn.addEventListener('click', ()=>{ if(currentFolder) newNote(currentFolder.id); });
folderSearchAddBtn.addEventListener('click', openFolderPicker);
pickerCloseBtn.addEventListener('click', closeFolderPicker);
pickerSearch.addEventListener('input', ()=> renderPickerList(pickerSearch.value));
pickerAddBtn.addEventListener('click', commitPickerAdd);

window.addEventListener('load', ()=>init());
