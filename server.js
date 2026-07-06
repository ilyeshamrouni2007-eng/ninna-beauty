process.env.TZ = process.env.TZ || 'Europe/Paris';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch {}

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const defaultDb = {
  settings: {
    salonName: 'Ninna Beauty',
    adminPassword: 'ninna',
    slotMinutes: 60,
    notifyEmail: '',
    notifyWhatsapp: '',
    smtpHost: '',
    smtpPort: '',
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    twilioSid: '',
    twilioToken: '',
    twilioFrom: '',
    twilioTplNew: '',
    twilioTplCancel: '',
    week: {
      0: [],
      1: [{ from: '09:30', to: '12:30' }, { from: '14:00', to: '18:30' }],
      2: [{ from: '09:30', to: '12:30' }, { from: '14:00', to: '18:30' }],
      3: [{ from: '09:30', to: '12:30' }, { from: '14:00', to: '18:30' }],
      4: [{ from: '09:30', to: '12:30' }, { from: '14:00', to: '18:30' }],
      5: [{ from: '09:30', to: '12:30' }, { from: '14:00', to: '18:30' }],
      6: [{ from: '10:00', to: '17:00' }]
    }
  },
  services: [
    { id: 'svc-gel', name: 'Pose gel complète', price: 45, durationMin: 60, description: 'Pose complète avec capsules ou chablons, couleur au choix', active: true },
    { id: 'svc-remplissage', name: 'Remplissage gel', price: 35, durationMin: 60, description: 'Remplissage de votre pose existante', active: true },
    { id: 'svc-gainage', name: 'Gainage sur ongles naturels', price: 40, durationMin: 60, description: 'Renforcement de l’ongle naturel, effet soigné et durable', active: true },
    { id: 'svc-nailart', name: 'Pose + nail art', price: 55, durationMin: 90, description: 'Pose complète avec décorations, french ou baby boomer', active: true },
    { id: 'svc-depose', name: 'Dépose', price: 15, durationMin: 30, description: 'Retrait complet de la pose en douceur', active: true }
  ],
  exceptions: {},
  bookings: [],
  notifications: []
};

let db;
function loadDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    db.settings = { ...defaultDb.settings, ...db.settings };
  } else {
    db = JSON.parse(JSON.stringify(defaultDb));
    saveDb();
  }
}
function saveDb() {
  fs.writeFileSync(DB_PATH + '.tmp', JSON.stringify(db, null, 2));
  fs.renameSync(DB_PATH + '.tmp', DB_PATH);
}
loadDb();

