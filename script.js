// Firebase + App-Logik (ESM via CDN)
// Hinweis: Ersetze die firebaseConfig unten mit deinen eigenen Projekt-Credentials.

// Dynamische Imports, damit Hosting ohne Bundler funktioniert
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js';
import { 
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence 
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, addDoc, getDoc, getDocs, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, enableIndexedDbPersistence, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js';

// -------------------------
// Firebase Init
// -------------------------
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Offline-Persistenz
enableIndexedDbPersistence(db).catch(() => {/* ggf. mehrere Tabs offen */});
setPersistence(auth, browserLocalPersistence);

// -------------------------
// DOM Refs
// -------------------------
const views = {
  dashboard: document.getElementById('view-dashboard'),
  inventory: document.getElementById('view-inventory'),
  builds: document.getElementById('view-builds'),
  bundles: document.getElementById('view-bundles'),
  trash: document.getElementById('view-trash'),
  settings: document.getElementById('view-settings')
};
const navButtons = Array.from(document.querySelectorAll('.nav-btn'));
const globalSearch = document.getElementById('global-search');

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userInfo = document.getElementById('user-info');

// Modale
const itemModal = document.getElementById('item-modal');
const buildModal = document.getElementById('build-modal');
const bundleModal = document.getElementById('bundle-modal');

// Formulare
const itemForm = document.getElementById('item-form');
const buildForm = document.getElementById('build-form');
const bundleForm = document.getElementById('bundle-form');

// Listen
const inventoryList = document.getElementById('inventory-list');
const buildsList = document.getElementById('builds-list');
const bundlesList = document.getElementById('bundles-list');
const trashList = document.getElementById('trash-list');
const recentItems = document.getElementById('recent-items');

// KPI-Elemente
const kpiCapital = document.getElementById('kpi-capital');
const kpiRealized = document.getElementById('kpi-realized');
const kpiInventory = document.getElementById('kpi-inventory');
const kpiOpen = document.getElementById('kpi-open-listings');

// Filter Controls
const filterCategory = document.getElementById('filter-category');
const filterCondition = document.getElementById('filter-condition');

// -------------------------
// State
// -------------------------
let currentUser = null;
let unsubscribeInventory = null;
let inventoryCache = [];
let buildsCache = [];
let bundlesCache = [];
let unsubscribeBuilds = null;
let unsubscribeBundles = null;

// -------------------------
// Utils
// -------------------------
const currency = () => (document.getElementById('settings-currency')?.value || 'EUR');
const fmt = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency() }).format(n || 0);
const parseTags = (str) => (str || '').split(',').map(s => s.trim()).filter(Boolean);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v; else if (k === 'text') node.textContent = v; else node.setAttribute(k, v);
  });
  children.forEach(c => node.appendChild(c));
  return node;
};

const specFieldsForCategory = (cat) => {
  switch (cat) {
    case 'CPU': return [ ['cores','Cores'], ['threads','Threads'] ];
    case 'GPU': return [ ['vram','VRAM (GB)'] ];
    case 'Netzteil': return [ ['watt','Watt'] ];
    case 'RAM': return [ ['size','Größe (GB)'], ['speed','Geschwindigkeit (MHz)'] ];
    case 'Case': return [ ['formfactor','Formfaktor'] ];
    case 'Kühler': return [ ['type','Typ'] ];
    case 'Mainboard': return [ ['chipset','Chipsatz'], ['formfactor','Formfaktor'] ];
    default: return [];
  }
};

const autoName = ({ brand, model, category, specs = {} }) => {
  const specStr = (() => {
    switch (category) {
      case 'CPU': return [specs.cores && `${specs.cores}C`, specs.threads && `${specs.threads}T`].filter(Boolean).join('/');
      case 'GPU': return specs.vram ? `${specs.vram}GB` : '';
      case 'Netzteil': return specs.watt ? `${specs.watt}W` : '';
      case 'RAM': return [specs.size && `${specs.size}GB`, specs.speed && `${specs.speed}MHz`].filter(Boolean).join(' ');
      case 'Case': return specs.formfactor || '';
      case 'Kühler': return specs.type || '';
      case 'Mainboard': return [specs.chipset, specs.formfactor].filter(Boolean).join(' ');
      default: return '';
    }
  })();
  return [brand, model, specStr && `– ${specStr}`].filter(Boolean).join(' ');
};

