// script.js — updated: admin-only actions + real DB updates using Service Role key (insecure for production)
const SUPABASE_URL = 'https://meaxdcjjcjugyceugwqt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lYXhkY2pqY2p1Z3ljZXVnd3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc0MDA2MDIsImV4cCI6MjA2Mjk3NjYwMn0.sB3z-8vxrsV48K2ccBhFvZ7acV0Ub5R0gZ05Fe7FNp8'; // <-- put your anon/public key here

// ***** WARNING *****
// The following SERVICE_ROLE_KEY is embedded so admin actions succeed from the browser.
// This is insecure for production. Use only for testing. Replace/remove once you
// move admin updates to a server-side function.
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lYXhkY2pqY2p1Z3ljZXVnd3F0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NzQwMDYwMiwiZXhwIjoyMDYyOTc2NjAyfQ.BJ2Ts4S9muH-JUNcYoqnU_wS5fIYhDx1qjuo2N_20c8';

// create supabase client (UMD)
if (!window.supabase) throw new Error('Supabase library not loaded.');
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let isAdmin = false; // global role flag (true only when logged-in user is admin)
let currentUser = null;

/* ---------- LOGIN & USER SETUP ---------- */
async function login() {
  try {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email || !password) { alert('Enter email and password'); return; }

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) { alert('Login failed: ' + error.message); return; }
    const user = data?.user;
    if (!user) { alert('Login returned no user'); return; }

    currentUser = user;
    document.getElementById('dashboard').style.display = 'block';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('userEmail').innerText = user.email || '';
    document.getElementById('logoutBtn').style.display = 'inline-block';
    document.getElementById('logoutVisibleBtn').style.display = 'inline-block';

    // fetch user record to determine role
    await loadUserRole(user.id, user.email);

    // initial loads
    await fetchBills();
    await fetchMonthlyTotal();

    setupTabs();
  } catch (err) {
    console.error('login error', err);
    alert('Login error: ' + (err?.message || err));
  }
}

async function loadUserRole(authUserId, email) {
  try {
    // Try to find the user row in public.users by auth id or email
    // Prefer matching auth id (user.id) to users.id foreign key if set,
    // otherwise fallback to email match.
    let q = client.from('users').select('id, name, role, email').limit(1);
    // try by auth id (users.id references auth.users.id in your schema)
    const byAuth = await q.eq('id', authUserId).maybeSingle();
    if (byAuth.error) {
      console.warn('user lookup by id error', byAuth.error);
    }
    let userRow = byAuth.data;
    if (!userRow) {
      const byEmail = await client.from('users').select('id, name, role, email').eq('email', email).limit(1).maybeSingle();
      if (byEmail.error) console.warn('user lookup by email error', byEmail.error);
      userRow = byEmail.data;
    }

    if (!userRow) {
      document.getElementById('userName').innerText = email;
      isAdmin = false;
      return;
    }

    document.getElementById('userName').innerText = (userRow.name || userRow.email) + (userRow.role === 'admin' ? ' [ADMIN]' : '');
    isAdmin = (userRow.role === 'admin');
  } catch (err) {
    console.error('loadUserRole error', err);
    isAdmin = false;
  }
}

async function logout() {
  try { await client.auth.signOut(); } catch (e){/*ignore*/}
  location.reload();
}

/* ---------- UI Tabs ---------- */
function setupTabs() {
  if (setupTabs._done) return;
  setupTabs._done = true;
  document.querySelectorAll('.tab').forEach(t=>{
    t.addEventListener('click', ()=> {
      document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.tabContent').forEach(c=>c.classList.remove('active'));
      t.classList.add('active');
      document.getElementById(t.getAttribute('data-target')).classList.add('active');

      const target = t.getAttribute('data-target');
      if (target === 'tab-verify') loadPPV();
      if (target === 'tab-monthly') {
        if (!document.getElementById('monthPick').value) {
          const now = new Date(); const y = now.getFullYear(); const m = String(now.getMonth()+1).padStart(2,'0');
          document.getElementById('monthPick').value = `${y}-${m}`;
        }
        loadMonth();
      }
      if (target === 'tab-all') loadAllBills();
      if (target === 'tab-home') fetchBills();
    });
  });

  document.getElementById('monthPick').addEventListener('change', loadMonth);
}