const pad = n => String(n).padStart(2, '0');
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const isDateStr = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const frDate = s => new Date(s + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function templateSlots(dateStr) {
  const ex = db.exceptions[dateStr] || {};
  if (ex.closed) return [];
  const wd = new Date(dateStr + 'T12:00:00').getDay();
  const step = db.settings.slotMinutes;
  const slots = new Set();
  for (const r of db.settings.week[wd] || []) {
    for (let t = toMin(r.from); t + step <= toMin(r.to); t += step) slots.add(toTime(t));
  }
  for (const e of ex.extra || []) slots.add(e);
  for (const b of ex.blocked || []) slots.delete(b);
  return [...slots].sort();
}

function bookedTimes(dateStr) {
  return db.bookings.filter(b => b.date === dateStr && b.status === 'confirmed').map(b => b.time);
}

function freeSlots(dateStr) {
  const booked = bookedTimes(dateStr);
  let slots = templateSlots(dateStr).filter(t => !booked.includes(t));
  if (dateStr === todayStr()) slots = slots.filter(t => toMin(t) > nowMin() + 30);
  return slots;
}

function smtpConf() {
  const s = db.settings;
  return {
    host: s.smtpHost || process.env.SMTP_HOST,
    port: +(s.smtpPort || process.env.SMTP_PORT || 587),
    user: s.smtpUser || process.env.SMTP_USER,
    pass: s.smtpPass || process.env.SMTP_PASS,
    from: s.smtpFrom || process.env.SMTP_FROM
  };
}
function twilioConf() {
  const s = db.settings;
  return {
    sid: s.twilioSid || process.env.TWILIO_SID,
    token: s.twilioToken || process.env.TWILIO_TOKEN,
    from: s.twilioFrom || process.env.TWILIO_WHATSAPP_FROM
  };
}
const smtpReady = () => { const c = smtpConf(); return !!(nodemailer && c.host && c.user && c.pass); };
const twilioReady = () => { const c = twilioConf(); return !!(c.sid && c.token && c.from); };

let lastEmailError = '';
async function sendEmail(to, subject, text) {
  if (!to) return 'skipped';
  if (!smtpReady()) return 'demo';
  const c = smtpConf();
  try {
    const transport = nodemailer.createTransport({
      host: c.host, port: c.port, secure: c.port === 465,
      auth: { user: c.user, pass: c.pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
    });
    await transport.sendMail({ from: c.from || c.user, to, subject, text });
    lastEmailError = '';
    return 'sent';
  } catch (e) {
    lastEmailError = e.message;
    console.error('Email error:', e.message);
    return 'failed';
  }
}

async function sendWhatsapp(to, { body, contentSid, variables } = {}) {
  if (!to) return 'skipped';
  if (!twilioReady()) return 'demo';
  const c = twilioConf();
  try {
    const params = new URLSearchParams({
      From: `whatsapp:${c.from}`,
      To: `whatsapp:${to}`
    });
    if (contentSid) {
      params.set('ContentSid', contentSid);
      params.set('ContentVariables', JSON.stringify(variables || {}));
    } else {
      params.set('Body', body || '');
    }
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${c.sid}:${c.token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });
    if (!r.ok) console.error('Twilio error:', await r.text());
    return r.ok ? 'sent' : 'failed';
  } catch (e) {
    console.error('WhatsApp error:', e.message);
    return 'failed';
  }
}

function logNotif(channel, to, subject, body, status) {
  db.notifications.unshift({
    id: crypto.randomUUID(), at: new Date().toISOString(),
    channel, to: to || '(non renseigné)', subject, body, status
  });
  db.notifications = db.notifications.slice(0, 200);
  saveDb();
}

async function notifyBooking(booking, service, kind) {
  const when = `${frDate(booking.date)} à ${booking.time}`;
  const isCancel = kind !== 'confirmed';
  const adminSubject = isCancel
    ? `Désistement — ${booking.name} (${when})`
    : `Nouveau rendez-vous — ${booking.name} (${when})`;
  const adminBody = [
    isCancel ? 'Un rendez-vous vient d’être annulé :' : 'Un nouveau rendez-vous vient d’être confirmé :',
    `Cliente : ${booking.name}`,
    `Prestation : ${service.name} — ${service.price} €`,
    `Date : ${when}`,
    `Téléphone : ${booking.phone}`,
    `Email : ${booking.email}`
  ].join('\n');

  const adminEmail = db.settings.notifyEmail;
  logNotif('email', adminEmail, adminSubject, adminBody, await sendEmail(adminEmail, adminSubject, adminBody));
  const wa = db.settings.notifyWhatsapp;
  const tpl = isCancel ? db.settings.twilioTplCancel : db.settings.twilioTplNew;
  const waOpts = tpl
    ? {
        contentSid: tpl,
        variables: isCancel
          ? { 1: booking.name, 2: service.name, 3: frDate(booking.date), 4: booking.time }
          : { 1: booking.name, 2: `${service.name} (${service.price} €)`, 3: frDate(booking.date), 4: booking.time, 5: booking.phone }
      }
    : { body: `${adminSubject}\n\n${adminBody}` };
  logNotif('whatsapp', wa, adminSubject, adminBody, await sendWhatsapp(wa, waOpts));

  const clientSubject = isCancel
    ? `${db.settings.salonName} — votre rendez-vous est annulé`
    : `${db.settings.salonName} — rendez-vous confirmé ✨`;
  const clientBody = isCancel
    ? `Bonjour ${booking.name},\n\nVotre rendez-vous du ${when} (${service.name}) a bien été annulé.\n\nÀ très bientôt,\n${db.settings.salonName}`
    : `Bonjour ${booking.name},\n\nVotre rendez-vous est confirmé :\n\nPrestation : ${service.name}\nPrix : ${service.price} €\nDate : ${when}\n\nCode d’annulation : ${booking.code}\n(conservez-le pour annuler si besoin)\n\nÀ très bientôt,\n${db.settings.salonName}`;
  logNotif('email', booking.email, clientSubject, clientBody, await sendEmail(booking.email, clientSubject, clientBody));
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/config', (req, res) => res.json({ salonName: db.settings.salonName }));

app.get('/api/services', (req, res) => {
  res.json(db.services.filter(s => s.active).map(({ id, name, price, durationMin, description }) => ({ id, name, price, durationMin, description })));
});

app.get('/api/availability', (req, res) => {
  const month = req.query.month;
  if (!/^\d{4}-\d{2}$/.test(month || '')) return res.status(400).json({ error: 'Mois invalide' });
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayStr();
  const result = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${pad(m)}-${pad(d)}`;
    if (dateStr < today) continue;
    const slots = freeSlots(dateStr);
    if (slots.length) result[dateStr] = slots;
  }
  res.json(result);
});

app.post('/api/bookings', (req, res) => {
  const { serviceId, date, time, name, phone, email } = req.body || {};
  const service = db.services.find(s => s.id === serviceId && s.active);
  if (!service) return res.status(400).json({ error: 'Prestation introuvable' });
  if (!isDateStr(date || '') || date < todayStr()) return res.status(400).json({ error: 'Date invalide' });
  if (!freeSlots(date).includes(time)) return res.status(409).json({ error: 'Ce créneau n’est plus disponible' });
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Veuillez indiquer votre prénom et nom' });
  if (!phone || phone.replace(/\D/g, '').length < 8) return res.status(400).json({ error: 'Numéro de téléphone invalide' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Adresse email invalide' });

  const booking = {
    id: crypto.randomUUID(),
    code: crypto.randomBytes(3).toString('hex').toUpperCase(),
    serviceId, date, time,
    name: name.trim(), phone: phone.trim(), email: email.trim().toLowerCase(),
    status: 'confirmed',
    createdAt: new Date().toISOString()
  };
  db.bookings.push(booking);
  saveDb();
  notifyBooking(booking, service, 'confirmed').catch(console.error);
  res.status(201).json({
    code: booking.code, date, time, name: booking.name,
    service: { name: service.name, price: service.price }
  });
});

app.post('/api/bookings/cancel', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const booking = db.bookings.find(b => b.code === code && b.status === 'confirmed');
  if (!booking) return res.status(404).json({ error: 'Aucun rendez-vous trouvé avec ce code' });
  booking.status = 'cancelled';
  booking.cancelledBy = 'client';
  booking.cancelledAt = new Date().toISOString();
  saveDb();
  const service = db.services.find(s => s.id === booking.serviceId) || { name: '?', price: 0 };
  notifyBooking(booking, service, 'cancelled').catch(console.error);
  res.json({ ok: true, date: booking.date, time: booking.time });
});

const sessions = new Set();
app.post('/api/admin/login', (req, res) => {
  if ((req.body?.password || '') !== db.settings.adminPassword) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.add(token);
  res.json({ token });
});

function requireAdmin(req, res, next) {
  if (sessions.has(req.headers['x-admin-token'])) return next();
  res.status(401).json({ error: 'Non autorisé' });
}

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const { adminPassword, smtpPass, twilioToken, ...settings } = db.settings;
  res.json({
    ...settings,
    smtpPassSet: !!smtpConf().pass,
    twilioTokenSet: !!twilioConf().token,
    emailConfigured: smtpReady(),
    whatsappConfigured: twilioReady()
  });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const s = db.settings;
  if (typeof b.salonName === 'string' && b.salonName.trim()) s.salonName = b.salonName.trim();
  if (typeof b.notifyEmail === 'string') s.notifyEmail = b.notifyEmail.trim();
  if (typeof b.notifyWhatsapp === 'string') s.notifyWhatsapp = b.notifyWhatsapp.trim();
  if (Number.isFinite(+b.slotMinutes) && +b.slotMinutes >= 10 && +b.slotMinutes <= 240) s.slotMinutes = Math.round(+b.slotMinutes);
  if (typeof b.adminPassword === 'string' && b.adminPassword.length >= 4) s.adminPassword = b.adminPassword;
  for (const k of ['smtpHost', 'smtpPort', 'smtpUser', 'smtpFrom', 'twilioSid', 'twilioFrom', 'twilioTplNew', 'twilioTplCancel']) {
    if (typeof b[k] === 'string') s[k] = b[k].trim();
  }
  for (const k of ['smtpPass', 'twilioToken']) {
    if (typeof b[k] === 'string' && b[k].trim()) s[k] = b[k].trim();
    if (b[k] === null) s[k] = '';
  }
  if (b.week && typeof b.week === 'object') {
    const week = {};
    for (let d = 0; d <= 6; d++) {
      const ranges = Array.isArray(b.week[d]) ? b.week[d] : [];
      week[d] = ranges
        .filter(r => /^\d{2}:\d{2}$/.test(r.from || '') && /^\d{2}:\d{2}$/.test(r.to || '') && toMin(r.from) < toMin(r.to))
        .map(r => ({ from: r.from, to: r.to }));
    }
    s.week = week;
  }
  saveDb();
  res.json({ ok: true });
});

app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const list = [...db.bookings].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  res.json(list.map(b => ({
    ...b,
    service: db.services.find(s => s.id === b.serviceId) || { name: 'Prestation supprimée', price: 0 }
  })));
});

app.patch('/api/admin/bookings/:id/cancel', requireAdmin, (req, res) => {
  const booking = db.bookings.find(b => b.id === req.params.id && b.status === 'confirmed');
  if (!booking) return res.status(404).json({ error: 'Rendez-vous introuvable' });
  booking.status = 'cancelled';
  booking.cancelledBy = 'admin';
  booking.cancelledAt = new Date().toISOString();
  saveDb();
  const service = db.services.find(s => s.id === booking.serviceId) || { name: '?', price: 0 };
  notifyBooking(booking, service, 'cancelled').catch(console.error);
  res.json({ ok: true });
});

app.post('/api/admin/services', requireAdmin, (req, res) => {
  const { name, price, durationMin, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });
  if (!(+price >= 0)) return res.status(400).json({ error: 'Prix invalide' });
  const svc = {
    id: 'svc-' + crypto.randomBytes(4).toString('hex'),
    name: name.trim(), price: +price,
    durationMin: +durationMin > 0 ? +durationMin : 60,
    description: (description || '').trim(), active: true
  };
  db.services.push(svc);
  saveDb();
  res.status(201).json(svc);
});

app.put('/api/admin/services/:id', requireAdmin, (req, res) => {
  const svc = db.services.find(s => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: 'Prestation introuvable' });
  const b = req.body || {};
  if (typeof b.name === 'string' && b.name.trim()) svc.name = b.name.trim();
  if (b.price !== undefined && +b.price >= 0) svc.price = +b.price;
  if (b.durationMin !== undefined && +b.durationMin > 0) svc.durationMin = +b.durationMin;
  if (typeof b.description === 'string') svc.description = b.description.trim();
  if (typeof b.active === 'boolean') svc.active = b.active;
  saveDb();
  res.json(svc);
});

app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
  const idx = db.services.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Prestation introuvable' });
  db.services.splice(idx, 1);
  saveDb();
  res.json({ ok: true });
});

app.get('/api/admin/services', requireAdmin, (req, res) => res.json(db.services));

app.get('/api/admin/day/:date', requireAdmin, (req, res) => {
  const date = req.params.date;
  if (!isDateStr(date)) return res.status(400).json({ error: 'Date invalide' });
  const ex = db.exceptions[date] || {};
  const bookings = db.bookings.filter(b => b.date === date && b.status === 'confirmed');
  const slots = templateSlots(date).map(t => {
    const bk = bookings.find(b => b.time === t);
    return { time: t, status: bk ? 'booked' : 'free', client: bk ? bk.name : null };
  });
  const blocked = (ex.blocked || []).map(t => ({ time: t, status: 'blocked', client: null }));
  const all = [...slots, ...blocked].sort((a, b) => a.time.localeCompare(b.time));
  const wd = new Date(date + 'T12:00:00').getDay();
  res.json({ date, closed: !!ex.closed, noTemplate: !(db.settings.week[wd] || []).length, slots: all });
});

app.post('/api/admin/exceptions', requireAdmin, (req, res) => {
  const { date, closed, toggleBlock } = req.body || {};
  if (!isDateStr(date || '')) return res.status(400).json({ error: 'Date invalide' });
  const ex = db.exceptions[date] || {};
  if (closed !== undefined) ex.closed = !!closed;
  if (toggleBlock && /^\d{2}:\d{2}$/.test(toggleBlock)) {
    const blocked = new Set(ex.blocked || []);
    if (blocked.has(toggleBlock)) blocked.delete(toggleBlock); else blocked.add(toggleBlock);
    ex.blocked = [...blocked].sort();
  }
  if (!ex.closed && !(ex.blocked || []).length && !(ex.extra || []).length) delete db.exceptions[date];
  else db.exceptions[date] = ex;
  saveDb();
  res.json({ ok: true });
});

app.get('/api/admin/notifications', requireAdmin, (req, res) => res.json(db.notifications.slice(0, 100)));

app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  if (!smtpReady()) return res.status(400).json({ error: 'Configurez et enregistrez d’abord les champs SMTP' });
  const to = db.settings.notifyEmail || smtpConf().user;
  const status = await sendEmail(to, `${db.settings.salonName} — email de test`, 'Si vous recevez ce message, l’envoi d’emails fonctionne parfaitement ✨');
  logNotif('email', to, 'Email de test', 'Test de la configuration SMTP', status);
  if (status !== 'sent') return res.status(500).json({ error: `Échec de l’envoi — ${lastEmailError || 'vérifiez le serveur, l’identifiant et le mot de passe SMTP'}` });
  res.json({ ok: true, to });
});

const PORT = process.env.PORT || 3178;
app.listen(PORT, () => console.log(`Ninna Beauty — http://localhost:${PORT} (admin: /admin)`));