const closeModal = (dlg) => { if (dlg?.open) dlg.close(); };
const openModal = (dlg) => { if (!dlg.open) dlg.showModal(); };

// -------------------------
// Navigation & Modale
// -------------------------
navButtons.forEach(btn => btn.addEventListener('click', () => {
  const view = btn.dataset.view;
  document.querySelector('.nav-btn.active')?.classList.remove('active');
  btn.classList.add('active');
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[view]?.classList.add('active');
}));
document.querySelector('.nav-btn[data-view="dashboard"]').classList.add('active');

document.querySelectorAll('[data-open-modal]').forEach(b => b.addEventListener('click', () => {
  const id = b.getAttribute('data-open-modal');
  const dlg = document.getElementById(id);
  openModal(dlg);
}));

document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', (e) => {
  const dlg = e.target.closest('dialog');
  closeModal(dlg);
}));

// Dynamische Spezifikationsfelder für Item-Form
const specsContainer = itemForm.querySelector('.specs-container');
const categorySelect = itemForm.querySelector('select[name="category"]');
const brandSelect = itemForm.querySelector('select[name="brand"]');
const modelInput = itemForm.querySelector('input[name="model"]');

function renderSpecInputs(cat, existing = {}) {
  specsContainer.innerHTML = '';
  const fields = specFieldsForCategory(cat);
  fields.forEach(([key, label]) => {
    const input = el('input', { name: `spec_${key}`, placeholder: label });
    if (existing[key] != null) input.value = existing[key];
    specsContainer.appendChild(input);
  });
}

categorySelect.addEventListener('change', () => renderSpecInputs(categorySelect.value));

// Auto-Namensvorschau bei Eingabe
[brandSelect, modelInput, categorySelect].forEach(ctrl => ctrl.addEventListener('input', () => {
  const specs = Array.from(specsContainer.querySelectorAll('input'))
    .reduce((acc, inp) => { const k = inp.name.replace('spec_',''); acc[k] = inp.value; return acc; }, {});
  const name = autoName({ brand: brandSelect.value, model: modelInput.value, category: categorySelect.value, specs });
  document.getElementById('item-form-title').textContent = name || 'Teil hinzufügen';
}));

// -------------------------
// Auth nur für dich (E-Mail/Passwort)
// -------------------------
loginBtn.addEventListener('click', async () => {
  const email = prompt('E-Mail');
  const password = prompt('Passwort');
  if (!email || !password) return;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) { alert('Login fehlgeschlagen: ' + e.message); }
});
logoutBtn.addEventListener('click', async () => { await signOut(auth); });

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    userInfo.textContent = user.email;
    loginBtn.hidden = true; logoutBtn.hidden = false;
    subscribeInventory();
    subscribeBuilds();
    subscribeBundles();
    refreshKPIs();
  } else {
    userInfo.textContent = 'Nicht angemeldet';
    loginBtn.hidden = false; logoutBtn.hidden = true;
    if (unsubscribeInventory) { unsubscribeInventory(); unsubscribeInventory = null; }
    if (unsubscribeBuilds) { unsubscribeBuilds(); unsubscribeBuilds = null; }
    if (unsubscribeBundles) { unsubscribeBundles(); unsubscribeBundles = null; }
    inventoryList.innerHTML = '';
    recentItems.innerHTML = '';
  }
});

// -------------------------
// Firestore Collections
// -------------------------
const colInventory = () => collection(db, 'inventory');
const colBuilds = () => collection(db, 'builds');
const colBundles = () => collection(db, 'bundles');

// Soft-Delete (inTrash)
async function moveToTrash(collectionName, id) {
  await updateDoc(doc(db, collectionName, id), { inTrash: true, updatedAt: serverTimestamp() });
}
async function restoreFromTrash(collectionName, id) {
  await updateDoc(doc(db, collectionName, id), { inTrash: false, updatedAt: serverTimestamp() });
}

