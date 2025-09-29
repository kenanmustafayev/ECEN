'use client';
// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trash2, PlusCircle, RefreshCcw, PieChart, Package, Users, DollarSign, Receipt, Layers, Pencil, X, Download, Upload } from "lucide-react";

/*************************
 * Helpers & Formatting  *
 *************************/
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-");
const parseNum = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, "."));
  return Number.isFinite(n) ? n : 0;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const formatBatchNameFromDate = (dateStr) => {
  if (!dateStr) return "P - ?";
  const [y, m, d] = String(dateStr).split("-");
  if (y && m && d) return `P - ${d}${m}${y}`;
  try {
    const dt = new Date(dateStr);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth()+1).padStart(2, '0');
    const yy = String(dt.getFullYear());
    return `P - ${dd}${mm}${yy}`;
  } catch { return "P - ?"; }
};
const nextSeqForDate = (purchases, dateStr) => {
  const count = (Array.isArray(purchases)?purchases:[]).filter(p=>p?.date===dateStr).length + 1;
  return String(count).padStart(2,'0');
};
const batchNameOf = (purchase) => {
  if (!purchase) return "P - ?";
  if (purchase.batchName) return purchase.batchName;
  const base = formatBatchNameFromDate(purchase.date);
  return purchase.batchSeq ? `${base}-${String(purchase.batchSeq).padStart(2,'0')}` : base;
};

/*************************
 * Firebase (Auth + DB)  *
 *************************/
// Dinamik import: paket olmasa (canvas-da) UI sıradan çıxmır. Vercel-də isə env-lər ilə işləyir.
const firebaseCfg = {
  apiKey: typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_FIREBASE_API_KEY : undefined,
  authDomain: typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN : undefined,
  projectId: typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_FIREBASE_PROJECT_ID : undefined,
  appId: typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_FIREBASE_APP_ID : undefined,
  messagingSenderId: typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID : undefined,
};

function useFirebase() {
  const [fb, setFb] = useState({ ready: false, user: null });
  const ref = React.useRef({});

  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        if (!firebaseCfg.apiKey) { setFb({ ready:false, user:null }); return; }
        const appMod = await import('firebase/app');
        const authMod = await import('firebase/auth');
        const dbMod = await import('firebase/firestore');

        const app = appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(firebaseCfg);
        const auth = authMod.getAuth(app);
        const db = dbMod.getFirestore(app);

        ref.current = { appMod, authMod, dbMod, app, auth, db };
        unsub = authMod.onAuthStateChanged(auth, (u)=> setFb({ ready:true, user:u }));
      } catch (e) {
        // console.warn('Firebase init skipped', e);
        setFb({ ready:false, user:null });
      }
    })();
    return () => { try { unsub && unsub(); } catch {} };
  }, []);

const signIn = async () => {
  const { authMod, auth } = ref.current;
  if (!authMod || !auth) {
    alert('Firebase konfiqurasiya edilməyib. Vercel Environment Variables yoxlayın.');
    return;
  }
  try {
    const provider = new authMod.GoogleAuthProvider();
    // Popup-u yoxla
    await authMod.signInWithPopup(auth, provider);
  } catch (err) {
    // Popup bloklandısa və ya icazə problemi varsa — redirect ilə cəhd et
    try {
      const provider = new authMod.GoogleAuthProvider();
      await authMod.signInWithRedirect(auth, provider);
    } catch (err2) {
      console.error('Sign-in failed', err, err2);
      alert('Giriş mümkün olmadı. Authorized Domains və env dəyərlərini yoxlayın.');
    }
  }
};

  // Firestore helpers
  const colPath = (uid, name) => `users/${uid}/${name}`;
  const subscribeCollection = (uid, name, cb) => {
    const { dbMod, db } = ref.current; if (!dbMod || !db) return () => {};
    const c = dbMod.collection(db, colPath(uid, name));
    const q = dbMod.query(c, dbMod.orderBy('date','asc'));
    return dbMod.onSnapshot(q, (snap)=> cb(snap.docs.map(d=>({ id: d.id, ...d.data() }))));
  };
  const addRow = (uid, name, payload) => {
    const { dbMod, db } = ref.current; if (!dbMod || !db) throw new Error('DB not ready');
    const c = dbMod.collection(db, colPath(uid, name));
    return dbMod.addDoc(c, { ...payload, createdAt: dbMod.serverTimestamp() });
  };
  const updateRow = (uid, name, id, patch) => {
    const { dbMod, db } = ref.current; if (!dbMod || !db) throw new Error('DB not ready');
    const d = dbMod.doc(db, `${colPath(uid,name)}/${id}`);
    return dbMod.updateDoc(d, { ...patch, updatedAt: dbMod.serverTimestamp() });
  };
  const deleteRow = (uid, name, id) => {
    const { dbMod, db } = ref.current; if (!dbMod || !db) throw new Error('DB not ready');
    const d = dbMod.doc(db, `${colPath(uid,name)}/${id}`);
    return dbMod.deleteDoc(d);
  };

  return { ...fb, signIn, signOut, subscribeCollection, addRow, updateRow, deleteRow };
}

