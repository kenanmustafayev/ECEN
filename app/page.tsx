import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Download, Upload, Trash2, PlusCircle, RefreshCcw, PieChart, Package, Users, DollarSign, Receipt, Layers } from "lucide-react";

// --- Simple helpers ---
const fmt = (n) => (isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-");
const parseNum = (v) => {
  const n = Number(String(v).replace(/,/g, "."));
  return isFinite(n) ? n : 0;
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// --- Storage ---
const STORAGE_KEY = "ECEN_DATA_V2"; // bumped version after schema/UI changes
const emptyData = {
  purchases: [], // {id, date, batchCode, qty, unitPrice}
  sales: [], // {id, date, batchId, customer, qty, unitPrice}
  expenses: [], // {id, date, batchId, name, amount}
  payments: [], // {id, date, customer, amount}
};

function usePersistedData() {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      // migrate V1 if present
      const v1 = localStorage.getItem("ECEN_DATA_V1");
      return v1 ? JSON.parse(v1) : emptyData;
    } catch (e) {
      console.warn("Failed to load ECEN data:", e);
      return emptyData;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const reset = () => setData(emptyData);
  const loadFromFile = (json) => setData(json);

  return { data, setData, reset, loadFromFile };
}

// --- Derived indices ---
function useIndices(data) {
  const batchIndex = useMemo(() => {
    const m = new Map();
    data.purchases.forEach((p) => m.set(p.id, p));
    return m;
  }, [data.purchases]);

  const customers = useMemo(() => {
    const set = new Set();
    data.sales.forEach((s) => s.customer && set.add(s.customer));
    data.payments.forEach((p) => p.customer && set.add(p.customer));
    return Array.from(set).sort();
  }, [data.sales, data.payments]);

  return { batchIndex, customers };
}

// --- Core calculations ---
function calculateReports(data) {
  const batchStats = new Map();

  // Initialize per batch from purchases
  for (const pur of data.purchases) {
    batchStats.set(pur.id, {
      batch: pur,
      purchasedQty: parseNum(pur.qty),
      unitCost: parseNum(pur.unitPrice),
      soldQty: 0,
      salesRevenue: 0,
      expensesTotal: 0,
    });
  }

  // Sales accumulation
  for (const s of data.sales) {
    const st = batchStats.get(s.batchId);
    if (!st) continue; // dangling
    const qty = parseNum(s.qty);
    const price = parseNum(s.unitPrice);
    st.soldQty += qty;
    st.salesRevenue += qty * price;
  }

  // Expenses accumulation (full per batch)
  for (const e of data.expenses) {
    const st = batchStats.get(e.batchId);
    if (!st) continue;
    st.expensesTotal += parseNum(e.amount);
  }

  // Compute derived per batch
  const perBatch = [];
  for (const [batchId, st] of batchStats) {
    const purchased = st.purchasedQty;
    const sold = st.soldQty;
    const stock = Math.max(0, purchased - sold);
    const revenue = st.salesRevenue;
    const cogs = st.unitCost * sold;
    const expensesFull = st.expensesTotal; // NOT allocated
    const profit = revenue - cogs - expensesFull;
    const stockCost = stock * st.unitCost; // remaining stock at cost

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

  // Customer debts
  const byCustomer = new Map();
  for (const s of data.sales) {
    const cust = s.customer || "(noname)";
    const amt = parseNum(s.qty) * parseNum(s.unitPrice);
    const obj = byCustomer.get(cust) || { invoiced: 0, paid: 0 };
    obj.invoiced += amt;
    byCustomer.set(cust, obj);
  }
  for (const p of data.payments) {
    const cust = p.customer || "(noname)";
    const amt = parseNum(p.amount);
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

  // Totals (include full expenses, paid/unpaid, stock qty/cost)
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

// --- UI Components ---
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

function Datalist({ id, options }) {
  return (
    <datalist id={id}>
      {options.map((o) => (
        <option key={o} value={o} />
      ))}
    </datalist>
  );
}

function NumberInput(props) {
  return <TextInput {...props} type="number" />;
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
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
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
          {rows.map((r) => (
            <tr key={r.id || r.key} className="border-t">
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

function Toolbar({ onExport, onImport, onReset }) {
  const fileRef = React.useRef(null);
  return (
    <div className="flex gap-2 flex-wrap">
      <button
        className="flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-gray-50"
        onClick={onExport}
        title="JSON ixrac et"
      >
        <Download size={16}/> İxrac (JSON)
      </button>
      <button
        className="flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-gray-50"
        onClick={() => fileRef.current?.click()}
        title="JSON idxal et"
      >
        <Upload size={16}/> İdxal (JSON)
      </button>
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          try { onImport(JSON.parse(String(reader.result))); }
          catch (err) { alert("İdxal xətası: " + err.message); }
        };
        reader.readAsText(f);
      }} />
      <button
        className="flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-gray-50 text-red-600"
        onClick={onReset}
        title="Bütün verilənləri sil"
      >
        <Trash2 size={16}/> Təmizlə
      </button>
    </div>
  );
}

// --- Forms ---
function PurchasesForm({ data, setData }) {
  const [date, setDate] = useState(todayISO());
  const [qty, setQty] = useState(0);
  const [unitPrice, setUnitPrice] = useState(0);
  const [amount, setAmount] = useState(0); // total amount (optional)

  const add = () => {
    const qtyN = parseNum(qty);
    let up = parseNum(unitPrice);
    const amt = parseNum(amount);
    if (qtyN <= 0) return alert("Miqdar > 0 olmalıdır");
    // Auto-calc unit price if amount given and unitPrice empty/zero
    if ((up === 0 || !isFinite(up)) && amt > 0) {
      up = amt / qtyN;
    }
    if (up < 0) return alert("Qiymət mənfi ola bilməz");
    const id = uid();
    const seq = (data.purchases.filter(p => p.date === date).length + 1).toString().padStart(2, "0");
    const batchCode = `P-${date.replaceAll('-', '')}-${seq}`;
    setData({
      ...data,
      purchases: [
        { id, date, batchCode, qty: qtyN, unitPrice: up },
        ...data.purchases,
      ],
    });
    setQty(0); setUnitPrice(0); setAmount(0);
  };

  const columns = [
    { key: "batchCode", header: "Partiya" },
    { key: "date", header: "Tarix" },
    { key: "qty", header: "Miqdar", render: (r) => fmt(r.qty) },
    { key: "unitPrice", header: "Alış qiyməti", render: (r) => fmt(r.unitPrice) },
    { key: "amount", header: "Məbləğ", render: (r) => fmt(r.qty * r.unitPrice) },
  ];

  return (
    <SectionCard title="Alışlar (Hər alış – partiya)" icon={<Package className="text-indigo-600"/>}
      right={<div className="text-sm text-gray-500">Partiya kodu avtomatik yaradılır (məs: P-20250105-01)</div>}>
      <div className="grid md:grid-cols-6 gap-3 mb-4">
        <TextInput label="Tarix" type="date" value={date} onChange={setDate} />
        <NumberInput label="Miqdar" value={qty} onChange={setQty} />
        <NumberInput label="Alış qiyməti (1 vahid)" value={unitPrice} onChange={setUnitPrice} />
        <NumberInput label="Məbləğ (cəmi)" value={amount} onChange={setAmount} />
        <div className="flex items-end">
          <button className="flex items-center gap-2 rounded-xl bg-indigo-600 text-white px-4 py-2 hover:bg-indigo-700" onClick={add}>
            <PlusCircle size={18}/> Əlavə et
          </button>
        </div>
      </div>
      <Table columns={columns} rows={data.purchases} />
    </SectionCard>
  );
}

function SalesForm({ data, setData, customers }) {
  const [date, setDate] = useState(todayISO());
  const [batchId, setBatchId] = useState("");
  const [customer, setCustomer] = useState("");
  const [qty, setQty] = useState(0);
  const [unitPrice, setUnitPrice] = useState(0);
  const [amount, setAmount] = useState(0); // optional total amount

  const add = () => {
    if (!batchId) return alert("Partiya seçin");
    if (!customer) return alert("Müştəri adı boş ola bilməz");
    const qtyN = parseNum(qty);
    let up = parseNum(unitPrice);
    const amt = parseNum(amount);
    if (qtyN <= 0) return alert("Miqdar > 0 olmalıdır");
    if ((up === 0 || !isFinite(up)) && amt > 0) {
      up = amt / qtyN; // derive unit price from amount
    }
    if (up < 0) return alert("Satış qiyməti mənfi ola bilməz");

    const soldSoFar = data.sales.filter(s => s.batchId === batchId).reduce((a, b) => a + parseNum(b.qty), 0);
    const purchased = data.purchases.find(p => p.id === batchId)?.qty || 0;
    if (qtyN + soldSoFar > purchased) {
      const proceed = confirm("Diqqət: Bu satış partiya üzrə mövcud miqdarı aşır. Yenə də əlavə etmək istəyirsiniz?");
      if (!proceed) return;
    }

    setData({
      ...data,
      sales: [ { id: uid(), date, batchId, customer, qty: qtyN, unitPrice: up }, ...data.sales ],
    });
    setQty(0); setUnitPrice(0); setAmount(0); setCustomer("");
  };

  const columns = [
    { key: "date", header: "Tarix" },
    { key: "batchId", header: "Partiya", render: (r) => data.purchases.find(p => p.id === r.batchId)?.batchCode || "?" },
    { key: "customer", header: "Müştəri" },
    { key: "qty", header: "Miqdar", render: (r) => fmt(r.qty) },
    { key: "unitPrice", header: "Satış qiyməti", render: (r) => fmt(r.unitPrice) },
    { key: "amount", header: "Məbləğ", render: (r) => fmt(parseNum(r.qty) * parseNum(r.unitPrice)) },
  ];

  return (
    <SectionCard title="Satışlar" icon={<Users className="text-emerald-600"/>}>
      <div className="grid md:grid-cols-7 gap-3 mb-4">
        <TextInput label="Tarix" type="date" value={date} onChange={setDate} />
        <Select label="Partiya" value={batchId} onChange={setBatchId} options={data.purchases.map(p => ({ value: p.id, label: `${p.batchCode} (qty ${fmt(p.qty)})` }))} />
        <TextInput label="Müştəri" value={customer} onChange={setCustomer} placeholder="Məs: AZPRINT MMC" listId="customersList" />
        <Datalist id="customersList" options={customers} />
        <NumberInput label="Miqdar" value={qty} onChange={setQty} />
        <NumberInput label="Satış qiyməti (1 vahid)" value={unitPrice} onChange={setUnitPrice} />
        <NumberInput label="Məbləğ (cəmi)" value={amount} onChange={setAmount} />
        <div className="flex items-end">
          <button className="flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700" onClick={add}>
            <PlusCircle size={18}/> Əlavə et
          </button>
        </div>
      </div>
      <Table columns={columns} rows={data.sales} />
    </SectionCard>
  );
}

function ExpensesForm({ data, setData }) {
  const [date, setDate] = useState(todayISO());
  const [batchId, setBatchId] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(0);

  const add = () => {
    if (!batchId) return alert("Partiya seçin");
    if (!name) return alert("Xərcin adını yazın");
    const amt = parseNum(amount);
    if (amt <= 0) return alert("Məbləğ > 0 olmalıdır");
    setData({ ...data, expenses: [{ id: uid(), date, batchId, name, amount: amt }, ...data.expenses ] });
    setAmount(0); setName("");
  };

  const columns = [
    { key: "date", header: "Tarix" },
    { key: "batchId", header: "Partiya", render: (r) => data.purchases.find(p => p.id === r.batchId)?.batchCode || "?" },
    { key: "name", header: "Xərc adı" },
    { key: "amount", header: "Məbləğ", render: (r) => fmt(r.amount) },
  ];

  return (
    <SectionCard title="Xərclər" icon={<Receipt className="text-amber-600"/>}>
      <div className="grid md:grid-cols-5 gap-3 mb-4">
        <TextInput label="Tarix" type="date" value={date} onChange={setDate} />
        <Select label="Partiya" value={batchId} onChange={setBatchId} options={data.purchases.map(p => ({ value: p.id, label: p.batchCode }))} />
        <TextInput label="Xərcin adı" value={name} onChange={setName} placeholder="Daşınma, gömrük və s." />
        <NumberInput label="Məbləğ" value={amount} onChange={setAmount} />
        <div className="flex items-end">
          <button className="flex items-center gap-2 rounded-xl bg-amber-600 text-white px-4 py-2 hover:bg-amber-700" onClick={add}>
            <PlusCircle size={18}/> Əlavə et
          </button>
        </div>
      </div>
      <Table columns={columns} rows={data.expenses} />
    </SectionCard>
  );
}

function PaymentsForm({ data, setData, customers }) {
  const [date, setDate] = useState(todayISO());
  const [customer, setCustomer] = useState("");
  const [amount, setAmount] = useState(0);

  const add = () => {
    if (!customer) return alert("Müştəri adı boş ola bilməz");
    const amt = parseNum(amount);
    if (amt <= 0) return alert("Məbləğ > 0 olmalıdır");
    setData({ ...data, payments: [{ id: uid(), date, customer, amount: amt }, ...data.payments ] });
    setAmount(0); setCustomer("");
  };

  const columns = [
    { key: "date", header: "Tarix" },
    { key: "customer", header: "Müştəri" },
    { key: "amount", header: "Məbləğ", render: (r) => fmt(r.amount) },
  ];

  return (
    <SectionCard title="Ödənişlər" icon={<DollarSign className="text-blue-600"/>}>
      <div className="grid md:grid-cols-4 gap-3 mb-4">
        <TextInput label="Tarix" type="date" value={date} onChange={setDate} />
        <TextInput label="Müştəri" value={customer} onChange={setCustomer} listId="customersList2" />
        <Datalist id="customersList2" options={customers} />
        <NumberInput label="Məbləğ" value={amount} onChange={setAmount} />
        <div className="flex items-end">
          <button className="flex items-center gap-2 rounded-xl bg-blue-600 text-white px-4 py-2 hover:bg-blue-700" onClick={add}>
            <PlusCircle size={18}/> Əlavə et
          </button>
        </div>
      </div>
      <Table columns={columns} rows={data.payments} />
    </SectionCard>
  );
}

function Reports({ data }) {
  const { perBatch, customerDebts, totals } = useMemo(() => calculateReports(data), [data]);

  const batchCols = [
    { key: "code", header: "Partiya", render: (r) => r.batch.batchCode },
    { key: "date", header: "Tarix", render: (r) => r.batch.date },
    { key: "purchased", header: "Alınan", render: (r) => fmt(r.purchased) },
    { key: "sold", header: "Satılan", render: (r) => <span className={r.overSold?"text-red-600 font-semibold":""}>{fmt(r.sold)}</span> },
    { key: "stock", header: "Stok", render: (r) => fmt(r.stock) },
    { key: "unitCost", header: "Alış qiyməti", render: (r) => fmt(r.unitCost) },
  ];

  const pnlCols = [
    { key: "code", header: "Partiya", render: (r) => r.batch.batchCode },
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
    <div className="grid lg:grid-cols-2 gap-6">
      <SectionCard title="Stok – Partiya üzrə" icon={<Layers className="text-gray-700"/>}>
        <Table columns={batchCols} rows={perBatch} />
      </SectionCard>

      <SectionCard title="Mənfəət/Zərər – Partiya üzrə" icon={<PieChart className="text-fuchsia-700"/>}>
        <Table columns={pnlCols} rows={perBatch} footer={
          <div className="flex gap-6 text-sm">
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

      <SectionCard title="Qısa xülasə" icon={<Receipt className="text-gray-600"/>}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
    </div>
  );
}

function KPI({ title, value, positive=false }) {
  return (
    <div className="rounded-2xl border p-4 min-w-[190px]">
      <div className="text-sm text-gray-600 break-words">{title}</div>
      <div className={`text-xl md:text-2xl font-semibold break-words ${positive && value>=0 ? "text-emerald-700" : value<0?"text-red-600":""}`}>{fmt(value)}</div>
    </div>
  );
}

// --- Self tests (non-breaking) ---
(function runSelfTests(){
  try {
    // Test 1: empty data
    const d1 = { purchases: [], sales: [], expenses: [], payments: [] };
    const r1 = calculateReports(d1);
    console.assert(r1.perBatch.length === 0, "Test1: perBatch empty");
    console.assert(r1.totals.revenue === 0 && r1.totals.cogs === 0 && r1.totals.expensesFull === 0 && r1.totals.profit === 0, "Test1: totals zero");

    // Test 2: one purchase, one sale, one expense, one payment
    const d2 = {
      purchases: [{ id: "b1", date: "2025-01-01", batchCode: "P-20250101-01", qty: 10, unitPrice: 5 }],
      sales: [{ id: "s1", date: "2025-01-02", batchId: "b1", customer: "Test MMC", qty: 4, unitPrice: 7 }],
      expenses: [{ id: "e1", date: "2025-01-03", batchId: "b1", name: "Daşınma", amount: 10 }],
      payments: [{ id: "p1", date: "2025-01-04", customer: "Test MMC", amount: 15 }],
    };
    const r2 = calculateReports(d2);
    const t2 = r2.totals;
    console.assert(t2.revenue === 28, "Test2: revenue 28");
    console.assert(t2.cogs === 20, "Test2: cogs 20");
    console.assert(t2.expensesFull === 10, "Test2: expenses 10");
    console.assert(t2.profit === -2, "Test2: profit -2");
    console.assert(t2.stockQty === 6 && t2.stockCost === 30, "Test2: stock 6 @ cost 30");
    console.assert(t2.paidTotal === 15 && t2.unpaidTotal === 13, "Test2: paid 15, unpaid 13");
  } catch (e) {
    console.warn("ECEN self-tests warning:", e);
  }
})();

// --- Main App ---
export default function ECENApp() {
  const { data, setData, reset, loadFromFile } = usePersistedData();
  const { customers } = useIndices(data);
  const [activeTab, setActiveTab] = useState("purchases");

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ECEN-backup-${new Date().toISOString().slice(0,19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div initial={{ rotate: -8, scale: 0.9 }} animate={{ rotate: 0, scale: 1 }} className="p-2 bg-indigo-600 text-white rounded-2xl shadow">
              <Package size={20}/>
            </motion.div>
            <div>
              <div className="text-xl font-bold">ECEN</div>
              <div className="text-xs text-gray-500">Partiya üzrə maya, gəlir, xərc və borclar</div>
            </div>
          </div>
          <Toolbar onExport={exportJSON} onImport={loadFromFile} onReset={() => { if (confirm("Bütün verilənlər silinsin?")) reset(); }} />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <nav className="mb-6 flex flex-wrap gap-2">
          <Tab id="purchases" active={activeTab} setActive={setActiveTab} icon={<Package size={16}/>} label="Alışlar" />
          <Tab id="sales" active={activeTab} setActive={setActiveTab} icon={<Users size={16}/>} label="Satışlar" />
          <Tab id="expenses" active={activeTab} setActive={setActiveTab} icon={<Receipt size={16}/>} label="Xərclər" />
          <Tab id="payments" active={activeTab} setActive={setActiveTab} icon={<DollarSign size={16}/>} label="Ödənişlər" />
          <Tab id="reports" active={activeTab} setActive={setActiveTab} icon={<PieChart size={16}/>} label="Hesabatlar" />
        </nav>

        {activeTab === "purchases" && <PurchasesForm data={data} setData={setData} />}
        {activeTab === "sales" && <SalesForm data={data} setData={setData} customers={customers} />}
        {activeTab === "expenses" && <ExpensesForm data={data} setData={setData} />}
        {activeTab === "payments" && <PaymentsForm data={data} setData={setData} customers={customers} />}
        {activeTab === "reports" && <Reports data={data} />}

        <div className="mt-10 text-xs text-gray-500 flex items-center gap-2">
          <RefreshCcw size={14}/> Verilənlər brauzerin LocalStorage-ində saxlanılır. JSON ixrac/idxal mümkündür.
        </div>
      </main>
    </div>
  );
}

function Tab({ id, active, setActive, icon, label }) {
  const isActive = active === id;
  return (
    <button
      onClick={() => setActive(id)}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border shadow-sm ${isActive ? "bg-indigo-600 text-white border-indigo-600" : "bg-white hover:bg-gray-50"}`}
    >
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  );
}