/* ---------- Recent bills ---------- */
async function fetchBills() {
  try {
    const { data: bills, error } = await client
      .from('bills')
      .select('id, amount, status, timestamp, user_id, users(name)')
      .order('timestamp', { ascending: false });

    if (error) { console.error('fetchBills error', error); document.getElementById('billTable').innerHTML = '<p>Error loading bills</p>'; return; }

    if (!bills || bills.length === 0) {
      document.getElementById('billTable').innerHTML = "<p>No bills found.</p>";
      return;
    }

    const isAdminLocal = isAdmin;
    let html = `<table><tr>`;
    if (isAdminLocal) { html += `<th>Name</th>`; }
    html += `<th>Amount</th><th>Status</th><th>Date</th></tr>`;

    for (const bill of bills) {
      html += `<tr>`;
      if (isAdminLocal) {
        const userName = bill.users ? bill.users.name : bill.user_id || 'Unknown';
        html += `<td>${escapeHtml(userName)}</td>`;
      }
      html += `<td>&#8377;${bill.amount}</td><td>${escapeHtml(bill.status)}</td><td>${new Date(bill.timestamp).toLocaleString()}</td></tr>`;
    }
    html += `</table>`;
    document.getElementById('billTable').innerHTML = html;
  } catch (err) {
    console.error('fetchBills unexpected', err);
    document.getElementById('billTable').innerHTML = '<p>Error loading bills</p>';
  }
}

/* ---------- Monthly summary ---------- */
async function fetchMonthlyTotal() {
  try {
    const getUser = await client.auth.getUser();
    const user = getUser?.data?.user ?? null;
    if (!user) return;
    const { data: totals, error } = await client.from('monthly_user_totals').select('total_monthly_amount').eq('user_id', user.id).limit(1);
    if (error || !totals || totals.length === 0) {
      document.getElementById('monthlyReport').innerHTML = "<p class='muted'>No monthly total to display yet.</p>";
      return;
    }
    const currentMonthTotal = totals[0].total_monthly_amount;
    document.getElementById('monthlyReport').innerHTML = `<div class="muted">This Month's Total:</div><div style="font-weight:600">&#8377;${currentMonthTotal}</div>`;
  } catch (err) {
    console.error('fetchMonthlyTotal error', err);
    document.getElementById('monthlyReport').innerHTML = "<p class='muted'>No monthly total to display.</p>";
  }
}

/* ---------- Payments to Verify (grouped view) ---------- */
function monthIsoFromTs(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  return `${y}-${m}`;
}

