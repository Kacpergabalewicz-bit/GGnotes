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
  if(!note.photos) note.photos = [];
  if(typeof note.locked !== 'boolean') note.locked = false;
  note.updatedAt = Date.now();
  await withStore(DB_STORE, 'readwrite', store=>store.put(note));
  scheduleAutoBackup();
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
  scheduleAutoBackup();
}

async function buildExportPayload(){
  const notes = await getAllNotes();
  const allFolders = await getAllFolders();
  // Nagrania głosowe i zdjęcia (Blob) nie są eksportowane do JSON - eksport obejmuje tekst, tytuł, datę, foldery, przypięcie i blokadę.
  const plainNotes = notes.map(({id,title,body,pinned,createdAt,updatedAt,folderIds,locked})=>({id,title,body,pinned,createdAt,updatedAt,folderIds,locked}));
  const plainFolders = allFolders.map(({id,name,createdAt})=>({id,name,createdAt}));
  return { notes: plainNotes, folders: plainFolders, exportedAt: Date.now() };
}

async function exportNotes(){
  const payload = await buildExportPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'gg-notes-export.json';
  a.click(); URL.revokeObjectURL(url);
}

async function importNotes(file){
  const text = await file.text();
  let data = null;
  try{ data = JSON.parse(text); }catch(e){ alert('Nieprawidłowy plik JSON'); return; }
  let notesArr = [];
  let foldersArr = [];
  if(Array.isArray(data)){ notesArr = data; }
  else if(data && typeof data === 'object'){ notesArr = data.notes || []; foldersArr = data.folders || []; }
  for(const f of foldersArr){ f.id = f.id || ('f_'+Date.now()+Math.random()); await saveFolder(f); }
  for(const n of notesArr){ n.id = n.id || ('n_'+Date.now()+Math.random()); await saveNote(n); }
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

// Udostępnianie / PIN / kopia zapasowa
const shareBtn = document.getElementById('shareBtn');
const lockBtn = document.getElementById('lockBtn');
const shareAppBtn = document.getElementById('shareAppBtn');
const pinSettingsBtn = document.getElementById('pinSettingsBtn');
const backupInfo = document.getElementById('backupInfo');
const pinModalBackdrop = document.getElementById('pinModalBackdrop');
const pinModal = document.getElementById('pinModal');
const pinTitle = document.getElementById('pinTitle');
const pinSubtitle = document.getElementById('pinSubtitle');
const pinInput = document.getElementById('pinInput');
const pinConfirmWrap = document.getElementById('pinConfirmWrap');
const pinConfirmInput = document.getElementById('pinConfirmInput');
const pinError = document.getElementById('pinError');
const pinBiometricBtn = document.getElementById('pinBiometricBtn');
const pinRegisterBioBtn = document.getElementById('pinRegisterBioBtn');
const pinCancelBtn = document.getElementById('pinCancelBtn');
const pinSubmitBtn = document.getElementById('pinSubmitBtn');

// Zdjęcia
const photoBtn = document.getElementById('photoBtn');
const photoFile = document.getElementById('photoFile');
const photosStrip = document.getElementById('photosStrip');
const photoViewer = document.getElementById('photoViewer');
const photoViewerImg = document.getElementById('photoViewerImg');
const photoViewerCloseBtn = document.getElementById('photoViewerCloseBtn');

// Rysowanie odręczne
const drawMenuBtn = document.getElementById('drawMenuBtn');
const drawAttachBtn = document.getElementById('drawAttachBtn');
const drawScreen = document.getElementById('drawScreen');
const drawCloseBtn = document.getElementById('drawCloseBtn');
const drawUndoBtn = document.getElementById('drawUndoBtn');
const drawClearBtn = document.getElementById('drawClearBtn');
const drawSaveBtn = document.getElementById('drawSaveBtn');
const drawCanvas = document.getElementById('drawCanvas');
const drawColors = document.getElementById('drawColors');
const drawSizes = document.getElementById('drawSizes');

// Przeciąganie do folderu / toast
const dropFoldersBar = document.getElementById('dropFoldersBar');
const dropFoldersChips = document.getElementById('dropFoldersChips');
const toastEl = document.getElementById('toast');

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
let photoObjectUrls = [];
let pinResolve = null;
let pinMode = 'verify';
let drawCtx = null;
let drawColor = '#1c1c1e';
let drawSize = 3;
let drawUndoStack = [];
let drawTargetNote = null;
let drawIsNewNote = false;
let isDrawingStroke = false;
let autoBackupTimer = null;
let dragState = null;

function buildEmptyHint(text){
  const d = document.createElement('div'); d.className = 'empty-hint'; d.textContent = text;
  return d;
}

function buildNoteItemEl(n, onOpen){
  const el = document.createElement('div'); el.className = 'note-item';
  if(currentNote && n.id===currentNote.id) el.classList.add('active');
  if(n.locked) el.classList.add('locked');

  const handle = document.createElement('div'); handle.className = 'drag-handle'; handle.textContent = '⠿';

  const star = document.createElement('button');
  star.className = 'pin-star'; star.type = 'button';
  star.textContent = n.pinned ? '★' : '☆';
  star.setAttribute('aria-label', n.pinned ? 'Odepnij notatkę' : 'Przypnij notatkę');
  star.onclick = (ev)=>{ ev.stopPropagation(); togglePinForNote(n); };

  const main = document.createElement('div'); main.className = 'note-main';
  const t = document.createElement('div'); t.className='note-title'; t.textContent = n.title||'(brak tytułu)';
  const b = document.createElement('div'); b.className='note-body';
  b.textContent = n.locked ? '🔒 Notatka zablokowana' : (n.body||'').slice(0,120);
  const meta = document.createElement('div'); meta.className='note-meta';
  meta.textContent = formatWhen(n.createdAt || n.updatedAt);
  if(n.audio){ const mic = document.createElement('span'); mic.textContent = ' 🎤'; meta.appendChild(mic); }
  if(n.photos && n.photos.length){ const ph = document.createElement('span'); ph.textContent = ' 📷'; meta.appendChild(ph); }
  if(n.locked){ const lk = document.createElement('span'); lk.className='note-lock-badge'; lk.textContent = ' 🔒'; meta.appendChild(lk); }
  main.appendChild(t); main.appendChild(b); main.appendChild(meta);

  el.appendChild(handle); el.appendChild(star); el.appendChild(main);
  el.onclick = ()=> onOpen(n);
  attachDragHandlers(el, n);
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
  if(n.locked){
    const ok = await unlockNoteFlow();
    if(!ok) return;
  }
  currentNote = n;
  titleEl.value = n.title||''; bodyEl.value = n.body||'';
  updatePinBtn(); updateLockBtn(); updateAudioUI(); renderPhotosStrip(); recordStatus.textContent = '';
  renderList(searchEl.value);
  showEditorScreen();
}

async function newNote(folderId){
  const n = { title:'', body:'', pinned:false, audio:null, audioMime:null, photos:[], locked:false, folderIds: folderId ? [folderId] : [], id: 'n_'+Date.now() };
  await saveNote(n);
  await refreshViews();
  currentNote = n; titleEl.value=''; bodyEl.value='';
  updatePinBtn(); updateLockBtn(); updateAudioUI(); renderPhotosStrip(); recordStatus.textContent='';
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

// --- Toast (krótkie powiadomienia) ---
let toastTimeout = null;
function showToast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if(toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(()=> toastEl.classList.remove('show'), 2400);
}

// --- Udostępnianie (Web Share API) ---
async function shareNote(){
  if(!currentNote) return;
  const text = [currentNote.title, currentNote.body].filter(Boolean).join('\n\n');
  if(navigator.share){
    try{ await navigator.share({ title: currentNote.title || 'Notatka z GG Notes', text }); }
    catch(e){ /* anulowane przez użytkownika */ }
  } else if(navigator.clipboard){
    await navigator.clipboard.writeText(text);
    showToast('Skopiowano notatkę do schowka');
  } else {
    showToast('Udostępnianie nie jest wspierane w tej przeglądarce');
  }
}

async function shareApp(){
  closeMenu();
  const url = location.href.split('#')[0];
  if(navigator.share){
    try{ await navigator.share({ title:'GG Notes', text:'Wypróbuj GG Notes - darmowe notatki offline!', url }); }
    catch(e){ /* anulowane */ }
  } else if(navigator.clipboard){
    await navigator.clipboard.writeText(url);
    showToast('Skopiowano link do aplikacji');
  } else {
    showToast('Udostępnianie nie jest wspierane');
  }
}

// --- Kryptografia pomocnicza (PIN + WebAuthn) ---
async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function abToB64(buf){
  let bin = ''; const bytes = new Uint8Array(buf);
  for(const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64ToAb(b64){
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function biometricAvailable(){
  return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(()=>false));
}

async function registerBiometric(){
  try{
    if(!(await biometricAvailable())) return false;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const cred = await navigator.credentials.create({ publicKey:{
      challenge, rp:{ name:'GG Notes' }, user:{ id:userId, name:'gg-notes', displayName:'GG Notes' },
      pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
      authenticatorSelection:{ authenticatorAttachment:'platform', userVerification:'required' },
      timeout: 60000
    }});
    if(cred){ localStorage.setItem('gg-webauthn-id', abToB64(cred.rawId)); return true; }
  }catch(e){ /* odrzucone lub niewspierane */ }
  return false;
}

async function verifyBiometric(){
  try{
    const idB64 = localStorage.getItem('gg-webauthn-id');
    if(!idB64) return false;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({ publicKey:{
      challenge, allowCredentials:[{ id: b64ToAb(idB64), type:'public-key' }],
      userVerification:'required', timeout: 60000
    }});
    return !!assertion;
  }catch(e){ return false; }
}

// --- Modal PIN ---
async function refreshPinBioButtons(){
  const avail = await biometricAvailable();
  const hasCred = !!localStorage.getItem('gg-webauthn-id');
  pinBiometricBtn.classList.toggle('hidden', !(pinMode==='verify' && avail && hasCred));
  pinRegisterBioBtn.classList.toggle('hidden', !(pinMode==='setup' && avail && !hasCred));
}

function openPinModal(mode){
  pinMode = mode;
  pinInput.value=''; pinConfirmInput.value=''; pinError.classList.add('hidden'); pinError.textContent='';
  if(mode==='setup'){
    pinTitle.textContent = localStorage.getItem('gg-pin-hash') ? 'Zmień PIN' : 'Ustaw PIN';
    pinSubtitle.classList.add('hidden');
    pinConfirmWrap.classList.remove('hidden');
  } else {
    pinTitle.textContent = 'Wprowadź PIN';
    pinSubtitle.classList.remove('hidden');
    pinConfirmWrap.classList.add('hidden');
  }
  refreshPinBioButtons();
  pinModalBackdrop.classList.remove('hidden');
  requestAnimationFrame(()=> pinModal.classList.add('open'));
  setTimeout(()=> pinInput.focus(), 260);
  return new Promise(resolve=>{ pinResolve = resolve; });
}
function closePinModal(result){
  pinModal.classList.remove('open');
  setTimeout(()=> pinModalBackdrop.classList.add('hidden'), 220);
  if(pinResolve){ pinResolve(result); pinResolve = null; }
}
function pinShowError(msg){ pinError.textContent = msg; pinError.classList.remove('hidden'); }

async function handlePinSubmit(){
  const val = pinInput.value.trim();
  if(!/^\d{4,6}$/.test(val)){ pinShowError('PIN musi mieć 4-6 cyfr.'); return; }
  if(pinMode==='setup'){
    if(val !== pinConfirmInput.value.trim()){ pinShowError('PIN-y nie są identyczne.'); return; }
    const hash = await sha256Hex(val);
    localStorage.setItem('gg-pin-hash', hash);
    showToast('PIN ustawiony');
    closePinModal(true);
  } else {
    const hash = await sha256Hex(val);
    if(hash === localStorage.getItem('gg-pin-hash')){ closePinModal(true); }
    else { pinShowError('Nieprawidłowy PIN.'); }
  }
}

async function handlePinBiometric(){
  const ok = await verifyBiometric();
  if(ok) closePinModal(true); else pinShowError('Nie udało się zweryfikować biometrii.');
}
async function handlePinRegisterBio(){
  const ok = await registerBiometric();
  if(ok){ showToast('Face ID / Touch ID zarejestrowane'); refreshPinBioButtons(); }
  else showToast('Nie udało się zarejestrować biometrii');
}

async function unlockNoteFlow(){
  if(!localStorage.getItem('gg-pin-hash')) return true; // brak PIN-u = brak blokady
  if(await biometricAvailable() && localStorage.getItem('gg-webauthn-id')){
    const bio = await verifyBiometric();
    if(bio) return true;
  }
  return await openPinModal('verify');
}

function updateLockBtn(){
  const locked = !!currentNote?.locked;
  lockBtn.textContent = locked ? '🔒' : '🔓';
  lockBtn.classList.toggle('locked', locked);
}

async function toggleLockForCurrentNote(){
  if(!currentNote) return;
  if(currentNote.locked){
    currentNote.locked = false;
    updateLockBtn(); await doSaveActive();
    showToast('Odblokowano notatkę');
  } else {
    if(!localStorage.getItem('gg-pin-hash')){
      const ok = await openPinModal('setup');
      if(!ok) return;
    }
    currentNote.locked = true;
    updateLockBtn(); await doSaveActive();
    showToast('Notatka zablokowana PIN-em / Face ID');
  }
}

// --- Zdjęcia w notatkach ---
function resizeImageFile(file, maxDim=1600, quality=0.82){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = ()=>{
      let { width, height } = img;
      if(width > maxDim || height > maxDim){
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width*scale); height = Math.round(height*scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob=>{ URL.revokeObjectURL(url); resolve(blob); }, 'image/jpeg', quality);
    };
    img.onerror = (e)=>{ URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function handlePhotoFiles(fileList){
  if(!currentNote) return;
  const files = Array.from(fileList||[]);
  for(const file of files){
    try{
      const blob = await resizeImageFile(file);
      currentNote.photos = currentNote.photos || [];
      currentNote.photos.push({ id:'p_'+Date.now()+Math.random(), blob, mime:'image/jpeg' });
    }catch(e){ /* pomiń błędny plik */ }
  }
  await doSaveActive();
  renderPhotosStrip();
}

function renderPhotosStrip(){
  photoObjectUrls.forEach(u=>URL.revokeObjectURL(u));
  photoObjectUrls = [];
  photosStrip.innerHTML = '';
  const photos = currentNote?.photos || [];
  if(photos.length===0){ photosStrip.classList.add('hidden'); return; }
  photosStrip.classList.remove('hidden');
  for(const p of photos){
    const url = URL.createObjectURL(p.blob);
    photoObjectUrls.push(url);
    const thumb = document.createElement('div'); thumb.className = 'photo-thumb';
    const img = document.createElement('img'); img.src = url; img.alt = 'Zdjęcie';
    img.onclick = ()=> openPhotoViewer(url);
    const rm = document.createElement('button'); rm.className='photo-remove'; rm.type='button'; rm.textContent='✕';
    rm.setAttribute('aria-label','Usuń zdjęcie');
    rm.onclick = async (ev)=>{
      ev.stopPropagation();
      currentNote.photos = currentNote.photos.filter(x=>x.id!==p.id);
      await doSaveActive();
      renderPhotosStrip();
    };
    thumb.appendChild(img); thumb.appendChild(rm);
    photosStrip.appendChild(thumb);
  }
}

function openPhotoViewer(url){
  photoViewerImg.src = url;
  photoViewer.classList.remove('hidden');
}
function closePhotoViewer(){
  photoViewer.classList.add('hidden');
  photoViewerImg.src = '';
}

// --- Rysowanie odręczne ---
function resizeDrawCanvas(){
  if(!drawCtx) return;
  const rect = drawCanvas.parentElement.getBoundingClientRect();
  const snapshot = drawCanvas.width ? drawCanvas.toDataURL() : null;
  drawCanvas.width = rect.width; drawCanvas.height = rect.height;
  drawCtx.fillStyle = '#ffffff'; drawCtx.fillRect(0,0,drawCanvas.width, drawCanvas.height);
  if(snapshot){
    const img = new Image();
    img.onload = ()=> drawCtx.drawImage(img,0,0, drawCanvas.width, drawCanvas.height);
    img.src = snapshot;
  }
}

function pushDrawUndo(){
  drawUndoStack.push(drawCanvas.toDataURL());
  if(drawUndoStack.length > 20) drawUndoStack.shift();
}

function drawUndo(){
  if(drawUndoStack.length===0) return;
  const last = drawUndoStack.pop();
  const img = new Image();
  img.onload = ()=>{ drawCtx.clearRect(0,0,drawCanvas.width,drawCanvas.height); drawCtx.drawImage(img,0,0); };
  img.src = last;
}

function drawClear(){
  pushDrawUndo();
  drawCtx.fillStyle = '#ffffff';
  drawCtx.fillRect(0,0,drawCanvas.width, drawCanvas.height);
}

function getDrawPos(ev){
  const rect = drawCanvas.getBoundingClientRect();
  return { x: ev.clientX-rect.left, y: ev.clientY-rect.top };
}

function initDrawCanvasEvents(){
  let last = null;
  drawCanvas.addEventListener('pointerdown', (ev)=>{
    isDrawingStroke = true; pushDrawUndo();
    drawCanvas.setPointerCapture(ev.pointerId);
    last = getDrawPos(ev);
    drawCtx.beginPath(); drawCtx.moveTo(last.x, last.y);
    drawCtx.lineTo(last.x+0.01, last.y+0.01);
    drawCtx.strokeStyle = drawColor; drawCtx.lineWidth = drawSize;
    drawCtx.lineCap = 'round'; drawCtx.lineJoin = 'round';
    drawCtx.stroke();
  });
  drawCanvas.addEventListener('pointermove', (ev)=>{
    if(!isDrawingStroke) return;
    const pos = getDrawPos(ev);
    drawCtx.strokeStyle = drawColor; drawCtx.lineWidth = drawSize;
    drawCtx.lineCap = 'round'; drawCtx.lineJoin = 'round';
    drawCtx.beginPath(); drawCtx.moveTo(last.x, last.y); drawCtx.lineTo(pos.x, pos.y); drawCtx.stroke();
    last = pos;
  });
  const endStroke = ()=>{ isDrawingStroke = false; last = null; };
  drawCanvas.addEventListener('pointerup', endStroke);
  drawCanvas.addEventListener('pointercancel', endStroke);
  window.addEventListener('resize', ()=>{ if(drawScreen.classList.contains('show')) resizeDrawCanvas(); });
}

function openDrawScreen(target, isNew){
  drawTargetNote = target; drawIsNewNote = !!isNew;
  drawUndoStack = [];
  drawScreen.classList.add('show');
  requestAnimationFrame(()=>{
    if(!drawCtx) drawCtx = drawCanvas.getContext('2d');
    resizeDrawCanvas();
  });
}
function closeDrawScreen(){
  drawScreen.classList.remove('show');
  drawTargetNote = null;
}

async function quickDrawNote(){
  closeMenu();
  const n = { title:'', body:'', pinned:false, audio:null, audioMime:null, photos:[], locked:false, folderIds:[], id:'n_'+Date.now() };
  await saveNote(n);
  await refreshViews();
  openDrawScreen(n, true);
}

function attachDrawFromEditor(){
  if(!currentNote) return;
  openDrawScreen(currentNote, false);
}

async function saveDrawing(){
  const blob = await new Promise(res=> drawCanvas.toBlob(res, 'image/png'));
  if(!blob){ closeDrawScreen(); return; }
  const target = drawTargetNote;
  target.photos = target.photos || [];
  target.photos.push({ id:'p_'+Date.now()+Math.random(), blob, mime:'image/png' });
  await saveNote(target);
  await refreshViews();
  closeDrawScreen();
  if(drawIsNewNote){
    currentNote = target;
    titleEl.value = target.title||''; bodyEl.value = target.body||'';
    updatePinBtn(); updateLockBtn(); updateAudioUI(); renderPhotosStrip(); recordStatus.textContent='';
    showEditorScreen();
  } else if(currentNote && currentNote.id===target.id){
    renderPhotosStrip();
  }
  showToast('Rysunek zapisany');
}

// --- Przeciąganie notatek do folderu (drag & drop, mysz + dotyk) ---
function renderDropFolderChips(excludeFolderIds){
  dropFoldersChips.innerHTML = '';
  const excl = excludeFolderIds || [];
  const avail = folders.filter(f=> !excl.includes(f.id));
  if(avail.length===0){
    const hint = document.createElement('div'); hint.className='drop-folders-label'; hint.textContent='Brak folderów - utwórz jeden w sekcji Foldery.';
    dropFoldersChips.appendChild(hint);
    return;
  }
  for(const f of avail){
    const chip = document.createElement('div'); chip.className='drop-chip'; chip.textContent = '📁 '+f.name;
    chip.dataset.folderId = f.id;
    dropFoldersChips.appendChild(chip);
  }
}

function attachDragHandlers(el, note){
  const handle = el.querySelector('.drag-handle');
  if(!handle) return;
  let startX=0, startY=0, ghost=null, started=false;

  const onMove = (ev)=>{
    if(!dragState) return;
    ev.preventDefault();
    const dx = Math.abs(ev.clientX-startX), dy = Math.abs(ev.clientY-startY);
    if(!started && (dx>6 || dy>6)){
      started = true;
      ghost = document.createElement('div'); ghost.className='drag-ghost';
      ghost.textContent = note.title || '(brak tytułu)';
      document.body.appendChild(ghost);
      renderDropFolderChips(note.folderIds||[]);
      dropFoldersBar.classList.remove('hidden');
      el.classList.add('dragging');
    }
    if(started && ghost){
      ghost.style.left = ev.clientX+'px'; ghost.style.top = ev.clientY+'px';
      const chips = dropFoldersChips.querySelectorAll('.drop-chip');
      chips.forEach(c=>{
        const r = c.getBoundingClientRect();
        const hover = ev.clientX>=r.left && ev.clientX<=r.right && ev.clientY>=r.top && ev.clientY<=r.bottom;
        c.classList.toggle('hover', hover);
      });
    }
  };
  const onUp = async (ev)=>{
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if(started){
      const hovered = dropFoldersChips.querySelector('.drop-chip.hover');
      if(hovered){
        const folderId = hovered.dataset.folderId;
        note.folderIds = note.folderIds || [];
        if(!note.folderIds.includes(folderId)){
          note.folderIds.push(folderId);
          await saveNote(note);
          await refreshViews(); await refreshFolders();
          const f = folders.find(x=>x.id===folderId);
          showToast(`Dodano do folderu „${f?f.name:''}”`);
        }
      }
      el.classList.remove('dragging');
      if(ghost) ghost.remove();
      dropFoldersBar.classList.add('hidden');
    }
    dragState = null; started = false; ghost = null;
  };

  handle.addEventListener('pointerdown', (ev)=>{
    ev.stopPropagation();
    dragState = note.id; startX = ev.clientX; startY = ev.clientY; started = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// --- Automatyczna kopia zapasowa (localStorage) ---
function updateBackupInfoText(){
  const ts = localStorage.getItem('gg-auto-backup-time');
  if(!ts){ backupInfo.textContent = 'Auto-kopia: brak jeszcze'; return; }
  const d = new Date(parseInt(ts,10));
  backupInfo.textContent = 'Auto-kopia: ' + d.toLocaleString('pl-PL', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

async function performAutoBackup(){
  try{
    const payload = await buildExportPayload();
    localStorage.setItem('gg-auto-backup', JSON.stringify(payload));
    localStorage.setItem('gg-auto-backup-time', String(Date.now()));
    updateBackupInfoText();
  }catch(e){ /* np. brak miejsca w localStorage - pomiń cicho */ }
}

function scheduleAutoBackup(){
  if(autoBackupTimer) clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(()=> performAutoBackup(), 2500);
}

async function maybeRestoreAutoBackup(){
  if(notes.length>0) return;
  const raw = localStorage.getItem('gg-auto-backup');
  if(!raw) return;
  try{
    const payload = JSON.parse(raw);
    const hasData = (payload.notes && payload.notes.length) || (payload.folders && payload.folders.length);
    if(!hasData) return;
    if(confirm('Znaleziono lokalną kopię zapasową notatek. Przywrócić ją?')){
      for(const f of (payload.folders||[])) await saveFolder(f);
      for(const n of (payload.notes||[])) await saveNote(n);
    }
  }catch(e){ /* nieprawidłowa kopia - pomiń */ }
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
  initDrawCanvasEvents();
  notes = await getAllNotes();
  folders = await getAllFolders();
  await maybeRestoreAutoBackup();
  notes = await getAllNotes();
  folders = await getAllFolders();
  if(notes.length===0){
    await saveNote({id:'n_welcome', title:'Witaj w GG Notes', body:'To jest Twoja pierwsza notatka. Edytuj ją, dodaj nagranie głosowe 🎤, zdjęcie 📷 lub przypnij ⭐ ważne notatki.', pinned:true, audio:null, audioMime:null, photos:[], locked:false});
    notes = await getAllNotes();
  }
  renderList();
  updateBackupInfoText();
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
importFile.addEventListener('change', async (e)=>{ if(e.target.files[0]) await importNotes(e.target.files[0]); await refreshViews(); await refreshFolders(); closeMenu(); });
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

// Udostępnianie / PIN / kopia zapasowa
shareBtn.addEventListener('click', shareNote);
shareAppBtn.addEventListener('click', shareApp);
lockBtn.addEventListener('click', toggleLockForCurrentNote);
pinSettingsBtn.addEventListener('click', ()=>{ closeMenu(); openPinModal('setup'); });
pinCancelBtn.addEventListener('click', ()=> closePinModal(false));
pinModalBackdrop.addEventListener('click', ()=> closePinModal(false));
pinSubmitBtn.addEventListener('click', handlePinSubmit);
pinInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') handlePinSubmit(); });
pinConfirmInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') handlePinSubmit(); });
pinBiometricBtn.addEventListener('click', handlePinBiometric);
pinRegisterBioBtn.addEventListener('click', handlePinRegisterBio);

// Zdjęcia
photoBtn.addEventListener('click', ()=> photoFile.click());
photoFile.addEventListener('change', async (e)=>{ await handlePhotoFiles(e.target.files); photoFile.value=''; });
photoViewerCloseBtn.addEventListener('click', closePhotoViewer);
photoViewer.addEventListener('click', (e)=>{ if(e.target===photoViewer) closePhotoViewer(); });

// Rysowanie odręczne
drawMenuBtn.addEventListener('click', quickDrawNote);
drawAttachBtn.addEventListener('click', attachDrawFromEditor);
drawCloseBtn.addEventListener('click', closeDrawScreen);
drawUndoBtn.addEventListener('click', drawUndo);
drawClearBtn.addEventListener('click', drawClear);
drawSaveBtn.addEventListener('click', saveDrawing);
drawColors.addEventListener('click', (e)=>{
  const btn = e.target.closest('.draw-color'); if(!btn) return;
  drawColors.querySelectorAll('.draw-color').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); drawColor = btn.dataset.color;
});
drawSizes.addEventListener('click', (e)=>{
  const btn = e.target.closest('.draw-size'); if(!btn) return;
  drawSizes.querySelectorAll('.draw-size').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); drawSize = parseInt(btn.dataset.size, 10);
});

window.addEventListener('load', ()=>init());
