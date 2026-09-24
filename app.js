'use strict';

const CONFIG = Object.freeze({
  apiUrl: 'https://script.google.com/macros/s/AKfycbwByHlOPEn9ovfk8wtLbEhJdu5bDRHNxyge1NCaQfkSxf3W0xAeRpvQpUAuo70RgCji/exec',
  weddingDate: '2027-01-17T14:30:00-03:00',
});

const elements = {
  form: document.querySelector('#guest-search-form'),
  input: document.querySelector('#guest-name'),
  searchButton: document.querySelector('#guest-search-form button[type="submit"]'),
  status: document.querySelector('#request-status'),
  results: document.querySelector('#guest-results'),
  attendanceCard: document.querySelector('#attendance-card'),
  selectedName: document.querySelector('#selected-guest-name'),
  selectedIdentification: document.querySelector('#selected-identification'),
  currentStatus: document.querySelector('#current-status'),
  backButton: document.querySelector('#back-to-results'),
  attendanceButtons: Array.from(document.querySelectorAll('[data-attending]')),
  successCard: document.querySelector('#success-card'),
  successTitle: document.querySelector('#success-title'),
  successMessage: document.querySelector('#success-message'),
  changeAnswer: document.querySelector('#change-answer'),
  countdownDays: document.querySelector('#countdown-days'),
  countdownHours: document.querySelector('#countdown-hours'),
  countdownMinutes: document.querySelector('#countdown-minutes'),
};

const state = {
  guests: [],
  selectedGuest: null,
  busy: false,
};

const STATUS_LABELS = Object.freeze({
  PENDENTE: 'Aguardando resposta',
  CONFIRMADO: 'Presença confirmada',
  'NÃO VAI': 'Não poderá comparecer',
});

function setRequestStatus(message = '', type = '') {
  elements.status.textContent = message;
  elements.status.className = 'request-status';
  if (type) {
    elements.status.classList.add(`is-${type}`);
  }
}

function setBusy(isBusy, context) {
  state.busy = isBusy;
  if (context === 'search') {
    elements.searchButton.disabled = isBusy;
    elements.input.disabled = isBusy;
  }
  elements.attendanceButtons.forEach((button) => {
    button.disabled = isBusy;
  });
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('A resposta do servidor não pôde ser lida.');
  }
}

async function searchGuests(query) {
  const url = new URL(CONFIG.apiUrl);
  url.searchParams.set('action', 'search');
  url.searchParams.set('q', query);

  const response = await fetch(url.toString(), { method: 'GET' });
  return readJsonResponse(response);
}

async function sendRsvp(guestId, attending) {
  const response = await fetch(CONFIG.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ action: 'rsvp', id: guestId, attending }),
  });
  return readJsonResponse(response);
}

function getPublicErrorMessage(errorCode) {
  const messages = {
    QUERY_TOO_SHORT: 'Digite pelo menos 3 letras para buscar seu nome.',
    QUERY_TOO_LONG: 'O nome digitado é muito longo.',
    GUEST_NOT_FOUND: 'Não encontramos este convidado. Faça uma nova busca.',
    BUSY: 'Estamos registrando outra resposta. Tente novamente em alguns instantes.',
  };
  return messages[errorCode] || 'Não foi possível concluir agora. Tente novamente em alguns instantes.';
}

function createGuestCard(guest) {
  const button = document.createElement('button');
  button.className = 'guest-card';
  button.type = 'button';

  const identity = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = guest.name;
  identity.appendChild(name);

  if (guest.identification) {
    const identification = document.createElement('small');
    identification.textContent = guest.identification;
    identity.appendChild(identification);
  }

  const badge = document.createElement('span');
  badge.className = 'status-badge';
  badge.dataset.status = guest.status;
  badge.textContent = STATUS_LABELS[guest.status] || guest.status;

  button.append(identity, badge);
  button.addEventListener('click', () => selectGuest(guest));
  return button;
}

function renderGuests(guests) {
  elements.results.replaceChildren();

  if (!guests.length) {
    setRequestStatus('Nenhum convidado encontrado. Confira a escrita ou tente outra parte do nome.', 'error');
    return;
  }

  setRequestStatus(
    guests.length === 1
      ? 'Encontramos 1 convidado. Selecione para continuar.'
      : `Encontramos ${guests.length} convidados. Selecione o seu nome.`
  );
  guests.forEach((guest) => elements.results.appendChild(createGuestCard(guest)));
}

