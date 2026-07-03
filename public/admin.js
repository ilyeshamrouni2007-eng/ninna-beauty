const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('ninna-admin-token') || '';

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const frDate = s => new Date(s + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const flash = msg => {
  const el = $('flash');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
};

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token, ...(opts.headers || {}) }
  });
  if (r.status === 401 && path !== '/admin/login') { logout(); throw new Error('Session expirée'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Une erreur est survenue');
  return data;
}

function logout() {
  token = '';
  sessionStorage.removeItem('ninna-admin-token');
  $('admin-app').classList.add('hidden');
  $('login-card').classList.remove('hidden');
}

async function login() {
  const errEl = $('login-error');
  errEl.classList.add('hidden');
  try {
    const data = await api('/admin/login', { method: 'POST', body: JSON.stringify({ password: $('login-pass').value }) });
    token = data.token;
    sessionStorage.setItem('ninna-admin-token', token);
    enterApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

async function enterApp() {
  $('login-card').classList.add('hidden');
  $('admin-app').classList.remove('hidden');
  await Promise.all([loadBookings(), loadSettings(), loadServices(), loadNotifs()]);
}

/* ---------- Rendez-vous ---------- */
let allBookings = [];
async function loadBookings() {
  allBookings = await api('/admin/bookings');
  renderBookings();
}

function renderBookings() {
  const showPast = $('show-past').checked;
  const today = new Date().toISOString().slice(0, 10);
  let list = allBookings;
  if (!showPast) list = list.filter(b => b.status === 'confirmed' && b.date >= today);
  const zone = $('bookings-list');
  if (!list.length) {
    zone.innerHTML = '<p class="hint">Aucun rendez-vous pour le moment.</p>';
    return;
  }
  zone.innerHTML = `<table class="list"><thead><tr>
    <th>Date</th><th>Cliente</th><th>Prestation</th><th>Statut</th><th></th>
  </tr></thead><tbody>${list.map(b => `
    <tr>
      <td style="text-transform:capitalize; white-space:nowrap">${frDate(b.date)}<br><strong>${b.time}</strong></td>
      <td>${esc(b.name)}<br><span class="hint">${esc(b.phone)}<br>${esc(b.email)}</span></td>
      <td>${esc(b.service.name)}<br><span class="hint">${b.service.price} €</span></td>
      <td>${b.status === 'confirmed'
        ? '<span class="badge ok">Confirmé</span>'
        : `<span class="badge cancelled">Annulé${b.cancelledBy === 'client' ? ' (cliente)' : ''}</span>`}</td>
      <td>${b.status === 'confirmed' && b.date >= today
        ? `<button class="btn danger small" data-cancel="${b.id}">Annuler</button>` : ''}</td>
    </tr>`).join('')}</tbody></table>`;
  zone.querySelectorAll('[data-cancel]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Annuler ce rendez-vous ? La cliente sera prévenue par email.')) return;
    try {
      await api(`/admin/bookings/${btn.dataset.cancel}/cancel`, { method: 'PATCH' });
      flash('Rendez-vous annulé');
      await Promise.all([loadBookings(), loadNotifs()]);
    } catch (e) { flash(e.message); }
  }));
}

/* ---------- Disponibilités ---------- */
let settings = null;

function renderWeekEditor() {
  const zone = $('week-editor');
  zone.innerHTML = DAY_ORDER.map(d => {
    const ranges = settings.week[d] || [];
    const r1 = ranges[0] || {}, r2 = ranges[1] || {};
    return `<div class="day-row" data-day="${d}">
      <span class="day-name">${DAY_NAMES[d]}</span>
      <input type="time" data-r="0-from" value="${r1.from || ''}"><span class="sep">→</span>
      <input type="time" data-r="0-to" value="${r1.to || ''}">
      <span class="sep" style="margin:0 6px">puis</span>
      <input type="time" data-r="1-from" value="${r2.from || ''}"><span class="sep">→</span>
      <input type="time" data-r="1-to" value="${r2.to || ''}">
    </div>`;
  }).join('');
}