// -------------------------
// Inventar
// -------------------------
function subscribeInventory() {
  if (unsubscribeInventory) unsubscribeInventory();
  const q = query(colInventory());
  unsubscribeInventory = onSnapshot(q, (snap) => {
    inventoryCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderInventory();
    renderRecent();
    refreshKPIs();
  });
}

function subscribeBuilds() {
  if (unsubscribeBuilds) unsubscribeBuilds();
  const q = query(colBuilds());
  unsubscribeBuilds = onSnapshot(q, (snap) => {
    buildsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBuilds();
  });
}

function subscribeBundles() {
  if (unsubscribeBundles) unsubscribeBundles();
  const q = query(colBundles());
  unsubscribeBundles = onSnapshot(q, (snap) => {
    bundlesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBundles();
  });
}

function readItemForm() {
  const formData = new FormData(itemForm);
  const category = formData.get('category') || '';
  const brand = formData.get('brand') || '';
  const model = formData.get('model') || '';
  const purchaseDate = formData.get('purchaseDate') || '';
  const paymentPlatform = formData.get('paymentPlatform') || '';
  const condition = formData.get('condition') || '';
  const tags = parseTags(formData.get('tags'));
  const purchasePrice = parseFloat(formData.get('purchasePrice')) || 0;
  const saleDate = formData.get('saleDate') || '';
  const salePlatform = formData.get('salePlatform') || '';
  const shipped = formData.get('shipped') || '';
  const askPrice = parseFloat(formData.get('askPrice')) || null;
  const salePrice = parseFloat(formData.get('salePrice')) || null;
  const specs = Array.from(specsContainer.querySelectorAll('input')).reduce((acc, inp) => {
    const key = inp.name.replace('spec_','');
    const val = inp.value;
    if (val !== '') acc[key] = isNaN(Number(val)) ? val : Number(val);
    return acc;
  }, {});
  const name = autoName({ brand, model, category, specs });
  return { category, brand, model, name, purchaseDate, paymentPlatform, condition, tags, purchasePrice, saleDate, salePlatform, shipped, askPrice, salePrice, specs, inTrash: false };
}

itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = readItemForm();
    await addDoc(colInventory(), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    itemForm.reset();
    specsContainer.innerHTML = '';
    closeModal(itemModal);
  } catch (e) { alert('Speichern fehlgeschlagen: ' + e.message); }
});

function renderInventory() {
  const term = (globalSearch.value || '').toLowerCase();
  const cat = filterCategory.value || '';
  const cond = filterCondition.value || '';
  const items = inventoryCache.filter(it => !it.inTrash)
    .filter(it => !cat || it.category === cat)
    .filter(it => !cond || it.condition === cond)
    .filter(it => [it.name, it.brand, it.model, (it.tags||[]).join(' ')].join(' ').toLowerCase().includes(term));

  inventoryList.innerHTML = '';
  // Header row
  inventoryList.appendChild(el('div', { class: 'row' }, [
    el('div', { class: 'name', text: 'Name' }),
    el('div', { text: 'Kategorie' }),
    el('div', { text: 'Details' }),
    el('div', { text: 'Kaufpreis' }),
    el('div', { text: 'Wunsch' }),
    el('div', { text: 'Verkauf' }),
    el('div', { text: '' }),
  ]));

  items.forEach(it => {
    const details = (() => {
      switch(it.category) {
        case 'CPU': return `${it.specs?.cores||''}C/${it.specs?.threads||''}T`;
        case 'GPU': return `${it.specs?.vram||''}GB`;
        case 'Netzteil': return `${it.specs?.watt||''}W`;
        case 'RAM': return `${it.specs?.size||''}GB ${it.specs?.speed||''}MHz`;
        case 'Case': return it.specs?.formfactor || '';
        case 'Kühler': return it.specs?.type || '';
        case 'Mainboard': return [it.specs?.chipset, it.specs?.formfactor].filter(Boolean).join(' ');
        default: return '';
      }
    })();

    const row = el('div', { class: 'row' });
    row.appendChild(el('div', { class: 'name', text: it.name || '-' }));
    row.appendChild(el('div', { text: it.category || '-' }));
    row.appendChild(el('div', { text: details || '-' }));
    row.appendChild(el('div', { text: fmt(it.purchasePrice) }));
    row.appendChild(el('div', { text: it.askPrice != null ? fmt(it.askPrice) : '—' }));
    row.appendChild(el('div', { text: it.salePrice != null ? fmt(it.salePrice) : '—' }));

    const actions = el('div');
    const editBtn = el('button', { class: 'ghost', text: 'Bearbeiten' });
    const sellBtn = el('button', { class: 'ghost', text: 'Verkauf' });
    const delBtn = el('button', { class: 'ghost', text: 'Löschen' });
    actions.appendChild(editBtn); actions.appendChild(sellBtn); actions.appendChild(delBtn);
    row.appendChild(actions);

    editBtn.addEventListener('click', () => openEditItem(it));
    sellBtn.addEventListener('click', () => openSellItem(it));
    delBtn.addEventListener('click', async () => { if (confirm('In Mülleimer verschieben?')) await moveToTrash('inventory', it.id); });

    inventoryList.appendChild(row);
  });
}

