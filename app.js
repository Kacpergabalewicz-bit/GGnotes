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
  if(!note.tags) note.tags = [];
  if(typeof note.color === 'undefined') note.color = null;
  if(!note.checklist) note.checklist = [];
  if(typeof note.reminderAt === 'undefined') note.reminderAt = null;
  if(typeof note.reminderFired !== 'boolean') note.reminderFired = false;
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
  // Zdjęcia i rysunki są teraz częścią treści notatki (inline <img> w polu body),
  // więc eksport zachowuje je w pełni. Jedynie nagrania głosowe (Blob) nie są eksportowane do JSON.
  const plainNotes = notes.map(({id,title,body,pinned,createdAt,updatedAt,folderIds,locked,tags,color,checklist,deletedAt,reminderAt,reminderFired})=>({id,title,body,pinned,createdAt,updatedAt,folderIds,locked,tags,color,checklist,deletedAt,reminderAt,reminderFired}));
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

let stripHtmlScratch = null;
function stripHtml(html){
  if(!html) return '';
  if(!stripHtmlScratch) stripHtmlScratch = document.createElement('div');
  stripHtmlScratch.innerHTML = html;
  return stripHtmlScratch.textContent || '';
}
function hasInlineImage(html){
  return !!html && /<img[\s>]/i.test(html);
}