function selectGuest(guest) {
  state.selectedGuest = guest;
  elements.form.hidden = true;
  elements.results.hidden = true;
  elements.successCard.hidden = true;
  elements.attendanceCard.hidden = false;
  setRequestStatus();

  elements.selectedName.textContent = guest.name;
  elements.selectedIdentification.textContent = guest.identification || '';
  elements.selectedIdentification.hidden = !guest.identification;
  elements.currentStatus.textContent = `Situação atual: ${STATUS_LABELS[guest.status] || guest.status}.`;
  elements.backButton.focus();
}

function showSearchResults() {
  elements.attendanceCard.hidden = true;
  elements.successCard.hidden = true;
  elements.form.hidden = false;
  elements.results.hidden = false;
  setRequestStatus(state.guests.length ? 'Selecione o seu nome para continuar.' : '');
  elements.input.focus();
}

function showSuccess(attending) {
  elements.form.hidden = true;
  elements.results.hidden = true;
  elements.attendanceCard.hidden = true;
  elements.successCard.hidden = false;
  setRequestStatus();

  elements.successTitle.textContent = attending
    ? 'Presença confirmada!'
    : 'Recebemos sua resposta';
  elements.successMessage.textContent = attending
    ? 'Que alegria saber que você estará conosco. Esperamos você no nosso grande dia!'
    : 'Sentiremos sua falta, mas agradecemos por nos avisar com carinho.';
  elements.successCard.focus();
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;

  const query = elements.input.value.trim();
  if (query.length < 3) {
    setRequestStatus('Digite pelo menos 3 letras para buscar seu nome.', 'error');
    elements.input.focus();
    return;
  }

  setBusy(true, 'search');
  elements.results.replaceChildren();
  elements.results.hidden = false;
  setRequestStatus('Buscando seu convite…', 'loading');

  try {
    const payload = await searchGuests(query);
    if (!payload.success) {
      throw Object.assign(new Error(payload.message), { code: payload.error });
    }
    state.guests = Array.isArray(payload.results) ? payload.results : [];
    renderGuests(state.guests);
  } catch (error) {
    setRequestStatus(getPublicErrorMessage(error.code), 'error');
  } finally {
    setBusy(false, 'search');
  }
});

elements.backButton.addEventListener('click', showSearchResults);

elements.attendanceButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    if (state.busy || !state.selectedGuest) return;
    const attending = button.dataset.attending === 'true';

    setBusy(true, 'rsvp');
    setRequestStatus('Registrando sua resposta…', 'loading');

    try {
      const payload = await sendRsvp(state.selectedGuest.id, attending);
      if (!payload.success) {
        throw Object.assign(new Error(payload.message), { code: payload.error });
      }

      state.selectedGuest.status = payload.status;
      showSuccess(attending);
    } catch (error) {
      setRequestStatus(getPublicErrorMessage(error.code), 'error');
    } finally {
      setBusy(false, 'rsvp');
    }
  });
});

elements.changeAnswer.addEventListener('click', () => {
  if (!state.selectedGuest) return;
  selectGuest(state.selectedGuest);
});

function updateCountdown() {
  const difference = new Date(CONFIG.weddingDate).getTime() - Date.now();
  if (difference <= 0) {
    document.querySelector('#countdown').textContent = 'Chegou o nosso grande dia!';
    return;
  }

  const totalMinutes = Math.floor(difference / 60000);
  elements.countdownDays.textContent = String(Math.floor(totalMinutes / 1440));
  elements.countdownHours.textContent = String(Math.floor((totalMinutes % 1440) / 60)).padStart(2, '0');
  elements.countdownMinutes.textContent = String(totalMinutes % 60).padStart(2, '0');
}

updateCountdown();
window.setInterval(updateCountdown, 60000);

function scrollToHashSection() {
  const sectionId = window.location.hash.slice(1);
  const section = sectionId ? document.getElementById(sectionId) : null;
  if (section) {
    section.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
}

// Reposiciona antes e depois do carregamento de fontes/imagens, evitando que
// links diretos para uma seção terminem alguns pixels fora do lugar.
window.requestAnimationFrame(scrollToHashSection);
window.addEventListener('load', scrollToHashSection);