globalSearch.addEventListener('input', renderInventory);
filterCategory.addEventListener('change', renderInventory);
filterCondition.addEventListener('change', renderInventory);

function renderRecent() {
  recentItems.innerHTML = '';
  inventoryCache
    .filter(it => !it.inTrash)
    .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0))
    .slice(0, 6)
    .forEach(it => {
      const card = el('div', { class: 'panel' });
      card.appendChild(el('div', { class: 'name', text: it.name || '-' }));
      card.appendChild(el('div', { class: 'tags', text: [it.category, ...(it.tags||[])].filter(Boolean).join(' • ') }));
      recentItems.appendChild(card);
    });
}

function openEditItem(item) {
  // Simple Edit: Formular vorfüllen und bei Speichern update
  itemForm.reset();
  itemForm.dataset.editId = item.id;
  itemForm.querySelector('select[name="category"]').value = item.category || '';
  itemForm.querySelector('select[name="brand"]').value = item.brand || '';
  itemForm.querySelector('input[name="model"]').value = item.model || '';
  itemForm.querySelector('input[name="purchaseDate"]').value = item.purchaseDate || '';
  itemForm.querySelector('select[name="paymentPlatform"]').value = item.paymentPlatform || '';
  itemForm.querySelector('select[name="condition"]').value = item.condition || '';
  itemForm.querySelector('input[name="tags"]').value = (item.tags||[]).join(', ');
  itemForm.querySelector('input[name="purchasePrice"]').value = item.purchasePrice || '';
  renderSpecInputs(item.category, item.specs || {});
  document.getElementById('item-form-title').textContent = item.name || 'Teil bearbeiten';
  openModal(itemModal);
}

function openSellItem(item) {
  // Verkauf-Felder im selben Formular nutzen
  openEditItem(item);
}

// Differenzierte Speicherung: add vs update
itemForm.addEventListener('close', async () => {
  // Kein Auto-Save beim Schließen
});

itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = itemForm.dataset.editId;
  try {
    const data = readItemForm();
    if (editId) {
      await updateDoc(doc(db, 'inventory', editId), { ...data, updatedAt: serverTimestamp() });
      delete itemForm.dataset.editId;
    } else {
      await addDoc(colInventory(), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    itemForm.reset(); specsContainer.innerHTML = '';
    closeModal(itemModal);
  } catch (e2) { alert('Speichern fehlgeschlagen: ' + e2.message); }
});

// -------------------------
// KPIs / Finanzen (Basis)
// -------------------------
function refreshKPIs() {
  const notTrashed = inventoryCache.filter(it => !it.inTrash);
  const capital = notTrashed.reduce((s, it) => s + (it.purchasePrice || 0), 0);
  const realizedItems = inventoryCache.reduce((s, it) => s + (it.salePrice ? (it.salePrice - (it.purchasePrice||0)) : 0), 0);
  const realizedBuilds = (buildsCache||[]).reduce((s, b) => s + (b.salePrice ? (b.salePrice - (b.totalPartsCost||0)) : 0), 0);
  const realized = realizedItems + realizedBuilds;
  const inventoryValue = notTrashed.reduce((s, it) => s + (it.salePrice ? 0 : (it.purchasePrice||0)), 0);
  const openListingsItems = notTrashed.filter(it => it.askPrice && !it.salePrice).length;
  const openListingsBuilds = (buildsCache||[]).filter(b => !b.inTrash && b.askPrice && !b.salePrice).length;
  const openListings = openListingsItems + openListingsBuilds;
  kpiCapital.textContent = fmt(capital);
  kpiRealized.textContent = fmt(realized);
  kpiInventory.textContent = fmt(inventoryValue);
  kpiOpen.textContent = String(openListings);
}