async function saveWeek() {
  const week = {};
  document.querySelectorAll('.day-row[data-day]').forEach(row => {
    const d = row.dataset.day;
    week[d] = [];
    for (const i of [0, 1]) {
      const from = row.querySelector(`[data-r="${i}-from"]`).value;
      const to = row.querySelector(`[data-r="${i}-to"]`).value;
      if (from && to) week[d].push({ from, to });
    }
  });
  try {
    await api('/admin/settings', { method: 'PUT', body: JSON.stringify({ week }) });
    flash('Semaine type enregistrée');
    await loadSettings();
    if ($('day-picker').value) loadDay();
  } catch (e) { flash(e.message); }
}

async function loadDay() {
  const date = $('day-picker').value;
  if (!date) return;
  const zone = $('day-detail');
  try {
    const day = await api(`/admin/day/${date}`);
    let html = `<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px">
      <strong style="text-transform:capitalize">${frDate(date)}</strong>
      <button class="btn ghost small" id="toggle-closed">${day.closed ? 'Rouvrir la journée' : 'Fermer la journée'}</button>
    </div>`;
    if (day.closed) {
      html += '<p class="hint">Journée fermée — aucune réservation possible.</p>';
    } else if (!day.slots.length) {
      html += `<p class="hint">${day.noTemplate ? 'Jour non travaillé dans la semaine type.' : 'Aucun créneau ce jour.'}</p>`;
    } else {
      html += '<div class="times">' + day.slots.map(s =>
        s.status === 'booked'
          ? `<span class="slot-chip booked" title="Réservé">${s.time} · ${esc(s.client)}</span>`
          : `<button class="slot-chip ${s.status}" data-slot="${s.time}">${s.time}</button>`
      ).join('') + '</div>';
    }
    zone.innerHTML = html;
    $('toggle-closed')?.addEventListener('click', async () => {
      await api('/admin/exceptions', { method: 'POST', body: JSON.stringify({ date, closed: !day.closed }) });
      flash(day.closed ? 'Journée rouverte' : 'Journée fermée');
      loadDay();
    });
    zone.querySelectorAll('[data-slot]').forEach(btn => btn.addEventListener('click', async () => {
      await api('/admin/exceptions', { method: 'POST', body: JSON.stringify({ date, toggleBlock: btn.dataset.slot }) });
      loadDay();
    }));
  } catch (e) {
    zone.innerHTML = `<p class="error-msg">${esc(e.message)}</p>`;
  }
}

/* ---------- Prestations ---------- */
async function loadServices() {
  const services = await api('/admin/services');
  const zone = $('services-admin');
  zone.innerHTML = services.map(s => `
    <div style="border:1px solid var(--rose-soft); border-radius:16px; padding:14px 16px; margin-bottom:10px; ${s.active ? '' : 'opacity:0.55'}">
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center">
        <input class="field" style="flex:2; min-width:160px" data-f="name" value="${esc(s.name)}">
        <input class="field" style="width:90px" data-f="price" type="number" min="0" value="${s.price}">
        <span class="hint">€</span>
        <input class="field" style="width:90px" data-f="durationMin" type="number" min="15" step="15" value="${s.durationMin}">
        <span class="hint">min</span>
      </div>
      <input class="field" style="margin-top:8px" data-f="description" value="${esc(s.description || '')}" placeholder="Description">
      <div style="display:flex; gap:8px; margin-top:10px; align-items:center">
        <button class="btn small" data-save="${s.id}">Enregistrer</button>
        <button class="btn ghost small" data-toggle="${s.id}">${s.active ? 'Masquer' : 'Réactiver'}</button>
        <button class="btn danger small" data-del="${s.id}">Supprimer</button>
        ${s.active ? '' : '<span class="hint">Masquée pour les clientes</span>'}
      </div>
    </div>`).join('');

  zone.querySelectorAll('[data-save]').forEach(btn => btn.addEventListener('click', async () => {
    const box = btn.closest('div').parentElement;
    const get = f => box.querySelector(`[data-f="${f}"]`).value;
    try {
      await api(`/admin/services/${btn.dataset.save}`, {
        method: 'PUT',
        body: JSON.stringify({ name: get('name'), price: +get('price'), durationMin: +get('durationMin'), description: get('description') })
      });
      flash('Prestation mise à jour');
      loadServices();
    } catch (e) { flash(e.message); }
  }));
  zone.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const svc = services.find(s => s.id === btn.dataset.toggle);
    await api(`/admin/services/${svc.id}`, { method: 'PUT', body: JSON.stringify({ active: !svc.active }) });
    loadServices();
  }));
  zone.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Supprimer définitivement cette prestation ?')) return;
    await api(`/admin/services/${btn.dataset.del}`, { method: 'DELETE' });
    flash('Prestation supprimée');
    loadServices();
  }));
}

