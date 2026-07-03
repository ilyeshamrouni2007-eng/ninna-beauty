const $ = id => document.getElementById(id);
const MONTHS_AHEAD = 3;

const state = {
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  availability: {},
  loadedMonths: {},
  selDate: null,
  selTime: null,
  selService: null,
  services: []
};

const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const frDate = s => new Date(s + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const flash = msg => {
  const el = $('flash');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
};

async function loadMonth(d) {
  const key = monthKey(d);
  if (!state.loadedMonths[key]) {
    const r = await fetch(`/api/availability?month=${key}`);
    Object.assign(state.availability, await r.json());
    state.loadedMonths[key] = true;
  }
}

function goToStep(n) {
  for (let i = 1; i <= 4; i++) $(`step-${i}`).classList.toggle('hidden', i !== n);
  document.querySelectorAll('.step-dot').forEach(dot => {
    const s = +dot.dataset.step;
    dot.classList.toggle('active', s === n);
    dot.classList.toggle('done', s < n);
  });
  $('steps').classList.toggle('hidden', n === 4);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function renderCalendar() {
  await loadMonth(state.month);
  const y = state.month.getFullYear(), m = state.month.getMonth();
  $('cal-title').textContent = state.month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const now = new Date();
  const minMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const maxMonth = new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD, 1);
  $('cal-prev').disabled = state.month <= minMonth;
  $('cal-next').disabled = state.month >= maxMonth;

  const grid = $('cal-grid');
  grid.innerHTML = '';
  for (const dow of ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']) {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = dow;
    grid.appendChild(el);
  }
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
  for (let i = 0; i < firstDow; i++) grid.appendChild(document.createElement('div'));
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const btn = document.createElement('button');
    btn.className = 'cal-day';
    btn.textContent = d;
    btn.type = 'button';
    if (state.availability[dateStr]?.length) {
      btn.classList.add('open');
      if (dateStr === state.selDate) btn.classList.add('selected');
      btn.addEventListener('click', () => selectDate(dateStr));
    } else {
      btn.disabled = true;
    }
    grid.appendChild(btn);
  }
}

function selectDate(dateStr) {
  state.selDate = dateStr;
  state.selTime = null;
  $('to-step-2').disabled = true;
  document.querySelectorAll('.cal-day').forEach(b => b.classList.remove('selected'));
  [...document.querySelectorAll('.cal-day.open')].find(b => {
    const y = state.month.getFullYear(), m = state.month.getMonth();
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(b.textContent).padStart(2, '0')}` === dateStr;
  })?.classList.add('selected');

  $('times-zone').classList.remove('hidden');
  $('times-label').textContent = frDate(dateStr);
  const times = $('times');
  times.innerHTML = '';
  for (const t of state.availability[dateStr] || []) {
    const chip = document.createElement('button');
    chip.className = 'time-chip';
    chip.type = 'button';
    chip.textContent = t;
    chip.addEventListener('click', () => {
      state.selTime = t;
      document.querySelectorAll('.time-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      $('to-step-2').disabled = false;
    });
    times.appendChild(chip);
  }
}

async function renderServices() {
  if (!state.services.length) {
    state.services = await (await fetch('/api/services')).json();
  }
  const zone = $('services');
  zone.innerHTML = '';
  for (const svc of state.services) {
    const btn = document.createElement('button');
    btn.className = 'svc' + (state.selService?.id === svc.id ? ' selected' : '');
    btn.type = 'button';
    btn.innerHTML = `
      <span>
        <span class="name">${svc.name}</span>
        <div class="desc">${svc.description || ''}</div>
        <div class="dur">≈ ${svc.durationMin} min</div>
      </span>
      <span class="price">${svc.price} €</span>`;
    btn.addEventListener('click', () => {
      state.selService = svc;
      document.querySelectorAll('.svc').forEach(el => el.classList.remove('selected'));
      btn.classList.add('selected');
      $('to-step-3').disabled = false;
    });
    zone.appendChild(btn);
  }
}

function renderRecap() {
  const s = state.selService;
  $('recap').innerHTML = `
    <div class="row"><span>Date</span><span style="text-transform:capitalize">${frDate(state.selDate)}</span></div>
    <div class="row"><span>Heure</span><span>${state.selTime}</span></div>
    <div class="row"><span>Prestation</span><span>${s.name}</span></div>
    <div class="row"><span>Durée</span><span>≈ ${s.durationMin} min</span></div>
    <div class="row total"><span>Prix</span><span class="amount">${s.price} €</span></div>`;
}

async function confirmBooking() {
  const errEl = $('book-error');
  errEl.classList.add('hidden');
  const payload = {
    serviceId: state.selService.id,
    date: state.selDate,
    time: state.selTime,
    name: $('f-name').value,
    phone: $('f-phone').value,
    email: $('f-email').value
  };
  const btn = $('confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Confirmation…';
  try {
    const r = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Une erreur est survenue');
    $('confirm-text').innerHTML = `<strong>${data.service.name}</strong> — ${data.service.price} €<br><span style="text-transform:capitalize">${frDate(data.date)}</span> à ${data.time}`;
    $('confirm-code').textContent = data.code;
    goToStep(4);
    state.loadedMonths = {};
    state.availability = {};
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
    if (e.message.includes('disponible')) {
      state.loadedMonths = {};
      state.availability = {};
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmer mon rendez-vous';
  }
}

async function cancelBooking() {
  const errEl = $('cancel-error'), okEl = $('cancel-ok');
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');
  try {
    const r = await fetch('/api/bookings/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: $('cancel-code').value })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Une erreur est survenue');
    okEl.textContent = `Votre rendez-vous du ${frDate(data.date)} à ${data.time} est bien annulé.`;
    okEl.classList.remove('hidden');
    $('cancel-code').value = '';
    state.loadedMonths = {};
    state.availability = {};
    renderCalendar();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

$('cal-prev').addEventListener('click', () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
  renderCalendar();
});
$('cal-next').addEventListener('click', () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
  renderCalendar();
});
$('to-step-2').addEventListener('click', () => { renderServices(); goToStep(2); });
$('to-step-3').addEventListener('click', () => { renderRecap(); goToStep(3); });
document.querySelectorAll('[data-back]').forEach(b =>
  b.addEventListener('click', () => goToStep(+b.dataset.back))
);
$('confirm-btn').addEventListener('click', confirmBooking);
$('new-booking').addEventListener('click', () => {
  state.selDate = null;
  state.selTime = null;
  state.selService = null;
  $('times-zone').classList.add('hidden');
  $('to-step-2').disabled = true;
  $('to-step-3').disabled = true;
  renderCalendar();
  goToStep(1);
});
$('toggle-cancel').addEventListener('click', e => {
  e.preventDefault();
  $('cancel-zone').classList.toggle('hidden');
  if (!$('cancel-zone').classList.contains('hidden')) {
    $('cancel-zone').scrollIntoView({ behavior: 'smooth' });
  }
});
$('cancel-btn').addEventListener('click', cancelBooking);

goToStep(1);
renderCalendar();