// -------------------------
// Platzhalter: Builds, Bundles, Trash (nur Rendering-Stubs)
// -------------------------
function renderBuilds() { buildsList.innerHTML = ''; }
function renderBundles() { bundlesList.innerHTML = ''; }
function renderTrash() {
  trashList.innerHTML = '';
  // Inventory
  inventoryCache.filter(it => it.inTrash).forEach(it => {
    const row = el('div', { class: 'row' });
    row.appendChild(el('div', { class: 'name', text: `Teil: ${it.name || '-'}` }));
    const restoreBtn = el('button', { class: 'ghost', text: 'Wiederherstellen' });
    restoreBtn.addEventListener('click', async () => { await restoreFromTrash('inventory', it.id); });
    row.appendChild(el('div', {}, [restoreBtn]));
    trashList.appendChild(row);
  });
  // Builds
  (buildsCache||[]).filter(b => b.inTrash).forEach(b => {
    const row = el('div', { class: 'row' });
    row.appendChild(el('div', { class: 'name', text: `Build: ${b.name}` }));
    const restoreBtn = el('button', { class: 'ghost', text: 'Wiederherstellen' });
    restoreBtn.addEventListener('click', async () => { await updateDoc(doc(db, 'builds', b.id), { inTrash: false, updatedAt: serverTimestamp() }); });
    row.appendChild(el('div', {}, [restoreBtn]));
    trashList.appendChild(row);
  });
  // Bundles
  (bundlesCache||[]).filter(b => b.inTrash).forEach(b => {
    const row = el('div', { class: 'row' });
    row.appendChild(el('div', { class: 'name', text: `Bundle: ${b.name}` }));
    const restoreBtn = el('button', { class: 'ghost', text: 'Wiederherstellen' });
    restoreBtn.addEventListener('click', async () => { await updateDoc(doc(db, 'bundles', b.id), { inTrash: false, updatedAt: serverTimestamp() }); });
    row.appendChild(el('div', {}, [restoreBtn]));
    trashList.appendChild(row);
  });
}

// Navigation Render Hooks
document.querySelector('[data-view="builds"]').addEventListener('click', renderBuilds);
document.querySelector('[data-view="bundles"]').addEventListener('click', renderBundles);
document.querySelector('[data-view="trash"]').addEventListener('click', renderTrash);

// Builds: Picker + Form
const buildPicker = document.getElementById('build-inventory-picker');

function availableInventoryForBuild() {
  return inventoryCache.filter(it => !it.inTrash && !it.salePrice && !it.buildId);
}

function renderBuildPicker(selectedIds = new Set()) {
  buildPicker.innerHTML = '';
  availableInventoryForBuild().forEach(it => {
    const row = el('div', { class: 'pick' });
    const label = el('div', { text: `${it.name} (${it.category}) – ${fmt(it.purchasePrice)}` });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = selectedIds.has(it.id);
    row.appendChild(label); row.appendChild(cb);
    buildPicker.appendChild(row);
  });
}

function readBuildForm() {
  const fd = new FormData(buildForm);
  const name = fd.get('name') || '';
  const saleDate = fd.get('saleDate') || '';
  const salePlatform = fd.get('salePlatform') || '';
  const shipped = fd.get('shipped') || '';
  const askPrice = parseFloat(fd.get('askPrice')) || null;
  const salePrice = parseFloat(fd.get('salePrice')) || null;
  const partIds = Array.from(buildPicker.querySelectorAll('input[type="checkbox"]'))
    .map((cb, idx) => cb.checked ? availableInventoryForBuild()[idx].id : null)
    .filter(Boolean);
  const totalPartsCost = partIds.reduce((s, id) => {
    const it = inventoryCache.find(x => x.id === id);
    return s + (it?.purchasePrice || 0);
  }, 0);
  return { name, partIds, saleDate, salePlatform, shipped, askPrice, salePrice, totalPartsCost, inTrash: false };
}