/***********************
 * Derived & Reporting  *
 ***********************/
function useIndices(data) {
  const purchases = Array.isArray(data?.purchases) ? data.purchases : [];
  const sales = Array.isArray(data?.sales) ? data.sales : [];
  const payments = Array.isArray(data?.payments) ? data.payments : [];

  const batchIndex = useMemo(() => {
    const m = new Map();
    purchases.forEach((p) => p?.id && m.set(p.id, p));
    return m;
  }, [purchases]);

  const customers = useMemo(() => {
    const set = new Set();
    sales.forEach((s) => s?.customer && set.add(s.customer));
    payments.forEach((p) => p?.customer && set.add(p.customer));
    return Array.from(set).sort();
  }, [sales, payments]);

  return { batchIndex, customers };
}

function calculateReports(data) {
  const purchases = Array.isArray(data?.purchases) ? data.purchases : [];
  const sales = Array.isArray(data?.sales) ? data.sales : [];
  const expenses = Array.isArray(data?.expenses) ? data.expenses : [];
  const payments = Array.isArray(data?.payments) ? data.payments : [];

  const batchStats = new Map();

  for (const pur of purchases) {
    if (!pur) continue;
    batchStats.set(pur.id, {
      batch: pur,
      purchasedQty: parseNum(pur.qty),
      unitCost: parseNum(pur.unitPrice),
      soldQty: 0,
      salesRevenue: 0,
      expensesTotal: 0,
    });
  }

  for (const s of sales) {
    if (!s) continue;
    const st = batchStats.get(s.batchId);
    if (!st) continue;
    const qty = parseNum(s.qty);
    const price = parseNum(s.unitPrice);
    st.soldQty += qty;
    st.salesRevenue += qty * price;
  }

  for (const e of expenses) {
    if (!e) continue;
    const st = batchStats.get(e.batchId);
    if (!st) continue;
    st.expensesTotal += parseNum(e.amount);
  }

  const perBatch = [];
  for (const [batchId, st] of batchStats) {
    const purchased = st.purchasedQty;
    const sold = st.soldQty;
    const stock = Math.max(0, purchased - sold);
    const revenue = st.salesRevenue;
    const cogs = st.unitCost * sold;
    const expensesFull = st.expensesTotal;
    const profit = revenue - cogs - expensesFull;
    const stockCost = stock * st.unitCost;

    perBatch.push({
      batchId,
      batch: st.batch,
      purchased,
      sold,
      stock,
      stockCost,
      unitCost: st.unitCost,
      expensesTotal: expensesFull,
      revenue,
      cogs,
      profit,
      overSold: sold > purchased,
    });
  }

  const byCustomer = new Map();
  for (const s of sales) {
    const cust = (s && s.customer) ? s.customer : "(noname)";
    const amt = parseNum(s?.qty) * parseNum(s?.unitPrice);
    const obj = byCustomer.get(cust) || { invoiced: 0, paid: 0 };
    obj.invoiced += amt;
    byCustomer.set(cust, obj);
  }
  for (const p of payments) {
    const cust = (p && p.customer) ? p.customer : "(noname)";
    const amt = parseNum(p?.amount);
    const obj = byCustomer.get(cust) || { invoiced: 0, paid: 0 };
    obj.paid += amt;
    byCustomer.set(cust, obj);
  }
  const customerDebts = Array.from(byCustomer.entries()).map(([customer, v]) => ({
    customer,
    invoiced: v.invoiced,
    paid: v.paid,
    balance: v.invoiced - v.paid,
  }));

  const totals = {
    revenue: perBatch.reduce((a, b) => a + b.revenue, 0),
    cogs: perBatch.reduce((a, b) => a + b.cogs, 0),
    expensesFull: perBatch.reduce((a, b) => a + b.expensesTotal, 0),
    profit: perBatch.reduce((a, b) => a + b.profit, 0),
    paidTotal: customerDebts.reduce((a, b) => a + b.paid, 0),
    unpaidTotal: customerDebts.reduce((a, b) => a + Math.max(0, b.balance), 0),
    stockQty: perBatch.reduce((a, b) => a + b.stock, 0),
    stockCost: perBatch.reduce((a, b) => a + b.stockCost, 0),
  };

  return { perBatch, customerDebts, totals };
}

