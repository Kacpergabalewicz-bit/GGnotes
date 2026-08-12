// GG Notes - simple PWA using IndexedDB for persistence
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
  return notes.sort((a,b)=>b.updatedAt-a.updatedAt);
}

async function saveNote(note){
  note.updatedAt = Date.now();
  if(!note.id) note.id = 'n_'+Date.now();
  await withStore('readwrite', store=>store.put(note));
  return note;
}

async function deleteNote(id){
  await withStore('readwrite', store=>store.delete(id));
}

async function exportNotes(){
  const notes = await getAllNotes();
  const blob = new Blob([JSON.stringify(notes, null, 2)], {type:'application/json'});
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

// UI
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

let notes = [];
let activeId = null;
let saveTimeout = null;

function renderList(filter=''){
  listPane.innerHTML = '';
  const f = filter.toLowerCase();
  for(const n of notes){
    if(f && !( (n.title||'').toLowerCase().includes(f) || (n.body||'').toLowerCase().includes(f) )) continue;
    const el = document.createElement('div'); el.className = 'note-item';
    if(n.id===activeId) el.classList.add('active');
    const t = document.createElement('div'); t.className='note-title'; t.textContent = n.title||'(brak tytułu)';
    const b = document.createElement('div'); b.className='note-body'; b.textContent = (n.body||'').slice(0,120);
    el.appendChild(t); el.appendChild(b);
    el.onclick = ()=>{ openNote(n.id); };
    listPane.appendChild(el);
  }
}

function bindAutosave(){
  [titleEl, bodyEl].forEach(el=>el.addEventListener('input', ()=>{
    if(saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(()=>doSaveActive(), 700);
  }));
}

async function doSaveActive(){
  if(!activeId) return;
  const note = { id: activeId, title: titleEl.value, body: bodyEl.value };
  await saveNote(note);
  notes = await getAllNotes(); renderList(searchEl.value);
}

async function openNote(id){
  const n = notes.find(x=>x.id===id); if(!n) return;
  activeId = n.id; titleEl.value = n.title||''; bodyEl.value = n.body||''; renderList(searchEl.value);
}

async function newNote(){
  const n = { title:'', body:'', id: 'n_'+Date.now() };
  await saveNote(n); notes = await getAllNotes(); activeId = n.id; renderList(); openNote(n.id);
}

async function removeActive(){
  if(!activeId) return;
  if(!confirm('Na pewno usunąć notatkę?')) return;
  await deleteNote(activeId); notes = await getAllNotes(); activeId = notes[0]?.id || null; renderList(searchEl.value);
  if(activeId) openNote(activeId); else { titleEl.value=''; bodyEl.value=''; }
}

async function init(){
  notes = await getAllNotes();
  if(notes.length===0){ await saveNote({id:'n_welcome',title:'Witaj w GG Notes',body:'To jest Twoja pierwsza notatka. Edytuj ją.'}); notes = await getAllNotes(); }
  activeId = notes[0].id;
  renderList(); openNote(activeId);
  bindAutosave();
}

searchEl.addEventListener('input', ()=>renderList(searchEl.value));
newBtn.addEventListener('click', newNote);
saveBtn.addEventListener('click', doSaveActive);
deleteBtn.addEventListener('click', removeActive);
exportBtn.addEventListener('click', exportNotes);
importBtn.addEventListener('click', ()=>importFile.click());
importFile.addEventListener('change', async (e)=>{ if(e.target.files[0]) await importNotes(e.target.files[0]); notes = await getAllNotes(); renderList(); });

window.addEventListener('load', ()=>init());