async function loadPPV() {
  try {
    const { data, error } = await client
      .from('bills')
      .select('id, amount, timestamp, user_id, users(name, email)')
      .eq('status','paid-pending-verification')
      .order('timestamp', { ascending: true });

    if (error) { console.error('loadPPV error', error); document.querySelector('#ppvTable tbody').innerHTML = `<tr><td colspan="4">Error loading</td></tr>`; return; }

    const groups = new Map();
    (data || []).forEach(row => {
      const monthIso = monthIsoFromTs(row.timestamp);
      const key = `${row.user_id}__${monthIso}`;
      if (!groups.has(key)) {
        groups.set(key, { user_id: row.user_id, name: row.users?.name ?? '-', email: row.users?.email ?? '-', monthIso, ids: [], total: 0 });
      }
      const g = groups.get(key);
      g.ids.push(row.id);
      g.total += Number(row.amount || 0);
    });

    const tbody = document.querySelector('#ppvTable tbody');
    tbody.innerHTML = '';

    if (groups.size === 0) {
      tbody.innerHTML = `<tr><td colspan="4">No payments awaiting verification.</td></tr>`;
      return;
    }

    for (const [key, g] of groups.entries()) {
      const tr = document.createElement('tr');
      let actionsHTML = '<span class="muted">No actions</span>';
      if (isAdmin) {
        // Admin sees action buttons (only)
        actionsHTML = `<button class="smallBtn" onclick='verifyUserMonth("${g.user_id}", "${g.monthIso}", ${JSON.stringify(g.ids)})'>Verify</button>
                       <button class="smallBtn dangerBtn" style="margin-left:8px;" onclick='markPendingUserMonth("${g.user_id}", "${g.monthIso}", ${JSON.stringify(g.ids)})'>Mark Pending</button>`;
      }
      tr.innerHTML =
        `<td>${escapeHtml(g.name)}</td>
         <td>&#8377;${g.total}</td>
         <td>${g.monthIso}</td>
         <td>${actionsHTML}</td>`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error('loadPPV unexpected', err);
    document.querySelector('#ppvTable tbody').innerHTML = `<tr><td colspan="4">Error loading</td></tr>`;
  }
}

/* ---------- ADMIN ACTIONS: Verify & Mark Pending ----------
   IMPLEMENTATION:
   - Uses Supabase REST API with SERVICE_ROLE_KEY to PATCH bills by id
   - This bypasses RLS so admin action succeeds. (Insecure — use server-side function later)
*/
function buildIdsQueryParam(ids) {
  // ids is array of uuids: build in.(id1,id2) form — must be comma separated without spaces
  return `(${ids.join(',')})`;
}

async function verifyUserMonth(user_id, monthIso, ids) {
  try {
    if (!isAdmin) { alert('Only admins can perform this action.'); return; }
    if (!confirm(`Mark ${ids.length} bills for ${monthIso} as PAID (final)?`)) return;

    // Use PostgREST PATCH endpoint
    const endpoint = `${SUPABASE_URL}/rest/v1/bills?id=in.${buildIdsQueryParam(ids)}&status=eq.paid-pending-verification`;
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ status: 'paid', verified_at: new Date().toISOString() })
    });

    const txt = await res.text();
    if (!res.ok) {
      console.error('verifyUserMonth failed', res.status, txt);
      alert('Verify failed: ' + txt);
      return;
    }

    // success
    alert('Marked as paid.');
    await loadPPV();
    await loadMonth();
    await loadAllBills();
  } catch (err) {
    console.error('verifyUserMonth error', err);
    alert('Error verifying — see console.');
  }
}

async function markPendingUserMonth(user_id, monthIso, ids) {
  try {
    if (!isAdmin) { alert('Only admins can perform this action.'); return; }
    if (!confirm(`Revert ${ids.length} bills for ${monthIso} back to PENDING?`)) return;

    const endpoint = `${SUPABASE_URL}/rest/v1/bills?id=in.${buildIdsQueryParam(ids)}`;
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ status: 'pending', verified_at: null })
    });

    const txt = await res.text();
    if (!res.ok) {
      console.error('markPendingUserMonth failed', res.status, txt);
      alert('Revert failed: ' + txt);
      return;
    }

    alert('Reverted to pending.');
    await loadPPV();
    await loadMonth();
    await loadAllBills();
  } catch (err) {
    console.error('markPendingUserMonth error', err);
    alert('Error reverting — see console.');
  }
}

/* ---------- other helpers ---------- */
async function verifyBill(id) {
  try {
    if (!isAdmin) { alert('Only admins can perform this action.'); return; }
    if (!confirm('Mark this bill as PAID?')) return;
    // Patch single id
    const endpoint = `${SUPABASE_URL}/rest/v1/bills?id=eq.${id}&status=eq.paid-pending-verification`;
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ status: 'paid', verified_at: new Date().toISOString() })
    });
    const txt = await res.text();
    if (!res.ok) { alert('Verify failed: ' + txt); return; }
    alert('Verified.');
    await loadPPV();
    await loadMonth();
    await loadAllBills();
  } catch (err) {
    console.error('verifyBill error', err);
  }
}