document.querySelector('[data-open-modal="build-modal"]').addEventListener('click', () => {
  buildForm.reset();
  delete buildForm.dataset.editId;
  renderBuildPicker();
});

buildForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = readBuildForm();
    const editId = buildForm.dataset.editId;
    if (!data.name) data.name = `Build (${data.partIds.length} Teile)`;
    if (editId) {
      await updateDoc(doc(db, 'builds', editId), { ...data, updatedAt: serverTimestamp() });
    } else {
      const ref = await addDoc(colBuilds(), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await Promise.all(data.partIds.map(id => updateDoc(doc(db, 'inventory', id), { buildId: ref.id, updatedAt: serverTimestamp() })));
    }
    closeModal(buildModal);
  } catch (e2) { alert('Build speichern fehlgeschlagen: ' + e2.message); }
});

function renderBuilds() {
  buildsList.innerHTML = '';
  buildsList.appendChild(el('div', { class: 'row' }, [
    el('div', { class: 'name', text: 'Name' }),
    el('div', { text: 'Teile' }),
    el('div', { text: 'Kosten' }),
    el('div', { text: 'Wunsch' }),
    el('div', { text: 'Verkauf' }),
    el('div', { text: '' }),
  ]));
  (buildsCache||[]).filter(b => !b.inTrash).forEach(b => {
    const parts = b.partIds?.map(id => inventoryCache.find(x => x.id === id)?.name || '—') || [];
    const row = el('div', { class: 'row' });
    row.appendChild(el('div', { class: 'name', text: b.name }));
    row.appendChild(el('div', { text: parts.join(', ') }));
    row.appendChild(el('div', { text: fmt(b.totalPartsCost || 0) }));
    row.appendChild(el('div', { text: b.askPrice != null ? fmt(b.askPrice) : '—' }));
    row.appendChild(el('div', { text: b.salePrice != null ? fmt(b.salePrice) : '—' }));
    const actions = el('div');
    const editBtn = el('button', { class: 'ghost', text: 'Bearbeiten' });
    const printBtn = el('button', { class: 'ghost', text: 'Drucken' });
    const delBtn = el('button', { class: 'ghost', text: 'Löschen' });
    actions.appendChild(editBtn); actions.appendChild(printBtn); actions.appendChild(delBtn);
    row.appendChild(actions);
    editBtn.addEventListener('click', () => openEditBuild(b));
    delBtn.addEventListener('click', async () => { if (confirm('Build in Mülleimer verschieben?')) await updateDoc(doc(db, 'builds', b.id), { inTrash: true, updatedAt: serverTimestamp() }); });
    printBtn.addEventListener('click', () => printBuild(b));
    buildsList.appendChild(row);
  });
}

function openEditBuild(b) {
  buildForm.reset();
  buildForm.dataset.editId = b.id;
  buildForm.querySelector('input[name="name"]').value = b.name || '';
  buildForm.querySelector('input[name="saleDate"]').value = b.saleDate || '';
  buildForm.querySelector('select[name="salePlatform"]').value = b.salePlatform || '';
  buildForm.querySelector('select[name="shipped"]').value = b.shipped || '';
  buildForm.querySelector('input[name="askPrice"]').value = b.askPrice || '';
  buildForm.querySelector('input[name="salePrice"]').value = b.salePrice || '';
  const selected = new Set(b.partIds || []);
  renderBuildPicker(selected);
  openModal(buildModal);
}