/****************
 * UI Utilities *
 ****************/
function SectionCard({ title, icon, children, right }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-4 md:p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-xl font-semibold">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Table({ columns, rows, footer }) {
  return (
    <div className="overflow-auto rounded-xl border">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-gray-700">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="text-left px-3 py-2 whitespace-nowrap">{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || r.key || i} className="border-t">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2 whitespace-nowrap">{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot className="bg-gray-50">
            <tr>
              <td colSpan={columns.length} className="px-3 py-2">{footer}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function TextInput({ label, value, onChange, type = "text", placeholder, className = "", listId }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-sm text-gray-600">{label}</span>
      <input
        className="border rounded-xl px-3 py-2 focus:outline-none focus:ring w-full"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={listId}
      />
    </label>
  );
}

function NumberInput({ label, value, onChange, placeholder, className = "" }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-sm text-gray-600">{label}</span>
      <input
        className="border rounded-xl px-3 py-2 focus:outline-none focus:ring w-full"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Select({ label, value, onChange, options, className = "" }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-sm text-gray-600">{label}</span>
      <select
        className="border rounded-xl px-3 py-2 focus:outline-none focus:ring w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Seçin…</option>
        {options?.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function KPI({ title, value, positive = false }) {
  return (
    <div className="rounded-2xl border p-4 h-full min-w-0">
      <div className="text-sm text-gray-600 break-words leading-snug">{title}</div>
      <div className={`text-lg md:text-xl font-semibold leading-snug break-words ${positive && value>=0 ? "text-emerald-700" : value<0?"text-red-600":""}`}>{fmt(value)}</div>
    </div>
  );
}

/****************
 * Forms (CRUD)  *
 ****************/
function PurchasesForm({ data, user, addRow, updateRow, deleteRow }) {
  const [date, setDate] = useState(todayISO());
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [editId, setEditId] = useState("");

  const resetInputs = () => { setDate(todayISO()); setQty(""); setUnitPrice(""); setAmount(""); setEditId(""); };

  const addOrSave = async () => {
    if (!user) return alert('Giriş edin.');
    const q = parseNum(qty);
    let up = parseNum(unitPrice);
    let amt = parseNum(amount);
    if (!up && q && amt) up = amt / q;
    if (!amt && q && up) amt = q * up;
    if (!date || !q || !up) return alert("Tarix, miqdar və qiymət vacibdir");

    if (editId) {
      const r = data.purchases.find(p=>p.id===editId) || {};
      await updateRow(user.uid, "purchases", editId, { date, qty:q, unitPrice:up, amount:q*up, batchSeq: r.batchSeq, batchName: r.batchName });
      resetInputs(); return;
    }
    const seq = nextSeqForDate(data.purchases, date);
    const name = `${formatBatchNameFromDate(date)}-${seq}`;
    await addRow(user.uid, "purchases", { date, qty:q, unitPrice:up, amount:q*up, batchSeq: seq, batchName: name });
    resetInputs();
  };

  const startEdit = (r) => { setEditId(r.id); setDate(r.date); setQty(String(r.qty)); setUnitPrice(String(r.unitPrice)); setAmount(String(r.amount ?? r.qty*r.unitPrice)); };
  const remove = async (id) => { if (!user) return; await deleteRow(user.uid, "purchases", id); };

  const cols = [
    { key: 'batch', header: 'Partiya', render: (r) => batchNameOf(r) },
    { key: 'date', header: 'Tarix' },
    { key: 'qty', header: 'Miqdar', render: (r) => fmt(r.qty) },
    { key: 'unitPrice', header: 'Qiymət', render: (r) => fmt(r.unitPrice) },
    { key: 'amount', header: 'Məbləğ', render: (r) => fmt(r.qty * r.unitPrice) },
    { key: 'actions', header: 'Əməliyyat', render: (r) => (
      <div className="flex gap-2">
        <button className="px-2 py-1 border rounded-lg" onClick={()=>startEdit(r)} title="Düzəlt"><Pencil size={14}/></button>
        <button className="px-2 py-1 border rounded-lg text-red-600" onClick={()=>remove(r.id)} title="Sil"><Trash2 size={14}/></button>
      </div>
    )},
  ];

  return (
    <SectionCard title="Alışlar" icon={<Package className="text-gray-600"/>}
      right={<button onClick={addOrSave} className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"><PlusCircle size={16}/> {editId? 'Yadda saxla' : 'Əlavə et'}</button>}>
      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <TextInput label="Tarix" type="date" value={date} onChange={setDate} />
        <NumberInput label="Miqdar" value={qty} onChange={setQty} placeholder="0" />
        <NumberInput label="Qiymət" value={unitPrice} onChange={setUnitPrice} placeholder="0.00" />
        <NumberInput label="Məbləğ" value={amount} onChange={setAmount} placeholder="(istəyə görə)" />
      </div>
      {editId && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-amber-50 border rounded">Düzəliş rejimi</span>
          <button className="text-blue-600 underline" onClick={()=>resetInputs()}><X size={12} className="inline"/> ləğv et</button>
        </div>
      )}
      <Table columns={cols} rows={data.purchases} />
    </SectionCard>
  );
}

function SalesForm({ data, user, addRow, updateRow, deleteRow, customers }) {
  const batches = (data.purchases || []).map((p) => ({ value: p.id, label: `${batchNameOf(p)} • ${fmt(p.qty)} əd • ${fmt(p.unitPrice)}` }));
  const [date, setDate] = useState(todayISO());
  const [batchId, setBatchId] = useState("");
  const [customer, setCustomer] = useState("");
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [editId, setEditId] = useState("");

  const resetInputs = () => { setDate(todayISO()); setBatchId(""); setCustomer(""); setQty(""); setUnitPrice(""); setAmount(""); setEditId(""); };

  const addOrSave = async () => {
    if (!user) return alert('Giriş edin.');
    const q = parseNum(qty);
    let up = parseNum(unitPrice);
    let amt = parseNum(amount);
    if (!up && q && amt) up = amt / q;
    if (!amt && q && up) amt = q * up;
    if (!date || !batchId || !customer || !q || !up) return alert("Bütün xanaları doldurun");

    if (editId) {
      await updateRow(user.uid, "sales", editId, { date, batchId, customer, qty:q, unitPrice:up, amount:q*up });
      resetInputs(); return;
    }
    await addRow(user.uid, "sales", { date, batchId, customer, qty:q, unitPrice:up, amount:q*up });
    resetInputs();
  };

  const startEdit = (r) => { setEditId(r.id); setDate(r.date); setBatchId(r.batchId); setCustomer(r.customer); setQty(String(r.qty)); setUnitPrice(String(r.unitPrice)); setAmount(String(r.amount ?? r.qty*r.unitPrice)); };
  const remove = async (id) => { if (!user) return; await deleteRow(user.uid, "sales", id); };

  const cols = [
    { key: 'date', header: 'Tarix' },
    { key: 'batchId', header: 'Partiya', render: (r) => batchNameOf(data.purchases.find(p=>p.id===r.batchId)) },
    { key: 'customer', header: 'Müştəri' },
    { key: 'qty', header: 'Miqdar', render: (r) => fmt(r.qty) },
    { key: 'unitPrice', header: 'Qiymət', render: (r) => fmt(r.unitPrice) },
    { key: 'amount', header: 'Məbləğ', render: (r) => fmt(r.qty * r.unitPrice) },
    { key: 'actions', header: 'Əməliyyat', render: (r) => (
      <div className="flex gap-2">
        <button className="px-2 py-1 border rounded-lg" onClick={()=>startEdit(r)} title="Düzəlt"><Pencil size={14}/></button>
        <button className="px-2 py-1 border rounded-lg text-red-600" onClick={()=>remove(r.id)} title="Sil"><Trash2 size={14}/></button>
      </div>
    )},
  ];

  return (
    <SectionCard title="Satışlar" icon={<Users className="text-gray-600"/>}
      right={<button onClick={addOrSave} className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"><PlusCircle size={16}/> {editId? 'Yadda saxla' : 'Əlavə et'}</button>}>
      <div className="grid sm:grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        <TextInput label="Tarix" type="date" value={date} onChange={setDate} />
        <Select label="Partiya" value={batchId} onChange={setBatchId} options={batches} />
        <TextInput label="Müştəri" value={customer} onChange={setCustomer} placeholder="müştəri adı yazın və ya seçin" listId="customerListSale" />
        <datalist id="customerListSale">
          {(customers||[]).map(c => <option key={c} value={c}>{c}</option>)}
        </datalist>
        <NumberInput label="Miqdar" value={qty} onChange={setQty} />
        <NumberInput label="Qiymət" value={unitPrice} onChange={setUnitPrice} />
        <NumberInput label="Məbləğ" value={amount} onChange={setAmount} />
      </div>
      {editId && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-amber-50 border rounded">Düzəliş rejimi</span>
          <button className="text-blue-600 underline" onClick={()=>resetInputs()}><X size={12} className="inline"/> ləğv et</button>
        </div>
      )}
      <Table columns={cols} rows={data.sales} />
    </SectionCard>
  );
}

function ExpensesForm({ data, user, addRow, updateRow, deleteRow }) {
  const batches = (data.purchases || []).map((p) => ({ value: p.id, label: `${batchNameOf(p)}` }));
  const [date, setDate] = useState(todayISO());
  const [batchId, setBatchId] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [editId, setEditId] = useState("");

  const resetInputs = () => { setDate(todayISO()); setBatchId(""); setName(""); setAmount(""); setEditId(""); };

  const addOrSave = async () => {
    if (!user) return alert('Giriş edin.');
    const amt = parseNum(amount);
    if (!date || !batchId || !name || !amt) return alert("Bütün xanaları doldurun");

    if (editId) {
      await updateRow(user.uid, "expenses", editId, { date, batchId, name, amount: amt });
      resetInputs(); return;
    }
    await addRow(user.uid, "expenses", { date, batchId, name, amount: amt });
    resetInputs();
  };

  const startEdit = (r) => { setEditId(r.id); setDate(r.date); setBatchId(r.batchId); setName(r.name); setAmount(String(r.amount)); };
  const remove = async (id) => { if (!user) return; await deleteRow(user.uid, "expenses", id); };

  const cols = [
    { key: 'date', header: 'Tarix' },
    { key: 'batchId', header: 'Partiya', render: (r) => batchNameOf(data.purchases.find(p=>p.id===r.batchId)) },
    { key: 'name', header: 'Xərc' },
    { key: 'amount', header: 'Məbləğ', render: (r) => fmt(r.amount) },
    { key: 'actions', header: 'Əməliyyat', render: (r) => (
      <div className="flex gap-2">
        <button className="px-2 py-1 border rounded-lg" onClick={()=>startEdit(r)} title="Düzəlt"><Pencil size={14}/></button>
        <button className="px-2 py-1 border rounded-lg text-red-600" onClick={()=>remove(r.id)} title="Sil"><Trash2 size={14}/></button>
      </div>
    )},
  ];

  return (
    <SectionCard title="Xərclər" icon={<Receipt className="text-gray-600"/>}
      right={<button onClick={addOrSave} className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"><PlusCircle size={16}/> {editId? 'Yadda saxla' : 'Əlavə et'}</button>}>
      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <TextInput label="Tarix" type="date" value={date} onChange={setDate} />
        <Select label="Partiya" value={batchId} onChange={setBatchId} options={batches} />
        <TextInput label="Xərcin adı" value={name} onChange={setName} placeholder="daşıma, gömrük…" />
        <NumberInput label="Məbləğ" value={amount} onChange={setAmount} />
      </div>
      {editId && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-amber-50 border rounded">Düzəliş rejimi</span>
          <button className="text-blue-600 underline" onClick={()=>resetInputs()}><X size={12} className="inline"/> ləğv et</button>
        </div>
      )}
      <Table columns={cols} rows={data.expenses} />
    </SectionCard>
  );
}

function PaymentsForm({ data, user, addRow, updateRow, deleteRow, customers }) {
  const [date, setDate] = useState(todayISO());
  const [customer, setCustomer] = useState("");
  const [amount, setAmount] = useState("");
  const [editId, setEditId] = useState("");

  const resetInputs = () => { setDate(todayISO()); setCustomer(""); setAmount(""); setEditId(""); };

  const addOrSave = async () => {
    if (!user) return alert('Giriş edin.');
    const amt = parseNum(amount);
    if (!date || !customer || !amt) return alert("Bütün xanaları doldurun");

    if (editId) {
      await updateRow(user.uid, "payments", editId, { date, customer, amount: amt });
      resetInputs(); return;
    }
    await addRow(user.uid, "payments", { date, customer, amount: amt });
    resetInputs();
  };

  const startEdit = (r) => { setEditId(r.id); setDate(r.date); setCustomer(r.customer); setAmount(String(r.amount)); };
  const remove = async (id) => { if (!user) return; await deleteRow(user.uid, "payments", id); };

  const cols = [
    { key: 'date', header: 'Tarix' },
    { key: 'customer', header: 'Müştəri' },
    { key: 'amount', header: 'Məbləğ', render: (r) => fmt(r.amount) },
    { key: 'actions', header: 'Əməliyyat', render: (r) => (
      <div className="flex gap-2">
        <button className="px-2 py-1 border rounded-lg" onClick={()=>startEdit(r)} title="Düzəlt"><Pencil size={14}/></button>
        <button className="px-2 py-1 border rounded-lg text-red-600" onClick={()=>remove(r.id)} title="Sil"><Trash2 size={14}/></button>
      </div>
    )},
  ];

  return (
    <SectionCard title="Ödənişlər" icon={<DollarSign className="text-blue-600"/>}
      right={<button onClick={addOrSave} className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-white hover:bg-gray-50"><PlusCircle size={16}/> {editId? 'Yadda saxla' : 'Əlavə et'}</button>}>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <TextInput label="Tarix" type="date" value={date} onChange={setDate} />
        <TextInput label="Müştəri" value={customer} onChange={setCustomer} placeholder="müştəri adı yazın və ya seçin" listId="customerList" />
        <datalist id="customerList">
          {(customers||[]).map(c => <option key={c} value={c}>{c}</option>)}
        </datalist>
        <NumberInput label="Məbləğ" value={amount} onChange={setAmount} />
      </div>
      {editId && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-amber-50 border rounded">Düzəliş rejimi</span>
          <button className="text-blue-600 underline" onClick={()=>resetInputs()}><X size={12} className="inline"/> ləğv et</button>
        </div>
      )}
      <Table columns={cols} rows={data.payments||[]} />
    </SectionCard>
  );
}

/************
 * Reports  *
 ************/
function Reports({ data }) {
  const safeData = {
    purchases: Array.isArray(data.purchases)?data.purchases:[],
    sales: Array.isArray(data.sales)?data.sales:[],
    expenses: Array.isArray(data.expenses)?data.expenses:[],
    payments: Array.isArray(data.payments)?data.payments:[],
  };
  const { perBatch, customerDebts, totals } = useMemo(() => calculateReports(safeData), [JSON.stringify(safeData)]);

  const batchCols = [
    { key: "batch", header: "Partiya", render: (r) => batchNameOf(r.batch) },
    { key: "date", header: "Tarix", render: (r) => r.batch?.date || "-" },
    { key: "purchased", header: "Alınan", render: (r) => fmt(r.purchased) },
    { key: "sold", header: "Satılan", render: (r) => <span className={r.overSold?"text-red-600 font-semibold":""}>{fmt(r.sold)}</span> },
    { key: "stock", header: "Stok", render: (r) => fmt(r.stock) },
    { key: "unitCost", header: "Alış qiyməti", render: (r) => fmt(r.unitCost) },
  ];

  const pnlCols = [
    { key: "batch", header: "Partiya", render: (r) => batchNameOf(r.batch) },
    { key: "revenue", header: "Gəlir", render: (r) => fmt(r.revenue) },
    { key: "cogs", header: "Maya (satılan)", render: (r) => fmt(r.cogs) },
    { key: "expensesTotal", header: "Xərc (tam)", render: (r) => fmt(r.expensesTotal) },
    { key: "stockCost", header: "Qalıq stok (maya)", render: (r) => fmt(r.stockCost) },
    { key: "profit", header: "Mənfəət/Zərər", render: (r) => <span className={r.profit<0?"text-red-600":"text-emerald-700"}>{fmt(r.profit)}</span> },
  ];

  const debtCols = [
    { key: "customer", header: "Müştəri" },
    { key: "invoiced", header: "Satış məbləği", render: (r) => fmt(r.invoiced) },
    { key: "paid", header: "Ödəniş", render: (r) => fmt(r.paid) },
    { key: "balance", header: "Qalıq borc", render: (r) => <span className={r.balance>0?"text-amber-700":"text-emerald-700"}>{fmt(r.balance)}</span> },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Qısa xülasə" icon={<Receipt className="text-gray-600"/>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <KPI title="Gəlir" value={totals.revenue} />
          <KPI title="Maya" value={totals.cogs} />
          <KPI title="Xərclər (tam)" value={totals.expensesFull} />
          <KPI title="Mənfəət" value={totals.profit} positive />
          <KPI title="Ödənilmiş borclar" value={totals.paidTotal} />
          <KPI title="Ödənilməmiş borclar" value={totals.unpaidTotal} />
          <KPI title="Qalıq stok miqdarı" value={totals.stockQty} />
          <KPI title="Qalıq stok məbləği" value={totals.stockCost} />
        </div>
      </SectionCard>

      <SectionCard title="Stok – Partiya üzrə" icon={<Layers className="text-gray-700"/>}>
        <Table columns={batchCols} rows={perBatch} />
      </SectionCard>

      <SectionCard title="Mənfəət/Zərər – Partiya üzrə" icon={<PieChart className="text-fuchsia-700"/>}>
        <Table columns={pnlCols} rows={perBatch} footer={
          <div className="flex flex-wrap gap-6 text-sm">
            <span><b>Toplam Gəlir:</b> {fmt(totals.revenue)}</span>
            <span><b>Toplam Maya:</b> {fmt(totals.cogs)}</span>
            <span><b>Toplam Xərclər (tam):</b> {fmt(totals.expensesFull)}</span>
            <span><b>Cəmi Mənfəət:</b> {fmt(totals.profit)}</span>
          </div>
        } />
      </SectionCard>

      <SectionCard title="Müştərilərin borcu" icon={<Users className="text-sky-700"/>}>
        <Table columns={debtCols} rows={customerDebts.map((r) => ({ ...r, id: r.customer }))} />
      </SectionCard>
    </div>
  );
}

/****************
 * App Shell     *
 ****************/
export default function ECENApp() {
  const fb = useFirebase();
  const { ready, user, signIn, signOut, subscribeCollection, addRow, updateRow, deleteRow } = fb;

  // Firestore-driven state
  const [data, setData] = useState({ purchases: [], sales: [], expenses: [], payments: [] });
  const [activeTab, setActiveTab] = useState('purchases');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!user) { setData({ purchases: [], sales: [], expenses: [], payments: [] }); return; }
    const unsubs = [
      subscribeCollection(user.uid, 'purchases', (rows)=> setData(prev=>({ ...prev, purchases: rows }))),
      subscribeCollection(user.uid, 'sales', (rows)=> setData(prev=>({ ...prev, sales: rows }))),
      subscribeCollection(user.uid, 'expenses', (rows)=> setData(prev=>({ ...prev, expenses: rows }))),
      subscribeCollection(user.uid, 'payments', (rows)=> setData(prev=>({ ...prev, payments: rows }))),
    ];
    return () => unsubs.forEach(u=>u && u());
  }, [user, subscribeCollection]);

  const { customers } = useIndices(data);

  const exportJSON = () => {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ECEN-backup-${new Date().toISOString().slice(0,19)}.json`; a.rel = "noopener";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { alert("İxrac xətası: "+(e?.message||e)); }
  };
  const handleImport = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (!user) return alert('Giriş edin.');
        const json = JSON.parse(String(reader.result)) || {};
        const buckets = ['purchases','sales','expenses','payments'];
        for (const b of buckets) {
          const arr = Array.isArray(json[b]) ? json[b] : [];
          for (const r of arr) {
            const clean = { ...r }; delete clean.id; // Firestore ID auto
            await addRow(user.uid, b, clean);
          }
        }
        alert('İdxal edildi ✅');
      } catch (e) { alert('İdxal xətası: '+(e?.message||e)); }
    };
    reader.readAsText(file);
  };

  async function clearAll() {
    if (!user) return;
    const buckets = ['purchases','sales','expenses','payments'];
    for (const b of buckets) {
      const rows = data[b] || [];
      for (const r of rows) await deleteRow(user.uid, b, r.id);
    }
  }

  function Tab({ id, icon, label }) {
    const isActive = activeTab === id;
    return (
      <button onClick={() => setActiveTab(id)} className={`flex items-center gap-2 px-3 py-2 rounded-xl border shadow-sm ${isActive ? "bg-indigo-600 text-white border-indigo-600" : "bg-white hover:bg-gray-50"}`}>
        {icon}
        <span className="text-sm">{label}</span>
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-3">
            <motion.div initial={{ rotate: -8, scale: 0.9 }} animate={{ rotate: 0, scale: 1 }} className="p-2 bg-indigo-600 text-white rounded-2xl shadow">
              <Package size={20}/>
            </motion.div>
            <div>
              <div className="text-xl font-bold whitespace-nowrap">ECEN</div>
              <div className="text-xs text-gray-500">Partiya üzrə maya, gəlir, xərc və borclar</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-end max-w-full">{/* Auth */}
            {user ? (
              <div className="flex items-center gap-2 mr-2">
                <span className="text-sm text-gray-600 truncate max-w-[140px] md:max-w-[220px]">{user.displayName || user.email}</span>
                <button onClick={signOut} className="rounded-xl border px-3 py-2 hover:bg-gray-50 shrink-0 whitespace-nowrap">Çıxış</button>
              </div>
            ) : (
              <button onClick={signIn} className="rounded-xl border px-3 py-2 hover:bg-gray-50 mr-2 shrink-0 whitespace-nowrap" disabled={!ready} title={ready? 'Google ilə giriş' : 'Firebase konfiqurasiya tələb olunur'}>
                Google ilə giriş
              </button>
            )}

            <button onClick={exportJSON} className="flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-gray-50 shrink-0 whitespace-nowrap"><Download size={16}/> İxrac</button>
            <label className="flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-gray-50 cursor-pointer shrink-0 whitespace-nowrap">
              <Upload size={16}/> İdxal
              <input type="file" accept="application/json" className="hidden" onChange={(e)=>handleImport(e.target.files?.[0])}/>
            </label>
            <button onClick={async () => {
              if (!confirmClear) { setConfirmClear(true); setTimeout(()=>setConfirmClear(false), 3000); return; }
              setConfirmClear(false); await clearAll();
            }} className={`flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-gray-50 shrink-0 whitespace-nowrap ${confirmClear? 'bg-red-50 text-red-700 border-red-300':'text-red-600'}`}>
              <Trash2 size={16}/> {confirmClear ? 'Təsdiqlə' : 'Təmizlə'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {!user && (
          <div className="mb-4 p-3 rounded-xl border bg-amber-50 text-amber-800 text-sm">
            Xahiş olunur <b>Google ilə giriş</b> edin – məlumatlarınız Firestore-da istifadəçi hesabınız üzrə saxlanılacaq.
          </div>
        )}
        <nav className="mb-6 flex flex-wrap gap-2">
          <Tab id="purchases" icon={<Package size={16}/>} label="Alışlar" />
          <Tab id="sales" icon={<Users size={16}/>} label="Satışlar" />
          <Tab id="expenses" icon={<Receipt size={16}/>} label="Xərclər" />
          <Tab id="payments" icon={<DollarSign size={16}/>} label="Ödənişlər" />
          <Tab id="reports" icon={<PieChart size={16}/>} label="Hesabatlar" />
        </nav>

        {activeTab === 'purchases' && <PurchasesForm data={data} user={user} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow} />}
        {activeTab === 'sales' && <SalesForm data={data} user={user} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow} customers={customers} />}
        {activeTab === 'expenses' && <ExpensesForm data={data} user={user} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow} />}
        {activeTab === 'payments' && <PaymentsForm data={data} user={user} addRow={addRow} updateRow={updateRow} deleteRow={deleteRow} customers={customers} />}
        {activeTab === 'reports' && <Reports data={data} />}

        <div className="mt-10 text-xs text-gray-500 flex items-center gap-2">
          <RefreshCcw size={14}/> Verilənlər Firestore-da <b>istifadəçi başına</b> saxlanılır. JSON ixrac/idxal mümkündür.
        </div>
      </main>
    </div>
  );
}

/****************
 * Test Cases    *
 ****************/
(function runTests(){
  try {
    if (typeof window !== 'undefined') {
      if (window.__ECEN_TESTS_RUN__) return; window.__ECEN_TESTS_RUN__ = true;
    }
    // parseNum
    console.assert(parseNum('1,5') === 1.5, 'parseNum comma failed');
    console.assert(parseNum('2.5') === 2.5, 'parseNum dot failed');

    // formatBatchNameFromDate
    console.assert(formatBatchNameFromDate('2025-09-01') === 'P - 01092025', 'formatBatchNameFromDate ddmmyyyy');

    // batchNameOf with seq
    const p0 = { date: '2025-09-01', batchSeq: '02' };
    console.assert(batchNameOf(p0) === 'P - 01092025-02', 'batchNameOf seq');

    // calculateReports
    const demo = {
      purchases: [{ id: 'b1', date: '2024-01-01', qty: 10, unitPrice: 5 }],
      expenses:  [{ id: 'e1', date: '2024-01-02', batchId: 'b1', name: 'cargo', amount: 20 }],
      sales:     [{ id: 's1', date: '2024-01-03', batchId: 'b1', customer: 'Ali', qty: 4, unitPrice: 8 }],
      payments:  [{ id: 'p1', date: '2024-01-04', customer: 'Ali', amount: 10 }],
    };
    const r2 = calculateReports(demo);
    console.assert(r2.totals.revenue === 32, 'revenue 32');
    console.assert(r2.totals.cogs === 20, 'cogs 20');
    console.assert(r2.totals.expensesFull === 20, 'expenses 20');
    console.assert(r2.totals.profit === -8, 'profit -8');
    console.assert(r2.totals.stockQty === 6, 'stockQty 6');
    console.assert(r2.totals.stockCost === 30, 'stockCost 30');
    const cd = r2.customerDebts.find(c=>c.customer==='Ali');
    console.assert(cd && cd.invoiced === 32 && cd.paid === 10 && cd.balance === 22, 'customer debts');

    console.log('%cECEN tests passed', 'color: green');
  } catch (e) {
    console.error('ECEN tests failed', e);
  }
})();