async function loadMonth() {
  try {
    const v = document.getElementById('monthPick').value; // "YYYY-MM"
    if (!v) return;
    const [year, month] = v.split('-');
    const start = `${year}-${month}-01T00:00:00Z`;
    const endDate = new Date(Number(year), Number(month), 1);
    const end = endDate.toISOString().slice(0,10) + 'T00:00:00Z';

    const { data, error } = await client.from('bills')
      .select('id,amount,status,users(name),timestamp,user_id')
      .gte('timestamp', start).lt('timestamp', end)
      .order('timestamp', { ascending: true });

    if (error) { console.error('loadMonth error', error); return; }

    const byName = new Map();
    let totalPaid=0, totalPPV=0, totalPend=0;
    (data || []).forEach(r=>{
      const name = r.users?.name ?? 'Unknown';
      const obj = byName.get(name) ?? { paid:0, ppv:0, pend:0, ids_paid:[], ids_ppv:[], ids_pend:[], user_id: r.user_id };
      if (r.status === 'paid') { obj.paid += Number(r.amount); obj.ids_paid.push(r.id); totalPaid += Number(r.amount); }
      else if (r.status === 'paid-pending-verification') { obj.ppv += Number(r.amount); obj.ids_ppv.push(r.id); totalPPV += Number(r.amount); }
      else { obj.pend += Number(r.amount); obj.ids_pend.push(r.id); totalPend += Number(r.amount); }
      byName.set(name, obj);
    });

    const cards = document.getElementById('summaryCards');
    cards.innerHTML = '';
    cards.innerHTML += `<div class="card"><div class="muted">Total Paid</div><div style="font-weight:bold;font-size:18px">&#8377;${totalPaid}</div></div>`;
    cards.innerHTML += `<div class="card"><div class="muted">Pending Verification</div><div style="font-weight:bold;font-size:18px">&#8377;${totalPPV}</div></div>`;
    cards.innerHTML += `<div class="card"><div class="muted">Pending</div><div style="font-weight:bold;font-size:18px">&#8377;${totalPend}</div></div>`;

    const tbody = document.querySelector('#monthTable tbody');
    tbody.innerHTML = '';
    for (const [name, vObj] of byName) {
      // Only show verify button to admin
      const verifyBtn = (isAdmin && vObj.ids_ppv.length) ? `<button class="smallBtn" style="margin-left:8px" onclick='verifyUserMonth("${vObj.user_id}", "${document.getElementById("monthPick").value}", ${JSON.stringify(vObj.ids_ppv)})'>Verify PPV</button>` : '';
      const payBtn = vObj.pend ? `<button class="smallBtn" style="margin-left:8px;background:#f59e0b" onclick='window.payPending("${vObj.user_id}", "${document.getElementById("monthPick").value}")'>Remind/Pay</button>` : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(name)}</td>
        <td>&#8377;${vObj.paid}</td>
        <td>&#8377;${vObj.ppv} ${verifyBtn}</td>
        <td>&#8377;${vObj.pend} ${payBtn}</td>`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error('loadMonth unexpected', err);
  }
}

window.payPending = function(user_id, monthYYYYMM) {
  alert('You can contact the user or re-run billing. (This button is a placeholder)');
}

/* ---------- All Bills ---------- */
async function loadAllBills() {
  try {
    const { data, error } = await client.from('bills').select('id,amount,status,timestamp,users(name)').order('timestamp', { ascending: false });
    if (error) { console.error('loadAllBills error', error); document.getElementById('allBillsArea').innerHTML = '<p>Error loading</p>'; return; }
    const wrapper = document.getElementById('allBillsArea');
    if (!data || data.length === 0) { wrapper.innerHTML = '<p>No bills</p>'; return; }
    let html = '<table><thead><tr><th>Name</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>';
    (data||[]).forEach(r=>{
      html += `<tr><td>${escapeHtml(r.users?.name ?? '-')}</td><td>&#8377;${r.amount}</td><td>${escapeHtml(r.status)}</td><td>${new Date(r.timestamp).toLocaleString()}</td></tr>`;
    });
    html += '</tbody></table>';
    wrapper.innerHTML = html;
  } catch (err) {
    console.error('loadAllBills unexpected', err);
    document.getElementById('allBillsArea').innerHTML = '<p>Error loading bills</p>';
  }
}

/* ---------- utilities ---------- */
function escapeHtml(s) {
  if (s == null) return '';
  return (s + '').replace(/[&<>"']/g, (c)=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

/* ---------- expose functions for inline onclick usage ---------- */
window.verifyUserMonth = verifyUserMonth;
window.markPendingUserMonth = markPendingUserMonth;
window.loadPPV = loadPPV;
window.loadMonth = loadMonth;
window.loadAllBills = loadAllBills;
window.verifyBill = verifyBill;