function printBuild(b) {
  const showPrices = document.getElementById('settings-print-prices')?.checked !== false;
  const parts = (b.partIds||[]).map(id => inventoryCache.find(x => x.id === id)).filter(Boolean);
  const total = parts.reduce((s, it) => s + (it.purchasePrice || 0), 0);
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${b.name} – Angebot</title>
  <style>body{font-family:Inter,Arial,sans-serif;padding:24px;color:#222} h1{font-size:22px;margin:0 0 8px} table{width:100%;border-collapse:collapse;margin-top:16px} th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left} .total{font-weight:700} .muted{color:#666}</style></head>
  <body><h1>${b.name}</h1><div class="muted">Erstellt am ${new Date().toLocaleDateString()}</div>
  <table><thead><tr><th>Teil</th>${showPrices?'<th>Preis</th>':''}</tr></thead><tbody>
  ${parts.map(p => `<tr><td>${p.name}</td>${showPrices?`<td>${fmt(p.purchasePrice||0)}</td>`:''}</tr>`).join('')}
  </tbody>${showPrices?`<tfoot><tr><td class="total">Gesamt</td><td class="total">${fmt(total)}</td></tr></tfoot>`:''}</table>
  <script>window.onload=() => window.print()</script></body></html>`;
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}

// Bundles UI + Logik
const addBundleItemBtn = document.getElementById('add-bundle-item');
const bundleItemsContainer = document.getElementById('bundle-items-container');

function addBundleItemRow(prefill = {}) {
  const row = el('div', { class: 'grid-2' });
  const col1 = el('div');
  const col2 = el('div');
  const category = el('select', { name: 'b_category' }, [
    ...['', 'CPU','GPU','RAM','Mainboard','Netzteil','Case','Kühler'].map(v => {
      const o = el('option', { value: v, text: v || 'Kategorie' });
      if (prefill.category === v) o.selected = true; return o;
    })
  ]);
  const brand = el('select', { name: 'b_brand' }, [
    ...['','AMD','Intel','Gigabyte','MSI','ASUS','Corsair'].map(v => {
      const o = el('option', { value: v, text: v || 'Marke' });
      if (prefill.brand === v) o.selected = true; return o;
    })
  ]);
  const model = el('input', { name: 'b_model', placeholder: 'Modell' }); model.value = prefill.model || '';
  const priceWeight = el('input', { name: 'b_weight', type: 'number', step: '0.01', placeholder: 'Gewichtung' }); priceWeight.value = prefill.weight || '';
  const specWrap = el('div');
  function renderSpec(cat) {
    specWrap.innerHTML='';
    specFieldsForCategory(cat).forEach(([key,label]) => {
      const inp = el('input', { name: `b_spec_${key}`, placeholder: label });
      if (prefill.specs && prefill.specs[key] != null) inp.value = prefill.specs[key];
      specWrap.appendChild(inp);
    });
  }
  category.addEventListener('change', () => renderSpec(category.value));
  renderSpec(prefill.category || '');
  col1.appendChild(category);
  col1.appendChild(brand);
  col1.appendChild(model);
  col1.appendChild(priceWeight);
  col2.appendChild(specWrap);
  const removeBtn = el('button', { class: 'ghost', text: 'Entfernen' });
  removeBtn.type = 'button';
  removeBtn.addEventListener('click', () => row.remove());
  col2.appendChild(removeBtn);
  row.appendChild(col1); row.appendChild(col2);
  bundleItemsContainer.appendChild(row);
}

addBundleItemBtn.addEventListener('click', () => addBundleItemRow());
document.querySelector('[data-open-modal="bundle-modal"]').addEventListener('click', () => {
  bundleForm.reset();
  delete bundleForm.dataset.editId;
  bundleItemsContainer.innerHTML = '';
  addBundleItemRow();
});

function readBundleForm() {
  const fd = new FormData(bundleForm);
  const name = fd.get('name') || '';
  const totalPrice = parseFloat(fd.get('totalPrice')) || 0;
  const distribution = fd.get('distribution') || 'even';
  const rows = Array.from(bundleItemsContainer.children);
  const items = rows.map(r => {
    const category = r.querySelector('select[name="b_category"]').value || '';
    const brand = r.querySelector('select[name="b_brand"]').value || '';
    const model = r.querySelector('input[name="b_model"]').value || '';
    const weight = parseFloat(r.querySelector('input[name="b_weight"]').value) || 1;
    const specs = Array.from(r.querySelectorAll('[name^="b_spec_"]')).reduce((acc, inp) => {
      const k = inp.name.replace('b_spec_','');
      const v = inp.value;
      if (v !== '') acc[k] = isNaN(Number(v)) ? v : Number(v);
      return acc;
    }, {});
    const nameAuto = autoName({ brand, model, category, specs });
    return { category, brand, model, specs, weight, name: nameAuto };
  });
  return { name, totalPrice, distribution, items, inTrash: false };
}

async function upsertBundleInventory(bundleId, bundleData) {
  const weights = bundleData.items.map(it => (bundleData.distribution === 'even' ? 1 : (it.weight || 1)));
  const weightSum = weights.reduce((a,b) => a+b, 0) || 1;
  const allocated = bundleData.items.map((it, idx) => ({
    ...it,
    purchasePrice: Math.round((bundleData.totalPrice * (weights[idx]/weightSum)) * 100) / 100
  }));
  const existing = inventoryCache.filter(it => it.sourceBundleId === bundleId);
  const toUpdateByName = new Map(existing.map(e => [e.name, e]));
  for (const it of allocated) {
    const match = toUpdateByName.get(it.name);
    const payload = {
      category: it.category, brand: it.brand, model: it.model, specs: it.specs,
      name: it.name, purchasePrice: it.purchasePrice, paymentPlatform: '', condition: '', tags: [],
      inTrash: false, sourceBundleId: bundleId
    };
    if (match) {
      await updateDoc(doc(db, 'inventory', match.id), { ...payload, updatedAt: serverTimestamp() });
    } else {
      await addDoc(colInventory(), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
  }
  const allocatedNames = new Set(allocated.map(a => a.name));
  for (const ex of existing) {
    if (!allocatedNames.has(ex.name)) {
      await updateDoc(doc(db, 'inventory', ex.id), { inTrash: true, updatedAt: serverTimestamp() });
    }
  }
}

bundleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = readBundleForm();
    const editId = bundleForm.dataset.editId;
    if (!data.name) data.name = `Bundle (${data.items.length} Teile)`;
    if (editId) {
      await updateDoc(doc(db, 'bundles', editId), { ...data, updatedAt: serverTimestamp() });
      await upsertBundleInventory(editId, data);
    } else {
      const ref = await addDoc(colBundles(), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await upsertBundleInventory(ref.id, data);
    }
    closeModal(bundleModal);
  } catch (e2) { alert('Bundle speichern fehlgeschlagen: ' + e2.message); }
});

function renderBundles() {
  bundlesList.innerHTML = '';
  bundlesList.appendChild(el('div', { class: 'row' }, [
    el('div', { class: 'name', text: 'Name' }),
    el('div', { text: 'Teile' }),
    el('div', { text: 'Gesamtpreis' }),
    el('div', { text: '' }),
  ]));
  (bundlesCache||[]).filter(b => !b.inTrash).forEach(b => {
    const row = el('div', { class: 'row' });
    row.appendChild(el('div', { class: 'name', text: b.name }));
    row.appendChild(el('div', { text: (b.items||[]).map(i => i.name).join(', ') }));
    row.appendChild(el('div', { text: fmt(b.totalPrice || 0) }));
    const actions = el('div');
    const editBtn = el('button', { class: 'ghost', text: 'Bearbeiten' });
    const delBtn = el('button', { class: 'ghost', text: 'Löschen' });
    actions.appendChild(editBtn); actions.appendChild(delBtn);
    row.appendChild(actions);
    editBtn.addEventListener('click', () => openEditBundle(b));
    delBtn.addEventListener('click', async () => { if (confirm('Bundle in Mülleimer verschieben?')) await updateDoc(doc(db, 'bundles', b.id), { inTrash: true, updatedAt: serverTimestamp() }); });
    bundlesList.appendChild(row);
  });
}

function openEditBundle(b) {
  bundleForm.reset();
  bundleForm.dataset.editId = b.id;
  bundleForm.querySelector('input[name="name"]').value = b.name || '';
  bundleForm.querySelector('input[name="totalPrice"]').value = b.totalPrice || '';
  bundleForm.querySelector('select[name="distribution"]').value = b.distribution || 'even';
  bundleItemsContainer.innerHTML = '';
  (b.items||[]).forEach(it => addBundleItemRow(it));
  openModal(bundleModal);
}