async function addService() {
  try {
    await api('/admin/services', {
      method: 'POST',
      body: JSON.stringify({
        name: $('new-svc-name').value,
        price: +$('new-svc-price').value,
        durationMin: +$('new-svc-dur').value || 60,
        description: $('new-svc-desc').value
      })
    });
    ['new-svc-name', 'new-svc-price', 'new-svc-dur', 'new-svc-desc'].forEach(id => $(id).value = '');
    flash('Prestation ajoutée');
    loadServices();
  } catch (e) { flash(e.message); }
}

/* ---------- Notifications ---------- */
async function loadNotifs() {
  const notifs = await api('/admin/notifications');
  const zone = $('notifs-list');
  if (!notifs.length) {
    zone.innerHTML = '<p class="hint">Aucune notification pour le moment. Elles apparaîtront ici à chaque rendez-vous confirmé ou annulé.</p>';
    return;
  }
  const badge = s => ({
    sent: '<span class="badge sent">Envoyé</span>',
    demo: '<span class="badge demo">Simulé</span>',
    failed: '<span class="badge failed">Échec</span>',
    skipped: '<span class="badge skipped">Destinataire manquant</span>'
  }[s] || s);
  zone.innerHTML = notifs.map(n => `
    <div class="notif">
      <div class="meta">
        <span>${n.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</span> ·
        <span>${new Date(n.at).toLocaleString('fr-FR')}</span> ·
        <span>→ ${esc(n.to)}</span> ${badge(n.status)}
      </div>
      <div class="subject">${esc(n.subject)}</div>
      <div class="body">${esc(n.body)}</div>
    </div>`).join('');
}

/* ---------- Paramètres ---------- */
async function loadSettings() {
  settings = await api('/admin/settings');
  $('set-name').value = settings.salonName;
  $('set-slot').value = settings.slotMinutes;
  $('set-email').value = settings.notifyEmail || '';
  $('set-wa').value = settings.notifyWhatsapp || '';
  $('channels-status').innerHTML =
    `Envoi réel des emails : ${settings.emailConfigured ? '<span class="badge sent">activé</span>' : '<span class="badge demo">non configuré (mode simulation)</span>'} · ` +
    `WhatsApp : ${settings.whatsappConfigured ? '<span class="badge sent">activé</span>' : '<span class="badge demo">non configuré (mode simulation)</span>'}`;
  $('notif-status').innerHTML = settings.emailConfigured || settings.whatsappConfigured
    ? 'Les envois réels sont activés.'
    : 'Mode simulation : les messages sont enregistrés ici mais pas réellement envoyés. Configurez le fichier <code>.env</code> sur le serveur pour activer l\'envoi réel (voir README).';
  renderWeekEditor();
}

async function saveSettings() {
  try {
    const body = {
      salonName: $('set-name').value,
      slotMinutes: +$('set-slot').value,
      notifyEmail: $('set-email').value,
      notifyWhatsapp: $('set-wa').value
    };
    if ($('set-pass').value) body.adminPassword = $('set-pass').value;
    await api('/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
    $('set-pass').value = '';
    flash('Paramètres enregistrés');
    loadSettings();
  } catch (e) { flash(e.message); }
}

/* ---------- Navigation ---------- */
document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  for (const tab of ['bookings', 'planning', 'services', 'notifs', 'settings']) {
    $(`tab-${tab}`).classList.toggle('hidden', tab !== btn.dataset.tab);
  }
}));

$('login-btn').addEventListener('click', login);
$('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
$('logout-btn').addEventListener('click', logout);
$('show-past').addEventListener('change', renderBookings);
$('save-week').addEventListener('click', saveWeek);
$('day-picker').addEventListener('change', loadDay);
$('add-svc').addEventListener('click', addService);
$('save-settings').addEventListener('click', saveSettings);

if (token) {
  enterApp().catch(() => logout());
}