function toDatetimeLocalValue(ts){
  const d = new Date(ts);
  const pad = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatReminder(ts){
  const d = new Date(ts); const now = new Date();
  const sameYear = d.getFullYear()===now.getFullYear();
  return d.toLocaleString('pl-PL', { day:'2-digit', month:'2-digit', year: sameYear?undefined:'numeric', hour:'2-digit', minute:'2-digit' });
}

function activeNotes(list){
  return (list || notes).filter(n=>!n.deletedAt);
}
function getAllTags(){
  const set = new Set();
  for(const n of activeNotes()){ (n.tags||[]).forEach(t=>set.add(t)); }
  return Array.from(set).sort((a,b)=>a.localeCompare(b,'pl'));
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

// Kosz / zaznaczanie wielu / sortowanie / filtr tagów
const trashMenuBtn = document.getElementById('trashMenuBtn');
const selectMenuBtn = document.getElementById('selectMenuBtn');
const sortBtn = document.getElementById('sortBtn');
const tagFilterBar = document.getElementById('tagFilterBar');
const tagFilterChips = document.getElementById('tagFilterChips');
const trashScreen = document.getElementById('trashScreen');
const trashBackBtn = document.getElementById('trashBackBtn');
const emptyTrashBtn = document.getElementById('emptyTrashBtn');
const trashPane = document.getElementById('trashPane');
const selectionBar = document.getElementById('selectionBar');
const selectionCount = document.getElementById('selectionCount');
const selectionMoveBtn = document.getElementById('selectionMoveBtn');
const selectionDeleteBtn = document.getElementById('selectionDeleteBtn');
const selectionCancelBtn = document.getElementById('selectionCancelBtn');
const bulkFolderBackdrop = document.getElementById('bulkFolderBackdrop');
const bulkFolderSheet = document.getElementById('bulkFolderSheet');
const bulkFolderList = document.getElementById('bulkFolderList');
const bulkFolderCancelBtn = document.getElementById('bulkFolderCancelBtn');

// Edytor: kolor notatki / tagi / lista zadań
const noteColorRow = document.getElementById('noteColorRow');
const checklistToggleBtn = document.getElementById('checklistToggleBtn');
const noteTagChips = document.getElementById('noteTagChips');
const addTagBtn = document.getElementById('addTagBtn');
const tagInput = document.getElementById('tagInput');
const checklistWrap = document.getElementById('checklistWrap');
const checklistItems = document.getElementById('checklistItems');
const checklistNewInput = document.getElementById('checklistNewInput');
const checklistAddBtn = document.getElementById('checklistAddBtn');
const reminderToggleBtn = document.getElementById('reminderToggleBtn');
const reminderRow = document.getElementById('reminderRow');
const reminderInput = document.getElementById('reminderInput');
const reminderSetBtn = document.getElementById('reminderSetBtn');
const reminderClearBtn = document.getElementById('reminderClearBtn');

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
let pinResolve = null;
let pinMode = 'verify';
let drawCtx = null;
let drawColor = '#1c1c1e';
let drawSize = 3;
let drawUndoStack = [];
let drawIsNewNote = false;
let isDrawingStroke = false;
let autoBackupTimer = null;
let dragState = null;
let sortMode = localStorage.getItem('gg-sort-mode') || 'new';
let activeTagFilter = null;
let selectionMode = false;
let selectedNoteIds = new Set();
let checklistVisible = false;
let checklistSaveTimeout = null;

function buildEmptyHint(text){
  const d = document.createElement('div'); d.className = 'empty-hint'; d.textContent = text;
  return d;
}

function buildNoteItemEl(n, onOpen){
  const el = document.createElement('div'); el.className = 'note-item';
  if(currentNote && n.id===currentNote.id) el.classList.add('active');
  if(n.locked) el.classList.add('locked');
  if(n.color){ el.classList.add('has-color'); el.style.setProperty('--note-accent', n.color); }

  let leading;
  if(selectionMode){
    leading = document.createElement('div');
    leading.className = 'pick-check' + (selectedNoteIds.has(n.id) ? ' selected' : '');
    leading.textContent = selectedNoteIds.has(n.id) ? '✓' : '';
  } else {
    leading = document.createElement('div'); leading.className = 'drag-handle'; leading.textContent = '⠿';
  }

  const main = document.createElement('div'); main.className = 'note-main';
  const t = document.createElement('div'); t.className='note-title'; t.textContent = n.title||'(brak tytułu)';
  const b = document.createElement('div'); b.className='note-body';
  b.textContent = n.locked ? '🔒 Notatka zablokowana' : stripHtml(n.body).slice(0,120);
  const meta = document.createElement('div'); meta.className='note-meta';
  meta.textContent = formatWhen(n.createdAt || n.updatedAt);
  if(n.audio){ const mic = document.createElement('span'); mic.textContent = ' 🎤'; meta.appendChild(mic); }
  if(hasInlineImage(n.body)){ const ph = document.createElement('span'); ph.textContent = ' 📷'; meta.appendChild(ph); }
  if(n.checklist && n.checklist.length){
    const done = n.checklist.filter(i=>i.checked).length;
    const cl = document.createElement('span'); cl.textContent = ` ☑️ ${done}/${n.checklist.length}`; meta.appendChild(cl);
  }
  if(n.reminderAt){
    const rem = document.createElement('span');
    rem.className = 'note-reminder-badge' + (n.reminderAt <= Date.now() ? ' overdue' : '');
    rem.textContent = ` 🔔 ${formatReminder(n.reminderAt)}`;
    meta.appendChild(rem);
  }
  if(n.locked){ const lk = document.createElement('span'); lk.className='note-lock-badge'; lk.textContent = ' 🔒'; meta.appendChild(lk); }
  main.appendChild(t); main.appendChild(b); main.appendChild(meta);

  if(n.tags && n.tags.length){
    const tagsRow = document.createElement('div'); tagsRow.className = 'note-tags-preview';
    for(const tag of n.tags.slice(0,3)){
      const pill = document.createElement('span'); pill.className='note-tag-pill'; pill.textContent = tag;
      tagsRow.appendChild(pill);
    }
    main.appendChild(tagsRow);
  }

  el.appendChild(leading);
  if(!selectionMode){
    const star = document.createElement('button');
    star.className = 'pin-star'; star.type = 'button';
    star.textContent = n.pinned ? '★' : '☆';
    star.setAttribute('aria-label', n.pinned ? 'Odepnij notatkę' : 'Przypnij notatkę');
    star.onclick = (ev)=>{ ev.stopPropagation(); togglePinForNote(n); };
    el.appendChild(star);
  }
  el.appendChild(main);

  if(selectionMode){
    el.onclick = ()=> toggleNoteSelection(n.id);
  } else {
    el.onclick = ()=> onOpen(n);
    attachDragHandlers(el, n);
  }
  return el;
}

function sortNotesForDisplay(list){
  const pinned = list.filter(n=>n.pinned);
  const rest = list.filter(n=>!n.pinned);
  const cmp = sortMode==='title'
    ? (a,b)=> (a.title||'').localeCompare(b.title||'', 'pl')
    : sortMode==='old'
      ? (a,b)=> (a.updatedAt||0)-(b.updatedAt||0)
      : (a,b)=> (b.updatedAt||0)-(a.updatedAt||0);
  pinned.sort(cmp); rest.sort(cmp);
  return pinned.concat(rest);
}

function renderList(filter=''){
  listPane.innerHTML = '';
  const f = filter.toLowerCase();
  let source = activeNotes();
  if(showingFavorites) source = source.filter(n=>n.pinned);
  if(activeTagFilter) source = source.filter(n=> (n.tags||[]).includes(activeTagFilter));
  source = sortNotesForDisplay(source);
  let any = false;
  for(const n of source){
    if(f && !( (n.title||'').toLowerCase().includes(f) || stripHtml(n.body).toLowerCase().includes(f) )) continue;
    any = true;
    listPane.appendChild(buildNoteItemEl(n, ()=> openNote(n.id)));
  }
  if(!any){
    if(f) listPane.appendChild(buildEmptyHint('Brak wyników wyszukiwania.'));
    else if(showingFavorites) listPane.appendChild(buildEmptyHint('Brak ulubionych notatek. Stuknij ☆ przy notatce, aby dodać ją tutaj.'));
    else if(activeTagFilter) listPane.appendChild(buildEmptyHint('Brak notatek z tagiem „'+activeTagFilter+'”.'));
  }
}

async function refreshViews(){
  notes = await getAllNotes();
  renderTagFilterBar();
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
    const count = activeNotes().filter(n=>(n.folderIds||[]).includes(folder.id)).length;
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
  const items = activeNotes().filter(n=> (n.folderIds||[]).includes(folder.id));
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
  for(const n of activeNotes()){
    if(f && !( (n.title||'').toLowerCase().includes(f) || stripHtml(n.body).toLowerCase().includes(f) )) continue;
    any = true;
    const already = (n.folderIds||[]).includes(currentFolder.id);
    const selected = pickerSelected.has(n.id);
    const el = document.createElement('div');
    el.className = 'note-item pickable' + (already ? ' already' : '') + (selected ? ' selected' : '');

    const check = document.createElement('div'); check.className = 'pick-check';
    check.textContent = (already || selected) ? '✓' : '';

    const main = document.createElement('div'); main.className = 'note-main';
    const t = document.createElement('div'); t.className='note-title'; t.textContent = n.title||'(brak tytułu)';
    const b = document.createElement('div'); b.className='note-body'; b.textContent = stripHtml(n.body).slice(0,120);
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

// --- Filtr tagów na liście notatek ---
function renderTagFilterBar(){
  const tags = getAllTags();
  if(tags.length===0){
    tagFilterBar.classList.remove('visible');
    activeTagFilter = null;
    return;
  }
  tagFilterBar.classList.add('visible');
  tagFilterChips.innerHTML = '';
  for(const tag of tags){
    const chip = document.createElement('button'); chip.type='button';
    chip.className = 'tag-chip' + (activeTagFilter===tag ? ' active' : '');
    chip.textContent = tag;
    chip.onclick = ()=>{
      activeTagFilter = (activeTagFilter===tag) ? null : tag;
      renderTagFilterBar();
      renderList(searchEl.value);
    };
    tagFilterChips.appendChild(chip);
  }
}

// --- Sortowanie listy notatek ---
const SORT_LABELS = { new:'Najnowsze', old:'Najstarsze', title:'Tytuł A-Z' };
function updateSortBtnLabel(){
  sortBtn.textContent = 'Sortuj: ' + SORT_LABELS[sortMode];
}
function cycleSortMode(){
  const order = ['new','old','title'];
  const idx = order.indexOf(sortMode);
  sortMode = order[(idx+1)%order.length];
  localStorage.setItem('gg-sort-mode', sortMode);
  updateSortBtnLabel();
  renderList(searchEl.value);
  showToast('Sortowanie: ' + SORT_LABELS[sortMode]);
}

// --- Zaznaczanie wielu notatek naraz ---
function updateSelectionBar(){
  selectionCount.textContent = 'Wybrano: ' + selectedNoteIds.size;
}
function enterSelectionMode(){
  closeMenu();
  selectionMode = true;
  selectedNoteIds.clear();
  selectionBar.classList.remove('hidden');
  updateSelectionBar();
  renderList(searchEl.value);
}
function exitSelectionMode(){
  selectionMode = false;
  selectedNoteIds.clear();
  selectionBar.classList.add('hidden');
  renderList(searchEl.value);
}
function toggleNoteSelection(id){
  if(selectedNoteIds.has(id)) selectedNoteIds.delete(id); else selectedNoteIds.add(id);
  updateSelectionBar();
  renderList(searchEl.value);
}
async function bulkDeleteSelected(){
  if(selectedNoteIds.size===0){ showToast('Zaznacz przynajmniej jedną notatkę'); return; }
  if(!confirm(`Przenieść ${selectedNoteIds.size} notatek do kosza?`)) return;
  for(const id of selectedNoteIds){
    const n = notes.find(x=>x.id===id);
    if(n){ n.deletedAt = Date.now(); await saveNote(n); }
  }
  exitSelectionMode();
  await refreshViews(); await refreshFolders();
  showToast('Przeniesiono do kosza');
}
function renderBulkFolderList(){
  bulkFolderList.innerHTML = '';
  if(folders.length===0){
    bulkFolderList.appendChild(buildEmptyHint('Brak folderów. Utwórz jeden w sekcji Foldery.'));
    return;
  }
  for(const f of folders){
    const row = document.createElement('div'); row.className='bulk-folder-row';
    const icon = document.createElement('span'); icon.textContent = '📁';
    const label = document.createElement('span'); label.textContent = f.name;
    row.appendChild(icon); row.appendChild(label);
    row.onclick = async ()=>{
      for(const id of selectedNoteIds){
        const n = notes.find(x=>x.id===id);
        if(!n) continue;
        n.folderIds = n.folderIds || [];
        if(!n.folderIds.includes(f.id)) n.folderIds.push(f.id);
        await saveNote(n);
      }
      closeBulkFolderSheet();
      exitSelectionMode();
      await refreshViews(); await refreshFolders();
      showToast(`Przeniesiono do folderu „${f.name}”`);
    };
    bulkFolderList.appendChild(row);
  }
}
function openBulkFolderSheet(){
  if(selectedNoteIds.size===0){ showToast('Zaznacz przynajmniej jedną notatkę'); return; }
  renderBulkFolderList();
  bulkFolderBackdrop.classList.remove('hidden');
  requestAnimationFrame(()=> bulkFolderSheet.classList.add('open'));
}
function closeBulkFolderSheet(){
  bulkFolderSheet.classList.remove('open');
  setTimeout(()=> bulkFolderBackdrop.classList.add('hidden'), 220);
}

// --- Kosz (kosz na notatki, cofnij usunięcie) ---
function buildTrashItemEl(n){
  const el = document.createElement('div'); el.className = 'trash-item';
  const main = document.createElement('div'); main.className = 'note-main';
  const t = document.createElement('div'); t.className='note-title'; t.textContent = n.title||'(brak tytułu)';
  const b = document.createElement('div'); b.className='note-body'; b.textContent = stripHtml(n.body).slice(0,100);
  const meta = document.createElement('div'); meta.className='note-meta';
  const daysLeft = Math.max(0, 30 - Math.floor((Date.now()-n.deletedAt)/86400000));
  meta.textContent = `Usunięto: ${formatWhen(n.deletedAt)} · zniknie za ${daysLeft} dni`;
  main.appendChild(t); main.appendChild(b); main.appendChild(meta);

  const actions = document.createElement('div'); actions.className = 'trash-actions';
  const restoreBtn = document.createElement('button'); restoreBtn.type='button'; restoreBtn.textContent='Przywróć';
  restoreBtn.onclick = async ()=>{
    n.deletedAt = null;
    await saveNote(n);
    await refreshViews(); await refreshFolders();
    renderTrashList();
    showToast('Przywrócono notatkę');
  };
  const delBtn = document.createElement('button'); delBtn.type='button'; delBtn.className='danger-btn'; delBtn.textContent='Usuń na zawsze';
  delBtn.onclick = async ()=>{
    if(!confirm('Usunąć trwale? Tej operacji nie można cofnąć.')) return;
    await deleteNote(n.id);
    notes = notes.filter(x=>x.id!==n.id);
    renderTrashList();
    showToast('Usunięto trwale');
  };
  actions.appendChild(restoreBtn); actions.appendChild(delBtn);

  el.appendChild(main); el.appendChild(actions);
  return el;
}
function renderTrashList(){
  trashPane.innerHTML = '';
  const items = notes.filter(n=>n.deletedAt).sort((a,b)=> b.deletedAt-a.deletedAt);
  if(items.length===0){
    trashPane.appendChild(buildEmptyHint('Kosz jest pusty.'));
    return;
  }
  for(const n of items){ trashPane.appendChild(buildTrashItemEl(n)); }
}
function openTrash(){
  closeMenu();
  renderTrashList();
  trashScreen.classList.add('show');
}
function closeTrash(){ trashScreen.classList.remove('show'); }
async function emptyTrash(){
  const items = notes.filter(n=>n.deletedAt);
  if(items.length===0){ showToast('Kosz jest już pusty'); return; }
  if(!confirm(`Trwale usunąć ${items.length} notatek z kosza?`)) return;
  for(const n of items){ await deleteNote(n.id); }
  notes = notes.filter(n=>!n.deletedAt);
  renderTrashList();
  showToast('Kosz opróżniony');
}
async function purgeOldTrash(){
  const THIRTY_DAYS = 30*24*60*60*1000;
  const stale = notes.filter(n=> n.deletedAt && (Date.now()-n.deletedAt > THIRTY_DAYS));
  for(const n of stale){ await deleteNote(n.id); }
  if(stale.length>0) notes = await getAllNotes();
}

// --- Edytor: kolor notatki ---
function renderColorSwatches(){
  const swatches = noteColorRow.querySelectorAll('.note-color-swatch');
  const current = currentNote?.color || '';
  swatches.forEach(sw=>{
    sw.classList.toggle('active', (sw.dataset.color||'') === current);
  });
}
async function setNoteColor(color){
  if(!currentNote) return;
  currentNote.color = color || null;
  renderColorSwatches();
  await doSaveActive();
}

// --- Edytor: etykiety (tagi) ---
function renderNoteTagsEditor(){
  noteTagChips.innerHTML = '';
  const tags = (currentNote && currentNote.tags) || [];
  for(const tag of tags){
    const chip = document.createElement('span'); chip.className = 'tag-chip-editable';
    const label = document.createElement('span'); label.textContent = tag;
    const rm = document.createElement('button'); rm.type='button'; rm.textContent='✕'; rm.setAttribute('aria-label','Usuń tag');
    rm.onclick = async ()=>{
      currentNote.tags = currentNote.tags.filter(t=>t!==tag);
      renderNoteTagsEditor();
      await doSaveActive();
      renderTagFilterBar();
    };
    chip.appendChild(label); chip.appendChild(rm);
    noteTagChips.appendChild(chip);
  }
}
function openTagInput(){
  tagInput.classList.remove('hidden');
  tagInput.value = '';
  tagInput.focus();
}
function closeTagInput(){
  tagInput.classList.add('hidden');
}
async function commitTagInput(){
  if(tagInput.classList.contains('hidden')) return;
  const val = tagInput.value.trim().toLowerCase();
  closeTagInput();
  if(!val || !currentNote) return;
  currentNote.tags = currentNote.tags || [];
  if(!currentNote.tags.includes(val)) currentNote.tags.push(val);
  renderNoteTagsEditor();
  await doSaveActive();
  renderTagFilterBar();
}

// --- Edytor: lista zadań (checklista) ---
function renderChecklist(){
  checklistItems.innerHTML = '';
  const items = (currentNote && currentNote.checklist) || [];
  for(const item of items){
    const row = document.createElement('div'); row.className = 'checklist-item';
    const check = document.createElement('button'); check.type='button';
    check.className = 'checklist-check' + (item.checked ? ' checked' : '');
    check.textContent = item.checked ? '✓' : '';
    check.setAttribute('aria-label', item.checked ? 'Odznacz zadanie' : 'Zaznacz zadanie');
    check.onclick = ()=>{
      item.checked = !item.checked;
      saveChecklistDebounced();
      renderChecklist();
    };
    const text = document.createElement('input');
    text.className = 'checklist-text' + (item.checked ? ' checked' : '');
    text.value = item.text || '';
    text.addEventListener('input', ()=>{ item.text = text.value; saveChecklistDebounced(); });
    const rm = document.createElement('button'); rm.type='button'; rm.className='checklist-remove'; rm.textContent='✕';
    rm.setAttribute('aria-label','Usuń zadanie');
    rm.onclick = ()=>{
      currentNote.checklist = currentNote.checklist.filter(x=>x.id!==item.id);
      saveChecklistDebounced();
      renderChecklist();
    };
    row.appendChild(check); row.appendChild(text); row.appendChild(rm);
    checklistItems.appendChild(row);
  }
}
function saveChecklistDebounced(){
  if(!currentNote) return;
  if(checklistSaveTimeout) clearTimeout(checklistSaveTimeout);
  checklistSaveTimeout = setTimeout(async ()=>{
    await saveNote(currentNote);
    await refreshViews();
  }, 400);
}
function setChecklistVisible(visible){
  checklistVisible = visible;
  checklistWrap.classList.toggle('hidden', !visible);
}
function toggleChecklist(){
  if(!currentNote) return;
  if(checklistVisible){ setChecklistVisible(false); return; }
  if(!currentNote.checklist) currentNote.checklist = [];
  setChecklistVisible(true);
  renderChecklist();
  setTimeout(()=> checklistNewInput.focus(), 200);
}
function addChecklistItem(){
  if(!currentNote) return;
  const text = checklistNewInput.value.trim();
  if(!text) return;
  currentNote.checklist = currentNote.checklist || [];
  currentNote.checklist.push({ id:'c_'+Date.now()+Math.random(), text, checked:false });
  checklistNewInput.value = '';
  saveChecklistDebounced();
  renderChecklist();
  checklistNewInput.focus();
}

// --- Edytor: przypomnienie ---
function updateReminderBtnLabel(){
  if(currentNote && currentNote.reminderAt){
    reminderToggleBtn.textContent = '🔔 ' + formatReminder(currentNote.reminderAt);
    reminderToggleBtn.classList.add('active');
  } else {
    reminderToggleBtn.textContent = '🔔';
    reminderToggleBtn.classList.remove('active');
  }
}
function openReminderRow(){
  reminderRow.classList.remove('hidden');
  if(currentNote && currentNote.reminderAt){
    reminderInput.value = toDatetimeLocalValue(currentNote.reminderAt);
    reminderClearBtn.classList.remove('hidden');
  } else {
    reminderInput.value = '';
    reminderClearBtn.classList.add('hidden');
  }
}
function closeReminderRow(){
  reminderRow.classList.add('hidden');
}
function toggleReminderRow(){
  if(!currentNote) return;
  if(reminderRow.classList.contains('hidden')) openReminderRow(); else closeReminderRow();
}
async function requestNotificationPermission(){
  if(!('Notification' in window)) return;
  if(Notification.permission === 'default'){
    try{ await Notification.requestPermission(); }catch(e){}
  }
}
async function commitReminder(){
  if(!currentNote) return;
  const val = reminderInput.value;
  if(!val){ showToast('Wybierz datę i godzinę'); return; }
  const ts = new Date(val).getTime();
  if(isNaN(ts)){ showToast('Nieprawidłowa data'); return; }
  currentNote.reminderAt = ts;
  currentNote.reminderFired = false;
  await requestNotificationPermission();
  await saveNote(currentNote);
  updateReminderBtnLabel();
  closeReminderRow();
  await refreshViews();
  showToast('Przypomnienie ustawione: ' + formatReminder(ts));
}
async function clearReminder(){
  if(!currentNote) return;
  currentNote.reminderAt = null;
  currentNote.reminderFired = false;
  await saveNote(currentNote);
  updateReminderBtnLabel();
  closeReminderRow();
  await refreshViews();
  showToast('Usunięto przypomnienie');
}
function fireReminderNotification(n){
  const title = n.title || 'Przypomnienie';
  const body = stripHtml(n.body).slice(0,120) || 'Masz przypomnienie w GG Notes';
  if('Notification' in window && Notification.permission === 'granted'){
    try{ new Notification(title, { body, icon: '/icon.svg' }); }catch(e){}
  }
  showToast('🔔 Przypomnienie: ' + title);
}
async function checkReminders(){
  const all = await getAllNotes();
  const now = Date.now();
  let firedAny = false;
  for(const n of all){
    if(n.deletedAt) continue;
    if(n.reminderAt && !n.reminderFired && n.reminderAt <= now){
      n.reminderFired = true;
      await saveNote(n);
      firedAny = true;
      fireReminderNotification(n);
    }
  }
  if(firedAny){
    notes = await getAllNotes();
    renderList(searchEl.value);
    if(currentNote){
      const updated = notes.find(x=>x.id===currentNote.id);
      if(updated){ currentNote = updated; updateReminderBtnLabel(); }
    }
  }
}

function bindAutosave(){
  titleEl.addEventListener('input', ()=>{
    if(!currentNote) return;
    currentNote.title = titleEl.value;
    if(saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(()=>doSaveActive(), 400);
  });
  bodyEl.addEventListener('input', ()=>{
    if(!currentNote) return;
    if(bodyEl.innerHTML === '<br>') bodyEl.innerHTML = '';
    currentNote.body = bodyEl.innerHTML;
    if(saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(()=>doSaveActive(), 400);
  });
  bodyEl.addEventListener('paste', (e)=>{
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    insertPlainTextAtSelection(text);
    currentNote && (currentNote.body = bodyEl.innerHTML);
    if(saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(()=>doSaveActive(), 400);
  });
  bodyEl.addEventListener('click', (e)=>{
    const img = e.target.closest('img.note-inline-img');
    if(img) openPhotoViewer(img.src);
  });
}

function insertPlainTextAtSelection(text){
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0 || !bodyEl.contains(sel.anchorNode)){
    bodyEl.appendChild(document.createTextNode(text));
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node); range.setEndAfter(node);
  sel.removeAllRanges(); sel.addRange(range);
}

async function doSaveActive(){
  if(!currentNote) return;
  currentNote.title = titleEl.value; currentNote.body = bodyEl.innerHTML;
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
  titleEl.value = n.title||'';
  bodyEl.innerHTML = n.body||'';
  savedRange = null;
  await migrateLegacyPhotos(n);
  updatePinBtn(); updateLockBtn(); updateAudioUI(); recordStatus.textContent = '';
  renderColorSwatches();
  renderNoteTagsEditor(); closeTagInput();
  checklistVisible = !!(n.checklist && n.checklist.length>0);
  setChecklistVisible(checklistVisible);
  if(checklistVisible) renderChecklist();
  updateReminderBtnLabel(); closeReminderRow();
  renderList(searchEl.value);
  showEditorScreen();
}

async function newNote(folderId){
  const n = { title:'', body:'', pinned:false, audio:null, audioMime:null, photos:[], locked:false, tags:[], color:null, checklist:[], reminderAt:null, reminderFired:false, folderIds: folderId ? [folderId] : [], id: 'n_'+Date.now() };
  await saveNote(n);
  await refreshViews();
  currentNote = n; titleEl.value=''; bodyEl.innerHTML='';
  savedRange = null;
  updatePinBtn(); updateLockBtn(); updateAudioUI(); recordStatus.textContent='';
  renderColorSwatches();
  renderNoteTagsEditor(); closeTagInput();
  setChecklistVisible(false);
  updateReminderBtnLabel(); closeReminderRow();
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
  if(!confirm('Przenieść notatkę do kosza?')) return;
  currentNote.deletedAt = Date.now();
  await saveNote(currentNote);
  currentNote = null;
  await refreshViews(); await refreshFolders();
  showListScreen();
  showToast('Przeniesiono do kosza');
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

// --- Zdjęcia w notatkach: wstawiane bezpośrednio w treść (inline <img>) ---
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
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = (e)=>{ URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Zapamiętuje pozycję kursora w treści notatki, zanim otworzymy okno wyboru
// zdjęcia lub ekran rysowania (te akcje odbierają focus edytorowi).
let savedRange = null;
function saveCursorRange(){
  const sel = window.getSelection();
  if(sel && sel.rangeCount>0 && bodyEl.contains(sel.anchorNode)){
    savedRange = sel.getRangeAt(0).cloneRange();
  } else {
    savedRange = null;
  }
}

function insertImageAtCursor(dataUrl){
  const img = document.createElement('img');
  img.className = 'note-inline-img';
  img.src = dataUrl;
  img.alt = 'Zdjęcie';

  const sel = window.getSelection();
  let range = savedRange;
  if(range && bodyEl.contains(range.startContainer)){
    sel.removeAllRanges(); sel.addRange(range);
  } else {
    range = document.createRange();
    range.selectNodeContents(bodyEl);
    range.collapse(false);
  }
  range.deleteContents();
  range.insertNode(img);
  const br = document.createElement('br');
  img.after(br);
  range.setStartAfter(br); range.setEndAfter(br);
  sel.removeAllRanges(); sel.addRange(range);
  savedRange = range.cloneRange();
}

async function commitBodyChangeNow(){
  if(!currentNote) return;
  if(saveTimeout){ clearTimeout(saveTimeout); saveTimeout = null; }
  currentNote.title = titleEl.value; currentNote.body = bodyEl.innerHTML;
  await saveNote(currentNote);
  await refreshViews();
}

async function blobToDataUrl(blob){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Migracja starych notatek: dawniej zdjęcia/rysunki trafiały do osobnej tablicy
// note.photos (Blob). Przy otwarciu takiej notatki dołączamy je jako inline <img>
// bezpośrednio do treści i czyścimy starą tablicę.
async function migrateLegacyPhotos(note){
  if(!note.photos || note.photos.length===0) return;
  for(const p of note.photos){
    try{
      const dataUrl = await blobToDataUrl(p.blob);
      const img = document.createElement('img');
      img.className = 'note-inline-img'; img.src = dataUrl; img.alt = 'Zdjęcie';
      bodyEl.appendChild(img);
      bodyEl.appendChild(document.createElement('br'));
    }catch(e){ /* pomiń uszkodzone zdjęcie */ }
  }
  note.photos = [];
  note.body = bodyEl.innerHTML;
  await saveNote(note);
}

async function handlePhotoFiles(fileList){
  if(!currentNote) return;
  const files = Array.from(fileList||[]);
  for(const file of files){
    try{
      const dataUrl = await resizeImageFile(file);
      insertImageAtCursor(dataUrl);
    }catch(e){ /* pomiń błędny plik */ }
  }
  await commitBodyChangeNow();
  showToast(files.length>1 ? 'Dodano zdjęcia' : 'Dodano zdjęcie');
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

function openDrawScreen(isNew){
  drawIsNewNote = !!isNew;
  drawUndoStack = [];
  drawScreen.classList.add('show');
  requestAnimationFrame(()=>{
    if(!drawCtx) drawCtx = drawCanvas.getContext('2d');
    resizeDrawCanvas();
  });
}
function closeDrawScreen(){
  drawScreen.classList.remove('show');
}

async function quickDrawNote(){
  closeMenu();
  await newNote();
  openDrawScreen(true);
}

function attachDrawFromEditor(){
  if(!currentNote) return;
  saveCursorRange();
  openDrawScreen(false);
}

async function saveDrawing(){
  const dataUrl = drawCanvas.toDataURL('image/png');
  if(!currentNote){ closeDrawScreen(); return; }
  insertImageAtCursor(dataUrl);
  await commitBodyChangeNow();
  closeDrawScreen();
  showToast('Rysunek dodany do notatki');
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
  await purgeOldTrash();
  if(activeNotes().length===0){
    await saveNote({id:'n_welcome', title:'Witaj w GG Notes', body:'To jest Twoja pierwsza notatka. Edytuj ją, dodaj nagranie głosowe 🎤, zdjęcie 📷 lub przypnij ⭐ ważne notatki.', pinned:true, audio:null, audioMime:null, photos:[], locked:false, tags:[], color:null, checklist:[], reminderAt:null, reminderFired:false});
    notes = await getAllNotes();
  }
  updateSortBtnLabel();
  renderTagFilterBar();
  renderList();
  updateBackupInfoText();
  bindAutosave();
  await checkReminders();
  setInterval(checkReminders, 30000);
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
photoBtn.addEventListener('click', ()=>{ saveCursorRange(); photoFile.click(); });
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

// Kosz
trashMenuBtn.addEventListener('click', openTrash);
trashBackBtn.addEventListener('click', closeTrash);
emptyTrashBtn.addEventListener('click', emptyTrash);

// Zaznaczanie wielu notatek
selectMenuBtn.addEventListener('click', enterSelectionMode);
selectionCancelBtn.addEventListener('click', exitSelectionMode);
selectionDeleteBtn.addEventListener('click', bulkDeleteSelected);
selectionMoveBtn.addEventListener('click', openBulkFolderSheet);
bulkFolderCancelBtn.addEventListener('click', closeBulkFolderSheet);
bulkFolderBackdrop.addEventListener('click', closeBulkFolderSheet);

// Sortowanie
sortBtn.addEventListener('click', cycleSortMode);

// Edytor: lista zadań (checklista)
checklistToggleBtn.addEventListener('click', toggleChecklist);
checklistAddBtn.addEventListener('click', addChecklistItem);
checklistNewInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); addChecklistItem(); } });

// Edytor: etykiety (tagi)
addTagBtn.addEventListener('click', openTagInput);
tagInput.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){ e.preventDefault(); commitTagInput(); }
  else if(e.key==='Escape'){ closeTagInput(); }
});
tagInput.addEventListener('blur', ()=>{ commitTagInput(); });

// Edytor: kolor notatki
noteColorRow.addEventListener('click', (e)=>{
  const btn = e.target.closest('.note-color-swatch'); if(!btn) return;
  setNoteColor(btn.dataset.color || null);
});

// Edytor: przypomnienie
reminderToggleBtn.addEventListener('click', toggleReminderRow);
reminderSetBtn.addEventListener('click', commitReminder);
reminderClearBtn.addEventListener('click', clearReminder);

window.addEventListener('load', ()=>init());
