import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { RotateCcw, ChevronRight, Landmark, Crown, MapPinned, Globe2, Settings2, Plus, Trash2, CalendarClock, Save, Download, Upload, Sparkles, MessageSquare, Send, Lock } from "lucide-react";

// ---------------------------------------------------------------------------
// DANE PODSTAWOWE
// ---------------------------------------------------------------------------

// Gra nie zawiera już żadnych wbudowanych partii ani sondaży startowych —
// wszystkie dane (partie, ich bloki, prezydent, daty najbliższych wyborów)
// gracz podaje samodzielnie na ekranie konfiguracji przed rozpoczęciem gry.

// Etykiety i ranga bloków ideologicznych (skrajna lewica -> skrajna prawica) —
// używane do budowy hemicyklu oraz jako opcje przy dodawaniu nowej partii.
const BLOC_LABELS = {
  skrajna_lewica: "Skrajna lewica",
  lewica: "Lewica",
  centrolewica: "Centrolewica",
  centrum: "Centrum",
  centroprawica: "Centroprawica",
  prawica: "Prawica",
  skrajna_prawica: "Skrajna prawica",
};
const BLOC_RANK = {
  skrajna_lewica: 0,
  lewica: 1,
  centrolewica: 2,
  centrum: 3,
  centroprawica: 4,
  prawica: 5,
  skrajna_prawica: 6,
};
const BLOC_KEYS = Object.keys(BLOC_LABELS);

// §2: opisy pozycji na osi ideologicznej — pokazywane w kreatorze postaci
// i w kreatorze własnej partii, żeby wybór nie był tylko suchą etykietą.
const BLOC_DESCRIPTIONS = {
  skrajna_lewica: "Radykalna transformacja gospodarcza i społeczna.",
  lewica: "Silne państwo socjalne i progresywne reformy.",
  centrolewica: "Socjaldemokracja i umiarkowany progresywizm.",
  centrum: "Umiarkowanie, pragmatyzm i kompromis.",
  centroprawica: "Wolnorynkowość połączona z umiarkowanym konserwatyzmem.",
  prawica: "Silny nacisk na tradycję, bezpieczeństwo, państwo i gospodarkę rynkową.",
  skrajna_prawica: "Radykalnie narodowy/konserwatywny kierunek.",
};

// §3: dodatkowe wymiary programowe (-100..100), niezależne od głównego `bloc`,
// ale pozwalające różnicować partie o tej samej etykiecie bloku. `bloc`
// pozostaje główną etykietą używaną przez istniejący silnik (D'Hondt, oś
// koalicyjna itd.) — te wymiary są warstwą dodatkową do wydarzeń/segmentów/UI.
const PLATFORM_AXES = [
  { id: "economy", label: "Gospodarka", left: "Socjalizm", right: "Wolny rynek" },
  { id: "society", label: "Społeczeństwo", left: "Progresywizm", right: "Konserwatyzm" },
  { id: "state", label: "Państwo", left: "Decentralizacja", right: "Centralizacja" },
  { id: "migration", label: "Migracja", left: "Otwartość", right: "Restrykcyjność" },
  { id: "security", label: "Bezpieczeństwo", left: "Pacyfizm", right: "Militaryzm" },
  { id: "eu", label: "UE", left: "Integracja", right: "Suwerenizm" },
  { id: "climate", label: "Klimat", left: "Radykalna transformacja", right: "Priorytet gospodarczy" },
  { id: "taxes", label: "Podatki", left: "Wysokie", right: "Niskie" },
];

// Rozsądne wartości domyślne platformy programowej na podstawie głównego
// bloku ideologicznego — używane, gdy gracz nie ustawił platformy ręcznie.
function defaultPlatformForBloc(bloc) {
  const rank = BLOC_RANK[bloc] ?? 3; // 0..6, 3 = centrum
  const lean = (rank - 3) / 3; // -1..1
  return {
    economy: Math.round(lean * 60),
    society: Math.round(lean * 55),
    state: Math.round(lean * 20),
    migration: Math.round(lean * 50),
    security: Math.round(lean * 40),
    eu: Math.round(lean * 35),
    climate: Math.round(-lean * 45),
    taxes: Math.round(lean * 45),
  };
}

// Bloki grupowane po dwóch stronach osi sporu (do rachunku koalicyjnego):
// oś centro-lewicowa (KO) vs. oś prawicowa (PiS).
const LEFT_AXIS_BLOCS = ["skrajna_lewica", "lewica", "centrolewica", "centrum"];
const RIGHT_AXIS_BLOCS = ["centroprawica", "prawica", "skrajna_prawica"];

const PALETTE = ["#0EA5E9", "#F97316", "#8B5CF6", "#22C55E", "#EF4444", "#EAB308", "#EC4899", "#14B8A6", "#94A3B8"];

const MONTHS_PL = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

const SEJM_SEATS = 460;
const SENAT_SEATS = 100;
const EP_SEATS = 53;
const SEJMIK_REGIONS = 16;
const WOJEWODZTWA = [
  "Dolnośląskie", "Kujawsko-pomorskie", "Lubelskie", "Lubuskie", "Łódzkie", "Małopolskie",
  "Mazowieckie", "Opolskie", "Podkarpackie", "Podlaskie", "Pomorskie", "Śląskie",
  "Świętokrzyskie", "Warmińsko-mazurskie", "Wielkopolskie", "Zachodniopomorskie",
];
const MAJORITY = 231; // większość przy domyślnych 460 mandatach — używana jako fallback

// Próg większości bezwzględnej dla dowolnej (konfigurowalnej) liczby mandatów w Sejmie.
function majorityFor(seatsTotal) {
  const total = Number(seatsTotal) > 0 ? Number(seatsTotal) : SEJM_SEATS;
  return Math.floor(total / 2) + 1;
}

// ---------------------------------------------------------------------------
// ZAPISY GRY — localStorage (zapisy nazwane + autosave po każdej zmianie stanu)
// ---------------------------------------------------------------------------

const SAVES_STORAGE_KEY = "polsim_saves_v1";
const AUTOSAVE_STORAGE_KEY = "polsim_autosave_v1";

function readSavesFromStorage() {
  try {
    const raw = window.localStorage.getItem(SAVES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function writeSavesToStorage(saves) {
  try {
    window.localStorage.setItem(SAVES_STORAGE_KEY, JSON.stringify(saves));
  } catch (e) {
    // np. tryb prywatny przeglądarki / brak dostępu do localStorage — pomijamy w ciszy
  }
}

function readAutosaveFromStorage() {
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeAutosaveToStorage(state) {
  try {
    window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // jw.
  }
}

// ---------------------------------------------------------------------------
// FUNKCJE POMOCNICZE — MATEMATYKA WYBORCZA
// ---------------------------------------------------------------------------

function dhondt(pollsObj, totalSeats, thresholdPct, exemptIds = []) {
  const ids = Object.keys(pollsObj);
  const eligible = ids.filter((id) => (pollsObj[id] || 0) >= thresholdPct || exemptIds.includes(id));
  const seats = {};
  ids.forEach((id) => (seats[id] = 0));
  for (let i = 0; i < totalSeats; i++) {
    let bestId = null;
    let bestQuotient = -1;
    eligible.forEach((id) => {
      const q = (pollsObj[id] || 0) / (seats[id] + 1);
      if (q > bestQuotient) {
        bestQuotient = q;
        bestId = id;
      }
    });
    if (bestId) seats[bestId] += 1;
  }
  return seats;
}

// Partie oznaczone jako "komitet mniejszości narodowej" są ustawowo zwolnione
// z krajowego progu wyborczego do Sejmu (próg dalej obowiązuje pozostałe partie).
function minorityExemptIds(pollsObj, registry) {
  return Object.keys(pollsObj).filter((id) => registry[id]?.minority);
}

function normalize(pollsObj) {
  const total = Object.values(pollsObj).reduce((a, b) => a + b, 0);
  const out = {};
  Object.keys(pollsObj).forEach((k) => (out[k] = Math.round(((pollsObj[k] / total) * 100) * 100) / 100));
  return out;
}

function randomWalk(pollsObj) {
  const next = { ...pollsObj };
  Object.keys(next).forEach((id) => {
    const delta = (Math.random() - 0.5) * 2.4; // +/- 1.2 pp bazowej zmienności
    next[id] = Math.max(0.05, next[id] + delta);
  });
  return normalize(next);
}

// ---------------------------------------------------------------------------
// FUNKCJE POMOCNICZE — ZARZĄDZANIE LISTĄ PARTII I SONDAŻAMI
// ---------------------------------------------------------------------------

function slugify(str) {
  const base = str
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "partia";
}

function uniqueId(base, existingIds) {
  let id = base;
  let i = 2;
  while (existingIds.includes(id)) {
    id = `${base}_${i}`;
    i += 1;
  }
  return id;
}

function randomColor(existingColors) {
  const free = PALETTE.filter((c) => !existingColors.includes(c));
  const pool = free.length ? free : PALETTE;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Ustawia poparcie danej partii na nową wartość, przeskalowując proporcjonalnie
// pozostałe partie tak, aby suma nadal wynosiła 100%.
function setPollValue(pollsObj, id, newValue) {
  const capped = Math.max(0.01, Math.min(99.98, newValue));
  const others = Object.keys(pollsObj).filter((k) => k !== id);
  const othersSum = others.reduce((a, k) => a + pollsObj[k], 0);
  const remaining = 100 - capped;
  const next = { ...pollsObj, [id]: capped };
  if (othersSum > 0) {
    others.forEach((k) => {
      next[k] = (pollsObj[k] / othersSum) * remaining;
    });
  } else {
    const share = remaining / (others.length || 1);
    others.forEach((k) => {
      next[k] = share;
    });
  }
  return normalize(next);
}

// Dodaje nową partię do obiektu sondaży z zadanym poparciem startowym,
// zabierając proporcjonalnie "miejsce" pozostałym partiom.
function addPollEntry(pollsObj, id, startValue) {
  const capped = Math.max(0.01, Math.min(90, startValue));
  const others = Object.keys(pollsObj);
  const othersSum = others.reduce((a, k) => a + pollsObj[k], 0);
  const remaining = 100 - capped;
  const next = {};
  others.forEach((k) => {
    next[k] = othersSum > 0 ? (pollsObj[k] / othersSum) * remaining : remaining / (others.length || 1);
  });
  next[id] = capped;
  return normalize(next);
}

// Usuwa partię z obiektu sondaży — pozostałe partie automatycznie rosną
// proporcjonalnie do 100% dzięki normalize().
function removePollEntry(pollsObj, id) {
  const next = { ...pollsObj };
  delete next[id];
  return normalize(next);
}

// Kolejność ideologiczna lewica -> prawica dla dowolnego zestawu partii,
// używana do budowy hemicyklu.
function computeIdeologicalOrder(partyList) {
  return [...partyList]
    .sort((a, b) => {
      const rA = BLOC_RANK[a.bloc] ?? 2;
      const rB = BLOC_RANK[b.bloc] ?? 2;
      if (rA !== rB) return rA - rB;
      return (a.name || "").localeCompare(b.name || "", "pl");
    })
    .map((p) => p.id);
}

const EVENTS = [
  { msg: (p) => `Afera obyczajowa wstrząsa partią ${p.full}`, delta: -4.5 },
  { msg: (p) => `${p.full} ogłasza sukces gospodarczy rządu / opozycji`, delta: 3.5 },
  { msg: (p) => `Wyciek nagrań kompromituje polityków ${p.full}`, delta: -3.2 },
  { msg: (p) => `Charyzmatyczne wystąpienie lidera ${p.full} w mediach`, delta: 2.6 },
  { msg: (p) => `Spór wewnętrzny osłabia ${p.full}`, delta: -2.1 },
  { msg: (p) => `${p.full} zyskuje po debacie sejmowej`, delta: 1.8 },
  { msg: (p) => `Afera korupcyjna w otoczeniu ${p.full}`, delta: -5.0 },
];

function maybeShock(pollsObj, activeParties) {
  if (Math.random() > 0.22 || !activeParties.length) return { polls: pollsObj, note: null };
  const party = activeParties[Math.floor(Math.random() * activeParties.length)];
  const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
  const next = { ...pollsObj };
  next[party.id] = Math.max(0.05, (next[party.id] || 0) + ev.delta);
  return { polls: normalize(next), note: ev.msg(party) };
}

function minimalWinningSubset(seatsMap, ids, majority) {
  const sorted = [...ids].sort((a, b) => (seatsMap[b] || 0) - (seatsMap[a] || 0));
  let total = 0;
  const included = [];
  for (const id of sorted) {
    if (total >= majority) break;
    if ((seatsMap[id] || 0) <= 0) continue;
    included.push(id);
    total += seatsMap[id];
  }
  return { included, total };
}

// Kolejność bloków licząc od centrum ku skrajności — używana do dobrania
// precyzyjnego określenia koalicji (np. dwie partie ze skrajnej lewicy mają
// dostać etykietę "skrajnie lewicowa", a nie ogólne "centrolewicowa").
const LEFT_BLOC_ORDER = ["centrolewica", "lewica", "skrajna_lewica"];
const LEFT_BLOC_ADJ = {
  centrolewica: "centrolewicowa",
  lewica: "lewicowa",
  skrajna_lewica: "skrajnie lewicowa",
};
const RIGHT_BLOC_ORDER = ["centroprawica", "prawica", "skrajna_prawica"];
const RIGHT_BLOC_ADJ = {
  centroprawica: "centroprawicowa",
  prawica: "prawicowa",
  skrajna_prawica: "skrajnie prawicowa",
};

// Zwraca określenie ideologiczne pasujące do faktycznego składu koalicji:
// - same partie z jednego bloku -> dokładne określenie tego bloku (np. obie skrajnie lewicowe -> "skrajnie lewicowa")
// - partie z kilku bloków tej samej strony osi -> określenie najbliższego centrum bloku spośród obecnych
// - same partie centrowe -> "centrowa"
function axisAdjective(includedIds, registryLookup, order, adjMap) {
  const blocsPresent = new Set(includedIds.map((id) => registryLookup[id]?.bloc).filter(Boolean));
  const presentInOrder = order.filter((b) => blocsPresent.has(b));
  if (presentInOrder.length === 0) return "centrowa";
  return adjMap[presentInOrder[0]];
}

// Generuje czytelną nazwę koalicji na podstawie faktycznego składu, a nie
// nazw konkretnych partii "na sztywno" — dzięki temu działa dla dowolnego
// zestawu partii wpisanych przez gracza, a nie tylko dla domyślnego (nieaktualnego) układu.
function describeCoalition(includedIds, seatsMap, registryLookup, axisAdj) {
  const sorted = [...includedIds].sort((a, b) => (seatsMap[b] || 0) - (seatsMap[a] || 0));
  const leaderName = registryLookup[sorted[0]]?.name || "?";
  if (sorted.length === 1) return `Rząd jednopartyjny (oś ${leaderName})`;
  if (sorted.length === 2) return `Koalicja dwupartyjna ${axisAdj} (oś ${leaderName})`;
  if (sorted.length === 3) return `Koalicja trójpartyjna ${axisAdj} (oś ${leaderName})`;
  return `Szeroka koalicja ${axisAdj} (oś ${leaderName})`;
}

function formGovernment(seatsMap, previousCoalition, activeParties, majority = MAJORITY) {
  const registryLookup = Object.fromEntries(activeParties.map((p) => [p.id, p]));

  // 1. Próba utrzymania obecnej koalicji
  if (previousCoalition && previousCoalition.length) {
    const total = previousCoalition.reduce((a, id) => a + (seatsMap[id] || 0), 0);
    if (total >= majority) {
      const pm = [...previousCoalition].sort((a, b) => (seatsMap[b] || 0) - (seatsMap[a] || 0))[0];
      return { coalition: previousCoalition, total, pm, label: "Kontynuacja koalicji", stable: true };
    }
  }
  if (!activeParties.length) {
    return { coalition: [], total: 0, pm: null, label: "Brak partii biorących udział w grze", stable: false };
  }

  const centrumLewica = activeParties.filter((p) => LEFT_AXIS_BLOCS.includes(p.bloc)).map((p) => p.id);
  const prawicaBlok = activeParties.filter((p) => RIGHT_AXIS_BLOCS.includes(p.bloc)).map((p) => p.id);

  const optA = minimalWinningSubset(seatsMap, centrumLewica, majority);
  const optB = minimalWinningSubset(seatsMap, prawicaBlok, majority);

  let best = null;
  if (optA.total >= majority) {
    const adjA = axisAdjective(optA.included, registryLookup, LEFT_BLOC_ORDER, LEFT_BLOC_ADJ);
    best = { ...optA, label: describeCoalition(optA.included, seatsMap, registryLookup, adjA) };
  }
  if (optB.total >= majority && (!best || optB.included.length < best.included.length)) {
    const adjB = axisAdjective(optB.included, registryLookup, RIGHT_BLOC_ORDER, RIGHT_BLOC_ADJ);
    best = { ...optB, label: describeCoalition(optB.included, seatsMap, registryLookup, adjB) };
  }

  if (!best) {
    // wielka koalicja — dwie największe partie z przeciwległych bloków, jako ostatnia deska ratunku
    const biggestCL = [...centrumLewica].sort((a, b) => (seatsMap[b] || 0) - (seatsMap[a] || 0))[0];
    const biggestPB = [...prawicaBlok].sort((a, b) => (seatsMap[b] || 0) - (seatsMap[a] || 0))[0];
    const grandIds = [biggestCL, biggestPB].filter(Boolean);
    if (grandIds.length === 2) {
      const grand = minimalWinningSubset(seatsMap, grandIds, majority);
      if (grand.total >= majority) {
        const [n1, n2] = grandIds.map((id) => registryLookup[id]?.name || "?");
        best = { ...grand, label: `Rząd techniczny — wielka koalicja (${n1}–${n2})` };
      }
    }
  }

  if (!best) {
    const biggest = [...activeParties].sort((a, b) => (seatsMap[b.id] || 0) - (seatsMap[a.id] || 0))[0];
    return {
      coalition: [biggest.id],
      total: seatsMap[biggest.id] || 0,
      pm: biggest.id,
      label: `Rząd mniejszościowy (${biggest.name}) — brak stabilnej większości`,
      stable: false,
    };
  }

  const pm = [...best.included].sort((a, b) => (seatsMap[b] || 0) - (seatsMap[a] || 0))[0];
  return { coalition: best.included, total: best.total, pm, label: best.label, stable: true };
}

// Sejmiki: 16 regionów, plurality zwycięzcy jako proxy kontroli
// Zwraca zarówno zagregowaną liczbę zdobytych sejmików (control, jak dotychczas),
// jak i pełny rozkład wyniku w każdym z 16 województw (regionalResults) oraz
// zwycięzcę w każdym z nich (regionalWinners) — używane m.in. do wyświetlania
// wyników wyborów według województw oraz do aktualizacji regionalStrength gracza.
function simulateSejmikiDetailed(pollsObj) {
  const ids = Object.keys(pollsObj);
  const control = {};
  ids.forEach((id) => (control[id] = 0));
  const regionalWinners = {};
  const regionalResults = {};
  if (!ids.length) return { control, regionalWinners, regionalResults };
  for (let r = 0; r < SEJMIK_REGIONS; r++) {
    const regionName = WOJEWODZTWA[r] || `Region ${r + 1}`;
    const regional = {};
    ids.forEach((id) => {
      const noise = (Math.random() - 0.5) * 9;
      regional[id] = Math.max(0.01, (pollsObj[id] || 0) + noise);
    });
    const normalizedRegional = normalize(regional);
    let leaderId = ids[0];
    ids.forEach((id) => {
      if (normalizedRegional[id] > normalizedRegional[leaderId]) leaderId = id;
    });
    control[leaderId] += 1;
    regionalWinners[regionName] = leaderId;
    regionalResults[regionName] = normalizedRegional;
  }
  return { control, regionalWinners, regionalResults };
}

function simulateSejmiki(pollsObj) {
  return simulateSejmikiDetailed(pollsObj).control;
}

// Szacowana frekwencja ogólnopolska dla danego typu wyborów — bazowa wartość
// typowa dla tego typu głosowania, skorygowana o temperaturę polityczną
// (świat gracza) i odrobinę losowości. Wyłącznie do celów prezentacyjnych,
// nie wpływa na wynik mandatowy (D'Hondt nadal liczy z samych sondaży).
function estimateTurnout(electionType, world) {
  const base = { sejm: 60, prezydent: 58, europarlament: 40, samorzad: 46 }[electionType] ?? 50;
  const tempAdj = world && Number.isFinite(world.politicalTemperature) ? (world.politicalTemperature - 35) * 0.15 : 0;
  const noise = (Math.random() - 0.5) * 8;
  return Math.max(28, Math.min(85, Math.round((base + tempAdj + noise) * 10) / 10));
}

// Rozkład wyniku DRUGIEJ TURY wyborów prezydenckich (tylko dwaj finaliści)
// w każdym z 16 województw — inny mechanizm niż simulateSejmikiDetailed, bo
// tu liczy się tylko dwóch kandydatów, nie cały sejm partii.
function buildRunoffRegionalResults(idA, pollA, idB, pollB) {
  const results = {};
  const winners = {};
  WOJEWODZTWA.forEach((region) => {
    const a = Math.max(0.5, pollA + (Math.random() - 0.5) * 14);
    const b = Math.max(0.5, pollB + (Math.random() - 0.5) * 14);
    const sum = a + b;
    const pctA = Math.round((a / sum) * 10000) / 100;
    const pctB = Math.round(10000 - pctA * 100) / 100;
    results[region] = { [idA]: pctA, [idB]: pctB };
    winners[region] = pctA >= pctB ? idA : idB;
  });
  return { results, winners };
}

// ---------------------------------------------------------------------------
// HARMONOGRAM WYBORÓW
// ---------------------------------------------------------------------------

function addYears(date, years) {
  return { year: date.year + years, month: date.month };
}

function addMonths(date, months) {
  const total = date.year * 12 + (date.month - 1) + months;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function sameDate(a, b) {
  return a.year === b.year && a.month === b.month;
}

function monthsBetween(a, b) {
  return (b.year * 12 + (b.month - 1)) - (a.year * 12 + (a.month - 1));
}

// Terminy pierwszych wyborów liczone względem wybranej daty startu symulacji
// (przy domyślnym starcie maj 2025 dają dokładnie: Sejm XI 2027, samorządowe
// IV 2029, europarlament VI 2029, prezydenckie V 2030).
function initialSchedule(startDate) {
  return {
    sejm: addMonths(startDate, 30),
    samorzad: addMonths(startDate, 47),
    europarlament: addMonths(startDate, 49),
    prezydent: addMonths(startDate, 60),
  };
}

// ---------------------------------------------------------------------------
// HEMICYKL — WIZUALIZACJA SEJMU/SENATU/EP
// ---------------------------------------------------------------------------

function distributeRows(total, rows) {
  const r0 = 1;
  const weights = Array.from({ length: rows }, (_, i) => r0 + i);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sumW) * total);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const fracIdx = raw
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) floors[fracIdx[k].i] += 1;
  return floors;
}

function buildHemicycle(seatCounts, order) {
  const seatList = [];
  order.forEach((id) => {
    for (let i = 0; i < (seatCounts[id] || 0); i++) seatList.push(id);
  });
  const total = seatList.length;
  if (total === 0) return [];

  const rows = total > 300 ? 13 : total > 120 ? 9 : 6;
  const dotR = total > 300 ? 3 : total > 120 ? 4.2 : 6.5;
  const rMin = 42;
  const rMax = 228;
  const step = (rMax - rMin) / (rows - 1);
  const rowCounts = distributeRows(total, rows);

  const cx = 280;
  const cy = 260;
  let positions = [];
  rowCounts.forEach((count, i) => {
    const radius = rMin + i * step;
    for (let j = 0; j < count; j++) {
      const angleDeg = 180 - (j + 0.5) * (180 / count);
      const angleRad = (angleDeg * Math.PI) / 180;
      const x = cx + radius * Math.cos(angleRad);
      const y = cy - radius * Math.sin(angleRad);
      positions.push({ x, y, angleDeg });
    }
  });
  positions.sort((a, b) => b.angleDeg - a.angleDeg);
  return positions.map((pos, i) => ({ ...pos, partyId: seatList[i], r: dotR }));
}

// Westminsterski układ ław — dwa przeciwstawne bloki miejsc (rząd kontra
// opozycja) w rzędach patrzących na siebie przez centralną przejście,
// zamiast półkolistego hemicyklu. coalitionIds określa, które partie siedzą
// po stronie rządowej (prawa strona) — reszta trafia do bloku opozycji (lewa strona).
function buildWestminster(seatCounts, order, coalitionIds) {
  const govSet = new Set(coalitionIds || []);
  const leftList = [];
  const rightList = [];
  order.forEach((id) => {
    const n = seatCounts[id] || 0;
    for (let i = 0; i < n; i++) {
      if (govSet.has(id)) rightList.push(id);
      else leftList.push(id);
    }
  });
  const total = leftList.length + rightList.length;
  if (total === 0) return [];

  const rows = total > 300 ? 14 : total > 120 ? 10 : 7;
  const seatSize = total > 300 ? 2.6 : total > 120 ? 3.8 : 5.6;
  const gap = seatSize * 2.15;
  const aisleGap = 18;
  const cy0 = 258;

  function layoutBlock(list, sideSign) {
    const perRow = Math.max(1, Math.ceil(list.length / rows));
    const positions = [];
    let idx = 0;
    for (let r = 0; r < rows && idx < list.length; r++) {
      const rowCount = Math.min(perRow, list.length - idx);
      for (let c = 0; c < rowCount; c++) {
        const x = 280 + sideSign * (aisleGap + c * gap + gap / 2);
        const y = cy0 - r * gap;
        positions.push({ x, y, partyId: list[idx], r: seatSize });
        idx++;
      }
    }
    return positions;
  }

  return [...layoutBlock(leftList, -1), ...layoutBlock(rightList, 1)];
}

// ---------------------------------------------------------------------------
// FORMATOWANIE
// ---------------------------------------------------------------------------

function fmtDate(d) {
  return `${MONTHS_PL[d.month - 1]} ${d.year}`;
}

function fmtSavedAt(iso) {
  try {
    return new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return iso;
  }
}

function pct(n) {
  return n.toFixed(2).replace(".", ",") + "%";
}

// ---------------------------------------------------------------------------
// WŁADZE — przetwarzanie historii prezydentów i premierów na czytelne bloki
// ---------------------------------------------------------------------------

// Łączy kolejne wpisy presidentHistory o tej samej nazwie prezydenta w jeden
// blok (np. dwie kolejne kadencje tej samej osoby/obozu -> jeden wiersz
// z pełnym zakresem lat), zamiast wypisywać każdą 5-letnią kadencję osobno.
function buildPresidentBlocks(presidentHistory) {
  if (!presidentHistory || !presidentHistory.length) return [];
  const blocks = [];
  presidentHistory.forEach((entry) => {
    const last = blocks[blocks.length - 1];
    if (last && last.name === entry.name) {
      last.to = entry.to;
      last.terms += 1;
    } else {
      blocks.push({ name: entry.name, note: entry.note, from: entry.from, to: entry.to, terms: 1 });
    }
  });
  return blocks;
}

// Łączy kolejne wpisy governmentHistory o tym samym premierze (pm party id)
// w jeden blok "rządów premiera X", a wewnątrz niego zwraca listę okresów
// o stałym, niezmienionym składzie koalicji (do wypisania w nawiasie).
function buildPremierBlocks(governmentHistory) {
  if (!governmentHistory || !governmentHistory.length) return [];
  const blocks = [];
  governmentHistory.forEach((entry) => {
    const last = blocks[blocks.length - 1];
    if (last && last.pm === entry.pm) {
      last.to = entry.to;
      last.periods.push(entry);
    } else {
      blocks.push({ pm: entry.pm, from: entry.from, to: entry.to, periods: [entry] });
    }
  });
  return blocks.map((block) => {
    const segments = [];
    block.periods.forEach((p) => {
      const key = [...p.coalition].sort().join("|");
      const lastSeg = segments[segments.length - 1];
      if (lastSeg && lastSeg.key === key) {
        lastSeg.to = p.to;
      } else {
        segments.push({ key, from: p.from, to: p.to, coalition: p.coalition, label: p.label });
      }
    });
    return { ...block, segments };
  });
}

function fmtYear(d) {
  return d ? String(d.year) : "";
}

function fmtYearRange(from, to) {
  const a = fmtYear(from);
  const b = to ? fmtYear(to) : "nadal";
  if (to && from && from.year === to.year) return a;
  return `${a}–${b}`;
}

// ---------------------------------------------------------------------------
// GŁÓWNY KOMPONENT
// ---------------------------------------------------------------------------

// config = { parties: [{id,name,full,color,bloc,start}, ...], startDate: {year,month},
//            schedule?: {sejm,samorzad,europarlament,prezydent}, president?: {name,note} }
// schedule i president pochodzą z ekranu konfiguracji (gracz podaje je przed startem gry);
// jeśli brak (np. przy "Uruchom symulację od nowa z tą datą" w Ustawieniach), dobierane są
// bezpieczne wartości domyślne. Po rozegraniu każdego typu wyborów harmonogram przechodzi
// w normalny, automatyczny cykl (patrz addYears w funkcji advance()).
// ---------------------------------------------------------------------------
// TRYB GRACZA — dane, biblioteki i logika czystych funkcji
// ---------------------------------------------------------------------------
// Cała ta sekcja jest dodatkową WARSTWĄ nad istniejącym silnikiem symulacji.
// Nie zastępuje ona ani nie duplikuje D'Hondta, formGovernment, randomWalk,
// harmonogramu wyborów ani configu partii — korzysta z nich wprost.
// Gdy state.gameMode === "simulation" (albo brak state.player), cała ta
// warstwa jest nieaktywna i gra działa dokładnie tak jak wcześniej.

function clamp(v, min, max) {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rollInRange(range, mult = 1) {
  if (!range) return 0;
  const [min, max] = range;
  return (min + Math.random() * (max - min)) * mult;
}

// --- role, stanowiska, ścieżka kariery -------------------------------------

const PLAYER_ROLES = [
  { id: "activist", label: "Działacz lokalny", tier: 1, needsParty: true, startable: true },
  { id: "councillor", label: "Radny (sejmik)", tier: 2, needsParty: false, startable: true },
  { id: "mp", label: "Poseł", tier: 3, needsParty: false, startable: true },
  { id: "senator", label: "Senator", tier: 3, needsParty: false, startable: true },
  { id: "mep", label: "Europoseł", tier: 3, needsParty: false, startable: true },
  { id: "independent", label: "Niezależny polityk", tier: 2, needsParty: false, startable: true },
  { id: "party_leader", label: "Lider partii", tier: 4, needsParty: true, startable: false },
  { id: "minister", label: "Minister", tier: 4, needsParty: false, startable: false },
  { id: "pm", label: "Premier", tier: 5, needsParty: false, startable: false },
  { id: "president_candidate", label: "Kandydat na prezydenta", tier: 4, needsParty: false, startable: false },
  { id: "president", label: "Prezydent", tier: 5, needsParty: false, startable: false },
];
const PLAYER_ROLE_LABELS = Object.fromEntries(PLAYER_ROLES.map((r) => [r.id, r.label]));
function roleLabel(id) {
  return PLAYER_ROLE_LABELS[id] || id;
}

const PLAYER_TRAITS = [
  { id: "orator", label: "Świetny mówca", desc: "Lepsze efekty debat i przemówień, mniejsze ryzyko wpadki w mediach." },
  { id: "organizer", label: "Organizator", desc: "Skuteczniejsza budowa struktur i kampanii lokalnej." },
  { id: "technocrat", label: "Technokrata", desc: "Przewaga w politykach publicznych, ale niższy start rozpoznawalności." },
  { id: "populist", label: "Populista", desc: "Silny efekt medialny i mobilizacyjny, wyższe ryzyko utraty wiarygodności." },
  { id: "negotiator", label: "Negocjator", desc: "Lepsze rozmowy koalicyjne, ale bywa postrzegany jako mniej stanowczy." },
  { id: "media_savvy", label: "Medialny", desc: "Wyższa skuteczność działań medialnych." },
  { id: "radical", label: "Radykał", desc: "Mocno mobilizuje twardy elektorat, drażni wyborców umiarkowanych." },
  { id: "moderate", label: "Umiarkowany", desc: "Łatwiej o kompromis, słabsza mobilizacja twardego elektoratu." },
  { id: "grassroots", label: "Lokalny działacz", desc: "Silne zaplecze regionalne i organizacyjne." },
];
const PLAYER_TRAIT_MAP = Object.fromEntries(PLAYER_TRAITS.map((t) => [t.id, t]));

const PLAY_STYLES = [
  { id: "pragmatist", label: "Pragmatyk", desc: "Łatwiej buduje koalicje, słabszy wśród twardego elektoratu." },
  { id: "idealist", label: "Ideowiec", desc: "Zyskuje lojalność zaplecza, trudniej mu o kompromisy." },
  { id: "media_warrior", label: "Medialny wojownik", desc: "Dobry w debatach i atakach, częściej eskaluje konflikty." },
  { id: "technocrat_style", label: "Technokrata", desc: "Przewaga w politykach publicznych, niższa rozpoznawalność." },
  { id: "negotiator_style", label: "Negocjator", desc: "Dobre relacje, bywa postrzegany jako niezdecydowany." },
  { id: "populist_style", label: "Populista", desc: "Szybki wzrost rozpoznawalności, ryzyko utraty wiarygodności." },
  { id: "organizer_style", label: "Organizator", desc: "Mocne struktury partyjne i lokalne." },
  { id: "outsider", label: "Outsider", desc: "Szybka rozpoznawalność, słabe struktury zaplecza." },
];

const PLAYER_TOPICS = [
  "gospodarka", "podatki", "bezpieczeństwo", "migracja", "mieszkalnictwo", "zdrowie",
  "edukacja", "klimat", "rolnictwo", "samorząd", "polityka zagraniczna", "prawa obywatelskie", "polityka rodzinna",
];

// ---------------------------------------------------------------------------
// §5 ELEKTORAT I SEGMENTY SPOŁECZNE
// ---------------------------------------------------------------------------
// Segmenty nie są osobnym modelem socjologicznym — to narzędzie do
// różnicowania reakcji na decyzje gracza. Każdy segment ma listę tematów,
// na które szczególnie reaguje ("affinity"), oraz preferowany "styl" decyzji
// (hardStance = twarde/zdecydowane stanowiska, softStance = kompromis/umiar).
const ELECTORATE_SEGMENTS = [
  { id: "youth", label: "Młodzi", affinity: ["edukacja", "klimat", "mieszkalnictwo", "prawa obywatelskie"], style: "media" },
  { id: "seniors", label: "Starsi", affinity: ["zdrowie", "bezpieczeństwo", "polityka rodzinna"], style: "stability" },
  { id: "urban", label: "Mieszkańcy dużych miast", affinity: ["klimat", "mieszkalnictwo", "prawa obywatelskie", "edukacja"], style: "media" },
  { id: "smalltown", label: "Mieszkańcy mniejszych miast", affinity: ["samorząd", "bezpieczeństwo", "gospodarka"], style: "stability" },
  { id: "rural", label: "Wieś", affinity: ["rolnictwo", "samorząd", "polityka rodzinna"], style: "stability" },
  { id: "entrepreneurs", label: "Przedsiębiorcy", affinity: ["podatki", "gospodarka"], style: "hard" },
  { id: "workers", label: "Pracownicy", affinity: ["gospodarka", "zdrowie", "bezpieczeństwo"], style: "stability" },
  { id: "low_income", label: "Wyborcy o niskich dochodach", affinity: ["gospodarka", "mieszkalnictwo", "zdrowie"], style: "soft" },
  { id: "high_income", label: "Wyborcy o wysokich dochodach", affinity: ["podatki", "gospodarka", "polityka zagraniczna"], style: "hard" },
  { id: "hard_ideological", label: "Elektorat ideologicznie twardy", affinity: ["bezpieczeństwo", "migracja", "polityka rodzinna", "prawa obywatelskie"], style: "hard" },
  { id: "moderate", label: "Elektorat umiarkowany", affinity: ["gospodarka", "zdrowie", "edukacja"], style: "soft" },
  { id: "undecided", label: "Wyborcy niezdecydowani", affinity: [], style: "media" },
];
const ELECTORATE_SEGMENT_MAP = Object.fromEntries(ELECTORATE_SEGMENTS.map((s) => [s.id, s]));

function createDefaultSegmentSupport() {
  const out = {};
  ELECTORATE_SEGMENTS.forEach((s) => { out[s.id] = 30 + Math.round(Math.random() * 20); });
  return out;
}

// Zwraca 1-3 segmenty najbardziej "zaangażowane" daną decyzją — na podstawie
// tematów gracza (player.topics) skrzyżowanych z affinity segmentu, plus stylu
// opcji (risk niskie/umiarkowane -> soft/stability, wysokie/bardzo wysokie -> hard).
function pickReactingSegments(decision, option, player) {
  const styleFromRisk = option.risk === "wysokie" || option.risk === "bardzo wysokie" ? "hard" : option.risk === "niskie" ? "soft" : "stability";
  const scored = ELECTORATE_SEGMENTS.map((s) => {
    let score = 0;
    (player.topics || []).forEach((t) => { if (s.affinity.includes(t)) score += 2; });
    if (s.style === styleFromRisk) score += 1;
    if (s.id === "undecided") score += 0.3;
    score += Math.random() * 1.5;
    return { segment: s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 1 + Math.round(Math.random())).map((x) => x.segment);
}

const SEGMENT_REACTION_PHRASES = {
  positive: [
    (label) => `${label} pozytywnie zareagowali na Twoje działania.`,
    (label) => `${label} docenili to stanowisko.`,
    (label) => `Wzrosło zaufanie wśród grupy: ${label.toLowerCase()}.`,
  ],
  negative: [
    (label) => `${label} odebrali to jako ustępstwo lub błąd.`,
    (label) => `${label} zareagowali chłodno na tę decyzję.`,
    (label) => `Spadło zaufanie wśród grupy: ${label.toLowerCase()}.`,
  ],
  neutral: [
    (label) => `${label} pozostali obojętni wobec tej decyzji.`,
  ],
};

// Zwraca listę {segmentId, label, delta, text} — używane zarówno do
// aktualizacji player.segmentSupport, jak i do wyświetlenia w UI/logu.
function resolveSegmentReactions(decision, option, player, netSentiment) {
  const segments = pickReactingSegments(decision, option, player);
  return segments.map((s) => {
    // netSentiment > 0 -> ogólnie pozytywna decyzja; ale segmenty "hard" lubią
    // ryzykowne/zdecydowane opcje nawet gdy netSentiment jest ujemny (np. atak).
    let tone = netSentiment >= 0 ? "positive" : "negative";
    if (s.style === "hard" && (option.risk === "wysokie" || option.risk === "bardzo wysokie")) tone = "positive";
    if (s.style === "soft" && (option.risk === "wysokie" || option.risk === "bardzo wysokie")) tone = "negative";
    const delta = (tone === "positive" ? 1 : tone === "negative" ? -1 : 0) * (1 + Math.random() * 2.5);
    const phrasePool = SEGMENT_REACTION_PHRASES[tone];
    const text = phrasePool[Math.floor(Math.random() * phrasePool.length)](s.label);
    return { segmentId: s.id, label: s.label, delta, tone, text };
  });
}

const DIFFICULTY_LEVELS = {
  easy: { label: "Łatwy", randomness: 0.65, eventChance: 0.75, activityBonus: 1, crisisFreq: 0.6, canUndoMonth: true, infoQuality: 1 },
  normal: { label: "Normalny", randomness: 1, eventChance: 1, activityBonus: 0, crisisFreq: 1, canUndoMonth: false, infoQuality: 0.75 },
  hard: { label: "Trudny", randomness: 1.3, eventChance: 1.25, activityBonus: -1, crisisFreq: 1.4, canUndoMonth: false, infoQuality: 0.55 },
  extreme: { label: "Ekstremalny", randomness: 1.6, eventChance: 1.5, activityBonus: -1, crisisFreq: 1.8, canUndoMonth: false, infoQuality: 0.35 },
};

const PLAYER_AMBITIONS = [
  { id: "party_leader", label: "Zostać liderem partii", check: (p) => p.role === "party_leader" },
  { id: "pm", label: "Zostać premierem", check: (p) => p.role === "pm" },
  { id: "president", label: "Zostać prezydentem", check: (p) => p.role === "president" },
  { id: "build_party_support", label: "Zbudować dużą partię (20%+ poparcia)", check: (p, s) => (s.polls[p.partyId] || 0) >= 20 },
  { id: "keep_coalition", label: "Utrzymać koalicję przy władzy", check: () => false },
  { id: "most_popular", label: "Zostać najpopularniejszym politykiem kraju", check: (p) => p.stats.popularity >= 80 },
  { id: "survive_years", label: "Przetrwać w polityce długi okres (10 lat)", check: (p) => p.monthsInPolitics >= 120 },
  { id: "new_party", label: "Stworzyć partię od zera", check: (p) => !!p.foundedOwnParty },
];
function ambitionLabel(id) {
  const a = PLAYER_AMBITIONS.find((x) => x.id === id);
  return a ? a.label : "Kariera polityczna";
}

const NPC_FIRST = ["Anna", "Marek", "Katarzyna", "Piotr", "Ewa", "Tomasz", "Magdalena", "Jan", "Agnieszka", "Michał", "Joanna", "Krzysztof", "Barbara", "Paweł", "Zofia", "Grzegorz", "Monika", "Andrzej"];
const NPC_LAST = ["Nowak", "Kowalski", "Wiśniewski", "Wójcik", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Dąbrowski", "Kozłowski", "Jankowski", "Mazur", "Krawczyk", "Piotrowski", "Grabowski", "Pawłowski"];
function generateNpcName() {
  return `${pickOne(NPC_FIRST)} ${pickOne(NPC_LAST)}`;
}

// --- statystyki i domyślny stan gracza --------------------------------------

function createDefaultPlayerStats() {
  return {
    popularity: 10,
    recognition: 6,
    mediaSkill: 32,
    leadership: 24,
    debateSkill: 30,
    organization: 30,
    credibility: 46,
    partyInfluence: 12,
    publicTrust: 34,
    coalitionSkill: 30,
    fundraising: 24,
    stamina: 75,
    scandalRisk: 14,
    factionSupport: 18,
  };
}

const TRAIT_STAT_BONUS = {
  orator: { debateSkill: 8, mediaSkill: 4 },
  organizer: { organization: 10 },
  technocrat: { credibility: 8, recognition: -4 },
  populist: { mediaSkill: 8, scandalRisk: 6, credibility: -4 },
  negotiator: { coalitionSkill: 10 },
  media_savvy: { mediaSkill: 10 },
  radical: { factionSupport: 8, publicTrust: -4 },
  moderate: { coalitionSkill: 6, publicTrust: 4 },
  grassroots: { organization: 8, recognition: 4 },
};

function createDefaultPlayerState(config, registry) {
  const id = "player_" + Math.random().toString(36).slice(2, 10);
  const stats = createDefaultPlayerStats();
  const traits = (config.traits && config.traits.length ? config.traits : ["organizer"]).slice(0, 5);
  traits.forEach((tId) => {
    const bonus = TRAIT_STAT_BONUS[tId];
    if (bonus) Object.entries(bonus).forEach(([k, v]) => { stats[k] = clamp((stats[k] || 0) + v, 0, 100); });
  });
  const role = PLAYER_ROLES.find((r) => r.id === config.role && r.startable) ? config.role : "activist";
  const partyId = config.partyId && registry[config.partyId] ? config.partyId : null;
  const ideology = config.ideology || (partyId && registry[partyId] ? registry[partyId].bloc : "centrum");
  return {
    id,
    name: (config.name || "Nowy polityk").trim() || "Nowy polityk",
    partyId,
    role,
    region: config.region || "Mazowieckie",
    age: Number(config.age) > 17 ? Math.round(Number(config.age)) : 35,
    ideology,
    // §3: wielowymiarowa platforma programowa postaci — jeśli gracz nie ustawił
    // jej ręcznie w kreatorze, wyliczamy sensowne wartości domyślne z bloku.
    platform: config.platform || defaultPlatformForBloc(ideology),
    topics: config.topics && config.topics.length ? config.topics.slice(0, 4) : ["gospodarka", "zdrowie"],
    traits,
    playStyle: config.playStyle || "pragmatist",
    difficulty: config.difficulty || "normal",
    ambition: config.ambition || "build_party_support",
    stats,
    segmentSupport: createDefaultSegmentSupport(),
    resources: { actionPoints: 3, energy: 80, politicalCapital: 20, budget: 15 },
    xp: 0,
    careerLevel: 1,
    monthsInPolitics: 0,
    foundedOwnParty: false,
    currentPosition: roleLabel(role),
    goals: [],
    retired: false,
    ambitionAchieved: false,
    analyticsBoughtThisMonth: false,
    electionsWon: 0,
    electionsLost: 0,
    peakPopularity: stats.popularity,
    peakPartyPoll: 0,
    pendingCandidacy: null,
    roleBeforePresidency: null,
  };
}

function createDefaultWorldState() {
  return {
    economy: 55,
    unemployment: 42,
    inflation: 50,
    publicServices: 50,
    security: 60,
    governmentApproval: 45,
    politicalTemperature: 35,
    mediaTemperature: 30,
  };
}

// --- NPC i relacje -----------------------------------------------------------

function ensureNpcsForParties(npcs, registry) {
  const next = { ...npcs };
  Object.values(registry).forEach((p) => {
    const leaderId = "npc_leader_" + p.id;
    if (!next[leaderId]) {
      next[leaderId] = {
        id: leaderId,
        name: generateNpcName(),
        role: "Lider partii",
        partyId: p.id,
        popularity: 35 + Math.round(Math.random() * 35),
        ideology: p.bloc,
        ambition: pickOne(["utrzymanie władzy", "budowę pozycji", "reformę partii", "ekspansję elektoratu"]),
        loyalty: 50,
        riskTolerance: Math.round(Math.random() * 100),
      };
    }
  });
  return next;
}

// ---------------------------------------------------------------------------
// §9 FRAKCJE WEWNĄTRZ PARTII
// ---------------------------------------------------------------------------
// Generowane proceduralnie na podstawie bloku ideologicznego partii — bez
// ręcznej konfiguracji dla każdej partii z osobna. Trzy frakcje o sumarycznym
// poparciu 100: umiarkowana / pragmatyczna / radykalna (nazwy dopasowane do
// strony osi lewica-prawica, żeby brzmiały naturalnie niezależnie od bloku).
function generateFactionsForParty(party) {
  const rank = BLOC_RANK[party.bloc] ?? 3;
  const leaning = rank < 3 ? "lewicowa" : rank > 3 ? "prawicowa" : "centrowa";
  const radicalLabel = rank < 3 ? "Radykalna lewica" : rank > 3 ? "Radykalna prawica" : "Skrzydło ideowe";
  const moderateLabel = "Umiarkowani";
  const pragmaticLabel = "Pragmatycy";
  const base = 34 + Math.round(Math.random() * 8);
  const radical = 20 + Math.round(Math.random() * 15);
  const pragmatic = 100 - base - radical;
  return [
    { id: "moderate", label: moderateLabel, support: base, loyalty: 55 + Math.round(Math.random() * 15) },
    { id: "pragmatic", label: pragmaticLabel, support: Math.max(10, pragmatic), loyalty: 60 + Math.round(Math.random() * 15) },
    { id: "radical", label: radicalLabel, support: radical, loyalty: 35 + Math.round(Math.random() * 20) },
  ];
}

function ensureFactionsForParties(factions, registry) {
  const next = { ...factions };
  Object.values(registry).forEach((p) => {
    if (!next[p.id]) next[p.id] = generateFactionsForParty(p);
  });
  return next;
}

// Przesuwa poparcie frakcji radykalnej/umiarkowanej partii gracza w reakcji na
// jego decyzje (np. kompromis wzmacnia umiarkowanych, atak/twarda linia wzmacnia
// radykałów) — utrzymuje sumę w okolicach 100 przez proporcjonalne odjęcie z pragmatyków.
function shiftPlayerFactions(factions, partyId, radicalDelta) {
  if (!factions || !factions[partyId]) return factions;
  const list = factions[partyId].map((f) => ({ ...f }));
  const radical = list.find((f) => f.id === "radical");
  const pragmatic = list.find((f) => f.id === "pragmatic");
  if (!radical || !pragmatic) return factions;
  const delta = clamp(radicalDelta, -8, 8);
  radical.support = clamp(radical.support + delta, 5, 70);
  pragmatic.support = clamp(pragmatic.support - delta, 5, 70);
  const moderate = list.find((f) => f.id === "moderate");
  const sum = list.reduce((s, f) => s + f.support, 0);
  if (moderate && sum !== 100) moderate.support = clamp(moderate.support + (100 - sum), 5, 80);
  return { ...factions, [partyId]: list };
}

function getRelation(playerRelations, npcId) {
  return (playerRelations && playerRelations[npcId]) || { score: 0, trust: 0, rivalry: 0, lastInteraction: null };
}

function adjustRelation(playerRelations, npcId, delta, dateLabel) {
  const cur = getRelation(playerRelations, npcId);
  return {
    ...playerRelations,
    [npcId]: {
      score: clamp(cur.score + delta, -100, 100),
      trust: clamp(cur.trust + delta * 0.4, -100, 100),
      rivalry: delta < 0 ? clamp(cur.rivalry - delta * 0.3, 0, 100) : cur.rivalry,
      lastInteraction: dateLabel,
    },
  };
}

function ownLeaderNpcId(player) {
  return player.partyId ? "npc_leader_" + player.partyId : null;
}

// --- dostępność decyzji wg roli/kontekstu ------------------------------------

function isInGovernment(player, state) {
  if (!player.partyId || !state.government) return false;
  return (state.government.coalition || []).includes(player.partyId);
}

function decisionAvailable(decision, state) {
  const player = state.player;
  if (!player || player.retired) return false;
  if (decision.minTier && (PLAYER_ROLES.find((r) => r.id === player.role)?.tier || 1) < decision.minTier) return false;
  if (decision.requiresParty && !player.partyId) return false;
  if (decision.requiresIndependent && player.partyId) return false;
  if (decision.requiresLeader && player.role !== "party_leader") return false;
  if (decision.requiresGovernment && !isInGovernment(player, state)) return false;
  if (decision.requiresParliament && !["mp", "senator", "party_leader", "pm", "minister"].includes(player.role)) return false;
  if (decision.requiresPresident && player.role !== "president") return false;
  if (decision.roles && !decision.roles.includes(player.role)) return false;
  if (decision.minResource && (player.resources[decision.minResource.key] || 0) < decision.minResource.value) return false;
  if (decision.minAge && player.age < decision.minAge) return false;
  // Kandydatura prezydencka nie ma sensu, gdy gracz już nią jest / już kandyduje.
  if (decision.id === "consider_presidency" && (player.role === "president" || player.role === "president_candidate")) return false;
  if (decision.id === "run_for_parliament" && player.pendingCandidacy === "mp") return false;
  if (decision.id === "consider_retirement" && player.age < 55) return false;
  return true;
}

// --- Biblioteka decyzji gracza (parametryzowane szablony) -------------------
// Każda opcja ma: label, risk (opisowy poziom), cost (punkty aktywności),
// stat: {statKey: [min,max]} zakres delty (przed uwzględnieniem trudności/cech),
// party: [min,max] delta w punktach procentowych sondażu WŁASNEJ partii gracza,
// relation: { target: 'ownLeader'|'coalitionLeader'|'randomRival', range:[min,max] },
// narrative: tekst do dziennika.

// §28: decyzje na tyle brzemienne w skutki (zmiana partii, roli, kariery),
// że ich świeże pojawienie się w puli powinno zatrzymać szybką symulację —
// patrz computeAdvancedState/advanceFast.
const CAREER_CRITICAL_IDS = new Set([
  "leave_party", "found_party", "join_party",
  "run_for_parliament", "challenge_leadership", "consider_presidency", "consider_retirement",
]);

const DECISION_LIBRARY = [
  // --- MEDIA ---
  { id: "tv_interview", category: "media", title: "Zaproszenie do wywiadu telewizyjnego", desc: "Stacja telewizyjna zaprasza Cię do rozmowy o bieżącej sytuacji politycznej.", cost: 1, repeatable: true,
    options: [
      { id: "confident", label: "Wystąp pewnie i ofensywnie", risk: "umiarkowane", stat: { popularity: [1, 4], recognition: [3, 7], scandalRisk: [0, 4] }, party: [0.05, 0.25], narrative: "Media chwalą pewne, ofensywne wystąpienie." },
      { id: "cautious", label: "Odpowiadaj rzeczowo i ostrożnie", risk: "niskie", stat: { popularity: [0, 2], recognition: [1, 3], credibility: [1, 3] }, party: [0.02, 0.1], narrative: "Wystąpienie oceniono jako stonowane i rzeczowe." },
      { id: "refuse", label: "Odmów wywiadu", risk: "niskie", stat: { recognition: [-1, 0] }, party: [0, 0.02], narrative: "Nieobecność w mediach przeszła bez większego echa." },
    ] },
  { id: "press_conference", category: "media", title: "Organizacja konferencji prasowej", desc: "Masz okazję samodzielnie zwołać konferencję prasową na wybrany temat.", cost: 1, repeatable: true,
    options: [
      { id: "topic_focus", label: "Skup się na jednym z Twoich priorytetów", risk: "niskie", stat: { credibility: [1, 3], recognition: [1, 3] }, party: [0.02, 0.12], narrative: "Konferencja wzmocniła Twój wizerunek eksperta w temacie." },
      { id: "attack", label: "Zaatakuj politycznych przeciwników", risk: "wysokie", stat: { popularity: [1, 5], mediaSkill: [0, 1], credibility: [-3, 0] }, party: [0.05, 0.3], narrative: "Ostry ton konferencji odbił się szerokim echem." },
    ] },
  { id: "social_media_push", category: "media", title: "Kampania w mediach społecznościowych", desc: "Możesz zainwestować czas w aktywność w mediach społecznościowych.", cost: 1, repeatable: true,
    options: [
      { id: "personal", label: "Publikuj osobiste, autentyczne treści", risk: "niskie", stat: { recognition: [2, 5], publicTrust: [1, 3] }, party: [0.02, 0.1], narrative: "Autentyczne treści dobrze przyjęto wśród młodszych wyborców." },
      { id: "viral", label: "Postaw na kontrowersyjny, wiralowy przekaz", risk: "wysokie", stat: { recognition: [4, 9], scandalRisk: [2, 6], credibility: [-2, 1] }, party: [0.05, 0.2], narrative: "Wpis rozszedł się szeroko, ale podzielił komentatorów." },
    ] },
  { id: "respond_criticism", category: "media", title: "Fala krytyki w mediach", desc: "Komentatorzy krytykują ostatnie działania Twojego środowiska politycznego.", cost: 1, repeatable: true,
    options: [
      { id: "apologize", label: "Odnieś się rzeczowo i częściowo przyznaj rację", risk: "niskie", stat: { credibility: [2, 4], popularity: [-1, 1] }, party: [-0.05, 0.05], narrative: "Rzeczowa odpowiedź uspokoiła część krytyki." },
      { id: "deny", label: "Zdecydowanie odrzuć krytykę", risk: "umiarkowane", stat: { factionSupport: [2, 5], credibility: [-2, 0] }, party: [0, 0.08], narrative: "Twarda odpowiedź spodobała się twardemu elektoratowi." },
      { id: "ignore", label: "Zignoruj temat", risk: "niskie", stat: { recognition: [-1, 0] }, party: [-0.02, 0.02], narrative: "Temat przycichł bez Twojego udziału." },
    ] },
  { id: "live_qna", category: "media", title: "Transmisja na żywo z pytaniami od wyborców", desc: "Możesz zorganizować bezpośrednią transmisję z możliwością zadawania pytań.", cost: 1, repeatable: true,
    options: [
      { id: "open", label: "Odpowiadaj otwarcie na trudne pytania", risk: "umiarkowane", stat: { publicTrust: [2, 5], mediaSkill: [1, 2] }, party: [0.03, 0.15], narrative: "Otwartość doceniono, choć nie uniknięto niewygodnych momentów." },
      { id: "scripted", label: "Trzymaj się przygotowanych odpowiedzi", risk: "niskie", stat: { credibility: [1, 2] }, party: [0.01, 0.06], narrative: "Transmisja przebiegła bezpiecznie, choć mało spontanicznie." },
    ] },

  // --- PARLAMENT ---
  { id: "vote_bill_support", category: "parlament", title: "Głosowanie nad projektem ustawy popieranym przez Twoje środowisko", desc: "W Sejmie odbywa się głosowanie nad projektem, który popiera kierownictwo Twojej partii.", cost: 1, requiresParliament: true, repeatable: true,
    options: [
      { id: "for", label: "Zagłosuj ZA, zgodnie z partią", risk: "niskie", stat: { partyInfluence: [1, 3] }, relation: { target: "ownLeader", range: [2, 5] }, narrative: "Głos zgodny z linią partii przyjęto bez zaskoczenia." },
      { id: "against", label: "Zagłosuj PRZECIW, wbrew partii", risk: "wysokie", stat: { credibility: [2, 5], factionSupport: [-3, 1] }, relation: { target: "ownLeader", range: [-12, -4] }, narrative: "Głos wbrew partii wywołał poruszenie w klubie." },
      { id: "abstain", label: "Wstrzymaj się", risk: "umiarkowane", stat: { credibility: [0, 1] }, relation: { target: "ownLeader", range: [-4, -1] }, narrative: "Wstrzymanie się odczytano jako brak zdecydowania." },
    ] },
  { id: "introduce_bill", category: "parlament", title: "Możliwość zgłoszenia własnego projektu ustawy", desc: "Masz okazję zgłosić własną inicjatywę ustawodawczą w jednym ze swoich priorytetowych tematów.", cost: 2, requiresParliament: true, repeatable: true,
    options: [
      { id: "bold", label: "Zgłoś ambitny, rozpoznawalny projekt", risk: "umiarkowane", stat: { recognition: [3, 7], credibility: [1, 3], organization: [-1, 1] }, party: [0.02, 0.1], narrative: "Projekt zwrócił uwagę mediów i komentatorów." },
      { id: "narrow", label: "Zgłoś wąski, techniczny projekt", risk: "niskie", stat: { credibility: [2, 4] }, narrative: "Techniczny projekt przeszedł bez rozgłosu, ale budując wiarygodność eksperta." },
    ] },
  { id: "committee_work", category: "parlament", title: "Praca w komisji sejmowej", desc: "Możesz zaangażować się mocniej w prace jednej z komisji.", cost: 1, requiresParliament: true, repeatable: true,
    options: [
      { id: "deep", label: "Zaangażuj się głęboko merytorycznie", risk: "niskie", stat: { credibility: [2, 4], organization: [1, 2] }, narrative: "Praca merytoryczna doceniona przez kolegów z komisji." },
      { id: "skip", label: "Ogranicz się do minimum", risk: "niskie", stat: { stamina: [2, 5], credibility: [-1, 0] }, narrative: "Ograniczona aktywność nie umknęła uwadze obserwatorów sejmowych." },
    ] },
  { id: "confidence_vote", category: "parlament", title: "Wniosek o wotum zaufania dla rządu", desc: "Napięta sytuacja polityczna prowadzi do głosowania nad wotum zaufania.", cost: 1, requiresParliament: true, repeatable: true,
    options: [
      { id: "support_gov", label: "Poprzyj rząd", risk: "niskie", stat: { partyInfluence: [1, 2] }, relation: { target: "ownLeader", range: [2, 4] }, narrative: "Poparcie dla rządu wzmocniło pozycję w klubie." },
      { id: "oppose_gov", label: "Odmów poparcia", risk: "bardzo wysokie", stat: { credibility: [2, 6], factionSupport: [-6, 2] }, relation: { target: "ownLeader", range: [-20, -8] }, narrative: "Odmowa poparcia rządu odbiła się szerokim echem." },
    ] },

  // --- PARTIA ---
  { id: "faction_meeting", category: "partia", title: "Spotkanie frakcji partyjnej", desc: "Możesz zorganizować lub dołączyć do spotkania frakcji w partii.", cost: 1, requiresParty: true, repeatable: true,
    options: [
      { id: "unify", label: "Buduj jedność wokół kierownictwa", risk: "niskie", stat: { partyInfluence: [1, 3] }, relation: { target: "ownLeader", range: [3, 7] }, narrative: "Spotkanie wzmocniło jedność wewnątrzpartyjną." },
      { id: "build_own", label: "Buduj własne zaplecze w partii", risk: "umiarkowane", stat: { factionSupport: [3, 7], partyInfluence: [1, 2] }, relation: { target: "ownLeader", range: [-3, 1] }, narrative: "Rozmowy wzmocniły Twoją własną pozycję we frakcji." },
    ] },
  { id: "criticize_leader_private", category: "partia", title: "Niezadowolenie z kierunku partii", desc: "Nie zgadzasz się z ostatnią decyzją kierownictwa partii.", cost: 1, requiresParty: true, repeatable: true,
    options: [
      { id: "private", label: "Wyraź sprzeciw prywatnie", risk: "umiarkowane", stat: { credibility: [1, 2] }, relation: { target: "ownLeader", range: [-6, -2] }, narrative: "Prywatna rozmowa pozostała w gronie kierownictwa." },
      { id: "public", label: "Skrytykuj kierownictwo publicznie", risk: "bardzo wysokie", stat: { recognition: [3, 6], credibility: [1, 3] }, relation: { target: "ownLeader", range: [-18, -8] }, narrative: "Publiczna krytyka lidera odbiła się głośnym echem w mediach." },
      { id: "silent", label: "Zachowaj milczenie", risk: "niskie", stat: {}, narrative: "Nie zabrałeś głosu w sprawie." },
    ] },
  { id: "support_leader_publicly", category: "partia", title: "Okazja do publicznego poparcia lidera", desc: "Lider partii oczekuje wyraźnych deklaracji lojalności przed ważnym głosowaniem.", cost: 1, requiresParty: true, repeatable: true,
    options: [
      { id: "yes", label: "Zdecydowanie poprzyj lidera", risk: "niskie", stat: { partyInfluence: [2, 4] }, relation: { target: "ownLeader", range: [5, 10] }, narrative: "Deklaracja lojalności doceniona przez kierownictwo." },
      { id: "vague", label: "Zachowaj wymijające stanowisko", risk: "umiarkowane", stat: {}, relation: { target: "ownLeader", range: [-3, 0] }, narrative: "Wymijająca odpowiedź wzbudziła pytania o lojalność." },
    ] },
  { id: "recruit_activist", category: "partia", title: "Możliwość rekrutacji nowego działacza lokalnego", desc: "Lokalna struktura partyjna potrzebuje wzmocnienia.", cost: 1, repeatable: true,
    options: [
      { id: "recruit", label: "Zaangażuj się w rekrutację", risk: "niskie", stat: { organization: [3, 6] }, narrative: "Struktury lokalne zyskały nowego, zaangażowanego działacza." },
      { id: "skip", label: "Skup się na innych priorytetach", risk: "niskie", stat: {}, narrative: "Rekrutację odłożono na później." },
    ] },
  { id: "promote_ally", category: "partia", title: "Możliwość promowania sojusznika w strukturach", desc: "Jako osoba z pewnym wpływem możesz poprzeć awans zaufanej osoby.", cost: 1, requiresParty: true, minTier: 3, repeatable: true,
    options: [
      { id: "promote", label: "Poprzyj awans sojusznika", risk: "niskie", stat: { partyInfluence: [1, 3] }, relation: { target: "randomAlly", range: [8, 15] }, narrative: "Awans sojusznika wzmocnił Twoją sieć wpływów." },
      { id: "block", label: "Zablokuj awans, wskazując inną osobę", risk: "umiarkowane", stat: { partyInfluence: [0, 2] }, relation: { target: "randomAlly", range: [-10, -4] }, narrative: "Decyzja o zablokowaniu awansu wywołała napięcia." },
    ] },

  // --- KAMPANIA ---
  { id: "rally", category: "kampania", title: "Organizacja wiecu wyborczego", desc: "Zbliżają się wybory — możesz zorganizować wiec w wybranym regionie.", cost: 2, repeatable: true,
    options: [
      { id: "big", label: "Duży wiec z udziałem mediów", risk: "umiarkowane", stat: { recognition: [4, 8], stamina: [8, 15] }, party: [0.1, 0.4], narrative: "Duży wiec przyciągnął uwagę lokalnych i krajowych mediów." },
      { id: "local", label: "Kameralne spotkanie lokalne", risk: "niskie", stat: { recognition: [1, 3], publicTrust: [2, 4] }, party: [0.03, 0.15], narrative: "Kameralne spotkanie budowało bliższą relację z wyborcami." },
    ] },
  { id: "campaign_ad", category: "kampania", title: "Reklama kampanijna", desc: "Masz budżet, który możesz przeznaczyć na reklamę.", cost: 1, minResource: { key: "budget", value: 5 }, repeatable: true,
    options: [
      { id: "positive", label: "Pozytywny przekaz programowy", risk: "niskie", stat: { recognition: [2, 5] }, party: [0.03, 0.15], narrative: "Pozytywna reklama spokojnie budowała rozpoznawalność." },
      { id: "negative", label: "Reklama kontrastowa wobec przeciwnika", risk: "wysokie", stat: { recognition: [4, 8], credibility: [-2, 1] }, party: [0.05, 0.25], narrative: "Reklama kontrastowa wywołała ostrą wymianę zdań." },
    ] },
  { id: "debate", category: "kampania", title: "Zaproszenie do debaty przedwyborczej", desc: "Organizatorzy zapraszają Cię do udziału w debacie z konkurencją.", cost: 2, repeatable: true,
    options: [
      { id: "prepared", label: "Solidnie się przygotuj", risk: "niskie", stat: { debateSkill: [1, 2], credibility: [2, 4] }, party: [0.05, 0.2], narrative: "Dobre przygotowanie zaowocowało spokojnym, przekonującym występem." },
      { id: "aggressive", label: "Postaw na ofensywny styl", risk: "wysokie", stat: { popularity: [2, 6], scandalRisk: [1, 4] }, party: [0.05, 0.25], narrative: "Ofensywny styl debaty wywołał skrajne reakcje komentatorów." },
      { id: "skip_debate", label: "Nie bierz udziału", risk: "umiarkowane", stat: { recognition: [-2, 0] }, party: [-0.1, 0], narrative: "Twoja nieobecność w debacie została zauważona." },
    ] },
  { id: "local_meetings", category: "kampania", title: "Objazd regionu i spotkania z wyborcami", desc: "Możesz poświęcić czas na bezpośrednie spotkania z wyborcami w terenie.", cost: 2, repeatable: true,
    options: [
      { id: "tour", label: "Zorganizuj objazd kilku miejscowości", risk: "niskie", stat: { organization: [2, 4], publicTrust: [2, 5], stamina: [6, 12] }, party: [0.05, 0.2], narrative: "Bezpośrednie spotkania budowały lokalne zaufanie." },
    ] },
  { id: "endorsement", category: "kampania", title: "Możliwość zdobycia poparcia znanej postaci", desc: "Rozpoznawalna postać publiczna rozważa udzielenie Ci poparcia.", cost: 1, repeatable: false,
    options: [
      { id: "seek", label: "Aktywnie zabiegaj o poparcie", risk: "umiarkowane", stat: { recognition: [3, 7] }, party: [0.05, 0.3], narrative: "Udało się zdobyć poparcie rozpoznawalnej postaci." },
      { id: "pass", label: "Zrezygnuj — wolisz własną markę", risk: "niskie", stat: { credibility: [1, 2] }, narrative: "Zdecydowano postawić na własną, niezależną markę." },
    ] },

  // --- GOSPODARKA / POLITYKA PUBLICZNA ---
  { id: "public_policy_stance", category: "gospodarka", title: "Zajęcie stanowiska w sprawie polityki gospodarczej", desc: "Trwa debata publiczna o kierunku polityki gospodarczej.", cost: 1, repeatable: true,
    options: [
      { id: "invest", label: "Poprzyj zwiększenie inwestycji publicznych", risk: "umiarkowane", stat: { publicTrust: [1, 3] }, party: [0.02, 0.12], narrative: "Stanowisko dobrze przyjęto wśród wyborców oczekujących inwestycji." },
      { id: "cut", label: "Poprzyj ograniczenie wydatków", risk: "umiarkowane", stat: { credibility: [1, 3] }, party: [0.02, 0.1], narrative: "Stanowisko doceniono za odpowiedzialność fiskalną, choć nie wszystkich przekonało." },
      { id: "neutral_pp", label: "Zachowaj wyważone stanowisko", risk: "niskie", stat: {}, party: [0, 0.04], narrative: "Wyważone stanowisko nie wzbudziło kontrowersji." },
    ] },
  { id: "propose_reform", category: "gospodarka", title: "Możliwość zaproponowania reformy w swoim temacie priorytetowym", desc: "Masz okazję przedstawić konkretną propozycję reformy.", cost: 2, requiresGovernment: true, repeatable: true,
    options: [
      { id: "ambitious_reform", label: "Zaproponuj ambitną reformę", risk: "wysokie", stat: { recognition: [4, 8], credibility: [2, 4] }, party: [0.05, 0.2], narrative: "Ambitna propozycja wywołała szeroką debatę publiczną." },
      { id: "modest_reform", label: "Zaproponuj ostrożną, stopniową zmianę", risk: "niskie", stat: { credibility: [2, 4] }, party: [0.02, 0.1], narrative: "Stopniowa reforma zyskała spokojne, pozytywne przyjęcie." },
    ] },
  { id: "defend_ministry", category: "gospodarka", title: "Krytyka wobec resortu, za który częściowo odpowiadasz", desc: "Opozycja krytykuje działania w obszarze zbliżonym do Twoich kompetencji.", cost: 1, requiresGovernment: true, repeatable: true,
    options: [
      { id: "defend", label: "Broń dotychczasowej polityki", risk: "umiarkowane", stat: { credibility: [1, 2] }, relation: { target: "ownLeader", range: [2, 5] }, narrative: "Zdecydowana obrona polityki rządu doceniona przez kierownictwo." },
      { id: "admit", label: "Przyznaj częściowo rację krytykom", risk: "umiarkowane", stat: { publicTrust: [2, 4] }, relation: { target: "ownLeader", range: [-4, 0] }, narrative: "Częściowe przyznanie racji krytykom zaskoczyło komentatorów." },
    ] },

  // --- RELACJE PERSONALNE ---
  { id: "meet_rival", category: "relacje", title: "Możliwość rozmowy z politycznym rywalem", desc: "Masz okazję na nieformalną rozmowę z osobą, z którą rywalizujesz o wpływy.", cost: 1, repeatable: true,
    options: [
      { id: "conciliate", label: "Szukaj porozumienia", risk: "niskie", stat: { coalitionSkill: [1, 3] }, relation: { target: "randomRival", range: [5, 12] }, narrative: "Rozmowa złagodziła napięcia między wami." },
      { id: "confront", label: "Postaw sprawę wprost, bez ustępstw", risk: "umiarkowane", stat: { credibility: [1, 2] }, relation: { target: "randomRival", range: [-10, -3] }, narrative: "Rozmowa nie przyniosła zbliżenia stanowisk." },
    ] },
  { id: "mentor_junior", category: "relacje", title: "Okazja do wsparcia młodszego polityka", desc: "Młodszy polityk z Twojego otoczenia szuka wsparcia i rady.", cost: 1, repeatable: true,
    options: [
      { id: "help", label: "Poświęć czas na mentoring", risk: "niskie", stat: { leadership: [2, 4] }, relation: { target: "randomAlly", range: [8, 15] }, narrative: "Wsparcie zaowocowało lojalnym sojusznikiem." },
      { id: "decline", label: "Odmów — brak czasu", risk: "niskie", stat: { stamina: [2, 4] }, relation: { target: "randomAlly", range: [-5, -1] }, narrative: "Odmowa pomocy nie umknęła uwadze młodszych kolegów." },
    ] },

  // --- KOALICJA ---
  { id: "coalition_talk", category: "koalicja", title: "Nieformalna rozmowa koalicyjna", desc: "Przedstawiciel potencjalnego partnera koalicyjnego chce nieformalnie porozmawiać.", cost: 1, requiresParty: true, minTier: 3, repeatable: true,
    options: [
      { id: "open_talk", label: "Prowadź otwarte, konstruktywne rozmowy", risk: "niskie", stat: { coalitionSkill: [2, 4] }, relation: { target: "coalitionLeader", range: [4, 9] }, narrative: "Rozmowy koalicyjne przebiegły w dobrej atmosferze." },
      { id: "hard_line", label: "Postaw twarde warunki", risk: "umiarkowane", stat: { credibility: [1, 3] }, relation: { target: "coalitionLeader", range: [-8, -2] }, narrative: "Twarda linia negocjacyjna nie ułatwiła porozumienia." },
    ] },
  { id: "coalition_crisis", category: "koalicja", title: "Napięcia w koalicji rządzącej", desc: "Koalicjant grozi wystąpieniem z rządu w związku ze sporną decyzją.", cost: 2, requiresGovernment: true, minTier: 3, repeatable: true,
    options: [
      { id: "concession", label: "Zaproponuj ustępstwo", risk: "umiarkowane", stat: { coalitionSkill: [2, 4], credibility: [-1, 1] }, relation: { target: "coalitionLeader", range: [10, 18] }, narrative: "Ustępstwo uratowało koalicję, choć kosztem części wizerunku." },
      { id: "stand_firm", label: "Nie ustępuj", risk: "wysokie", stat: { credibility: [2, 4] }, relation: { target: "coalitionLeader", range: [-15, -6] }, narrative: "Twarda postawa zaostrzyła kryzys koalicyjny." },
    ] },
  { id: "propose_coalition", category: "koalicja", title: "Możliwość zaproponowania współpracy koalicyjnej", desc: "Jako lider partii możesz zaproponować formalną współpracę innemu ugrupowaniu.", cost: 2, requiresLeader: true, repeatable: true,
    options: [
      { id: "full_coalition", label: "Zaproponuj pełną koalicję", risk: "umiarkowane", stat: { coalitionSkill: [2, 5] }, relation: { target: "coalitionLeader", range: [6, 14] }, narrative: "Propozycja pełnej koalicji przyjęta z zainteresowaniem." },
      { id: "support_deal", label: "Zaproponuj umowę o poparciu", risk: "niskie", stat: { coalitionSkill: [1, 3] }, relation: { target: "coalitionLeader", range: [2, 6] }, narrative: "Umowa o poparciu to ostrożny, ale stabilny krok." },
    ] },

  // --- ORGANIZACJA ---
  { id: "build_structures", category: "organizacja", title: "Rozbudowa struktur partyjnych w regionie", desc: "Masz okazję zainwestować czas w rozwój lokalnych struktur.", cost: 2, repeatable: true,
    options: [
      { id: "invest_org", label: "Zainwestuj czas i zasoby", risk: "niskie", stat: { organization: [4, 8] }, party: [0.02, 0.08], narrative: "Struktury lokalne zyskały na sile." },
    ] },
  { id: "internal_primaries", category: "organizacja", title: "Wewnętrzne prawybory na listę kandydatów", desc: "Partia organizuje wewnętrzne prawybory przed nadchodzącymi wyborami.", cost: 1, requiresParty: true, repeatable: false,
    options: [
      { id: "compete", label: "Weź udział i rywalizuj o wysokie miejsce", risk: "umiarkowane", stat: { partyInfluence: [2, 5], factionSupport: [1, 3] }, relation: { target: "ownLeader", range: [-3, 2] }, narrative: "Udział w prawyborach umocnił Twoją pozycję w strukturach." },
      { id: "support_others", label: "Wesprzyj kandydatury innych", risk: "niskie", stat: { partyInfluence: [0, 2] }, relation: { target: "ownLeader", range: [3, 6] }, narrative: "Wsparcie dla innych kandydatów doceniło kierownictwo." },
    ] },

  // --- FINANSE KAMPANII ---
  { id: "fundraiser", category: "finanse", title: "Organizacja zbiórki na cele kampanijne", desc: "Możesz zorganizować legalną zbiórkę środków na działalność polityczną.", cost: 1, repeatable: true,
    options: [
      { id: "run_fundraiser", label: "Zorganizuj zbiórkę", risk: "niskie", stat: { fundraising: [3, 6] }, narrative: "Zbiórka przyniosła dodatkowe środki na dalsze działania." },
    ] },

  // --- KRYZYS ---
  { id: "handle_scandal", category: "kryzys", title: "Reakcja na zarzuty medialne", desc: "Media publikują zarzuty dotyczące Twojego środowiska politycznego.", cost: 1, repeatable: true,
    options: [
      { id: "apology_full", label: "Przeproś i zapowiedz zmiany", risk: "niskie", stat: { credibility: [2, 5], popularity: [-2, 1] }, party: [-0.1, 0.02], narrative: "Przeprosiny częściowo uspokoiły sytuację." },
      { id: "deny_scandal", label: "Zdecydowanie zaprzecz zarzutom", risk: "wysokie", stat: { scandalRisk: [2, 6], factionSupport: [1, 4] }, party: [-0.2, 0.1], narrative: "Zdecydowane zaprzeczenie podzieliło opinię publiczną." },
      { id: "silent_scandal", label: "Nie komentuj sprawy", risk: "umiarkowane", stat: { credibility: [-2, 0] }, party: [-0.15, -0.02], narrative: "Brak komentarza odczytano jako unikanie odpowiedzialności." },
    ] },
  { id: "call_for_resignation", category: "kryzys", title: "Presja, by wezwać do dymisji ministra", desc: "Opinia publiczna oczekuje jasnego stanowiska w sprawie kontrowersyjnego ministra.", cost: 1, repeatable: true,
    options: [
      { id: "call", label: "Wezwij do dymisji", risk: "wysokie", stat: { credibility: [2, 4] }, relation: { target: "ownLeader", range: [-8, -2] }, narrative: "Wezwanie do dymisji odbiło się szerokim echem." },
      { id: "defend_min", label: "Broń ministra", risk: "umiarkowane", stat: { credibility: [-2, 0] }, relation: { target: "ownLeader", range: [3, 6] }, narrative: "Obrona ministra doceniona przez kierownictwo, skrytykowana przez media." },
    ] },

  // --- ŻYCIE PUBLICZNE / STRATEGIA DŁUGOTERMINOWA ---
  { id: "rest_recover", category: "zycie", title: "Możliwość odpoczynku", desc: "Ostatnie miesiące były wymagające — możesz zwolnić tempo.", cost: 0, repeatable: true,
    options: [
      { id: "rest", label: "Odpocznij i zregeneruj siły", risk: "niskie", stat: { stamina: [15, 25] }, narrative: "Krótki odpoczynek pozwolił odzyskać energię do dalszej pracy." },
    ] },
  { id: "long_term_plan", category: "strategia", title: "Ogłoszenie planu działania na najbliższy rok", desc: "Możesz przedstawić dłuższą wizję swojej działalności politycznej.", cost: 1, repeatable: false,
    options: [
      { id: "ambitious_plan", label: "Ogłoś ambitny plan", risk: "umiarkowane", stat: { recognition: [2, 5], credibility: [1, 3] }, party: [0.02, 0.1], narrative: "Ambitny plan wzbudził zainteresowanie mediów i komentatorów." },
      { id: "modest_plan", label: "Ogłoś skromny, realistyczny plan", risk: "niskie", stat: { credibility: [1, 3] }, narrative: "Realistyczny plan oceniono jako wiarygodny." },
    ] },

  // --- PREZYDENTURA (tylko rola: prezydent) — §31 ---
  { id: "sign_or_veto_bill", category: "prezydentura", title: "Ustawa uchwalona przez Sejm trafia na Twoje biurko", desc: "Sejm uchwalił kontrowersyjną ustawę — jako prezydent decydujesz o jej dalszym losie.", cost: 1, requiresPresident: true, repeatable: true,
    options: [
      { id: "sign", label: "Podpisz ustawę", risk: "niskie", stat: { credibility: [1, 2] }, worldEffect: { governmentApproval: [1, 3] }, narrative: "Podpisanie ustawy utrzymało dobre relacje z rządem." },
      { id: "veto", label: "Zawetuj ustawę", risk: "wysokie", stat: { popularity: [1, 4], credibility: [-1, 2] }, worldEffect: { politicalTemperature: [3, 6], governmentApproval: [-3, -1] }, narrative: "Weto wywołało napięcie na linii prezydent–rząd." },
      { id: "tribunal", label: "Skieruj do Trybunału Konstytucyjnego", risk: "umiarkowane", stat: { credibility: [2, 4] }, worldEffect: { politicalTemperature: [1, 3] }, narrative: "Skierowanie do TK odłożyło spór w czasie." },
    ] },
  { id: "annual_address", category: "prezydentura", title: "Coroczne orędzie do narodu", desc: "Masz okazję wygłosić orędzie i nadać ton debacie publicznej na najbliższe miesiące.", cost: 2, requiresPresident: true, repeatable: false,
    options: [
      { id: "unity", label: "Orędzie o jedności ponad podziałami", risk: "niskie", stat: { popularity: [2, 5], publicTrust: [2, 4] }, worldEffect: { politicalTemperature: [-3, -1] }, narrative: "Orędzie o jedności dobrze przyjęto ponad podziałami." },
      { id: "bold_vision", label: "Ambitna wizja reform", risk: "umiarkowane", stat: { recognition: [3, 6], credibility: [1, 3] }, worldEffect: { politicalTemperature: [1, 3] }, narrative: "Ambitna wizja wywołała szeroką debatę publiczną." },
    ] },
  { id: "consult_leaders", category: "prezydentura", title: "Konsultacje z liderami partii", desc: "W obliczu napiętej sytuacji politycznej zwołujesz konsultacje z liderami partii.", cost: 1, requiresPresident: true, repeatable: true,
    options: [
      { id: "broad", label: "Zaproś szerokie spektrum polityczne", risk: "niskie", stat: { coalitionSkill: [2, 4] }, worldEffect: { politicalTemperature: [-2, 0] }, narrative: "Szerokie konsultacje uspokoiły nastroje." },
      { id: "narrow", label: "Ogranicz się do sojuszników", risk: "umiarkowane", stat: { partyInfluence: [1, 3] }, worldEffect: { politicalTemperature: [1, 2] }, narrative: "Wąski krąg konsultacji skrytykowała opozycja." },
    ] },
  { id: "nominate_official", category: "prezydentura", title: "Nominacja na ważne stanowisko państwowe", desc: "Masz do obsadzenia ważne stanowisko wymagające Twojej nominacji.", cost: 1, requiresPresident: true, repeatable: true,
    options: [
      { id: "technocrat_nom", label: "Nominuj apolitycznego eksperta", risk: "niskie", stat: { credibility: [2, 4] }, narrative: "Nominacja eksperta oceniona jako rozsądna i apolityczna." },
      { id: "loyalist_nom", label: "Nominuj zaufaną osobę", risk: "umiarkowane", stat: { partyInfluence: [1, 3], credibility: [-1, 1] }, narrative: "Nominacja zaufanej osoby wywołała zarzuty o nepotyzm." },
    ] },
  { id: "international_summit", category: "prezydentura", title: "Zaproszenie na szczyt międzynarodowy", desc: "Reprezentujesz kraj na arenie międzynarodowej.", cost: 2, requiresPresident: true, repeatable: true,
    options: [
      { id: "active_role", label: "Odegraj aktywną rolę w negocjacjach", risk: "umiarkowane", stat: { recognition: [3, 6], credibility: [2, 4] }, worldEffect: { politicalTemperature: [-1, 1] }, narrative: "Aktywna rola na szczycie wzmocniła międzynarodową pozycję kraju." },
      { id: "cautious_role", label: "Zachowaj ostrożną, obserwacyjną postawę", risk: "niskie", stat: { credibility: [1, 2] }, narrative: "Ostrożna postawa nie przyniosła rozgłosu, ale i ryzyka." },
    ] },
  { id: "constitutional_crisis", category: "prezydentura", title: "Napięcia konstytucyjne wobec rządu", desc: "Spór kompetencyjny między Tobą a rządem eskaluje.", cost: 2, requiresPresident: true, repeatable: true,
    options: [
      { id: "escalate", label: "Postaw sprawę na ostro", risk: "bardzo wysokie", stat: { popularity: [1, 4], credibility: [-2, 1] }, worldEffect: { politicalTemperature: [5, 9], governmentApproval: [-4, -1] }, narrative: "Eskalacja sporu konstytucyjnego zdominowała debatę publiczną." },
      { id: "deescalate", label: "Szukaj kompromisu z rządem", risk: "niskie", stat: { coalitionSkill: [2, 4] }, worldEffect: { politicalTemperature: [-3, -1] }, narrative: "Kompromis złagodził napięcia na linii prezydent–rząd." },
    ] },

  // --- PRZYNALEŻNOŚĆ PARTYJNA — §12 (decyzje specjalne, zmieniają partyId/registry/polls) ---
  { id: "leave_party", category: "partia", title: "Rozważasz odejście z partii", desc: "Narastające różnice z kierownictwem skłaniają Cię do rozważenia odejścia z partii.", cost: 1, requiresParty: true, repeatable: false,
    options: [
      { id: "leave", label: "Odejdź z partii i zostań niezależny/a", risk: "bardzo wysokie", special: "leave_party", narrative: "Odejście z partii odbiło się szerokim echem." },
      { id: "stay", label: "Zostań w partii mimo różnic", risk: "niskie", stat: { credibility: [0, 1] }, narrative: "Zdecydowano pozostać w strukturach mimo napięć." },
    ] },
  { id: "found_party", category: "partia", title: "Możliwość założenia własnego ugrupowania", desc: "Jako niezależny/a polityk/polityczka masz wystarczające zaplecze, by rozważyć start własnej partii.", cost: 2, requiresIndependent: true, repeatable: false,
    options: [
      { id: "found", label: "Załóż nową partię", risk: "wysokie", special: "found_party", narrative: "Ogłoszenie nowego ugrupowania zdominowało newsy dnia." },
      { id: "wait_found", label: "Jeszcze nie teraz", risk: "niskie", stat: {}, narrative: "Zdecydowano poczekać z decyzją o nowej partii." },
    ] },
  { id: "join_party", category: "partia", title: "Zaproszenie do dołączenia do partii", desc: "Jako niezależny/a polityk/polityczka dostajesz propozycję dołączenia do jednej ze scenicznych partii.", cost: 1, requiresIndependent: true, repeatable: false,
    options: [
      { id: "join", label: "Dołącz do partii", risk: "umiarkowane", special: "join_party", narrative: "Dołączenie do partii skomentowały media." },
      { id: "decline_join", label: "Zachowaj niezależność", risk: "niskie", stat: { credibility: [0, 1] }, narrative: "Zdecydowano pozostać niezależnym/ą." },
    ] },

  // --- KARIERA — §15 (decyzje specjalne, mogą zmienić rolę gracza) ---
  { id: "run_for_parliament", category: "kariera", title: "Rozważasz start w najbliższych wyborach parlamentarnych", desc: "Możesz oficjalnie ogłosić start w wyborach do Sejmu.", cost: 2, roles: ["activist", "councillor", "independent"], repeatable: false,
    options: [
      { id: "run", label: "Ogłoś kandydowanie do Sejmu", risk: "wysokie", special: "run_mp", narrative: "Ogłoszenie kandydatury do Sejmu odbiło się szerokim echem." },
      { id: "not_yet", label: "Jeszcze nie teraz", risk: "niskie", stat: {}, narrative: "Zdecydowano poczekać z decyzją o starcie do Sejmu." },
    ] },
  { id: "challenge_leadership", category: "kariera", title: "Rozważasz wyzwanie obecnego kierownictwa partii", desc: "Masz wystarczające wpływy, by rozważyć rywalizację o fotel lidera partii.", cost: 2, requiresParty: true, minTier: 3, repeatable: false,
    options: [
      { id: "challenge", label: "Wyzwij obecnego lidera partii", risk: "bardzo wysokie", special: "run_leader", narrative: "Wyzwanie rzucone kierownictwu partii wstrząsnęło strukturami." },
      { id: "hold_back", label: "Wstrzymaj się z wyzwaniem", risk: "niskie", stat: { partyInfluence: [0, 1] }, narrative: "Zdecydowano nie rzucać wyzwania kierownictwu — na razie." },
    ] },
  { id: "consider_presidency", category: "kariera", title: "Otoczenie namawia Cię do startu w wyborach prezydenckich", desc: "Twoja pozycja pozwala rozważyć kandydowanie na prezydenta w najbliższych wyborach.", cost: 2, minTier: 3, repeatable: false,
    options: [
      { id: "declare", label: "Ogłoś kandydaturę na prezydenta", risk: "bardzo wysokie", special: "run_president", narrative: "Ogłoszenie kandydatury prezydenckiej zdominowało media." },
      { id: "decline_pres", label: "Nie teraz", risk: "niskie", stat: {}, narrative: "Zdecydowano nie ogłaszać kandydatury prezydenckiej w tym momencie." },
    ] },
  { id: "order_polling_analysis", category: "strategia", title: "Zlecenie szczegółowej analizy sondażowej", desc: "Za odpowiednią cenę możesz zlecić dokładną analizę nastrojów społecznych i wewnątrzpartyjnych na ten miesiąc.", cost: 1, minResource: { key: "politicalCapital", value: 5 }, repeatable: true,
    options: [
      { id: "buy_analytics", label: "Zleć analizę (koszt: kapitał polityczny)", risk: "niskie", special: "buy_analytics", narrative: "Analiza dała pełniejszy obraz sytuacji na ten miesiąc." },
    ] },
  { id: "consider_retirement", category: "kariera", title: "Rozważasz zakończenie kariery politycznej", desc: "Po latach w polityce zastanawiasz się, czy nie czas przejść na polityczną emeryturę.", cost: 0, repeatable: false,
    options: [
      { id: "retire", label: "Zakończ karierę polityczną", risk: "niskie", special: "retire", narrative: "Ogłoszenie zakończenia kariery politycznej." },
      { id: "keep_going", label: "Kontynuuj karierę", risk: "niskie", stat: { stamina: [3, 6] }, narrative: "Zdecydowano kontynuować karierę polityczną." },
    ] },
];

// --- Biblioteka wydarzeń niezależnych od gracza -----------------------------
// weight — względna częstość, reaction — opcjonalna reakcja gracza (jak decyzja).

const PLAYER_EVENT_LIBRARY = [
  { id: "journalist_critical", weight: 3, title: "Krytyczny tekst dziennikarski", text: (ctx) => `Dziennikarz publikuje tekst krytycznie oceniający działania ${ctx.playerName}.`, stat: { credibility: [-3, 0], recognition: [1, 3] } },
  { id: "local_branch_support", weight: 2, title: "Poparcie lokalnego oddziału partii", text: (ctx) => `Lokalny oddział partii ${ctx.partyName || ""} publicznie wyraża poparcie dla ${ctx.playerName}.`, stat: { factionSupport: [3, 6] }, requiresParty: true },
  { id: "rival_campaign", weight: 2, important: true, title: "Kampania rywala", text: (ctx) => `Polityczny rywal rozpoczyna kampanię krytykującą ${ctx.playerName}.`, stat: { popularity: [-2, 0], recognition: [1, 3] } },
  { id: "leader_offer", weight: 1, important: true, title: "Propozycja od kierownictwa", text: (ctx) => `Kierownictwo partii proponuje ${ctx.playerName} nową funkcję.`, stat: { partyInfluence: [2, 5] }, requiresParty: true },
  { id: "coalition_ultimatum", weight: 1, important: true, title: "Ultimatum koalicjanta", text: () => `Koalicjant stawia rządowi ultimatum w spornej sprawie.`, stat: {}, requiresGovernment: true, reaction: "coalition_crisis" },
  { id: "party_finance_trouble", weight: 1, title: "Problemy finansowe partii", text: () => `Partia zgłasza problemy z finansowaniem bieżącej działalności.`, stat: { fundraising: [-2, 0] }, requiresParty: true },
  { id: "positive_poll_leak", weight: 2, title: "Korzystny sondaż", text: (ctx) => `Do mediów trafia sondaż korzystny dla ${ctx.playerName}.`, stat: { popularity: [1, 3], recognition: [1, 2] } },
  { id: "viral_old_post", weight: 1, important: true, title: "Stary wpis wraca do mediów", text: (ctx) => `Stary wpis ${ctx.playerName} zostaje ponownie nagłośniony w mediach.`, stat: { scandalRisk: [2, 5], recognition: [1, 3] } },
  { id: "congress_called", weight: 1, title: "Zjazd partii", text: () => `Władze partii zwołują kongres krajowy.`, stat: { partyInfluence: [0, 2] }, requiresParty: true },
  { id: "economic_downturn", weight: 1, title: "Spowolnienie gospodarcze", text: () => `Dane makroekonomiczne wskazują na spowolnienie gospodarcze.`, stat: {}, worldEffect: { economy: [-4, -1], governmentApproval: [-3, -1] } },
  { id: "economic_upturn", weight: 1, title: "Poprawa koniunktury", text: () => `Dane makroekonomiczne wskazują na poprawę koniunktury.`, stat: {}, worldEffect: { economy: [1, 4], governmentApproval: [1, 3] } },
  { id: "protest_region", weight: 1, title: "Protest w regionie", text: (ctx) => `W regionie ${ctx.region} dochodzi do protestu społecznego.`, stat: {}, worldEffect: { politicalTemperature: [3, 7] } },
  { id: "statement_viral", weight: 2, title: "Wypowiedź staje się viralem", text: (ctx) => `Jedna z wypowiedzi ${ctx.playerName} zaczyna krążyć w mediach społecznościowych.`, stat: { recognition: [3, 6] } },
  { id: "rival_challenges_debate", weight: 1, title: "Wyzwanie na debatę", text: (ctx) => `Konkurencyjny kandydat wyzywa ${ctx.playerName} na publiczną debatę.`, stat: {}, reaction: "debate" },
  { id: "local_demand_investment", weight: 1, title: "Żądania inwestycyjne", text: (ctx) => `Lokalni wyborcy w regionie ${ctx.region} żądają większych inwestycji.`, stat: { publicTrust: [-1, 0] } },
  { id: "ngo_request", weight: 1, title: "Prośba organizacji społecznej", text: () => `Organizacja społeczna zwraca się z prośbą o publiczne zajęcie stanowiska.`, stat: {} },
  { id: "party_congress_conflict", weight: 1, title: "Konflikt na zjeździe partyjnym", text: () => `Debata programowa na zjeździe partii wywołuje wewnętrzny konflikt.`, stat: { factionSupport: [-2, 1] }, requiresParty: true },
  { id: "praise_from_leader", weight: 1, title: "Pochwała od lidera", text: (ctx) => `Lider partii chwali publicznie ${ctx.playerName}.`, stat: { partyInfluence: [2, 4], popularity: [1, 2] }, requiresParty: true, relation: { target: "ownLeader", range: [4, 8] } },
  { id: "criticism_from_leader", weight: 1, important: true, title: "Krytyka od lidera", text: (ctx) => `Lider partii krytykuje publicznie decyzję ${ctx.playerName}.`, stat: { credibility: [-1, 1] }, requiresParty: true, relation: { target: "ownLeader", range: [-8, -3] } },
  { id: "rising_star", weight: 1, title: "Media okrzykują wschodzącą gwiazdę", text: (ctx) => `Komentatorzy zaczynają opisywać ${ctx.playerName} jako wschodzącą gwiazdę polityki.`, stat: { recognition: [3, 6], popularity: [2, 4] } },
  { id: "hypocrisy_accusation", weight: 1, important: true, title: "Zarzut hipokryzji", text: (ctx) => `Przeciwnik zarzuca ${ctx.playerName} niekonsekwencję w głoszonych poglądach.`, stat: { credibility: [-2, 0] } },
  { id: "ally_asks_support", weight: 1, title: "Sojusznik prosi o wsparcie", text: () => `Polityczny sojusznik zwraca się o publiczne wsparcie w trudnej sprawie.`, stat: {} },
  { id: "security_incident", weight: 1, title: "Incydent bezpieczeństwa", text: () => `W kraju dochodzi do incydentu wpływającego na poczucie bezpieczeństwa.`, stat: {}, worldEffect: { security: [-5, -2], politicalTemperature: [2, 5] } },
  { id: "international_meeting", weight: 1, title: "Wydarzenie międzynarodowe", text: () => `Na arenie międzynarodowej dochodzi do wydarzenia istotnego dla polityki krajowej.`, stat: {}, worldEffect: { politicalTemperature: [1, 3] } },
  { id: "minor_gaffe", weight: 2, title: "Drobna wpadka", text: (ctx) => `${ctx.playerName} popełnia drobną, niezręczną wpadkę publiczną.`, stat: { scandalRisk: [1, 3], popularity: [-1, 0] } },
  { id: "quiet_month", weight: 4, title: "Spokojny miesiąc", text: () => `Miesiąc przebiega bez większych wydarzeń politycznych.`, stat: {} },
  { id: "coalition_partner_praise", weight: 1, title: "Pochwała od koalicjanta", text: () => `Partner koalicyjny publicznie chwali współpracę.`, stat: {}, requiresGovernment: true, relation: { target: "coalitionLeader", range: [3, 6] } },
  { id: "budget_debate", weight: 1, title: "Debata budżetowa", text: () => `W parlamencie trwa napięta debata nad budżetem państwa.`, stat: {}, worldEffect: { politicalTemperature: [2, 4] } },
  { id: "new_movement", weight: 1, title: "Nowy ruch społeczny", text: () => `Na scenie publicznej pojawia się nowy, oddolny ruch społeczny.`, stat: {}, worldEffect: { politicalTemperature: [1, 3] } },
  { id: "poll_dip", weight: 2, title: "Niekorzystny sondaż", text: (ctx) => `Publikowany sondaż pokazuje spadek notowań ${ctx.playerName}.`, stat: { popularity: [-2, 0] } },

  // --- Dodatkowe wydarzenia (dopełnienie do ok. 50 szablonów) ---
  { id: "party_wants_program_change", weight: 1, title: "Partia chce zmienić program", text: () => `Władze partii sygnalizują potrzebę zmiany kierunku programowego.`, stat: { factionSupport: [-1, 2] }, requiresParty: true },
  { id: "councillor_defects", weight: 1, title: "Poseł deklaruje przejście do innej partii", text: () => `Jeden z posłów ogłasza zamiar zmiany klubu parlamentarnego.`, stat: {}, worldEffect: { politicalTemperature: [1, 3] } },
  { id: "player_offered_transfer", weight: 1, important: true, title: "Propozycja przejścia do innej partii", text: (ctx) => `${ctx.playerName} otrzymuje nieformalną propozycję przejścia do innego ugrupowania.`, stat: { recognition: [1, 3] } },
  { id: "party_congress_scheduled", weight: 1, title: "Władze partii organizują kongres", text: () => `Partia ogłasza termin najbliższego kongresu krajowego.`, stat: {}, requiresParty: true },
  { id: "government_controversial_decision", weight: 1, title: "Rząd podejmuje kontrowersyjną decyzję", text: () => `Rząd ogłasza decyzję, która dzieli opinię publiczną.`, stat: {}, worldEffect: { governmentApproval: [-2, 0], politicalTemperature: [2, 4] } },
  { id: "opposition_protest", weight: 1, title: "Opozycja organizuje protest", text: () => `Ugrupowania opozycyjne organizują wspólny protest przeciwko rządowi.`, stat: {}, worldEffect: { politicalTemperature: [2, 5] } },
  { id: "bill_divides_party", weight: 1, important: true, title: "Ważny projekt ustawy dzieli partię", text: () => `Debata nad kluczowym projektem ustawy ujawnia podziały w partii.`, stat: { factionSupport: [-3, 0] }, requiresParty: true },
  { id: "ngo_public_letter", weight: 1, title: "List otwarty organizacji społecznej", text: (ctx) => `Organizacja społeczna publikuje list otwarty odnoszący się do działań ${ctx.playerName}.`, stat: { publicTrust: [-1, 1] } },
  { id: "local_investment_announced", weight: 1, title: "Rząd ogłasza inwestycję w regionie", text: (ctx) => `Rząd ogłasza nową inwestycję publiczną w regionie ${ctx.region}.`, stat: {}, worldEffect: { governmentApproval: [1, 2] } },
  { id: "media_fact_check", weight: 1, title: "Dziennikarze weryfikują wypowiedź", text: (ctx) => `Portal factcheckingowy analizuje jedną z wypowiedzi ${ctx.playerName}.`, stat: { credibility: [-1, 2] } },
  { id: "youth_wing_demands", weight: 1, title: "Młodzieżówka partii domaga się zmian", text: () => `Młodzieżowe struktury partii domagają się większego wpływu na program.`, stat: { factionSupport: [-1, 1] }, requiresParty: true },
  { id: "business_association_meeting", weight: 1, title: "Zaproszenie na spotkanie z przedsiębiorcami", text: (ctx) => `Organizacja przedsiębiorców zaprasza ${ctx.playerName} na spotkanie branżowe.`, stat: { fundraising: [1, 3] } },
  { id: "union_demands", weight: 1, title: "Związki zawodowe zgłaszają postulaty", text: () => `Związki zawodowe publikują listę postulatów wobec polityków.`, stat: {}, worldEffect: { politicalTemperature: [1, 2] } },
  { id: "foreign_media_mention", weight: 1, title: "Wzmianka w zagranicznych mediach", text: (ctx) => `Zagraniczny portal wspomina o ${ctx.playerName} w kontekście krajowej polityki.`, stat: { recognition: [2, 4] } },
  { id: "poll_methodology_dispute", weight: 1, title: "Spór o metodologię sondaży", text: () => `Komentatorzy spierają się o wiarygodność najnowszych sondaży.`, stat: {} },
  { id: "party_donor_scandal", weight: 1, important: true, title: "Wątpliwości wokół finansowania partii", text: () => `Media pytają o źródła finansowania działalności partii.`, stat: { fundraising: [-2, 0], scandalRisk: [1, 3] }, requiresParty: true },
  { id: "unexpected_endorsement", weight: 1, title: "Nieoczekiwane poparcie", text: (ctx) => `Nieoczekiwana postać publiczna wyraża poparcie dla ${ctx.playerName}.`, stat: { recognition: [2, 5], popularity: [1, 3] } },
  { id: "rival_alliance_forms", weight: 1, important: true, title: "Rywale zawiązują sojusz", text: () => `Dwaj polityczni rywale ogłaszają współpracę przeciwko wspólnemu przeciwnikowi.`, stat: {}, worldEffect: { politicalTemperature: [1, 3] } },
  { id: "public_apology_demanded", weight: 1, important: true, title: "Żądanie publicznych przeprosin", text: (ctx) => `Środowisko polityczne domaga się przeprosin od ${ctx.playerName} za wcześniejszą wypowiedź.`, stat: { credibility: [-2, 1] } },
  { id: "successful_local_project", weight: 1, title: "Sukces lokalnego projektu", text: (ctx) => `Lokalny projekt wspierany przez ${ctx.playerName} w regionie ${ctx.region} kończy się sukcesem.`, stat: { publicTrust: [2, 4], organization: [1, 2] } },
  { id: "generational_change_debate", weight: 1, title: "Debata o zmianie pokoleniowej", text: () => `W mediach toczy się debata o potrzebie zmiany pokoleniowej w polityce.`, stat: { recognition: [1, 2] } },
];

function eventAvailable(evt, state) {
  const player = state.player;
  if (evt.requiresParty && !player.partyId) return false;
  if (evt.requiresGovernment && !isInGovernment(player, state)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// §18 AI/NPC I ODPORNOŚĆ ŚWIATA NA GRACZA
// ---------------------------------------------------------------------------
// Świat nie czeka biernie na gracza — raz na jakiś czas NPC podejmują własną
// inicjatywę, warunkowaną tym, jak gracz sobie radzi (popularność, relacje).
// To NIE jest to samo, co losowe wydarzenie z PLAYER_EVENT_LIBRARY — inicjatywa
// NPC jest bezpośrednią reakcją na trajektorię gracza, nie tłem politycznym.
function resolveNpcInitiative(state, player, diff) {
  // Najpierw jedna, niższa "bramka" na to, czy w ogóle coś się wydarzy z
  // inicjatywy otoczenia w tym miesiącu (obniżone względem poprzedniej wersji,
  // żeby szybka symulacja nie zatrzymywała się niemal co miesiąc).
  if (Math.random() > 0.09 * diff.eventChance) return null;

  const ownLeaderId = ownLeaderNpcId(player);
  const rel = ownLeaderId ? getRelation(state.playerRelations, ownLeaderId) : { score: 0 };
  const isGov = isInGovernment(player, state);
  const candidates = [];

  if (player.stats.popularity > 55) {
    candidates.push({
      weight: 2,
      kind: "rival_attack",
      text: `Rosnąca popularność ${player.name} skłania politycznego rywala do otwartej kampanii krytycznej.`,
      statDeltas: { popularity: [-3, -1], recognition: [1, 3] },
    });
    if (player.partyId) {
      candidates.push({
        weight: 2,
        kind: "leader_wary",
        text: `Lider partii zaczyna dostrzegać w ${player.name} rosnące zagrożenie dla własnej pozycji.`,
        relationTarget: "ownLeader",
        relationRange: [-6, -1],
      });
    }
  }

  if (player.stats.popularity < 20 && player.monthsInPolitics > 3) {
    candidates.push({
      weight: 2,
      kind: "support_erodes",
      text: `Część dotychczasowego zaplecza ${player.name} zaczyna szukać innych sojuszy politycznych.`,
      statDeltas: { factionSupport: [-4, -1], organization: [-2, 0] },
    });
  }

  if (player.foundedOwnParty) {
    candidates.push({
      weight: 2,
      kind: "counter_movement",
      text: `Konkurencyjne ugrupowania uruchamiają kontrakcję wymierzoną w elektorat nowej partii ${player.name}.`,
      statDeltas: { recognition: [1, 2] },
      partyDeltaRange: [-0.15, -0.02],
    });
  }

  if (player.partyId && rel.score > 40 && player.stats.partyInfluence > 40 && !["party_leader", "pm", "minister"].includes(player.role)) {
    candidates.push({
      weight: 1,
      kind: "leader_courts",
      text: `Lider partii, dostrzegając Twoje kompetencje i lojalność, zaczyna zabiegać o bliższą współpracę.`,
      relationTarget: "ownLeader",
      relationRange: [2, 6],
    });
  }

  // §18 rozszerzenie — bunt frakcji: niska relacja z liderem + wysokie poparcie frakcji gracza.
  if (player.partyId && rel.score < -20 && player.stats.factionSupport > 45) {
    candidates.push({
      weight: 2,
      kind: "faction_rebellion_warning",
      text: `Część działaczy Twojej frakcji zaczyna otwarcie mówić o buncie przeciwko kierownictwu partii.`,
      statDeltas: { factionSupport: [2, 5], credibility: [-1, 1] },
      relationTarget: "ownLeader",
      relationRange: [-5, -1],
    });
  }

  // §18 rozszerzenie — groźba odejścia koalicjanta, gdy stabilność rządu jest niska.
  if (isGov && Number.isFinite(state.governmentStability) && state.governmentStability < 40) {
    candidates.push({
      weight: 2,
      kind: "coalition_defection_threat",
      text: `Partner koalicyjny sygnalizuje gotowość do opuszczenia rządu, jeśli sytuacja się nie poprawi.`,
      statDeltas: {},
      relationTarget: "coalitionLeader",
      relationRange: [-8, -2],
    });
  }

  // §18 rozszerzenie — dziennikarskie śledztwo eskaluje, gdy ryzyko skandalu jest wysokie.
  if ((player.stats.scandalRisk || 0) > 50) {
    candidates.push({
      weight: 2,
      kind: "media_investigation_escalates",
      text: `Zespół dziennikarzy śledczych zapowiada publikację obszernego materiału o działalności ${player.name}.`,
      statDeltas: { scandalRisk: [2, 5], recognition: [1, 3] },
    });
  }

  if (!candidates.length) return null;
  const pool = [];
  candidates.forEach((c) => { for (let i = 0; i < c.weight; i++) pool.push(c); });
  return pickOne(pool);
}

// ---------------------------------------------------------------------------
// §9 STABILNOŚĆ RZĄDU
// ---------------------------------------------------------------------------
// Prosty wskaźnik 0–100 wyliczany na nowo co miesiąc z: wielkości większości,
// relacji gracza z koalicjantem (jeśli gracz jest w rządzie), temperatury
// politycznej i odrobiny losowości. Używany do wyzwalania kryzysów zaufania.
function computeGovernmentStability(prevStability, government, sejmSeatsTotal, world, player, playerRelations) {
  const majority = majorityFor(sejmSeatsTotal || SEJM_SEATS);
  const seatMargin = government && government.total ? (government.total - majority) / Math.max(1, majority) : -0.5;
  let target = clamp(55 + seatMargin * 70, 5, 95);
  if (world) target -= (world.politicalTemperature - 35) * 0.3;
  if (player && player.partyId && government && (government.coalition || []).includes(player.partyId) && government.coalition.length > 1) {
    const partners = government.coalition.filter((id) => id !== player.partyId);
    const avgRel = partners.length
      ? partners.reduce((sum, id) => sum + getRelation(playerRelations, "npc_leader_" + id).score, 0) / partners.length
      : 0;
    target += avgRel * 0.15;
  }
  target = clamp(target, 0, 100);
  const prev = Number.isFinite(prevStability) ? prevStability : target;
  return clamp(prev + (target - prev) * 0.35 + (Math.random() * 6 - 3), 0, 100);
}

// ---------------------------------------------------------------------------
// §19 CELE I WARUNKI ZWYCIĘSTWA
// ---------------------------------------------------------------------------
function checkAmbition(player, state) {
  if (player.ambitionAchieved) return false;
  const ambition = PLAYER_AMBITIONS.find((a) => a.id === player.ambition);
  if (!ambition) return false;
  try {
    return !!ambition.check(player, state);
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// §28 REAKCJE GRUP — rozbicie skutków decyzji na osobne, czytelne linie
// ---------------------------------------------------------------------------
// Nie pokazujemy WSZYSTKICH możliwych grup przy każdej decyzji — tylko te,
// których dotyczy dana opcja (na podstawie statystyk, które faktycznie się
// zmieniły, oraz kontekstu roli gracza).
function buildGroupReactions(option, statDeltas, player, isGov) {
  const out = [];
  const sum = (keys) => keys.reduce((s, k) => s + (statDeltas[k] || 0), 0);

  const socLine = sum(["popularity", "publicTrust"]);
  if (Math.abs(socLine) > 0.3) {
    out.push({ group: "Społeczeństwo", tone: socLine > 0 ? "positive" : "negative", text: socLine > 0 ? "Ogólnie pozytywny odbiór społeczny." : "Chłodny odbiór w opinii publicznej." });
  }
  const partyLine = sum(["partyInfluence", "factionSupport"]);
  if (player.partyId && Math.abs(partyLine) > 0.3) {
    out.push({ group: "Partia", tone: partyLine > 0 ? "positive" : "negative", text: partyLine > 0 ? "Twoja pozycja w partii się umacnia." : "Twoja pozycja w partii słabnie." });
  }
  const mediaLine = sum(["recognition", "credibility"]);
  if (Math.abs(mediaLine) > 0.3) {
    out.push({ group: "Media", tone: mediaLine > 0 ? "positive" : "negative", text: mediaLine > 0 ? "Media komentują to raczej przychylnie." : "Media komentują to raczej krytycznie." });
  }
  if (option.relation && option.relation.target === "coalitionLeader" && isGov) {
    out.push({ group: "Koalicjanci", tone: option.relation.range[0] + option.relation.range[1] >= 0 ? "positive" : "negative", text: "Reakcja partnera koalicyjnego." });
  }
  if ((statDeltas.scandalRisk || 0) > 0.5) {
    out.push({ group: "Opozycja", tone: "negative", text: "Opozycja wykorzystuje sytuację we własnej narracji." });
  }
  return out;
}

// ---------------------------------------------------------------------------
// §11 DEDYKOWANY SYSTEM SKANDALI
// ---------------------------------------------------------------------------
// W przeciwieństwie do samego wskaźnika scandalRisk, skandal jest tu trwałym,
// śledzonym obiektem z własnym cyklem życia (nowe -> aktywny -> eskalujący/
// wygasający -> zakończony), który gracz może próbować ugasić decyzją
// "handle_scandal" (przeproś / zaprzecz / milcz) zamiast tylko obserwować liczbę.
const SCANDAL_TOPICS = [
  "finansowanie kampanii", "kontrowersyjna wypowiedź medialna", "konflikt interesów",
  "domniemane nadużycie stanowiska", "afera obyczajowa", "wyciek prywatnych nagrań",
  "nieprawidłowości w strukturach partii", "zarzuty o kłamstwo wyborcze",
];

function createScandal(decision, option, dateLabel) {
  const level = clamp(Math.round(1 + Math.random() * 4), 1, 5);
  const sourceByCategory = { media: "media", kryzys: "opozycja", partia: "wewnątrzpartyjne źródło", kampania: "konkurencja wyborcza" };
  return {
    id: "scandal_" + Math.random().toString(36).slice(2, 9),
    level,
    topic: pickOne(SCANDAL_TOPICS),
    source: sourceByCategory[decision.category] || "anonimowe źródło",
    credibility: 30 + Math.round(Math.random() * 50),
    mediaInterest: clamp(20 + level * 12 + Math.round(Math.random() * 15), 0, 100),
    status: "nowe",
    createdDate: dateLabel,
    originDecision: decision.title,
  };
}

// Naturalne wygasanie skandali w czasie oraz reakcja na decyzję "handle_scandal"
// (jeśli gracz ją w tym miesiącu podjął) — zwraca zaktualizowaną listę.
function tickScandals(activeScandals, handledOptionId) {
  let list = (activeScandals || []).map((s) => ({ ...s }));
  if (handledOptionId) {
    const target = list.find((s) => s.status !== "zakończony");
    if (target) {
      if (handledOptionId === "apology_full") {
        target.status = "zakończony";
        target.mediaInterest = clamp(target.mediaInterest - 30, 0, 100);
      } else if (handledOptionId === "deny_scandal") {
        target.status = Math.random() < 0.45 ? "eskalujący" : "zakończony";
        target.mediaInterest = clamp(target.mediaInterest + (target.status === "eskalujący" ? 15 : -20), 0, 100);
      } else if (handledOptionId === "silent_scandal") {
        target.status = "eskalujący";
        target.mediaInterest = clamp(target.mediaInterest + 8, 0, 100);
      }
    }
  }
  list = list.map((s) => {
    if (s.status === "zakończony") return s;
    const faded = { ...s, mediaInterest: clamp(s.mediaInterest - 10, 0, 100) };
    if (faded.mediaInterest <= 0) faded.status = "zakończony";
    else if (faded.mediaInterest <= 15) faded.status = "wygasający";
    else if (faded.status === "nowe") faded.status = "aktywny";
    return faded;
  });
  return list.slice(-8);
}

// ---------------------------------------------------------------------------
// §32 SAMORZĄD I REGION
// ---------------------------------------------------------------------------
function createDefaultRegionalStrength(playerRegion) {
  return WOJEWODZTWA.map((name) => ({
    name,
    support: 30 + Math.round(Math.random() * 20),
    organization: name === playerRegion ? 45 : 25 + Math.round(Math.random() * 15),
    localPopularity: name === playerRegion ? 20 : 5 + Math.round(Math.random() * 10),
  }));
}

function bumpRegionalStrength(regionalStrength, regionName, deltas) {
  if (!regionalStrength) return regionalStrength;
  return regionalStrength.map((r) => {
    if (r.name !== regionName) return r;
    return {
      ...r,
      support: clamp(r.support + (deltas.support || 0), 0, 100),
      organization: clamp(r.organization + (deltas.organization || 0), 0, 100),
      localPopularity: clamp(r.localPopularity + (deltas.localPopularity || 0), 0, 100),
    };
  });
}

// --- Rozstrzyganie efektów decyzji/wydarzeń ---------------------------------

function resolveStatDeltas(statRanges, difficultyMult) {
  const out = {};
  Object.entries(statRanges || {}).forEach(([k, range]) => {
    out[k] = rollInRange(range, difficultyMult);
  });
  return out;
}

function pickRelationTarget(target, state) {
  const player = state.player;
  if (target === "ownLeader") return ownLeaderNpcId(player);
  if (target === "coalitionLeader") {
    const partners = (state.government?.coalition || []).filter((pid) => pid !== player.partyId);
    if (!partners.length) return null;
    return "npc_leader_" + pickOne(partners);
  }
  if (target === "randomRival" || target === "randomAlly") {
    const ids = Object.keys(state.npcs || {}).filter((id) => id !== ownLeaderNpcId(player));
    if (!ids.length) return ownLeaderNpcId(player);
    return pickOne(ids);
  }
  return null;
}

// --- Cele miesięczne ---------------------------------------------------------

const MONTHLY_GOAL_POOL = [
  { id: "improve_leader_relation", text: "Popraw relację z liderem partii", check: (before, after) => (after.leaderRelation || 0) > (before.leaderRelation || 0), requiresParty: true },
  { id: "positive_debate", text: "Osiągnij pozytywny wynik debaty lub wywiadu", check: (before, after) => after.mediaPositive },
  { id: "avoid_conflict", text: "Unikaj eskalacji konfliktu w tym miesiącu", check: (before, after) => !after.hadConflict },
  { id: "boost_recognition", text: "Zwiększ rozpoznawalność", check: (before, after) => after.stats.recognition > before.stats.recognition },
  { id: "maintain_stability", text: "Utrzymaj stabilność koalicji/rządu", check: (before, after) => !after.hadCoalitionCrisis },
  { id: "boost_credibility", text: "Zwiększ swoją wiarygodność", check: (before, after) => after.stats.credibility > before.stats.credibility },
];

function pickMonthlyGoals(state) {
  const pool = MONTHLY_GOAL_POOL.filter((g) => !g.requiresParty || state.player.partyId);
  return shuffleArr(pool).slice(0, 2).map((g) => ({ id: g.id, text: g.text, done: false }));
}

// --- Generowanie puli decyzji i wydarzenia na dany miesiąc ------------------

function generatePlayerTurn(state) {
  const player = state.player;
  if (!player) return null;
  const pool = DECISION_LIBRARY.filter((d) => decisionAvailable(d, state));
  const shuffled = shuffleArr(pool);
  const available = shuffled.slice(0, Math.min(8, shuffled.length)).map((d) => d.id);
  const diff = DIFFICULTY_LEVELS[player.difficulty] || DIFFICULTY_LEVELS.normal;
  let activeEvent = null;
  if (Math.random() < 0.55 * diff.eventChance) {
    const candidates = PLAYER_EVENT_LIBRARY.filter((e) => eventAvailable(e, state));
    const weighted = [];
    candidates.forEach((e) => { for (let i = 0; i < (e.weight || 1); i++) weighted.push(e); });
    if (weighted.length) activeEvent = pickOne(weighted).id;
  }
  const monthlyGoals = pickMonthlyGoals(state);
  return { availableDecisionIds: available, activeEventId: activeEvent, monthlyGoals, chosen: [] };
}

// --- XP i poziom kariery -----------------------------------------------------

function xpToNextLevel(level) {
  return 40 + level * 30;
}

function applyXpGain(player, amount) {
  let xp = player.xp + amount;
  let level = player.careerLevel;
  const stats = { ...player.stats };
  let leveled = false;
  while (xp >= xpToNextLevel(level)) {
    xp -= xpToNextLevel(level);
    level += 1;
    leveled = true;
    const growKeys = ["mediaSkill", "leadership", "debateSkill", "organization", "coalitionSkill", "fundraising"];
    const key = pickOne(growKeys);
    stats[key] = clamp(stats[key] + 3, 0, 100);
  }
  return { xp, careerLevel: level, stats, leveled };
}

// --- Migracja i domyślne wartości dla kompatybilności wstecznej -------------

function migrateGameState(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const state = { ...raw };
  if (!state.gameMode) state.gameMode = "simulation";
  if (state.player === undefined) state.player = null;
  if (!state.playerRelations) state.playerRelations = {};
  if (!state.npcs) state.npcs = {};
  if (!state.playerCareerHistory) state.playerCareerHistory = [];
  if (!state.playerDecisionHistory) state.playerDecisionHistory = [];
  if (!state.playerEventHistory) state.playerEventHistory = [];
  if (!state.world) state.world = createDefaultWorldState();
  if (!state.monthlySnapshots) state.monthlySnapshots = [];
  if (!Number(state.sejmSeatsTotal)) state.sejmSeatsTotal = SEJM_SEATS;
  if (state.pendingCoalition === undefined) state.pendingCoalition = null;
  if (state.player) {
    if (!state.player.segmentSupport) state.player.segmentSupport = createDefaultSegmentSupport();
    if (state.player.ambitionAchieved === undefined) state.player.ambitionAchieved = false;
    if (state.player.analyticsBoughtThisMonth === undefined) state.player.analyticsBoughtThisMonth = false;
    if (state.player.electionsWon === undefined) state.player.electionsWon = 0;
    if (state.player.electionsLost === undefined) state.player.electionsLost = 0;
    if (state.player.peakPopularity === undefined) state.player.peakPopularity = state.player.stats?.popularity || 0;
    if (state.player.peakPartyPoll === undefined) state.player.peakPartyPoll = 0;
    if (state.player.pendingCandidacy === undefined) state.player.pendingCandidacy = null;
    if (state.player.roleBeforePresidency === undefined) state.player.roleBeforePresidency = null;
    if (!state.player.ideology) state.player.ideology = "centrum";
    if (!state.player.platform) state.player.platform = defaultPlatformForBloc(state.player.ideology);
    if (!state.regionalStrength) state.regionalStrength = createDefaultRegionalStrength(state.player.region);
  }
  if (!state.factions) state.factions = {};
  if (state.registry) state.factions = ensureFactionsForParties(state.factions, state.registry);
  if (!state.activeScandals) state.activeScandals = [];
  if (!Number.isFinite(state.governmentStability)) {
    state.governmentStability = computeGovernmentStability(null, state.government, state.sejmSeatsTotal, state.world, state.player, state.playerRelations);
  }
  if (!state.currentTurn) state.currentTurn = state.gameMode === "player" && state.player ? generatePlayerTurn(state) : null;
  return state;
}

// --- Rozwiązywanie miesiąca gracza (nowa funkcja spinająca warstwę z silnikiem) ---
// Przyjmuje poprzedni pełny stan gry oraz listę wybranych przez gracza opcji
// [{decisionId, optionId}], a zwraca "patch" do zmerge'owania z resztą stanu
// wyliczaną przez istniejący silnik symulacji (randomWalk/D'Hondt/wybory itd.).
// NIE dotyka sondaży partii innych niż partia gracza i NIE nadpisuje mandatów —
// jedyny efekt na "twardy" silnik to niewielka addytywna korekta poparcia
// własnej partii gracza, naniesiona PRZED normalizacją sondaży w advance().

function resolvePlayerMonth(state, chosen, dateLabel) {
  const player = state.player;
  const diff = DIFFICULTY_LEVELS[player.difficulty] || DIFFICULTY_LEVELS.normal;
  let stats = { ...player.stats };
  let resources = { ...player.resources };
  let relations = { ...(state.playerRelations || {}) };
  let world = { ...(state.world || createDefaultWorldState()) };
  let segmentSupport = { ...(player.segmentSupport || createDefaultSegmentSupport()) };
  let regionalStrength = state.regionalStrength ? state.regionalStrength.map((r) => ({ ...r })) : createDefaultRegionalStrength(player.region);
  let partyDelta = 0;
  let xpGain = 0;
  const decisionLog = [];
  const narrativeLines = [];
  let hadConflict = false;
  let factionRadicalDelta = 0; // §9: przesunięcie poparcia frakcji radykalnej w partii gracza
  const newScandals = []; // §18: nowe skandale wywołane decyzjami/wydarzeniami tego miesiąca
  let handledScandalOptionId = null; // §11: reakcja gracza na najstarszy aktywny skandal, jeśli wybrał "handle_scandal"

  // --- §12/§15 akcje specjalne (zmieniają partyId/rolę/registry/polls) ---
  let nextPartyId = player.partyId;
  let roleChange = null;
  let foundedOwnParty = player.foundedOwnParty;
  let pendingCandidacy = player.pendingCandidacy || null;
  let roleBeforePresidency = player.roleBeforePresidency || null;
  let retired = false;
  let analyticsBought = false;
  let registryPatch = null; // nowa partia do dodania do registry (§12 "founded_party")
  let pollsPatchId = null;
  let pollsPatchStart = 0;
  let electionsWonDelta = 0;
  let electionsLostDelta = 0;

  (chosen || []).forEach((chosenEntry) => {
    const { decisionId, optionId } = chosenEntry;
    const decision = DECISION_LIBRARY.find((d) => d.id === decisionId);
    if (!decision) return;
    const option = decision.options.find((o) => o.id === optionId);
    if (!option) return;

    const statDeltas = resolveStatDeltas(option.stat, diff.randomness);
    Object.entries(statDeltas).forEach(([k, v]) => { stats[k] = clamp((stats[k] || 0) + v, 0, 100); });

    if (option.worldEffect) {
      Object.entries(option.worldEffect).forEach(([k, range]) => {
        world[k] = clamp((world[k] ?? 50) + rollInRange(range, diff.randomness), 0, 100);
      });
    }

    if (option.party && player.partyId) {
      partyDelta += rollInRange(option.party, diff.randomness);
    }

    if (option.relation) {
      const targetId = pickRelationTarget(option.relation.target, { ...state, player });
      if (targetId) {
        const delta = rollInRange(option.relation.range, diff.randomness);
        relations = adjustRelation(relations, targetId, delta, dateLabel);
        if (delta < 0) hadConflict = true;
        // §9: konflikt z liderem wzmacnia frakcję radykalną, lojalność wzmacnia umiarkowanych.
        if (targetId === ownLeaderNpcId(player)) {
          factionRadicalDelta += delta < -5 ? 2.5 : delta < 0 ? 1 : delta > 5 ? -1.5 : 0;
        }
      }
    }
    if (option.risk === "wysokie" || option.risk === "bardzo wysokie") factionRadicalDelta += 0.5;

    if (decisionId === "handle_scandal") handledScandalOptionId = optionId;

    // §11: dedykowany system skandali — jeśli decyzja niesie realne ryzyko
    // skandalu (np. duży wzrost scandalRisk albo bezpośrednio dotyczy kryzysu),
    // z pewnym prawdopodobieństwem powstaje trwały, śledzony obiekt skandalu
    // zamiast tylko podniesienia liczby scandalRisk bez konsekwencji fabularnych.
    if ((statDeltas.scandalRisk || 0) >= 2 && Math.random() < 0.35) {
      newScandals.push(createScandal(decision, option, dateLabel));
    }

    // --- §5: reakcje segmentów elektoratu ---
    const netSentiment = Object.values(statDeltas).reduce((a, b) => a + b, 0);
    const segmentReactions = resolveSegmentReactions(decision, option, player, netSentiment);
    segmentReactions.forEach((r) => {
      segmentSupport[r.segmentId] = clamp((segmentSupport[r.segmentId] || 30) + r.delta, 0, 100);
    });

    // --- §28: reakcje grup (społeczeństwo/partia/media/koalicjanci/opozycja) ---
    const groupReactions = buildGroupReactions(option, statDeltas, player, isInGovernment(player, state));

    // --- §32: lekki wpływ decyzji kampanijnych/lokalnych na region gracza ---
    if (["kampania"].includes(decision.category) || decisionId === "local_meetings" || decisionId === "rally") {
      regionalStrength = bumpRegionalStrength(regionalStrength, player.region, {
        support: rollInRange([0.2, 1.2], diff.randomness),
        organization: rollInRange([0.1, 0.8], diff.randomness),
        localPopularity: rollInRange([0.3, 1.5], diff.randomness),
      });
    }

    // --- §12/§15: akcje specjalne ---
    if (option.special) {
      switch (option.special) {
        case "leave_party": {
          const oldParty = player.partyId ? state.registry[player.partyId] : null;
          relations = adjustRelation(relations, ownLeaderNpcId(player), -20, dateLabel);
          nextPartyId = null;
          if (player.role === "party_leader" || player.role === "minister" || player.role === "pm") roleChange = "independent";
          narrativeLines.push(`${player.name} opuszcza partię${oldParty ? ` ${oldParty.name}` : ""} i zostaje niezależnym/ą politykiem/polityczką.`);
          break;
        }
        case "found_party": {
          const details = chosenEntry.foundPartyDetails;
          const newId = uniqueId(slugify((details?.abbreviation || details?.name || player.name + " Ruch")), Object.keys(state.registry));
          const startPoll = clamp(player.stats.popularity * 0.15 + player.stats.recognition * 0.1 + 1, 0.5, 15);
          const chosenBloc = details?.bloc || player.ideology || "centrum";
          registryPatch = {
            id: newId,
            name: details?.abbreviation || `Ruch ${player.name.split(" ")[0]}`,
            full: details?.fullName || details?.name || `Ruch Obywatelski ${player.name}`,
            color: details?.color || randomColor(Object.values(state.registry).map((p) => p.color)),
            bloc: chosenBloc,
            minority: false,
            // §3 wielowymiarowa platforma programowa nowej partii — jeśli gracz nie
            // ustawił jej ręcznie w kreatorze, dziedziczymy z platformy postaci.
            platform: details?.platform || player.platform || defaultPlatformForBloc(chosenBloc),
          };
          pollsPatchId = newId;
          pollsPatchStart = startPoll;
          nextPartyId = newId;
          foundedOwnParty = true;
          roleChange = "party_leader";
          narrativeLines.push(`${player.name} zakłada nowe ugrupowanie „${registryPatch.full}” (${BLOC_LABELS[chosenBloc]}) ze startowym poparciem ok. ${startPoll.toFixed(1)}%.`);
          break;
        }
        case "join_party": {
          const candidates = Object.keys(state.polls).map((id) => state.registry[id]).filter(Boolean);
          if (candidates.length) {
            candidates.sort((a, b) => (a.bloc === player.ideology ? 0 : 1) - (b.bloc === player.ideology ? 0 : 1) || Math.random() - 0.5);
            const target = candidates[0];
            nextPartyId = target.id;
            relations = adjustRelation(relations, "npc_leader_" + target.id, 10, dateLabel);
            narrativeLines.push(`${player.name} dołącza do partii ${target.full}.`);
          }
          break;
        }
        case "run_mp": {
          const chance = clamp(0.3 + (stats.popularity + stats.recognition + stats.partyInfluence) / 300 + (player.partyId ? (state.polls[player.partyId] || 0) / 100 : 0), 0.05, 0.9);
          if (Math.random() < chance) {
            roleChange = "mp";
            electionsWonDelta += 1;
            narrativeLines.push(`${player.name} zdobywa mandat i zostaje posłem/posłanką.`);
          } else {
            electionsLostDelta += 1;
            stats.credibility = clamp(stats.credibility - rollInRange([1, 3], diff.randomness), 0, 100);
            narrativeLines.push(`Start w wyborach do Sejmu kończy się porażką — mandatu nie udało się zdobyć.`);
          }
          break;
        }
        case "run_leader": {
          const rel = getRelation(relations, ownLeaderNpcId(player));
          const chance = clamp(0.25 + (stats.partyInfluence + stats.factionSupport) / 250 - rel.score / 300, 0.05, 0.85);
          if (Math.random() < chance) {
            roleChange = "party_leader";
            relations = adjustRelation(relations, ownLeaderNpcId(player), -40, dateLabel);
            narrativeLines.push(`${player.name} wygrywa wewnątrzpartyjne starcie i zostaje nowym liderem/nową liderką partii.`);
          } else {
            relations = adjustRelation(relations, ownLeaderNpcId(player), -15, dateLabel);
            narrativeLines.push(`Próba przejęcia przywództwa partii kończy się porażką.`);
          }
          break;
        }
        case "run_president": {
          // Zapamiętujemy rolę sprzed kandydatury, żeby po ewentualnej
          // przegranej lub zakończeniu kadencji gracz wrócił do niej,
          // zamiast zawsze lądować na "lider partii"/"niezależny".
          roleBeforePresidency = player.role;
          roleChange = "president_candidate";
          pendingCandidacy = "president";
          narrativeLines.push(`${player.name} oficjalnie ogłasza kandydaturę na prezydenta RP.`);
          break;
        }
        case "buy_analytics": {
          analyticsBought = true;
          resources.politicalCapital = clamp(resources.politicalCapital - 5, 0, 999);
          narrativeLines.push(`Zlecono szczegółową analizę sondażową i wewnątrzpartyjną na ten miesiąc.`);
          break;
        }
        case "retire": {
          retired = true;
          narrativeLines.push(`${player.name} ogłasza zakończenie kariery politycznej.`);
          break;
        }
        default:
          break;
      }
    }

    resources.energy = clamp(resources.energy - (decision.cost || 0) * 8, 0, 100);
    if (decision.cost && resources.budget !== undefined && decision.category === "kampania") {
      resources.budget = clamp(resources.budget - Math.min(decision.cost, resources.budget), 0, 999);
    }

    xpGain += 6 + (decision.cost || 0) * 3;
    decisionLog.push({ decisionId, optionId, title: decision.title, optionLabel: option.label, narrative: option.narrative || narrativeLines[narrativeLines.length - 1] || "", groupReactions, segmentReactions });
    if (option.narrative) narrativeLines.push(option.narrative);
  });

  // Wydarzenie niezależne od gracza — jeśli w tej turze było aktywne, ma własny,
  // niewielki wpływ na statystyki i/lub relacje, niezależny od wyboru gracza.
  const eventLogEntries = [];
  if (state.currentTurn && state.currentTurn.activeEventId) {
    const evt = PLAYER_EVENT_LIBRARY.find((e) => e.id === state.currentTurn.activeEventId);
    if (evt) {
      const ctx = { playerName: player.name, partyName: player.partyId ? state.registry[player.partyId]?.name : "", region: player.region };
      const evtStatDeltas = resolveStatDeltas(evt.stat, diff.randomness * 0.6);
      Object.entries(evtStatDeltas).forEach(([k, v]) => { stats[k] = clamp((stats[k] || 0) + v, 0, 100); });
      if (evt.worldEffect) {
        Object.entries(evt.worldEffect).forEach(([k, range]) => {
          world[k] = clamp((world[k] || 50) + rollInRange(range, diff.randomness * 0.6), 0, 100);
        });
      }
      if (evt.relation) {
        const targetId = pickRelationTarget(evt.relation.target, { ...state, player });
        if (targetId) relations = adjustRelation(relations, targetId, rollInRange(evt.relation.range, diff.randomness * 0.6), dateLabel);
      }
      eventLogEntries.push({ id: evt.id, title: evt.title, text: evt.text(ctx), kind: "scheduled", important: !!evt.important });
    }
  }

  // --- §18: inicjatywa NPC, niezależna od zaplanowanego wydarzenia miesiąca ---
  const npcInitiative = resolveNpcInitiative(state, { ...player, stats }, diff);
  if (npcInitiative) {
    if (npcInitiative.statDeltas) {
      Object.entries(resolveStatDeltas(npcInitiative.statDeltas, diff.randomness * 0.7)).forEach(([k, v]) => { stats[k] = clamp((stats[k] || 0) + v, 0, 100); });
    }
    if (npcInitiative.relationTarget) {
      const targetId = pickRelationTarget(npcInitiative.relationTarget, { ...state, player });
      if (targetId) relations = adjustRelation(relations, targetId, rollInRange(npcInitiative.relationRange, diff.randomness * 0.7), dateLabel);
    }
    if (npcInitiative.partyDeltaRange && player.partyId) {
      partyDelta += rollInRange(npcInitiative.partyDeltaRange, diff.randomness * 0.7);
    }
    eventLogEntries.push({ id: "npc_" + npcInitiative.kind, title: "Inicjatywa polityczna otoczenia", text: npcInitiative.text, kind: "npc_initiative" });
  }

  // Naturalny, powolny dryf świata (niezależnie od wydarzenia) — utrzymuje
  // wskaźniki państwa w ruchu, ale w bardzo małej skali.
  ["economy", "unemployment", "inflation", "publicServices", "security", "governmentApproval", "politicalTemperature", "mediaTemperature"].forEach((k) => {
    world[k] = clamp((world[k] ?? 50) + (Math.random() * 2 - 1), 0, 100);
  });

  // Naturalna regeneracja energii i lekkie zużycie kondycji między turami.
  resources.energy = clamp(resources.energy + 15, 0, 100);
  resources.politicalCapital = clamp(resources.politicalCapital + (partyDelta > 0 ? 1 : 0), 0, 100);

  const xpResult = applyXpGain({ ...player, stats }, xpGain);

  const monthsInPolitics = player.monthsInPolitics + 1;
  // §38: bardzo powolne starzenie się postaci — rok gry = rok życia.
  const age = monthsInPolitics % 12 === 0 ? player.age + 1 : player.age;

  const nextPlayer = {
    ...player,
    partyId: nextPartyId,
    role: roleChange || player.role,
    foundedOwnParty,
    pendingCandidacy,
    roleBeforePresidency,
    stats: xpResult.stats,
    segmentSupport,
    resources,
    xp: xpResult.xp,
    careerLevel: xpResult.careerLevel,
    monthsInPolitics,
    age,
    retired: retired || player.retired,
    analyticsBoughtThisMonth: analyticsBought,
    electionsWon: (player.electionsWon || 0) + electionsWonDelta,
    electionsLost: (player.electionsLost || 0) + electionsLostDelta,
    peakPopularity: Math.max(player.peakPopularity || 0, xpResult.stats.popularity),
  };

  const activeScandals = [...tickScandals(state.activeScandals, handledScandalOptionId), ...newScandals].slice(-8);
  const factions = player.partyId ? shiftPlayerFactions(state.factions, player.partyId, factionRadicalDelta) : state.factions;

  return {
    player: nextPlayer,
    playerRelations: relations,
    world,
    regionalStrength,
    partyDelta,
    registryPatch,
    pollsPatchId,
    pollsPatchStart,
    decisionLog,
    eventLogEntries,
    narrativeLines,
    leveled: xpResult.leveled,
    hadConflict,
    activeScandals,
    factions,
  };
}

function buildInitialState(config) {
  const parties = config.parties;
  const startDate = config.startDate;
  const registry = Object.fromEntries(parties.map((p) => [p.id, p]));
  const sejmSeatsTotal = Number(config.sejmSeatsTotal) > 0 ? Math.round(Number(config.sejmSeatsTotal)) : SEJM_SEATS;
  const majority = majorityFor(sejmSeatsTotal);

  const rawPolls = {};
  parties.forEach((p) => (rawPolls[p.id] = Math.max(0.01, p.start)));
  // „Kumulacja” zawiera już dokładnie średnie wartości (suma / 30), więc
  // nie przeskalowujemy ich ponownie do 100%. Pozostałe szablony zachowują
  // dotychczasowe zachowanie z normalizacją sondaży startowych.
  const startPolls = config.preservePollValues ? { ...rawPolls } : normalize(rawPolls);

  const sejmThreshold = Number.isFinite(Number(config.settings?.sejmThreshold)) ? Number(config.settings.sejmThreshold) : 5;
  const epThreshold = Number.isFinite(Number(config.settings?.epThreshold)) ? Number(config.settings.epThreshold) : 5;

  const sejmSeats = dhondt(startPolls, sejmSeatsTotal, sejmThreshold, minorityExemptIds(startPolls, registry));
  const senatSeats = dhondt(startPolls, SENAT_SEATS, 0);
  const epSeats = dhondt(startPolls, EP_SEATS, epThreshold);
  const sejmikControl = simulateSejmiki(startPolls);
  const government = formGovernment(sejmSeats, null, parties, majority);

  // --- TRYB GRACZA: warstwa dodatkowa, aktywna tylko gdy config.gameMode === "player" ---
  const gameMode = config.gameMode === "player" ? "player" : "simulation";
  let player = null;
  let npcs = {};
  let world = null;
  let currentTurn = null;
  let regionalStrength = null;
  let factions = {};
  const activeScandals = [];
  if (gameMode === "player" && config.playerConfig) {
    player = createDefaultPlayerState(config.playerConfig, registry);
    npcs = ensureNpcsForParties({}, registry);
    world = createDefaultWorldState();
    regionalStrength = createDefaultRegionalStrength(player.region);
    factions = ensureFactionsForParties({}, registry);
    const stub = { player, npcs, registry, polls: startPolls, government, playerRelations: {} };
    currentTurn = generatePlayerTurn(stub);
  }
  const governmentStability = computeGovernmentStability(null, government, sejmSeatsTotal, world, player, {});

  return {
    date: { ...startDate },
    startDate: { ...startDate },
    registry,
    polls: startPolls,
    sejmSeatsTotal,
    history: [{ label: `${MONTHS_PL[startDate.month - 1]} '${String(startDate.year).slice(2)}`, ...startPolls }],
    schedule: config.schedule ? { ...config.schedule } : initialSchedule(startDate),
    sejmSeats,
    senatSeats,
    epSeats,
    sejmikControl,
    government,
    president: config.president ? { ...config.president } : { name: "Prezydent RP", note: "" },
    // Chronologiczna historia głów państwa i rządów — każdy wpis ma zakres dat
    // {from, to}; to === null oznacza "nadal urzęduje". Zasilana w advance()
    // przy każdych wyborach prezydenckich / parlamentarnych. Używana w zakładce
    // "Władze" do zbudowania listy prezydentów i premierów.
    presidentHistory: [
      { from: { ...startDate }, to: null, name: (config.president ? config.president.name : "Prezydent RP"), note: config.president ? config.president.note : "" },
    ],
    governmentHistory: [
      { from: { ...startDate }, to: null, label: government.label, coalition: government.coalition, pm: government.pm },
    ],
    electionsArchive: [],
    settings: {
      dissolutionEnabled: !!config.settings?.dissolutionEnabled,
      dissolutionChance: config.settings?.dissolutionChance ?? 15,
      newPartiesEnabled: !!config.settings?.newPartiesEnabled,
      newPartiesChance: config.settings?.newPartiesChance ?? 5,
      randomEventsEnabled: config.settings?.randomEventsEnabled !== false,
      randomEventsChance: config.settings?.randomEventsChance ?? 18,
      sejmThreshold,
      epThreshold,
      // §29: w trybie symulacji gracz może wyłączyć zatrzymywanie się szybkiej
      // symulacji na wyborach (Sejm/EP/samorząd/prezydent) — domyślnie
      // włączone (zachowanie jak dotychczas). Przydatne razem z "symuluj do daty".
      stopOnElections: config.settings?.stopOnElections !== false,
    },
    log: [
      { date: fmtDate(startDate), text: "Start symulacji. Sejm/Senat/EP/sejmiki wyliczone metodą D'Hondta z sondaży startowych (uproszczenie — brak realnych danych mandatowych sprzed startu)." },
    ],

    // --- TRYB GRACZA ---
    gameMode,
    player,
    playerRelations: {},
    npcs,
    playerCareerHistory: player
      ? [{ id: "career_start", date: fmtDate(startDate), text: `Rozpoczyna karierę polityczną jako: ${roleLabel(player.role)}${player.partyId ? ` (${registry[player.partyId]?.name})` : " (niezależny)"}.` }]
      : [],
    playerDecisionHistory: [],
    playerEventHistory: [],
    world,
    monthlySnapshots: [],
    currentTurn,
    regionalStrength,
    governmentStability,
    pendingCoalition: null,
    factions,
    activeScandals,
  };
}

function SeatTable({ seats, total, title, registry }) {
  const ranked = Object.keys(seats)
    .filter((id) => seats[id] > 0 && registry[id])
    .map((id) => registry[id])
    .sort((a, b) => seats[b.id] - seats[a.id]);
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">
        {title} <span className="text-slate-600 font-mono">({total})</span>
      </p>
      <div className="space-y-1">
        {ranked.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <span className="w-28 truncate text-slate-300">{p.name}</span>
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(seats[p.id] / total) * 100}%`, backgroundColor: p.color }} />
            </div>
            <span className="w-10 text-right font-mono text-slate-400">{seats[p.id]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PollSnapshot({ polls, registry }) {
  const ranked = Object.keys(polls)
    .filter((id) => registry[id])
    .map((id) => registry[id])
    .sort((a, b) => polls[b.id] - polls[a.id]);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {ranked.map((p) => (
        <span key={p.id} className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
          {p.name} {pct(polls[p.id])}
        </span>
      ))}
    </div>
  );
}

const ELECTION_TITLES = {
  sejm: "🗳️ Wybory parlamentarne — Sejm i Senat",
  europarlament: "🇪🇺 Wybory do Parlamentu Europejskiego",
  samorzad: "🏛️ Wybory samorządowe — sejmiki wojewódzkie",
  prezydent: "🎖️ Wybory prezydenckie",
};

const ELECTION_LABELS = {
  sejm: "Sejm / Senat",
  samorzad: "Samorządowe (sejmiki)",
  europarlament: "Europarlamentarne",
  prezydent: "Prezydenckie",
};

// ---------------------------------------------------------------------------
// SZABLONY KONFIGURACJI — gotowe, historyczne punkty startowe do wczytania
// jednym kliknięciem na ekranie konfiguracji (partie, poparcie, prezydent,
// data startu i harmonogram najbliższych wyborów).
// ---------------------------------------------------------------------------
const TEMPLATES = [
  {
    key: "prezydent1990",
    label: "Wybory prezydenckie 1990",
    sub: "listopad 1990",
    startDate: { month: 11, year: 1990 },
    president: { name: "Lech Wałęsa", note: "Komitet Obywatelski \"Solidarność\"" },
    schedule: {
      sejm: { month: 10, year: 1991 },
      samorzad: { month: 10, year: 1998 },
      europarlament: { month: 6, year: 2004 },
      prezydent: { month: 11, year: 1995 },
    },
    parties: [
      { name: "KO\"S\"", full: "Komitet Obywatelski \"Solidarność\"", bloc: "centrum", start: 58.04 },
      { name: "SdRP", full: "Socjaldemokracja Rzeczypospolitej Polskiej", bloc: "centrolewica", start: 9.21 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 7.15 },
      { name: "KPN", full: "Konfederacja Polski Niepodległej", bloc: "prawica", start: 2.5 },
    ],
  },
  {
    key: "sejm1991",
    label: "Wybory parlamentarne 1991",
    sub: "październik 1991",
    startDate: { month: 10, year: 1991 },
    president: { name: "Lech Wałęsa", note: "Komitet Obywatelski \"Solidarność\"" },
    schedule: {
      sejm: { month: 9, year: 1993 },
      samorzad: { month: 10, year: 1998 },
      europarlament: { month: 6, year: 2004 },
      prezydent: { month: 11, year: 1995 },
    },
    parties: [
      { name: "UD", full: "Unia Demokratyczna", bloc: "centroprawica", start: 12.32 },
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 11.99 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 9.21 },
      { name: "WAK", full: "Wyborcza Akcja Katolicka", bloc: "prawica", start: 8.99 },
      { name: "POC", full: "Porozumienie Obywatelskie Centrum", bloc: "centroprawica", start: 8.71 },
      { name: "KPN", full: "Konfederacja Polski Niepodległej", bloc: "prawica", start: 7.75 },
      { name: "KLD", full: "Kongres Liberalno-Demokratyczny", bloc: "centroprawica", start: 7.49 },
      { name: "PSL-PL", full: "Polskie Stronnictwo Ludowe – Porozumienie Ludowe", bloc: "centrum", start: 5.47 },
      { name: "KO\"S\"", full: "Komitet Obywatelski \"Solidarność\"", bloc: "centrum", start: 5.05 },
      { name: "PPPP", full: "Polska Partia Przyjaciół Piwa", bloc: "centrum", start: 3.27 },
      { name: "ChD", full: "Chrześcijańska Demokracja", bloc: "centrum", start: 2.36 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 2.26 },
      { name: "SP", full: "Solidarność Pracy", bloc: "centrum", start: 2.06 },
      { name: "SD", full: "Stronnictwo Demokratyczne", bloc: "centrolewica", start: 1.42 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 1.18, minority: true },
      { name: "PchD", full: "Partia Chrześcijańskich Demokratów", bloc: "prawica", start: 1.12 },
      { name: "PZ", full: "Partia Zielonych (Polska)", bloc: "centrum", start: 0.82 },
      { name: "PW", full: "Partia Wolności (Polska)", bloc: "centrum", start: 0.7 },
      { name: "SN", full: "Stronnictwo Narodowe", bloc: "centrum", start: 0.66 },
      { name: "PPZ", full: "Polska Partia Zielonych", bloc: "centrum", start: 0.63 },
      { name: "Partia X", full: "Partia X", bloc: "lewica", start: 0.47 },
      { name: "RDS", full: "Ruch Demokratyczno-Społeczny", bloc: "centrum", start: 0.46 },
      { name: "RAŚ", full: "Ruch Autonomii Śląska/Ruch Autōnōmije Ślōnska", bloc: "lewica", start: 0.36 },
      { name: "UChS", full: "Unia Chrześcijańsko-Społeczna", bloc: "centrum", start: 0.27 },
      { name: "S80", full: "Solidarność 80", bloc: "centrum", start: 0.25 },
      { name: "ZP", full: "Związek Podhalan", bloc: "centrum", start: 0.24 },
      { name: "KR", full: "Koalicja Republikańska", bloc: "centrum", start: 0.21 },
      { name: "WUS", full: "Wielkopolska Unia Socjaldemokratyczna", bloc: "centrum", start: 0.21 },
      { name: "NSZZP", full: "Niezależny Samorządny Związek Zawodowy Policjantów", bloc: "centrum", start: 0.2 },
      { name: "UWlkp", full: "Unia Wielkopolan", bloc: "centrum", start: 0.08 },
      { name: "PWN", full: "Polska Wspólnota Narodowa", bloc: "centrum", start: 0.05 },
      { name: "ZZMK", full: "Związek Zawodowy Maszynistów Kolejowych w Polsce", bloc: "centrum", start: 0.05 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 0.03 },
      { name: "ZKRP", full: "Związek Kombatantów RP i Byłych Więźniów Politycznych", bloc: "centrum", start: 0.03 },
      { name: "PFLCh", full: "Polskie Forum Ludowo-Chrześcijańskie „Ojcowizna”", bloc: "prawica", start: 0.03 },
      { name: "SND", full: "Stronnictwo Narodowo-Demokratyczne", bloc: "centrum", start: 0.02 },
      { name: "PTP", full: "Polskie Towarzystwo Pielęgniarskie", bloc: "centrum", start: 0.02 },
      { name: "SdRP", full: "Socjaldemokracja Rzeczypospolitej Polskiej", bloc: "centrolewica", start: 0.02 },
      { name: "PZD", full: "Polski Związek Działkowców", bloc: "centrum", start: 0.01 },
      { name: "PPN-PNP", full: "Polska Partia Niepodległościowa – Partia Nowej Prawicy", bloc: "centrum", start: 0.01 },
    ],
  },
  {
    key: "sejm1993",
    label: "Wybory parlamentarne 1993",
    sub: "wrzesień 1993",
    startDate: { month: 9, year: 1993 },
    president: { name: "Lech Wałęsa", note: "Komitet Obywatelski \"Solidarność\"" },
    schedule: {
      sejm: { month: 9, year: 1997 },
      samorzad: { month: 10, year: 1998 },
      europarlament: { month: 6, year: 2004 },
      prezydent: { month: 11, year: 1995 },
    },
    parties: [
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 20.41 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 15.4 },
      { name: "UD", full: "Unia Demokratyczna", bloc: "centroprawica", start: 10.59 },
      { name: "UP", full: "Unia Pracy", bloc: "centrolewica", start: 7.28 },
      { name: "KWW", full: "Katolicki Komitet Wyborczy \"Ojczyzna\"", bloc: "centroprawica", start: 6.37 },
      { name: "KPN", full: "Konfederacja Polski Niepodległej", bloc: "prawica", start: 5.77 },
      { name: "BBWR", full: "Bezpartyjny Blok Wspierania Reform", bloc: "centroprawica", start: 5.41 },
      { name: "KO\"S\"", full: "Komitet Obywatelski \"Solidarność\"", bloc: "centrum", start: 4.9 },
      { name: "PC-ZP", full: "Porozumienie Centrum – Zjednoczenie Polskie", bloc: "centroprawica", start: 4.42 },
      { name: "KLD", full: "Kongres Liberalno-Demokratyczny", bloc: "centroprawica", start: 3.99 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 3.18 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 2.78 },
      { name: "Partia X", full: "Partia X", bloc: "lewica", start: 2.74 },
      { name: "KdR", full: "Koalicja dla Rzeczypospolitej", bloc: "centroprawica", start: 2.7 },
      { name: "PSL-PL", full: "Polskie Stronnictwo Ludowe – Porozumienie Ludowe", bloc: "centrum", start: 2.37 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.8, minority: true },
      { name: "PPPP", full: "Polska Partia Przyjaciół Piwa", bloc: "centrum", start: 0.1 },
    ],
  },
  {
    key: "prezydent1995",
    label: "Wybory prezydenckie 1995",
    sub: "listopad 1995",
    startDate: { month: 11, year: 1995 },
    president: { name: "Aleksander Kwaśniewski", note: "Sojusz Lewicy Demokratycznej" },
    schedule: {
      sejm: { month: 9, year: 1997 },
      samorzad: { month: 10, year: 1998 },
      europarlament: { month: 6, year: 2004 },
      prezydent: { month: 10, year: 2000 },
    },
    parties: [
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 35.11 },
      { name: "UW", full: "Unia Wolności", bloc: "centroprawica", start: 9.22 },
      { name: "RdR", full: "Ruch dla Rzeczypospolitej", bloc: "centroprawica", start: 6.86 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 4.31 },
      { name: "UP", full: "Unia Pracy", bloc: "centrolewica", start: 3.53 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 2.4 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 1.32 },
    ],
  },
  {
    key: "sejm1997",
    label: "Wybory parlamentarne 1997",
    sub: "wrzesień 1997",
    startDate: { month: 9, year: 1997 },
    president: { name: "Aleksander Kwaśniewski", note: "Sojusz Lewicy Demokratycznej" },
    schedule: {
      sejm: { month: 9, year: 2001 },
      samorzad: { month: 10, year: 1998 },
      europarlament: { month: 6, year: 2004 },
      prezydent: { month: 10, year: 2000 },
    },
    parties: [
      { name: "AWS", full: "Akcja Wyborcza Solidarność", bloc: "centroprawica", start: 33.83 },
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 27.13 },
      { name: "UW", full: "Unia Wolności", bloc: "centroprawica", start: 13.37 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 7.31 },
      { name: "ROP", full: "Ruch Odbudowy Polski", bloc: "prawica", start: 5.56 },
      { name: "UP", full: "Unia Pracy", bloc: "centrolewica", start: 4.74 },
      { name: "KPEiR", full: "Krajowa Partia Emerytów i Rencistów", bloc: "lewica", start: 2.18 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 2.03 },
      { name: "KPEiR RP", full: "Krajowe Porozumienie Emerytów i Rencistów Rzeczypospolitej Polskiej", bloc: "prawica", start: 1.63 },
      { name: "BdP", full: "Blok dla Polski", bloc: "centrum", start: 1.36 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.39, minority: true },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 0.08 },
      { name: "PWN", full: "Polska Wspólnota Narodowa", bloc: "centrum", start: 0.07 },
    ],
  },
  {
    key: "samorzad1998",
    label: "Wybory samorządowe 1998",
    sub: "październik 1998",
    startDate: { month: 10, year: 1998 },
    president: { name: "Aleksander Kwaśniewski", note: "Sojusz Lewicy Demokratycznej" },
    schedule: {
      sejm: { month: 9, year: 2001 },
      samorzad: { month: 10, year: 2002 },
      europarlament: { month: 6, year: 2004 },
      prezydent: { month: 10, year: 2000 },
    },
    parties: [
      { name: "AWS", full: "Akcja Wyborcza Solidarność", bloc: "centroprawica", start: 33.31 },
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 31.83 },
      { name: "PS", full: "Przymierzenie Społeczne", bloc: "lewica", start: 12.03 },
      { name: "UW", full: "Unia Wolności", bloc: "centroprawica", start: 11.68 },
      { name: "RP", full: "Stowarzyszenie Rodzina Polska", bloc: "prawica", start: 5.17 },
      { name: "RPO", full: "Ruch Patriotyczny „Ojczyzna”", bloc: "prawica", start: 3.21 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.58, minority: true },
      { name: "SWŚ", full: "Stowarzyszenie Wspólnota Świętokrzyska", bloc: "centrum", start: 0.36 },
      { name: "RAŚ", full: "Ruch Autonomii Śląska/Ruch Autōnōmije Ślōnska", bloc: "lewica", start: 0.26 },
      { name: "ChD III RP", full: "Chrześcijańska Demokracja III Rzeczypospolitej Polskiej", bloc: "centrum", start: 0.1 },
      { name: "ZKRP", full: "Związek Kombatantów RP i Byłych Więźniów Politycznych", bloc: "centrum", start: 0.03 },
      { name: "PLD", full: "Partia Ludowo-Demokratyczna", bloc: "centrolewica", start: 0.01 },
    ],
  },
  {
    key: "prezydent2000",
    label: "Wybory prezydenckie 2000",
    sub: "październik 2000",
    startDate: { month: 10, year: 2000 },
    president: { name: "Aleksander Kwaśniewski", note: "Sojusz Lewicy Demokratycznej" },
    schedule: {
      sejm: { month: 9, year: 2001 },
      samorzad: { month: 10, year: 2002 },
      europarlament: { month: 6, year: 2004 },
      prezydent: { month: 10, year: 2005 },
    },
    parties: [
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 53.9 },
      { name: "SKL", full: "Stronnictwo Konserwatywno-Ludowe", bloc: "centroprawica", start: 17.3 },
      { name: "AWS", full: "Akcja Wyborcza Solidarność", bloc: "centroprawica", start: 15.57 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 5.95 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 3.05 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 1.43 },
      { name: "ChD III RP", full: "Chrześcijańska Demokracja III Rzeczypospolitej Polskiej", bloc: "centrum", start: 1.01 },
      { name: "PP", full: "Porozumienie Polskie", bloc: "prawica", start: 0.79 },
      { name: "SPRS", full: "Stronnictwo Polska Racja Stanu", bloc: "centrum", start: 0.51 },
      { name: "PPS", full: "Polska Partia Socjalistyczna", bloc: "centrolewica", start: 0.22 },
      { name: "SN", full: "Stronnictwo Narodowe", bloc: "centrum", start: 0.16 },
      { name: "PSL-M", full: "Polskie Stronnictwo Ludowe (Mikołajczykowskie)", bloc: "prawica", start: 0.1 },
    ],
  },
  {
    key: "sejm2001",
    label: "Wybory parlamentarne 2001",
    sub: "wrzesień 2001",
    startDate: { month: 9, year: 2001 },
    president: { name: "Aleksander Kwaśniewski", note: "Sojusz Lewicy Demokratycznej" },
    schedule: {
      sejm: { month: 9, year: 2005 },
      samorzad: { month: 10, year: 2002 },
      europarlament: { month: 6, year: 2004 },
      prezydent: { month: 10, year: 2005 },
    },
    parties: [
      { name: "SLD-UP", full: "Sojusz Lewicy Demokratycznej-Unia Pracy", bloc: "centrolewica", start: 41.04 },
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 12.68 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 10.2 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 9.5 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 8.98 },
      { name: "LPR", full: "Liga Polskich Rodzin", bloc: "prawica", start: 7.87 },
      { name: "AWS", full: "Akcja Wyborcza Solidarność", bloc: "centroprawica", start: 5.6 },
      { name: "UW", full: "Unia Wolności", bloc: "centroprawica", start: 3.1 },
      { name: "ARS", full: "Alternatywa Ruch Społeczny", bloc: "lewica", start: 0.42 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.36, minority: true },
      { name: "PPS", full: "Polska Partia Socjalistyczna", bloc: "centrolewica", start: 0.1 },
      { name: "PUG", full: "Polska Unia Gospodarcza", bloc: "centrum", start: 0.06 },
      { name: "PWN", full: "Polska Wspólnota Narodowa", bloc: "centrum", start: 0.02 },
    ],
  },
  {
    key: "samorzad2002",
    label: "Wybory samorządowe 2002",
    sub: "październik 2002",
    startDate: { month: 10, year: 2002 },
    president: { name: "Aleksander Kwaśniewski", note: "Sojusz Lewicy Demokratycznej" },
    schedule: {
      sejm: { month: 9, year: 2005 },
      samorzad: { month: 11, year: 2006 },
      europarlament: { month: 6, year: 2004 },
      prezydent: { month: 10, year: 2005 },
    },
    parties: [
      { name: "SLD-UP", full: "Sojusz Lewicy Demokratycznej-Unia Pracy", bloc: "centrolewica", start: 24.65 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 15.98 },
      { name: "LPR", full: "Liga Polskich Rodzin", bloc: "prawica", start: 14.36 },
      { name: "POPiS", full: "POPiS", bloc: "centroprawica", start: 12.11 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 10.81 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 2.35 },
      { name: "KROB", full: "Konfederacja Ruch Obrony Bezrobotnych", bloc: "centrum", start: 2.34 },
      { name: "US", full: "Unia Samorządowa", bloc: "centrum", start: 2.29 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 2.27 },
      { name: "PPP", full: "Polska Partia Pracy-Sierpień 80", bloc: "lewica", start: 1.5 },
      { name: "WM", full: "Wspólnota Małopolska", bloc: "centrum", start: 1.21 },
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 1.14 },
      { name: "KPEiR", full: "Krajowa Partia Emerytów i Rencistów", bloc: "lewica", start: 1.14 },
      { name: "PR", full: "Podkarpacie Razem", bloc: "centroprawica", start: 0.95 },
      { name: "WSWŚ", full: "Wspólnota Samorządowa Województwa Śląskiego", bloc: "centrum", start: 0.89 },
      { name: "RAŚ", full: "Ruch Autonomii Śląska/Ruch Autōnōmije Ślōnska", bloc: "lewica", start: 0.51 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.49, minority: true },
      { name: "KPN", full: "Konfederacja Polski Niepodległej", bloc: "prawica", start: 0.26 },
      { name: "PUG", full: "Polska Unia Gospodarcza", bloc: "centrum", start: 0.11 },
      { name: "KPEiR RP", full: "Krajowe Porozumienie Emerytów i Rencistów Rzeczypospolitej Polskiej", bloc: "prawica", start: 0.03 },
      { name: "ONP-LP", full: "Organizacja Narodu Polskiego – Liga Polska", bloc: "centroprawica", start: 0.02 },
      { name: "FER", full: "Forum Emerytów i Rencistów", bloc: "centrum", start: 0.01 },
    ],
  },
  {
    key: "europarlament2004",
    label: "Wybory europarlamentarne 2004",
    sub: "czerwiec 2004",
    startDate: { month: 6, year: 2004 },
    president: { name: "Aleksander Kwaśniewski", note: "Sojusz Lewicy Demokratycznej" },
    schedule: {
      sejm: { month: 9, year: 2005 },
      samorzad: { month: 11, year: 2006 },
      europarlament: { month: 6, year: 2009 },
      prezydent: { month: 10, year: 2005 },
    },
    parties: [
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 24.1 },
      { name: "LPR", full: "Liga Polskich Rodzin", bloc: "prawica", start: 15.92 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 12.67 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 10.78 },
      { name: "SLD-UP", full: "Sojusz Lewicy Demokratycznej-Unia Pracy", bloc: "centrolewica", start: 9.35 },
      { name: "UW", full: "Unia Wolności", bloc: "centroprawica", start: 7.33 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 6.34 },
      { name: "SDPL", full: "Socjaldemokracja Polska", bloc: "centrolewica", start: 5.33 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 1.87 },
      { name: "NKWW", full: "Narodowy Komitet Wyborczy Wyborców", bloc: "centroprawica", start: 1.56 },
      { name: "IdP", full: "Inicjatywa dla Polski", bloc: "centroprawica", start: 1.45 },
      { name: "KPEiR", full: "Krajowa Partia Emerytów i Rencistów", bloc: "lewica", start: 0.8 },
      { name: "KROB", full: "Konfederacja Ruch Obrony Bezrobotnych", bloc: "centrum", start: 0.61 },
      { name: "OKO", full: "Ogólnopolska Koalicja Obywatelska", bloc: "centrum", start: 0.58 },
      { name: "PPP", full: "Polska Partia Pracy-Sierpień 80", bloc: "lewica", start: 0.54 },
      { name: "RACJA", full: "RACJA Polskiej Lewicy", bloc: "centrolewica", start: 0.3 },
      { name: "Zieloni", full: "Zieloni", bloc: "centrolewica", start: 0.27 },
      { name: "DPL", full: "Demokratyczna Partia Lewicy", bloc: "lewica", start: 0.09 },
      { name: "RdP", full: "Razem dla Przyszłości", bloc: "centrum", start: 0.05 },
      { name: "NOP", full: "Narodowe Odrodzenie Polski", bloc: "skrajna_prawica", start: 0.04 },
      { name: "PPN", full: "Polska Partia Narodowa", bloc: "centrum", start: 0.04 },
    ],
  },
  {
    key: "sejm2005",
    label: "Wybory parlamentarne 2005",
    sub: "wrzesień 2005",
    startDate: { month: 9, year: 2005 },
    president: { name: "Aleksander Kwaśniewski", note: "Sojusz Lewicy Demokratycznej" },
    schedule: {
      sejm: { month: 10, year: 2007 },
      samorzad: { month: 11, year: 2006 },
      europarlament: { month: 6, year: 2009 },
      prezydent: { month: 10, year: 2005 },
    },
    parties: [
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 26.99 },
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 24.14 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 11.41 },
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 11.31 },
      { name: "LPR", full: "Liga Polskich Rodzin", bloc: "prawica", start: 7.97 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 6.96 },
      { name: "SDLP", full: "Socjaldemokracja Polska", bloc: "centrolewica", start: 3.89 },
      { name: "PD", full: "Partia Demokratyczna – demokraci.pl", bloc: "centrum", start: 2.45 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 1.57 },
      { name: "RP", full: "Ruch Patriotyczny", bloc: "centrum", start: 1.05 },
      { name: "PPP", full: "Polska Partia Pracy-Sierpień 80", bloc: "lewica", start: 0.77 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.29, minority: true },
      { name: "PPN", full: "Polska Partia Narodowa", bloc: "centrum", start: 0.29 },
      { name: "DO", full: "Dom Ojczysty", bloc: "prawica", start: 0.28 },
      { name: "PC", full: "Partia Centrum", bloc: "centrum", start: 0.19 },
      { name: "OKO", full: "Ogólnopolska Koalicja Obywatelska", bloc: "centrum", start: 0.14 },
      { name: "IRP", full: "Inicjatywa Rzeczpospolitej Polskiej", bloc: "centrolewica", start: 0.1 },
      { name: "PKGiP", full: "Polska Konfederacja – Godność i Praca", bloc: "lewica", start: 0.07 },
      { name: "NOP", full: "Narodowe Odrodzenie Polski", bloc: "skrajna_prawica", start: 0.06 },
      { name: "SP", full: "Stronnictwo Pracy", bloc: "centrum", start: 0.01 },
    ],
  },
  {
    key: "prezydent2005",
    label: "Wybory prezydenckie 2005",
    sub: "październik 2005",
    startDate: { month: 10, year: 2005 },
    president: { name: "Lech Kaczyński", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 10, year: 2007 },
      samorzad: { month: 11, year: 2006 },
      europarlament: { month: 6, year: 2009 },
      prezydent: { month: 6, year: 2010 },
    },
    parties: [
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 36.33 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 33.1 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 15.11 },
      { name: "SDPL", full: "Socjaldemokracja Polska", bloc: "centrolewica", start: 10.33 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 1.8 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 1.43 },
      { name: "PD", full: "Partia Demokratyczna – demokraci.pl", bloc: "centrum", start: 1.26 },
      { name: "PUG", full: "Polska Unia Gospodarcza", bloc: "centrum", start: 0.16 },
      { name: "PPN", full: "Polska Partia Narodowa", bloc: "centrum", start: 0.13 },
      { name: "ONP-LP", full: "Organizacja Narodu Polskiego – Liga Polska", bloc: "centroprawica", start: 0.07 },
      { name: "PKGiP", full: "Polska Konfederacja – Godność i Praca", bloc: "lewica", start: 0.06 },
    ],
  },
  {
    key: "samorzad2006",
    label: "Wybory samorządowe 2006",
    sub: "listopad 2006",
    startDate: { month: 11, year: 2006 },
    president: { name: "Lech Kaczyński", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 10, year: 2007 },
      samorzad: { month: 11, year: 2010 },
      europarlament: { month: 6, year: 2009 },
      prezydent: { month: 6, year: 2010 },
    },
    parties: [
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 27.35 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 25.12 },
      { name: "LiD", full: "Lewica i Demokraci", bloc: "centrolewica", start: 14.36 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 13.09 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 5.55 },
      { name: "LPR", full: "Liga Polskich Rodzin", bloc: "prawica", start: 4.71 },
      { name: "KPEiR", full: "Krajowa Partia Emerytów i Rencistów", bloc: "lewica", start: 2.97 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 1.22 },
      { name: "PPP", full: "Polska Partia Pracy – Sierpień 80", bloc: "lewica", start: 1.12 },
      { name: "SP", full: "Samoobrona Patriotyczna", bloc: "prawica", start: 0.64 },
      { name: "RAŚ", full: "Ruch Autonomii Śląska/Ruch Autōnōmije Ślōnska", bloc: "lewica", start: 0.52 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.41, minority: true },
      { name: "Porozumienie Samorządowe", full: "Porozumienie Samorządowe W. Lubawski", bloc: "centroprawica", start: 0.35 },
      { name: "NOP", full: "Narodowe Odrodzenie Polski", bloc: "skrajna_prawica", start: 0.34 },
      { name: "ChRS", full: "Chrześcijański Ruch Samorządowy", bloc: "centrum", start: 0.33 },
      { name: "ONP", full: "Obrona Narodu Polskiego", bloc: "prawica", start: 0.18 },
      { name: "PKGiP", full: "Polska Konfederacja – Godność i Praca", bloc: "lewica", start: 0.16 },
      { name: "KPN", full: "Konfederacja Polski Niepodległej", bloc: "prawica", start: 0.01 },
    ],
  },
  {
    key: "sejm2007",
    label: "Wybory parlamentarne 2007",
    sub: "październik 2007",
    startDate: { month: 10, year: 2007 },
    president: { name: "Lech Kaczyński", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 10, year: 2011 },
      samorzad: { month: 11, year: 2010 },
      europarlament: { month: 6, year: 2009 },
      prezydent: { month: 6, year: 2010 },
    },
    parties: [
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 41.5 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 32.1 },
      { name: "LiD", full: "Lewica i Demokraci", bloc: "centrolewica", start: 13.2 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 8.9 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.2, minority: true },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 1.53 },
      { name: "LPR", full: "Liga Polskich Rodzin", bloc: "prawica", start: 1.3 },
      { name: "PPP", full: "Polska Partia Pracy-Sierpień 80", bloc: "lewica", start: 0.99 },
      { name: "PK", full: "Partia Kobiet", bloc: "centrum", start: 0.28 },
      { name: "SP", full: "Samoobrona Patriotyczna", bloc: "prawica", start: 0.02 },
    ],
  },
  {
    key: "europarlament2009",
    label: "Wybory europarlamentarne 2009",
    sub: "czerwiec 2009",
    startDate: { month: 6, year: 2009 },
    president: { name: "Lech Kaczyński", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 10, year: 2011 },
      samorzad: { month: 11, year: 2010 },
      europarlament: { month: 5, year: 2014 },
      prezydent: { month: 6, year: 2010 },
    },
    parties: [
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 44.43 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 27.4 },
      { name: "SLD-UP", full: "Sojusz Lewicy Demokratycznej-Unia Pracy", bloc: "centrolewica", start: 12.34 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 7.01 },
      { name: "PdP-CL", full: "Porozumienie dla Przyszłości – CentroLewica", bloc: "centrolewica", start: 2.44 },
      { name: "PR", full: "Prawica Rzeczypospolitej", bloc: "prawica", start: 1.95 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 1.46 },
      { name: "LP", full: "Libertas Polska", bloc: "centrum", start: 1.14 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 1.1 },
      { name: "PPP", full: "Polska Partia Pracy – Sierpień 80", bloc: "lewica", start: 0.7 },
      { name: "NPP", full: "Naprzód Polsko-Piast", bloc: "centrum", start: 0.02 },
      { name: "PPS", full: "Polska Partia Socjalistyczna", bloc: "lewica", start: 0.02 },
    ],
  },
  {
    key: "prezydent2010",
    label: "Wybory prezydenckie 2010",
    sub: "czerwiec 2010",
    startDate: { month: 6, year: 2010 },
    president: { name: "Bronisław Komorowski", note: "Platforma Obywatelska" },
    schedule: {
      sejm: { month: 10, year: 2011 },
      samorzad: { month: 11, year: 2010 },
      europarlament: { month: 5, year: 2014 },
      prezydent: { month: 5, year: 2015 },
    },
    parties: [
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 41.54 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 36.46 },
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 13.68 },
      { name: "WiP", full: "Wolność i Praworządność", bloc: "centrum", start: 2.48 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 1.75 },
      { name: "SD", full: "Stronnictwo Demokratyczne", bloc: "centrolewica", start: 1.44 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 1.28 },
      { name: "PR", full: "Prawica Rzeczypospolitej", bloc: "prawica", start: 1.06 },
      { name: "PPP", full: "Polska Partia Pracy – Sierpień 80", bloc: "lewica", start: 0.18 },
      { name: "SW", full: "Solidarność Walcząca", bloc: "centrum", start: 0.13 },
    ],
  },
  {
    key: "samorzad2010",
    label: "Wybory samorządowe 2010",
    sub: "listopad 2010",
    startDate: { month: 11, year: 2010 },
    president: { name: "Bronisław Komorowski", note: "Platforma Obywatelska" },
    schedule: {
      sejm: { month: 10, year: 2011 },
      samorzad: { month: 11, year: 2014 },
      europarlament: { month: 5, year: 2014 },
      prezydent: { month: 5, year: 2015 },
    },
    parties: [
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 30.89 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 23.05 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 16.3 },
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 15.2 },
      { name: "KPEiR", full: "Krajowa Partia Emerytów i Rencistów", bloc: "lewica", start: 1.82 },
      { name: "ODŚ", full: "Obywatelski Dolny Śląsk", bloc: "centroprawica", start: 1.64 },
      { name: "WiP", full: "Wolność i Praworządność", bloc: "centrum", start: 1.22 },
      { name: "PPP", full: "Polska Partia Pracy – Sierpień 80", bloc: "lewica", start: 1.18 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 1.05 },
      { name: "RAŚ", full: "Ruch Autonomii Śląska / Ruch Autōnōmije Ślōnska", bloc: "lewica", start: 0.97 },
      { name: "SDLP", full: "Socjaldemokracja Polska", bloc: "centrolewica", start: 0.72 },
      { name: "KWS", full: "Krajowa Wspólnota Samorządowa", bloc: "centrum", start: 0.71 },
      { name: "LPR", full: "Liga Polskich Rodzin", bloc: "prawica", start: 0.69 },
      { name: "PR", full: "Prawica Rzeczypospolitej", bloc: "prawica", start: 0.62 },
      { name: "WM", full: "Wspólnota Małopolska", bloc: "centrum", start: 0.54 },
      { name: "UPR", full: "Unia Polityki Realnej", bloc: "prawica", start: 0.44 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.42, minority: true },
      { name: "Porozumienie Samorządowe", full: "Porozumienie Samorządowe W. Lubawski", bloc: "centroprawica", start: 0.37 },
      { name: "NOP", full: "Narodowe Odrodzenie Polski", bloc: "skrajna_prawica", start: 0.24 },
      { name: "SP", full: "Stronnictwo Piast", bloc: "centroprawica", start: 0.24 },
      { name: "KPN-OP", full: "Konfederacja Polski Niepodległej – Obóz Patriotyczny", bloc: "centrum", start: 0.12 },
      { name: "PNP", full: "Przymierze Narodu Polskiego", bloc: "prawica", start: 0.1 },
      { name: "Polska P.", full: "Polska Patriotyczna", bloc: "centrum", start: 0.05 },
      { name: "ZS", full: "Związek Słowiański", bloc: "lewica", start: 0.04 },
      { name: "IO", full: "Inicjatywa Obywatelska", bloc: "centrum", start: 0.04 },
    ],
  },
  {
    key: "sejm2011",
    label: "Wybory parlamentarne 2011",
    sub: "październik 2011",
    startDate: { month: 10, year: 2011 },
    president: { name: "Bronisław Komorowski", note: "Platforma Obywatelska" },
    schedule: {
      sejm: { month: 10, year: 2015 },
      samorzad: { month: 11, year: 2014 },
      europarlament: { month: 5, year: 2014 },
      prezydent: { month: 5, year: 2015 },
    },
    parties: [
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 39.18 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 29.89 },
      { name: "RP", full: "Ruch Palikota", bloc: "centrum", start: 10.02 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 8.36 },
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 8.24 },
      { name: "PJN", full: "Polska jest Najważniejsza", bloc: "centroprawica", start: 2.19 },
      { name: "KNP", full: "Kongres Nowej Prawicy", bloc: "prawica", start: 1.06 },
      { name: "PPP", full: "Polska Partia Pracy – Sierpień 80", bloc: "lewica", start: 0.55 },
      { name: "PR", full: "Prawica Rzeczypospolitej", bloc: "prawica", start: 0.24 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.19, minority: true },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 0.07 },
    ],
  },
  {
    key: "europarlament2014",
    label: "Wybory europarlamentarne 2014",
    sub: "maj 2014",
    startDate: { month: 5, year: 2014 },
    president: { name: "Bronisław Komorowski", note: "Platforma Obywatelska" },
    schedule: {
      sejm: { month: 10, year: 2015 },
      samorzad: { month: 11, year: 2014 },
      europarlament: { month: 5, year: 2019 },
      prezydent: { month: 5, year: 2015 },
    },
    parties: [
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 32.13 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 31.78 },
      { name: "SLD-UP", full: "Sojusz Lewicy Demokratycznej-Unia Pracy", bloc: "centrolewica", start: 9.44 },
      { name: "KNP", full: "Kongres Nowej Prawicy", bloc: "prawica", start: 7.15 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 6.8 },
      { name: "SP", full: "Solidarna Polska", bloc: "prawica", start: 3.98 },
      { name: "RSEP", full: "Ruch Społeczny Europa Plus", bloc: "centrolewica", start: 3.58 },
      { name: "PR", full: "Polska Razem", bloc: "centroprawica", start: 3.16 },
      { name: "RN", full: "Ruch Narodowy", bloc: "skrajna_prawica", start: 1.4 },
      { name: "Zieloni", full: "Zieloni", bloc: "centrolewica", start: 0.32 },
      { name: "DB", full: "Demokracja Bezpośrednia", bloc: "centrum", start: 0.23 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 0.04 },
    ],
  },
  {
    key: "samorzad2014",
    label: "Wybory samorządowe 2014",
    sub: "listopad 2014",
    startDate: { month: 11, year: 2014 },
    president: { name: "Bronisław Komorowski", note: "Platforma Obywatelska" },
    schedule: {
      sejm: { month: 10, year: 2015 },
      samorzad: { month: 10, year: 2018 },
      europarlament: { month: 5, year: 2019 },
      prezydent: { month: 5, year: 2015 },
    },
    parties: [
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 26.89 },
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 26.29 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 23.88 },
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 8.79 },
      { name: "KNP", full: "Kongres Nowej Prawicy", bloc: "prawica", start: 3.89 },
      { name: "RN", full: "Ruch Narodowy", bloc: "skrajna_prawica", start: 1.57 },
      { name: "TR", full: "Twój Ruch", bloc: "prawica", start: 1 },
      { name: "RAŚ", full: "Ruch Autonomii Śląska / Ruch Autōnōmije Ślōnska", bloc: "lewica", start: 0.86 },
      { name: "BS", full: "Bezpartyjni Samorządowcy", bloc: "prawica", start: 0.85 },
      { name: "DB", full: "Demokracja Bezpośrednia", bloc: "centrum", start: 0.81 },
      { name: "Teraz Wielkopolska", full: "Teraz Wielkopolska", bloc: "centrum", start: 0.62 },
      { name: "BPZ", full: "Bezpartyjni Pomorze Zachodnie", bloc: "centrum", start: 0.4 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.35, minority: true },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 0.32 },
      { name: "LL", full: "Lepsze Lubuskie – Bezpartyjny Samorząd", bloc: "centrum", start: 0.29 },
      { name: "LPR", full: "Liga Polskich Rodzin", bloc: "prawica", start: 0.29 },
      { name: "NOP", full: "Narodowe Odrodzenie Polski", bloc: "skrajna_prawica", start: 0.15 },
      { name: "IO", full: "Inicjatywa Obywatelska", bloc: "centrum", start: 0.09 },
      { name: "Polska P.", full: "Polska Patriotyczna", bloc: "centrum", start: 0.06 },
      { name: "ZS", full: "Związek Słowiański", bloc: "lewica", start: 0.06 },
      { name: "SL Ojcowizna", full: "Stronnictwo Ludowe „Ojcowizna” RP", bloc: "centrum", start: 0.03 },
      { name: "SO", full: "Samoobrona Odrodzenie", bloc: "lewica", start: 0.01 },
    ],
  },
  {
    key: "prezydent2015",
    label: "Wybory prezydenckie 2015",
    sub: "maj 2015",
    startDate: { month: 5, year: 2015 },
    president: { name: "Andrzej Duda", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 10, year: 2015 },
      samorzad: { month: 10, year: 2018 },
      europarlament: { month: 5, year: 2019 },
      prezydent: { month: 6, year: 2020 },
    },
    parties: [
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 34.76 },
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 33.77 },
      { name: "KORWiN", full: "Koalicja Odnowy Rzeczypospolitej Wolność i Nadzieja", bloc: "skrajna_prawica", start: 3.26 },
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 2.38 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 1.6 },
      { name: "TR", full: "Twój Ruch", bloc: "prawica", start: 1.42 },
      { name: "KWWGB", full: "Komitet Wyborczy Wyborców Grzegorza Brauna „Szczęść Boże!”", bloc: "prawica", start: 0.83 },
      { name: "RN", full: "Ruch Narodowy", bloc: "skrajna_prawica", start: 0.52 },
      { name: "KNP", full: "Kongres Nowej Prawicy", bloc: "prawica", start: 0.46 },
      { name: "DB", full: "Demokracja Bezpośrednia", bloc: "centrum", start: 0.2 },
    ],
  },
  {
    key: "sejm2015",
    label: "Wybory parlamentarne 2015",
    sub: "październik 2015",
    startDate: { month: 10, year: 2015 },
    president: { name: "Andrzej Duda", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 10, year: 2019 },
      samorzad: { month: 10, year: 2018 },
      europarlament: { month: 5, year: 2019 },
      prezydent: { month: 6, year: 2020 },
    },
    parties: [
      { name: "ZP", full: "Zjednoczona Prawica", bloc: "centroprawica", start: 37.58 },
      { name: "PO", full: "Platforma Obywatelska", bloc: "centroprawica", start: 24.09 },
      { name: "K'15", full: "Kukiz'15", bloc: "prawica", start: 8.81 },
      { name: ".Nowoczesna", full: ".Nowoczesna", bloc: "centroprawica", start: 7.6 },
      { name: "ZL", full: "Zjednoczona Lewica", bloc: "centrolewica", start: 7.55 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 5.13 },
      { name: "KORWiN", full: "Koalicja Odnowy Rzeczypospolitej Wolność i Nadzieja", bloc: "skrajna_prawica", start: 4.76 },
      { name: "Razem", full: "Lewica Razem", bloc: "centrolewica", start: 3.62 },
      { name: "SPP", full: "Stonoga Partia Polska", bloc: "prawica", start: 0.28 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.18, minority: true },
      { name: "ZdŚ", full: "Zjednoczeni dla Śląska", bloc: "centrum", start: 0.12, minority: true },
      { name: "JOW", full: "JOW Bezpartyjni", bloc: "centrum", start: 0.1 },
      { name: "KWWGB", full: "Komitet Wyborczy Wyborców Grzegorza Brauna „Szczęść Boże!”", bloc: "prawica", start: 0.09 },
      { name: "KNP", full: "Kongres Nowej Prawicy", bloc: "prawica", start: 0.03 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 0.03 },
      { name: "RS RP", full: "Ruch Społeczny Rzeczypospolitej Polskiej", bloc: "lewica", start: 0.03 },
      { name: "OdP", full: "Obywatele do Parlamentu", bloc: "centrum", start: 0.01 },
    ],
  },
  {
    key: "samorzad2018",
    label: "Wybory samorządowe 2018",
    sub: "październik 2018",
    startDate: { month: 10, year: 2018 },
    president: { name: "Andrzej Duda", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 10, year: 2019 },
      samorzad: { month: 4, year: 2024 },
      europarlament: { month: 5, year: 2019 },
      prezydent: { month: 6, year: 2020 },
    },
    parties: [
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 34.13 },
      { name: "KO", full: "Koalicja Obywatelska", bloc: "centroprawica", start: 26.97 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 12.07 },
      { name: "SLD", full: "Sojusz Lewicy Demokratycznej", bloc: "centrolewica", start: 6.62 },
      { name: "K'15", full: "Kukiz'15", bloc: "prawica", start: 5.63 },
      { name: "BS", full: "Bezpartyjni Samorządowcy", bloc: "prawica", start: 5.28 },
      { name: "NN", full: "Nowa Nadzieja", bloc: "skrajna_prawica", start: 1.59 },
      { name: "Razem", full: "Partia Razem", bloc: "centrolewica", start: 1.57 },
      { name: "RN", full: "Ruch Narodowy", bloc: "skrajna_prawica", start: 1.26 },
      { name: "Zieloni", full: "Zieloni", bloc: "centrolewica", start: 1.15 },
      { name: "WiS", full: "Wolni i Solidarni", bloc: "prawica", start: 0.78 },
      { name: "ZDdDŚ", full: "Z Dutkiewiczem dla Dolnego Śląska", bloc: "centrum", start: 0.6 },
      { name: "ŚPR", full: "Ślōnskŏ Partyjŏ Regiōnalnŏ", bloc: "centrolewica", start: 0.38 },
      { name: "Ślonzoki Razem", full: "Ślonzoki Razem", bloc: "centrolewica", start: 0.37 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.34, minority: true },
      { name: "PŚ", full: "Projekt Świętokrzyskie", bloc: "centrum", start: 0.18 },
      { name: "ZChR", full: "Zjednoczenie Chrześcijańskich Rodzin", bloc: "prawica", start: 0.14 },
      { name: "IO", full: "Inicjatywa Obywatelska", bloc: "centrum", start: 0.09 },
      { name: "ZS", full: "Związek Słowiański", bloc: "lewica", start: 0.02 },
      { name: "SP", full: "Stronnictwo Pracy", bloc: "centrum", start: 0.01 },
    ],
  },
  {
    key: "europarlament2019",
    label: "Wybory europarlamentarne 2019",
    sub: "maj 2019",
    startDate: { month: 5, year: 2019 },
    president: { name: "Andrzej Duda", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 10, year: 2019 },
      samorzad: { month: 4, year: 2024 },
      europarlament: { month: 6, year: 2024 },
      prezydent: { month: 6, year: 2020 },
    },
    parties: [
      { name: "ZP", full: "Zjednoczona Prawica", bloc: "centroprawica", start: 45.38 },
      { name: "KE", full: "Koalicja Europejska", bloc: "centrum", start: 38.47 },
      { name: "Wiosna", full: "Wiosna", bloc: "centrolewica", start: 6.06 },
      { name: "KWiN", full: "Konfederacja Wolność i Niepodległość", bloc: "skrajna_prawica", start: 4.55 },
      { name: "K'15", full: "Kukiz'15", bloc: "prawica", start: 3.69 },
      { name: "Razem", full: "Lewica Razem", bloc: "centrolewica", start: 1.24 },
      { name: "PFP", full: "Polska Fair Play", bloc: "centroprawica", start: 0.54 },
      { name: "PolExit", full: "PolExit", bloc: "skrajna_prawica", start: 0.06 },
    ],
  },
  {
    key: "sejm2019",
    label: "Wybory parlamentarne 2019",
    sub: "październik 2019",
    startDate: { month: 10, year: 2019 },
    president: { name: "Andrzej Duda", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 10, year: 2023 },
      samorzad: { month: 4, year: 2024 },
      europarlament: { month: 6, year: 2024 },
      prezydent: { month: 6, year: 2020 },
    },
    parties: [
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 43.59 },
      { name: "KO", full: "Koalicja Obywatelska", bloc: "centroprawica", start: 27.4 },
      { name: "Lewica", full: "Lewica", bloc: "centrolewica", start: 12.56 },
      { name: "KP", full: "Koalicja Polska", bloc: "centrum", start: 8.55 },
      { name: "KWiN", full: "Konfederacja Wolność i Niepodległość", bloc: "skrajna_prawica", start: 6.81 },
      { name: "BS", full: "Bezpartyjni Samorządowcy", bloc: "prawica", start: 0.78 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.17, minority: true },
      { name: "Skuteczni", full: "Skuteczni Piotra Liroya-Marca", bloc: "prawica", start: 0.1 },
      { name: "AZER", full: "Akcja Zawiedzionych Emerytów Rencistów", bloc: "lewica", start: 0.03 },
      { name: "PR", full: "Prawica Rzeczypospolitej", bloc: "prawica", start: 0.01 },
    ],
  },
  {
    key: "prezydent2020",
    label: "Wybory prezydenckie 2020",
    sub: "czerwiec 2020",
    startDate: { month: 6, year: 2020 },
    president: { name: "Andrzej Duda", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 10, year: 2023 },
      samorzad: { month: 4, year: 2024 },
      europarlament: { month: 6, year: 2024 },
      prezydent: { month: 5, year: 2025 },
    },
    parties: [
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 43.5 },
      { name: "KO", full: "Koalicja Obywatelska", bloc: "centroprawica", start: 30.46 },
      { name: "KWiN", full: "Konfederacja Wolność i Niepodległość", bloc: "skrajna_prawica", start: 6.78 },
      { name: "PSL", full: "Polskie Stronnictwo Ludowe", bloc: "prawica", start: 2.36 },
      { name: "Lewica", full: "Lewica", bloc: "centrolewica", start: 2.22 },
      { name: "KNP", full: "Kongres Nowej Prawicy", bloc: "prawica", start: 0.23 },
      { name: "FdR", full: "Federacja dla Rzeczypospolitej", bloc: "prawica", start: 0.17 },
      { name: "UP", full: "Unia Pracy", bloc: "centrolewica", start: 0.14 },
      { name: "RPE", full: "Ruch Prawdziwa Europa – Europa Christi", bloc: "prawica", start: 0.11 },
    ],
  },
  {
    key: "sejm2023",
    label: "Wybory parlamentarne 2023",
    sub: "październik 2023",
    startDate: { month: 10, year: 2023 },
    president: { name: "Andrzej Duda", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 11, year: 2027 },
      samorzad: { month: 4, year: 2024 },
      europarlament: { month: 6, year: 2024 },
      prezydent: { month: 5, year: 2025 },
    },
    parties: [
      { name: "ZP", full: "Zjednoczona Prawica", bloc: "centroprawica", start: 35.38 },
      { name: "KO", full: "Koalicja Obywatelska", bloc: "centroprawica", start: 30.7 },
      { name: "TD", full: "Trzecia Droga", bloc: "centroprawica", start: 14.4 },
      { name: "Lewica", full: "Lewica", bloc: "centrolewica", start: 8.61 },
      { name: "KWiN", full: "Konfederacja", bloc: "skrajna_prawica", start: 7.16 },
      { name: "BS", full: "Bezpartyjni Samorządowcy", bloc: "prawica", start: 1.86 },
      { name: "PJJ", full: "Polska Jest Jedna", bloc: "prawica", start: 1.63 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.12, minority: true },
      { name: "RDiP", full: "Ruch Dobrobytu i Pokoju", bloc: "lewica", start: 0.12 },
      { name: "NK", full: "Normalny Kraj", bloc: "prawica", start: 0.02 },
      { name: "RNP", full: "Ruch Naprawy Polski", bloc: "prawica", start: 0.01 },
    ],
  },
  {
    key: "samorzad2024",
    label: "Wybory samorządowe 2024",
    sub: "kwiecień 2024",
    startDate: { month: 4, year: 2024 },
    president: { name: "Andrzej Duda", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 11, year: 2027 },
      samorzad: { month: 4, year: 2029 },
      europarlament: { month: 6, year: 2024 },
      prezydent: { month: 5, year: 2025 },
    },
    parties: [
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 34.27 },
      { name: "KO", full: "Koalicja Obywatelska", bloc: "centroprawica", start: 30.59 },
      { name: "TD", full: "Trzecia Droga", bloc: "centroprawica", start: 14.25 },
      { name: "KWiN", full: "Konfederacja", bloc: "skrajna_prawica", start: 7.23 },
      { name: "Lewica", full: "Lewica", bloc: "centrolewica", start: 6.32 },
      { name: "BS", full: "Bezpartyjni Samorządowcy", bloc: "prawica", start: 3.01 },
      { name: "OK Polska", full: "Koalicja Samorządowa „OK Polska”", bloc: "centrolewica", start: 1.15 },
      { name: "NK", full: "Normalny Kraj", bloc: "prawica", start: 0.6 },
      { name: "KWMN", full: "Komitet Wyborczy Mniejszość Niemiecka", bloc: "centrum", start: 0.37, minority: true },
      { name: "PL!SP", full: "Polska Liberalna Strajk Przedsiębiorców", bloc: "centrum", start: 0.36 },
      { name: "RAŚ", full: "Ruch Autonomii Śląska/ Ruch Autōnōmije Ślōnska", bloc: "lewica", start: 0.35 },
      { name: "Ślonzoki Razem", full: "Ślonzoki Razem", bloc: "centrolewica", start: 0.25 },
      { name: "RNP", full: "Ruch Naprawy Polski", bloc: "prawica", start: 0.24 },
      { name: "SLD", full: "Stowarzyszenie Lewicy Demokratycznej", bloc: "centrolewica", start: 0.09 },
      { name: "ZS", full: "Związek Słowiański", bloc: "lewica", start: 0.08 },
      { name: "SRP", full: "Samoobrona Rzeczpospolitej Polskiej", bloc: "lewica", start: 0.05 },
      { name: "IO", full: "Inicjatywa Obywatelska", bloc: "centrum", start: 0.04 },
    ],
  },
  {
    key: "europarlament2024",
    label: "Wybory europarlamentarne 2024",
    sub: "czerwiec 2024",
    startDate: { month: 6, year: 2024 },
    president: { name: "Andrzej Duda", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 11, year: 2027 },
      samorzad: { month: 4, year: 2029 },
      europarlament: { month: 6, year: 2029 },
      prezydent: { month: 5, year: 2025 },
    },
    parties: [
      { name: "KO", full: "Koalicja Obywatelska", bloc: "centroprawica", start: 37.06 },
      { name: "ZP", full: "Zjednoczona Prawica", bloc: "centroprawica", start: 36.16 },
      { name: "KWiN", full: "Konfederacja Wolność i Niepodległość", bloc: "skrajna_prawica", start: 12.08 },
      { name: "TD", full: "Trzecia Droga", bloc: "centroprawica", start: 6.91 },
      { name: "Lewica", full: "Lewica", bloc: "centrolewica", start: 6.3 },
      { name: "BS", full: "Bezpartyjni Samorządowcy", bloc: "prawica", start: 0.93 },
      { name: "PolExit", full: "PolExit", bloc: "skrajna_prawica", start: 0.25 },
      { name: "NK", full: "Normalny Kraj", bloc: "prawica", start: 0.17 },
      { name: "PL!SP", full: "Polska Liberalna Strajk Przedsiębiorców", bloc: "centrum", start: 0.08 },
      { name: "RNP", full: "Ruch Naprawy Polski", bloc: "prawica", start: 0.04 },
      { name: "GSP", full: "Głos Silnej Polski", bloc: "centrum", start: 0.02 },
    ],
  },
  {
    key: "prezydent2025",
    label: "Wybory prezydenckie 2025",
    sub: "maj 2025",
    startDate: { month: 5, year: 2025 },
    president: { name: "Karol Nawrocki", note: "Prawo i Sprawiedliwość" },
    schedule: {
      sejm: { month: 11, year: 2027 },
      samorzad: { month: 4, year: 2029 },
      europarlament: { month: 6, year: 2029 },
      prezydent: { month: 5, year: 2030 },
    },
    parties: [
      { name: "KO", full: "Koalicja Obywatelska", bloc: "centroprawica", start: 31.36 },
      { name: "PiS", full: "Prawo i Sprawiedliwość", bloc: "prawica", start: 29.54 },
      { name: "KWiN", full: "Konfederacja Wolność i Niepodległość", bloc: "skrajna_prawica", start: 14.81 },
      { name: "KKP", full: "Konfederacja Korony Polskiej", bloc: "skrajna_prawica", start: 6.34 },
      { name: "TD", full: "Trzecia Droga", bloc: "centroprawica", start: 4.99 },
      { name: "Razem", full: "Partia Razem", bloc: "centrolewica", start: 4.86 },
      { name: "Lewica", full: "Lewica", bloc: "centrolewica", start: 4.23 },
      { name: "SLD", full: "Stowarzyszenie Lewicy Demokratycznej", bloc: "centrolewica", start: 1.09 },
      { name: "DB", full: "Wolni Republikanie", bloc: "prawica", start: 0.77 },
      { name: "RDiP", full: "Ruch Dobrobytu i Pokoju", bloc: "lewica", start: 0.19 },
      { name: "BS", full: "Bezpartyjni Samorządowcy", bloc: "prawica", start: 0.09 },
    ],
  },
];

// Zbiorcza pula wszystkich partii występujących w powyższych szablonach historycznych
// (bez duplikatów po nazwie) — używana przez tryb "nowe partie" (losowe dołączanie
// partii spoza aktywnego szablonu) oraz przez generator losowego szablonu poniżej.
// Dodatkowe, nowe partie spoza szablonów historycznych — trafiają do tej samej puli
// (tryb "nowych partii" oraz szablon losowy). Część to realne ugrupowania z ostatnich lat,
// reszta to partie fikcyjne dla większej nieprzewidywalności sceny politycznej.
// ---------------------------------------------------------------------------
// SZABLON „KUMULACJA” — średnie poparcie ze wszystkich 30 scenariuszy
// ---------------------------------------------------------------------------
// Bierze UNIĘ wszystkich partii występujących w TEMPLATES. Dla każdej partii
// sumuje jej poparcie startowe ze wszystkich scenariuszy, w których występuje,
// a następnie dzieli tę sumę przez 30 — liczbę scenariuszy historycznych.
// Jeśli partia nie występuje w danym scenariuszu, jej udział w tej sumie wynosi 0.
const KUMULACJA_SCENARIO_COUNT = 30;

const KUMULACJA_TEMPLATE = (() => {
  const aggregated = new Map();

  TEMPLATES.forEach((tpl) => {
    tpl.parties.forEach((p) => {
      const existing = aggregated.get(p.name);
      if (existing) {
        existing.start += Number(p.start) || 0;
        existing.minority = existing.minority || !!p.minority;
      } else {
        aggregated.set(p.name, {
          name: p.name,
          full: p.full || p.name,
          bloc: p.bloc,
          start: Number(p.start) || 0,
          minority: !!p.minority,
        });
      }
    });
  });

  const parties = Array.from(aggregated.values())
    .map((p) => ({
      ...p,
      start: Math.round((p.start / KUMULACJA_SCENARIO_COUNT) * 100) / 100,
    }))
    .sort((a, b) => b.start - a.start);

  return {
    key: "kumulacja",
    label: "Kumulacja",
    sub: "średnie poparcie ze wszystkich 30 scenariuszy",
    startDate: { month: 1, year: 2025 },
    president: { name: "Prezydent RP", note: "scenariusz zbiorczy" },
    schedule: initialSchedule({ month: 1, year: 2025 }),
    parties,
    preservePollValues: true,
  };
})();

const EXTRA_PARTY_POOL = [
  { name: "PL2050", full: "Polska 2050", bloc: "centrum" },
  { name: "NL", full: "Nowa Lewica", bloc: "centrolewica" },
  { name: "Porozumienie", full: "Porozumienie", bloc: "centroprawica" },
  { name: "Republikanie", full: "Republikanie", bloc: "prawica" },
  { name: "TAK!", full: "Ruch Samorządowy Tak! Dla Polski", bloc: "centrum" },
  { name: "PPS+", full: "Polska Partia Socjalistyczna – Odnowa", bloc: "lewica" },
  { name: "RW", full: "Ruch Wolnościowy", bloc: "prawica" },
  { name: "ZR", full: "Zielona Rewolucja", bloc: "lewica" },
  { name: "UCP", full: "Unia Cyfrowa Polski", bloc: "centrum" },
  { name: "FNO", full: "Front Narodowej Odbudowy", bloc: "skrajna_prawica" },
  { name: "PRR", full: "Partia Rozsądku i Reform", bloc: "centroprawica" },
  { name: "LR", full: "Liga Regionów", bloc: "centrum" },
  { name: "SSP", full: "Sojusz Sprawiedliwości Społecznej", bloc: "centrolewica" },
  { name: "RWP", full: "Ruch Wolnych Polaków", bloc: "skrajna_prawica" },
  { name: "PRS", full: "Partia Rodziny i Społeczeństwa", bloc: "prawica" },
  { name: "AK", full: "Alternatywa Klimatyczna", bloc: "centrolewica" },
  { name: "UMP", full: "Unia Młodych Przedsiębiorców", bloc: "centroprawica" },
  { name: "FPL", full: "Front Pracy i Lewicy", bloc: "skrajna_lewica" },
  { name: "SOR", full: "Stowarzyszenie Obywatelskiej Reformy", bloc: "centrum" },
  { name: "KS", full: "Koalicja Seniorów", bloc: "centrum" },
  { name: "WP", full: "Wspólnota Podhala i Gór", bloc: "prawica" },
  { name: "PZR", full: "Partia Zrównoważonego Rozwoju", bloc: "centrolewica" },
  { name: "NRP", full: "Narodowy Ruch Patriotyczny", bloc: "skrajna_prawica" },
  { name: "KRL", full: "Komitet Robotniczej Lewicy", bloc: "skrajna_lewica" },
];

const GLOBAL_PARTY_POOL = (() => {
  const seen = new Map();
  TEMPLATES.forEach((tpl) => {
    tpl.parties.forEach((p) => {
      if (!seen.has(p.name)) seen.set(p.name, p);
    });
  });
  EXTRA_PARTY_POOL.forEach((p) => {
    if (!seen.has(p.name)) seen.set(p.name, p);
  });
  return Array.from(seen.values());
})();

// Pula do wyszukiwarki partii na ekranie konfiguracji: wszystkie partie dostępne
// w szablonach (+ dodatkowe), z domyślnym poparciem = średnia z „Kumulacji”
// (partie spoza szablonów historycznych dostają 1%).
const KUMULACJA_AVG_BY_NAME = Object.fromEntries(KUMULACJA_TEMPLATE.parties.map((p) => [p.name, p.start]));
const SEARCHABLE_PARTY_POOL = GLOBAL_PARTY_POOL.map((p) => ({
  name: p.name,
  full: p.full || p.name,
  bloc: p.bloc,
  minority: !!p.minority,
  avg: Math.max(0.01, KUMULACJA_AVG_BY_NAME[p.name] ?? 1),
}));

function searchNormalize(str) {
  return String(str || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
}

// Generator całkowicie fikcyjnych partii — losowe połączenie członu organizacyjnego
// i hasła programowego, z blokiem ideologicznym dopasowanym do hasła.
const FICTIONAL_PARTY_FORMS = ["Partia", "Ruch", "Sojusz", "Unia", "Front", "Forum", "Koalicja", "Stronnictwo"];
const FICTIONAL_PARTY_THEMES = [
  { text: "Nowej Polski", bloc: "centrum" },
  { text: "Wolnych Obywateli", bloc: "prawica" },
  { text: "Zielonej Przyszłości", bloc: "centrolewica" },
  { text: "Sprawiedliwości Społecznej", bloc: "lewica" },
  { text: "Rodzin i Tradycji", bloc: "prawica" },
  { text: "Cyfrowego Rozwoju", bloc: "centroprawica" },
  { text: "Polskiej Wsi", bloc: "centrum" },
  { text: "Suwerennej Polski", bloc: "skrajna_prawica" },
  { text: "Pracy i Godności", bloc: "lewica" },
  { text: "Wielkich Miast", bloc: "centrolewica" },
  { text: "Przedsiębiorczych", bloc: "centroprawica" },
  { text: "Radykalnej Zmiany", bloc: "skrajna_lewica" },
  { text: "Ziem Zachodnich", bloc: "centrum" },
  { text: "Narodowego Odrodzenia", bloc: "skrajna_prawica" },
  { text: "Mieszkań dla Wszystkich", bloc: "centrolewica" },
  { text: "Bezpieczeństwa Obywateli", bloc: "prawica" },
];

function generateFictionalParty(existingNames) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const form = pickOne(FICTIONAL_PARTY_FORMS);
    const theme = pickOne(FICTIONAL_PARTY_THEMES);
    const full = `${form} ${theme.text}`;
    const abbr = full
      .split(" ")
      .map((w) => w[0].toUpperCase())
      .join("");
    if (!existingNames.has(abbr) && !existingNames.has(full)) {
      return { name: abbr, full, bloc: theme.bloc };
    }
  }
  const n = Math.floor(Math.random() * 900) + 100;
  return { name: `NP${n}`, full: `Nowa Partia ${n}`, bloc: pickOne(BLOC_KEYS) };
}

// ---------------------------------------------------------------------------
// NIEPRZEWIDYWALNE WYDARZENIA LOSOWE (poziom całej sceny politycznej)
// ---------------------------------------------------------------------------
// Działają niezależnie od pojedynczych szoków z maybeShock(): dotyczą rządu,
// opozycji, całych bloków ideologicznych, rozłamów i fuzji partii oraz rzadkich
// "czarnych łabędzi". Każde wydarzenie zwraca zaktualizowane sondaże i opis do
// kroniki; może też dopisać nową partię do registry (rozłam, outsider).

function applyPollDeltas(polls, deltas) {
  const next = { ...polls };
  Object.keys(deltas).forEach((id) => {
    if (next[id] !== undefined) next[id] = Math.max(0.05, next[id] + deltas[id]);
  });
  return normalize(next);
}

function rr(min, max) {
  return min + Math.random() * (max - min);
}

function partiesInBlocs(ctx, blocs) {
  return ctx.active.filter((p) => blocs.includes(p.bloc)).map((p) => p.id);
}

function spreadDelta(ids, min, max, sign = 1) {
  const out = {};
  ids.forEach((id) => { out[id] = sign * rr(min, max); });
  return out;
}

function registerNewParty(ctx, def, startShare) {
  const id = uniqueId(slugify(def.name), Object.keys(ctx.registry));
  const color = randomColor(Object.values(ctx.registry).map((p) => p.color));
  ctx.registry[id] = { id, name: def.name, full: def.full, color, bloc: def.bloc, minority: false };
  const polls = addPollEntry(ctx.polls, id, startShare);
  return { id, polls };
}

const RANDOM_WORLD_EVENTS = [
  {
    id: "economic_crisis", weight: 3,
    apply: (ctx) => {
      const gov = ctx.govIds.length ? spreadDelta(ctx.govIds, 1.5, 4, -1) : {};
      const opp = spreadDelta(ctx.oppIds, 0.3, 1.2, 1);
      return { polls: applyPollDeltas(ctx.polls, { ...opp, ...gov }), note: "Nagłe załamanie gospodarcze — rząd traci w sondażach, opozycja korzysta." };
    },
  },
  {
    id: "economic_boom", weight: 2,
    apply: (ctx) => {
      if (!ctx.govIds.length) return null;
      return { polls: applyPollDeltas(ctx.polls, spreadDelta(ctx.govIds, 1, 3, 1)), note: "Nieoczekiwany boom gospodarczy umacnia pozycję partii rządzących." };
    },
  },
  {
    id: "security_crisis", weight: 2,
    apply: (ctx) => {
      const right = spreadDelta(partiesInBlocs(ctx, RIGHT_AXIS_BLOCS), 0.6, 2.5, 1);
      const left = spreadDelta(partiesInBlocs(ctx, ["skrajna_lewica", "lewica"]), 0.3, 1.2, -1);
      return { polls: applyPollDeltas(ctx.polls, { ...left, ...right }), note: "Kryzys bezpieczeństwa u granic — wyborcy skłaniają się ku ugrupowaniom twardej ręki." };
    },
  },
  {
    id: "mass_protests", weight: 2,
    apply: (ctx) => {
      const gov = ctx.govIds.length ? spreadDelta(ctx.govIds, 1, 3, -1) : {};
      const edges = spreadDelta(partiesInBlocs(ctx, ["skrajna_lewica", "skrajna_prawica"]), 0.4, 1.5, 1);
      return { polls: applyPollDeltas(ctx.polls, { ...edges, ...gov }), note: "Masowe protesty na ulicach miast osłabiają rząd i wzmacniają ugrupowania antysystemowe." };
    },
  },
  {
    id: "migration_crisis", weight: 2,
    apply: (ctx) => {
      const right = spreadDelta(partiesInBlocs(ctx, ["prawica", "skrajna_prawica"]), 1, 3.5, 1);
      const left = spreadDelta(partiesInBlocs(ctx, ["lewica", "centrolewica"]), 0.3, 1.5, -1);
      return { polls: applyPollDeltas(ctx.polls, { ...left, ...right }), note: "Kryzys migracyjny rozpala debatę publiczną i podbija notowania partii prawicowych." };
    },
  },
  {
    id: "climate_disaster", weight: 1,
    apply: (ctx) => {
      const left = spreadDelta(partiesInBlocs(ctx, ["lewica", "centrolewica"]), 0.6, 2.2, 1);
      const gov = ctx.govIds.length ? spreadDelta(ctx.govIds, 0.3, 1.2, -1) : {};
      return { polls: applyPollDeltas(ctx.polls, { ...left, ...gov }), note: "Klęska żywiołowa (powódź/susza) przesuwa debatę ku polityce klimatycznej i pomocy państwa." };
    },
  },
  {
    id: "polarization_wave", weight: 1,
    apply: (ctx) => {
      const edges = spreadDelta(partiesInBlocs(ctx, ["skrajna_lewica", "skrajna_prawica", "lewica", "prawica"]), 0.4, 1.6, 1);
      const center = spreadDelta(partiesInBlocs(ctx, ["centrum", "centrolewica", "centroprawica"]), 0.3, 1.2, -1);
      return { polls: applyPollDeltas(ctx.polls, { ...center, ...edges }), note: "Fala polaryzacji — wyborcy uciekają z centrum ku silniejszym, skrajniejszym przekazom." };
    },
  },
  {
    id: "leader_resigns", weight: 2,
    apply: (ctx) => {
      const p = pickOne(ctx.active);
      return { polls: applyPollDeltas(ctx.polls, { [p.id]: -rr(1.5, 4) }), note: `Niespodziewana rezygnacja lidera partii ${p.full} pogrąża ugrupowanie w chaosie.` };
    },
  },
  {
    id: "new_charismatic_leader", weight: 2,
    apply: (ctx) => {
      const p = pickOne(ctx.active);
      return { polls: applyPollDeltas(ctx.polls, { [p.id]: rr(1.5, 4.5) }), note: `Charyzmatyczny nowy lider elektryzuje wyborców — ${p.full} zyskuje w sondażach.` };
    },
  },
  {
    id: "major_scandal", weight: 2, major: true,
    apply: (ctx) => {
      const sorted = [...ctx.active].sort((a, b) => ctx.polls[b.id] - ctx.polls[a.id]);
      const p = Math.random() < 0.6 ? sorted[0] : pickOne(ctx.active);
      return { polls: applyPollDeltas(ctx.polls, { [p.id]: -rr(3, 7) }), note: `Gigantyczna afera wstrząsa ${p.full} — dziennikarze ujawniają kolejne materiały.` };
    },
  },
  {
    id: "party_split", weight: 2, major: true,
    condition: (ctx) => ctx.active.some((p) => (ctx.polls[p.id] || 0) >= 6),
    apply: (ctx) => {
      const eligible = ctx.active.filter((p) => (ctx.polls[p.id] || 0) >= 6);
      const parent = pickOne(eligible);
      const share = rr(0.25, 0.45);
      const taken = ctx.polls[parent.id] * share;
      const names = new Set(Object.values(ctx.registry).map((p) => p.name));
      let newName = `Nowa ${parent.name}`;
      let k = 2;
      while (names.has(newName)) newName = `Nowa ${parent.name} ${k++}`;
      // rozłamowcy zwykle przesuwają się o jeden stopień na osi ideologicznej
      const rank = BLOC_RANK[parent.bloc] ?? 3;
      const shift = Math.random() < 0.5 ? -1 : 1;
      const newBloc = BLOC_KEYS[clamp(rank + (Math.random() < 0.4 ? shift : 0), 0, BLOC_KEYS.length - 1)];
      const { id, polls } = registerNewParty(ctx, { name: newName, full: `Nowa ${parent.full} (rozłamowcy)`, bloc: newBloc }, taken);
      // addPollEntry zabiera proporcjonalnie wszystkim — dociągamy część od macierzystej partii
      const adjusted = applyPollDeltas(polls, { [parent.id]: -taken * 0.6 });
      return { polls: adjusted, note: `Rozłam w partii ${parent.full}! Grupa rozłamowców zakłada nowe ugrupowanie „${ctx.registry[id].full}”.`, createdPartyId: id };
    },
  },
  {
    id: "party_merger", weight: 1, major: true,
    condition: (ctx) => {
      if (ctx.active.length < 4) return false;
      return ctx.active.some((a) => ctx.active.some((b) => a.id !== b.id && a.bloc === b.bloc &&
        (ctx.polls[a.id] || 0) < 8 && (ctx.polls[b.id] || 0) < 8 &&
        !ctx.protectedIds.includes(a.id) && !ctx.protectedIds.includes(b.id)));
    },
    apply: (ctx) => {
      const pairs = [];
      ctx.active.forEach((a) => ctx.active.forEach((b) => {
        if (a.id < b.id && a.bloc === b.bloc && (ctx.polls[a.id] || 0) < 8 && (ctx.polls[b.id] || 0) < 8 &&
          !ctx.protectedIds.includes(a.id) && !ctx.protectedIds.includes(b.id)) pairs.push([a, b]);
      }));
      if (!pairs.length) return null;
      const [x, y] = pickOne(pairs);
      const [big, small] = (ctx.polls[x.id] || 0) >= (ctx.polls[y.id] || 0) ? [x, y] : [y, x];
      const merged = { ...ctx.polls, [big.id]: ctx.polls[big.id] + ctx.polls[small.id] * rr(0.9, 1.15) };
      delete merged[small.id];
      return { polls: normalize(merged), note: `Fuzja: ${small.full} łączy się z ${big.full} — ugrupowanie ${small.name} znika z sondaży.` };
    },
  },
  {
    id: "black_swan_outsider", weight: 1, major: true,
    apply: (ctx) => {
      const names = new Set(Object.values(ctx.registry).map((p) => p.name));
      const def = generateFictionalParty(names);
      const { id, polls } = registerNewParty(ctx, def, rr(4, 9));
      return { polls, note: `Czarny łabędź: znikąd wyłania się ruch outsiderów „${ctx.registry[id].full}” i z miejsca zdobywa duże poparcie.`, createdPartyId: id };
    },
  },
  {
    id: "black_swan_collapse", weight: 1, major: true,
    apply: (ctx) => {
      const biggest = [...ctx.active].sort((a, b) => ctx.polls[b.id] - ctx.polls[a.id])[0];
      return { polls: applyPollDeltas(ctx.polls, { [biggest.id]: -rr(6, 10) }), note: `Czarny łabędź: dramatyczny kryzys uderza w największą partię — ${biggest.full} traci grunt pod nogami.` };
    },
  },
];

// Losuje (ważone) jedno dostępne wydarzenie i je stosuje. Zwraca
// { polls, notes: [{text, major}] } albo null, jeśli nic się nie wydarzyło.
function rollRandomWorldEvent(polls, registry, government, protectedIds = []) {
  const active = Object.keys(polls).filter((id) => registry[id]).map((id) => registry[id]);
  if (active.length < 2) return null;
  const govIds = ((government && government.coalition) || []).filter((id) => polls[id] !== undefined);
  const oppIds = active.map((p) => p.id).filter((id) => !govIds.includes(id));
  const ctx = { polls, registry, active, govIds, oppIds, protectedIds };
  const candidates = RANDOM_WORLD_EVENTS.filter((e) => !e.condition || e.condition(ctx));
  const weighted = [];
  candidates.forEach((e) => { for (let i = 0; i < (e.weight || 1); i++) weighted.push(e); });
  if (!weighted.length) return null;
  const evt = pickOne(weighted);
  const result = evt.apply(ctx);
  if (!result) return null;
  return { polls: result.polls, notes: [{ text: result.note, major: !!evt.major, id: evt.id }] };
}

function pickRandom(arr, n) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

// Generuje "losowy szablon": bierze od 6 do 12 losowych partii z całej historii
// (z dowolnych szablonów), losuje im nowe poparcie startowe (normalizowane do 100%)
// oraz losową datę startu i harmonogram kolejnych wyborów w typowych odstępach.
function buildRandomTemplate() {
  const count = 6 + Math.floor(Math.random() * 7); // 6..12
  const chosen = pickRandom(GLOBAL_PARTY_POOL, count).map((p) => ({
    name: p.name,
    full: p.full,
    bloc: p.bloc,
    start: Math.round((2 + Math.random() * 38) * 100) / 100,
    minority: false,
  }));
  const year = 1991 + Math.floor(Math.random() * 34);
  const month = 1 + Math.floor(Math.random() * 12);
  const startDate = { month, year };
  return {
    key: `losowy_${Date.now()}`,
    label: "Szablon losowy",
    sub: `wygenerowano dla ${MONTHS_PL[month - 1]} ${year}`,
    startDate,
    president: { name: "Prezydent RP", note: "losowy punkt startowy" },
    schedule: initialSchedule(startDate),
    parties: chosen,
  };
}


// Rozwijana tabela z wynikiem procentowym każdej partii w każdym z 16
// województw — używana we wszystkich typach wyborów (nie tylko samorządowych),
// ponieważ regionalne zróżnicowanie poparcia dotyczy każdego głosowania.
function RegionalResultsTable({ regionalResults, registry, regionalWinners, lookup, title, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  if (!regionalResults) return null;
  const resolve = lookup || ((id) => registry[id]);
  const regions = Object.keys(regionalResults);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2"
      >
        {open ? `Ukryj ${title || "wyniki według województw"}` : `Pokaż ${title || "wyniki według województw"}`}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
          {regions.map((region) => {
            const results = regionalResults[region];
            const sortedIds = Object.keys(results)
              .filter((id) => resolve(id))
              .sort((a, b) => results[b] - results[a])
              .slice(0, 6);
            const winnerId = regionalWinners ? regionalWinners[region] : sortedIds[0];
            return (
              <div key={region} className="bg-slate-950 border border-slate-800 rounded-md p-2.5">
                <p className="text-xs text-slate-300 font-medium mb-1.5">{region}</p>
                <div className="space-y-1">
                  {sortedIds.map((id) => (
                    <div key={id} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: resolve(id).color }} />
                      <span className={id === winnerId ? "text-slate-100 font-medium" : "text-slate-500"}>{resolve(id).name || resolve(id).full}</span>
                      <span className="ml-auto font-mono text-slate-500">{results[id].toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TurnoutBadge({ turnout }) {
  if (!Number.isFinite(turnout)) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-full px-2.5 py-1">
      Frekwencja ogólnopolska: <span className="font-mono text-slate-200">{turnout}%</span>
    </span>
  );
}

// Zwraca dane do wyświetlenia kandydata w wyborach prezydenckich — obsługuje
// zarówno zwykłe partie z registry, jak i wirtualną kandydaturę gracza
// (id "__player__"), która nie ma odpowiednika w registry.
function candidateDisplay(id, registry, player) {
  if (id === "__player__") {
    const label = player ? `${player.name} (Twoja kandydatura)` : "Kandydat niezależny";
    return { name: label, full: label, color: "#f43f5e" };
  }
  return registry[id] || { name: id, full: id, color: "#64748b" };
}

function ElectionCard({ entry, registry, player }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-serif text-lg text-slate-50">{ELECTION_TITLES[entry.type]}</h3>
        <span className="text-slate-500 font-mono text-sm">{entry.date}</span>
      </div>

      {Number.isFinite(entry.turnout) && (
        <div className="mb-3">
          <TurnoutBadge turnout={entry.turnout} />
        </div>
      )}

      {entry.type === "sejm" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SeatTable seats={entry.sejmSeats} total={entry.sejmSeatsTotal || SEJM_SEATS} title="Sejm" registry={registry} />
            <SeatTable seats={entry.senatSeats} total={SENAT_SEATS} title="Senat" registry={registry} />
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-md p-3 text-sm">
            <p className="text-slate-300">
              <span className="text-slate-500">Utworzony rząd:</span> {entry.government.label} —{" "}
              {entry.government.coalition.map((id) => registry[id]?.name || id).join(" + ")} ({entry.government.total}/{entry.sejmSeatsTotal || SEJM_SEATS})
            </p>
            <p className="text-slate-500 mt-0.5">Premier: {entry.government.pm ? registry[entry.government.pm]?.full : "brak"}</p>
          </div>
          <RegionalResultsTable regionalResults={entry.regionalResults} registry={registry} />
          <PollSnapshot polls={entry.polls} registry={registry} />
        </div>
      )}

      {entry.type === "europarlament" && (
        <div className="space-y-3">
          <SeatTable seats={entry.epSeats} total={EP_SEATS} title="Parlament Europejski" registry={registry} />
          <RegionalResultsTable regionalResults={entry.regionalResults} registry={registry} />
          <PollSnapshot polls={entry.polls} registry={registry} />
        </div>
      )}

      {entry.type === "samorzad" && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">Kontrolowane sejmiki (16)</p>
          <div className="flex flex-wrap gap-2">
            {Object.keys(entry.sejmikControl)
              .filter((id) => entry.sejmikControl[id] > 0 && registry[id])
              .sort((a, b) => entry.sejmikControl[b] - entry.sejmikControl[a])
              .map((id) => (
                <span key={id} className="px-3 py-1.5 rounded-full text-xs font-medium text-slate-950" style={{ backgroundColor: registry[id].color }}>
                  {registry[id].name}: {entry.sejmikControl[id]}
                </span>
              ))}
          </div>
          <RegionalResultsTable regionalResults={entry.regionalResults} registry={registry} regionalWinners={entry.regionalWinners} />
          <PollSnapshot polls={entry.polls} registry={registry} />
        </div>
      )}

      {entry.type === "prezydent" && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Wynik II tury (suma 100%)</p>
          <div className="flex flex-col gap-2 text-sm">
            {entry.finalistIds.map((id) => {
              const c = candidateDisplay(id, registry, player);
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                  <span className={id === entry.winnerId ? "text-slate-50 font-semibold" : "text-slate-400"}>
                    {c.full} {id === entry.winnerId ? "— zwycięzca" : ""}
                  </span>
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${entry.secondRoundResults[id]}%`, backgroundColor: c.color }} />
                  </div>
                  <span className="ml-auto font-mono text-slate-500">{pct(entry.secondRoundResults[id])}</span>
                </div>
              );
            })}
          </div>
          {entry.secondRoundRegionalResults && (
            <RegionalResultsTable
              regionalResults={entry.secondRoundRegionalResults}
              regionalWinners={entry.secondRoundRegionalWinners}
              lookup={(id) => candidateDisplay(id, registry, player)}
              title="wyniki II tury według województw"
            />
          )}
          <p className="text-xs uppercase tracking-wide text-slate-500 pt-1">Sondaż ogólny w dniu wyborów (I tura, wszystkie partie)</p>
          <RegionalResultsTable regionalResults={entry.regionalResults} registry={registry} title="rozkład I tury (wszystkie partie) według województw" />
          <PollSnapshot polls={entry.polls} registry={registry} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KOMPONENT — EDYCJA POJEDYNCZEGO POPARCIA (Ustawienia)
// ---------------------------------------------------------------------------

function PollEditor({ id, value, onCommit }) {
  const [draft, setDraft] = useState(value.toFixed(2));

  useEffect(() => {
    setDraft(value.toFixed(2));
  }, [value]);

  function commit() {
    const parsed = parseFloat(String(draft).replace(",", "."));
    if (!isNaN(parsed) && Math.abs(parsed - value) > 0.001) {
      onCommit(id, parsed);
    } else {
      setDraft(value.toFixed(2));
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        step="0.01"
        min="0.01"
        max="99.98"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="w-20 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-sm text-right font-mono text-slate-200 focus:outline-none focus:border-red-500"
      />
      <span className="text-slate-500 text-xs">%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EKRAN KONFIGURACJI — dane wpisywane przez gracza przed startem gry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FORMULARZ KONTAKTOWY DLA BETATESTERÓW — wysyłka przez webhook Discorda
// ---------------------------------------------------------------------------
// UWAGA: adres webhooka jest widoczny w kodzie strony, więc każdy może go
// użyć. Jeśli ktoś zacznie spamować, wygeneruj nowy webhook w Discordzie
// (Edytuj kanał → Integracje → Webhooki) i podmień adres poniżej.
const FEEDBACK_WEBHOOK_URL = "https://discord.com/api/webhooks/1489393781680771133/SYjDin-ZhFAX8ejhoH3ptVyoGdD6bVTyfntjJhGbaobVRzkSSpO0Ow06tT73mnIrqyZk";
const FEEDBACK_COOLDOWN_MS = 30000;
const FEEDBACK_MAX_LEN = 1500;

const FEEDBACK_TYPES = [
  { id: "bug", label: "Zgłoszenie błędu", color: 0xef4444, placeholder: "Opisz, co poszło nie tak: co robiłeś/aś, czego się spodziewałeś/aś, co się stało zamiast tego..." },
  { id: "idea", label: "Propozycja co dodać", color: 0x22c55e, placeholder: "Opisz pomysł na nową funkcję, partię, wydarzenie, zmianę balansu..." },
  { id: "collab", label: "Współpraca", color: 0x8b5cf6, placeholder: "Napisz, w czym chcesz pomóc lub co zaproponować (np. dane historyczne, grafika, kod, testy)..." },
];

function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("bug");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errorText, setErrorText] = useState("");

  const current = FEEDBACK_TYPES.find((t) => t.id === type);

  function close() {
    setOpen(false);
    if (status === "sent" || status === "error") setStatus("idle");
  }

  async function send() {
    const text = message.trim();
    if (!text || status === "sending") return;

    // Prosty limit częstotliwości po stronie przeglądarki (przeciw przypadkowym dublom).
    let last = 0;
    try { last = Number(window.localStorage.getItem("polsim_feedback_last") || 0); } catch (e) { /* brak localStorage */ }
    const wait = FEEDBACK_COOLDOWN_MS - (Date.now() - last);
    if (wait > 0) {
      setStatus("error");
      setErrorText(`Poczekaj jeszcze ${Math.ceil(wait / 1000)} s przed kolejną wiadomością.`);
      return;
    }

    setStatus("sending");
    setErrorText("");
    const fields = [];
    if (type === "collab") {
      fields.push({ name: "Preferowana forma kontaktu", value: (contact.trim() || "nie podano").slice(0, 300) });
    }
    try {
      const res = await fetch(FEEDBACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "Symulator RP — formularz",
          allowed_mentions: { parse: [] }, // wiadomości nie mogą pingować @everyone/@here
          embeds: [
            {
              title: current.label,
              description: text.slice(0, FEEDBACK_MAX_LEN),
              color: current.color,
              fields,
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try { window.localStorage.setItem("polsim_feedback_last", String(Date.now())); } catch (e) { /* pomijamy */ }
      setStatus("sent");
      setMessage("");
      setContact("");
    } catch (e) {
      setStatus("error");
      setErrorText("Nie udało się wysłać wiadomości. Spróbuj ponownie za chwilę.");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-red-600 hover:bg-red-500 text-white text-sm font-medium shadow-lg shadow-black/40 transition-colors"
      >
        <MessageSquare size={16} /> Napisz do twórcy
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={close}>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-5 max-w-lg w-full my-8" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-serif font-bold text-slate-50 mb-1">Napisz do twórcy</h3>
            <p className="text-xs text-slate-500 mb-4">Wiadomość trafia bezpośrednio do twórcy gry. Dzięki za pomoc w testach!</p>

            {status === "sent" ? (
              <div className="text-center py-6">
                <p className="text-green-400 text-sm mb-4">Wiadomość wysłana — dziękuję!</p>
                <div className="flex justify-center gap-2">
                  <button onClick={() => setStatus("idle")} className="px-3 py-1.5 rounded-md text-sm text-slate-300 border border-slate-700 hover:bg-slate-800">
                    Wyślij kolejną
                  </button>
                  <button onClick={close} className="px-3 py-1.5 rounded-md text-sm bg-red-600 hover:bg-red-500 text-white">
                    Zamknij
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5 mb-4">
                  {FEEDBACK_TYPES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setType(t.id)}
                      className={`px-2 py-2 rounded text-xs leading-tight text-center border transition-colors ${
                        type === t.id ? "bg-red-600 border-red-500 text-white" : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <label className="text-xs text-slate-500 block mb-1">Treść wiadomości</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MAX_LEN))}
                  placeholder={current.placeholder}
                  rows={6}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 resize-y"
                />
                <p className="text-[11px] text-slate-600 text-right mb-3">{message.length}/{FEEDBACK_MAX_LEN}</p>

                {type === "collab" && (
                  <div className="mb-3">
                    <label className="text-xs text-slate-500 block mb-1">Jak się z Tobą skontaktować?</label>
                    <input
                      type="text"
                      value={contact}
                      onChange={(e) => setContact(e.target.value.slice(0, 300))}
                      placeholder="np. Discord: nick#1234, e-mail, Messenger..."
                      className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200"
                    />
                  </div>
                )}

                {status === "error" && <p className="text-xs text-red-400 mb-3">{errorText}</p>}

                <div className="flex justify-end gap-2">
                  <button onClick={close} className="px-3 py-1.5 rounded-md text-sm text-slate-400 border border-slate-700 hover:bg-slate-800">
                    Anuluj
                  </button>
                  <button
                    onClick={send}
                    disabled={!message.trim() || status === "sending"}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 text-white"
                  >
                    <Send size={14} /> {status === "sending" ? "Wysyłanie..." : "Wyślij"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Hasło odblokowujące tryb gracza na ekranie startowym (wersja beta).
// Usuń PLAYER_MODE_PASSWORD i blokadę w SetupScreen, gdy tryb będzie gotowy.
const PLAYER_MODE_PASSWORD = "102528";
const PLAYER_MODE_UNLOCK_KEY = "polsim_player_mode_unlocked"; // stary klucz — czyszczony, odblokowanie nie jest już zapamiętywane

// Odblokowanie trwa tylko do odświeżenia strony (zmienna w pamięci) — nie jest
// zapisywane w localStorage, więc po każdym wejściu do gry hasło trzeba podać ponownie.
let playerModeUnlockedThisSession = false;
try { window.localStorage.removeItem(PLAYER_MODE_UNLOCK_KEY); } catch (e) { /* brak localStorage */ }

function isPlayerModeUnlocked() {
  return playerModeUnlockedThisSession;
}

function unlockPlayerMode(password) {
  if (String(password).trim() === PLAYER_MODE_PASSWORD) {
    playerModeUnlockedThisSession = true;
    return true;
  }
  return false;
}

// Zapisy/importy w trybie gracza też wymagają hasła — inaczej dałoby się obejść blokadę
// wczytując zapis albo „Kontynuuj ostatnią grę” z trybu gracza.
function requirePlayerModeAccess(st) {
  if (!st || st.gameMode !== "player" || isPlayerModeUnlocked()) return true;
  const pw = window.prompt("Ten zapis używa trybu gracza (w budowie). Podaj hasło, aby go wczytać:");
  if (pw !== null && unlockPlayerMode(pw)) return true;
  alert("Nieprawidłowe hasło — tryb gracza pozostaje zablokowany.");
  return false;
}

function SetupScreen({ onStart, autosave, saves, onContinueAutosave, onLoadSave, onImportFile }) {
  const [playerModeUnlocked, setPlayerModeUnlocked] = useState(() => isPlayerModeUnlocked());
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordError, setPasswordError] = useState(false);

  function submitPassword() {
    if (unlockPlayerMode(passwordDraft)) {
      setPlayerModeUnlocked(true);
      setPasswordPromptOpen(false);
      setPasswordDraft("");
      setPasswordError(false);
      setGameMode("player");
    } else {
      setPasswordError(true);
    }
  }

  const savesList = Object.entries(saves || {}).sort((a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt));
  const today = new Date();
  const [startDate, setStartDate] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });

  const [president, setPresident] = useState({ name: "", note: "" });

  const [schedule, setSchedule] = useState(() => initialSchedule({ year: today.getFullYear(), month: today.getMonth() + 1 }));

  const [parties, setParties] = useState([]);
  const [draft, setDraft] = useState({ name: "", full: "", bloc: "centrum", color: PALETTE[0], start: "5", minority: false });
  const [partySearch, setPartySearch] = useState("");
  const [partySearchStart, setPartySearchStart] = useState("");

  // Liczba mandatów w Sejmie — domyślnie ustawowe 460, ale gracz może to
  // zmienić przed startem gry (np. symulacja innego systemu wyborczego).
  const [sejmSeatsTotal, setSejmSeatsTotal] = useState(SEJM_SEATS);

  const [settings, setSettings] = useState({
    dissolutionEnabled: false,
    dissolutionChance: 15,
    newPartiesEnabled: false,
    newPartiesChance: 5,
    randomEventsEnabled: true,
    randomEventsChance: 18,
    sejmThreshold: 5,
    epThreshold: 5,
  });

  // --- TRYB GRACZA: tryb rozgrywki + kreator postaci ---------------------
  // "simulation" = obecny tryb bez zmian. "player" = gracz wciela się w postać
  // i co miesiąc podejmuje decyzje nad warstwą automatycznej symulacji.
  const [gameMode, setGameMode] = useState("simulation");
  const [playerConfig, setPlayerConfig] = useState({
    name: "",
    role: "activist",
    partyId: null,
    region: "Mazowieckie",
    age: "32",
    ideology: "centrum",
    platform: null,
    topics: ["gospodarka", "zdrowie"],
    traits: ["organizer"],
    playStyle: "pragmatist",
    difficulty: "normal",
    ambition: "build_party_support",
  });

  // §2/§3: efektywna platforma programowa pokazywana w suwakach — jeśli gracz
  // nie dotknął jeszcze żadnego suwaka, pokazujemy sensowne wartości domyślne
  // wyliczone z wybranej pozycji na osi ideologicznej (playerConfig.ideology).
  const effectivePlatform = playerConfig.platform || defaultPlatformForBloc(playerConfig.ideology);

  function setPlatformAxis(axisId, value) {
    setPlayerConfig((p) => ({
      ...p,
      platform: { ...(p.platform || defaultPlatformForBloc(p.ideology)), [axisId]: value },
    }));
  }

  function togglePlayerTopic(topic) {
    setPlayerConfig((prev) => {
      const has = prev.topics.includes(topic);
      if (has) return { ...prev, topics: prev.topics.filter((t) => t !== topic) };
      if (prev.topics.length >= 4) return prev;
      return { ...prev, topics: [...prev.topics, topic] };
    });
  }

  function togglePlayerTrait(traitId) {
    setPlayerConfig((prev) => {
      const has = prev.traits.includes(traitId);
      if (has) return { ...prev, traits: prev.traits.filter((t) => t !== traitId) };
      if (prev.traits.length >= 3) return prev;
      return { ...prev, traits: [...prev.traits, traitId] };
    });
  }

  function updateScheduleField(key, field, value) {
    setSchedule((prev) => ({ ...prev, [key]: { ...prev[key], [field]: Number(value) } }));
  }

  function applyTypicalIntervals() {
    setSchedule(initialSchedule(startDate));
  }

  // Wczytuje gotowy szablon (historyczny punkt startowy): nadpisuje datę startu,
  // prezydenta, harmonogram najbliższych wyborów i listę partii — wszystko da się
  // później dowolnie doedytować w formularzach poniżej, zanim gracz rozpocznie grę.
  const [activeTemplateKey, setActiveTemplateKey] = useState(null);

  function applyTemplate(tpl) {
    setStartDate(tpl.startDate);
    setPresident({ name: tpl.president?.name || "", note: tpl.president?.note || "" });
    setSchedule(tpl.schedule);
    const usedIds = [];
    const usedColors = [];
    const nextParties = tpl.parties.map((p) => {
      const id = uniqueId(slugify(p.name), usedIds);
      usedIds.push(id);
      const color = randomColor(usedColors);
      usedColors.push(color);
      return {
        id,
        name: p.name,
        full: p.full || p.name,
        color,
        bloc: p.bloc,
        start: p.start,
        minority: !!p.minority,
      };
    });
    setParties(nextParties);
    setActiveTemplateKey(tpl.key);
  }

  function addPartyDraft() {
    const name = draft.name.trim();
    if (!name) return;
    const baseId = slugify(name);
    const id = uniqueId(baseId, parties.map((p) => p.id));
    const startVal = Math.max(0.01, parseFloat(String(draft.start).replace(",", ".")) || 1);
    const next = {
      id,
      name,
      full: draft.full.trim() || name,
      color: draft.color,
      bloc: draft.bloc,
      start: startVal,
      minority: draft.minority,
    };
    setParties((prev) => [...prev, next]);
    setDraft({ name: "", full: "", bloc: draft.bloc, color: randomColor([...parties.map((p) => p.color), draft.color]), start: "5", minority: false });
    setActiveTemplateKey(null);
  }

  // Dodaje partię znalezioną w wyszukiwarce (pula partii ze wszystkich szablonów).
  // Nie zmienia aktywnego szablonu — partia trafia do scenariusza, który budujemy.
  function addPoolParty(entry) {
    if (parties.some((p) => p.name === entry.name)) return;
    const override = parseFloat(String(partySearchStart).replace(",", "."));
    const startVal = Number.isFinite(override) && override > 0 ? override : entry.avg;
    setParties((prev) => {
      const id = uniqueId(slugify(entry.name), prev.map((p) => p.id));
      return [
        ...prev,
        { id, name: entry.name, full: entry.full, color: randomColor(prev.map((p) => p.color)), bloc: entry.bloc, start: startVal, minority: entry.minority },
      ];
    });
  }

  const partySearchResults = useMemo(() => {
    const q = searchNormalize(partySearch.trim());
    if (!q) return [];
    return SEARCHABLE_PARTY_POOL
      .filter((p) => searchNormalize(p.name).includes(q) || searchNormalize(p.full).includes(q))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 12);
  }, [partySearch]);

  function removePartyDraft(id) {
    setParties((prev) => prev.filter((p) => p.id !== id));
    setActiveTemplateKey(null);
  }

  function changePartyDraftColor(id, newColor) {
    setParties((prev) => prev.map((p) => (p.id === id ? { ...p, color: newColor } : p)));
  }

  // Edycja partii już po dodaniu jej do konfiguracji. ID pozostaje niezmienne,
  // dzięki czemu zmiana skrótu/nazwy nie rozrywa późniejszych odwołań w grze.
  function changePartyDraftField(id, field, value) {
    setParties((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    setActiveTemplateKey(null);
  }

  function changePartyDraftStart(id, value) {
    const normalized = String(value).replace(',', '.');
    if (normalized === '' || /^\d*(?:\.\d*)?$/.test(normalized)) {
      setParties((prev) => prev.map((p) => (p.id === id ? { ...p, start: normalized } : p)));
      setActiveTemplateKey(null);
    }
  }

  function commitPartyDraftStart(id) {
    setParties((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const parsed = parseFloat(String(p.start).replace(',', '.'));
      return { ...p, start: Number.isFinite(parsed) ? Math.max(0.01, Math.min(90, parsed)) : 0.01 };
    }));
  }

  const canStart =
    parties.length >= 2 &&
    president.name.trim().length > 0 &&
    (gameMode !== "player" || playerConfig.name.trim().length > 0);

  function handleStart() {
    if (!canStart) return;
    onStart({
      parties,
      startDate,
      schedule,
      president: { name: president.name.trim(), note: president.note.trim() },
      settings,
      sejmSeatsTotal,
      preservePollValues: activeTemplateKey === "kumulacja",
      gameMode,
      playerConfig: gameMode === "player" ? { ...playerConfig, name: playerConfig.name.trim() } : null,
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <FeedbackWidget />
      {passwordPromptOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setPasswordPromptOpen(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-5 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-serif font-bold text-slate-50 mb-1 flex items-center gap-2">
              <Lock size={16} /> Tryb gracza zablokowany
            </h3>
            <p className="text-xs text-slate-500 mb-3">Ten tryb jest w budowie. Podaj hasło, aby go odblokować.</p>
            <input
              type="password"
              autoFocus
              value={passwordDraft}
              onChange={(e) => { setPasswordDraft(e.target.value); setPasswordError(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitPassword(); }}
              placeholder="Hasło"
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 mb-2"
            />
            {passwordError && <p className="text-xs text-red-400 mb-2">Nieprawidłowe hasło.</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setPasswordPromptOpen(false)} className="px-3 py-1.5 rounded-md text-sm text-slate-400 border border-slate-700 hover:bg-slate-800">
                Anuluj
              </button>
              <button onClick={submitPassword} className="px-4 py-1.5 rounded-md text-sm font-medium bg-red-600 hover:bg-red-500 text-white">
                Odblokuj
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-5xl mx-auto p-4 md:p-8">
        <div className="border-b border-slate-800 pb-6 mb-6">
          <p className="text-xs uppercase tracking-widest text-red-500 font-mono mb-1">Symulator sceny politycznej — RP</p>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-slate-50">Konfiguracja nowej rozgrywki</h1>
          <p className="text-slate-400 text-sm mt-2 max-w-2xl">
            Gra nie zawiera żadnych domyślnych partii ani wyników — najpierw uzupełnij dane wyjściowe: datę startu, prezydenta,
            terminy najbliższych wyborów oraz listę partii z ich poparciem startowym. Po każdych rozegranych wyborach danego
            typu harmonogram przechodzi automatycznie w normalny cykl (Sejm co 4 lata, EP i samorząd co 5 lat, prezydent co 5 lat).
          </p>
        </div>

        {(autosave || savesList.length > 0) && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
              <Save size={14} /> Masz zapisaną grę
            </div>

            {autosave && (
              <button
                onClick={onContinueAutosave}
                className="w-full text-left flex items-center justify-between gap-3 text-sm bg-slate-950 border border-slate-800 rounded-md px-3 py-2 mb-2 hover:border-red-500 transition-colors"
              >
                <span className="text-slate-200">Kontynuuj ostatnią grę</span>
                <span className="text-slate-500 font-mono text-xs">{fmtDate(autosave.date)}</span>
              </button>
            )}

            {savesList.length > 0 && (
              <div className="space-y-2 mb-3">
                {savesList.map(([name, entry]) => (
                  <button
                    key={name}
                    onClick={() => onLoadSave(name)}
                    className="w-full text-left flex items-center justify-between gap-3 text-sm bg-slate-950 border border-slate-800 rounded-md px-3 py-2 hover:border-red-500 transition-colors"
                  >
                    <span className="text-slate-200 truncate">{name}</span>
                    <span className="text-slate-500 font-mono text-xs shrink-0">
                      {fmtDate(entry.state.date)} · zapisano {fmtSavedAt(entry.savedAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer w-fit">
              <Upload size={13} /> Wczytaj zapis z pliku (.json)
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) onImportFile(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        )}

        {/* TRYB ROZGRYWKI */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
            <Crown size={14} /> Tryb rozgrywki
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => setGameMode("simulation")}
              className={`text-left rounded-md border p-3 transition-colors ${
                gameMode === "simulation" ? "border-red-500 bg-slate-950" : "border-slate-800 bg-slate-950 hover:border-slate-700"
              }`}
            >
              <p className="text-sm font-medium text-slate-100">Symulacja</p>
              <p className="text-xs text-slate-500 mt-1">
                Obserwujesz scenę polityczną z zewnątrz — sondaże, wybory i rządy toczą się automatycznie, tak jak dotychczas.
              </p>
            </button>
            {/* §30: tryb gracza jest jeszcze niedoskonały/rozwijany — przycisk
                zostaje w pełni AKTYWNY (nie disabled), tak by ciekawscy mogli
                sami wejść i zobaczyć, że to jeszcze nie jest dopracowane. */}
            <button
              onClick={() => {
                if (playerModeUnlocked) setGameMode("player");
                else { setPasswordPromptOpen(true); setPasswordError(false); setPasswordDraft(""); }
              }}
              className={`text-left rounded-md border p-3 transition-colors ${
                gameMode === "player" ? "border-red-500 bg-slate-950" : "border-slate-800 bg-slate-950 hover:border-slate-700"
              }`}
            >
              <p className="text-sm font-medium text-slate-100 flex items-center gap-1.5">
                Tryb gracza {!playerModeUnlocked && <Lock size={12} className="text-slate-500" />}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Wcielasz się w polityka i co miesiąc podejmujesz decyzje (media, partia, parlament, kampania...), a reszta świata
                nadal toczy się dzięki temu samemu silnikowi symulacji.
              </p>
              <p className="text-xs text-amber-500/80 mt-1.5 italic">
                {playerModeUnlocked
                  ? "Jeszcze w środku rozwoju — tryb odblokowany hasłem."
                  : "Tryb w budowie — dostęp zablokowany hasłem na czas wersji beta."}
              </p>
            </button>
          </div>
        </div>

        {/* KREATOR POSTACI (tylko tryb gracza) */}
        {gameMode === "player" && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
              <MapPinned size={14} /> Tworzenie postaci
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Imię i nazwisko postaci</label>
                <input
                  type="text"
                  value={playerConfig.name}
                  onChange={(e) => setPlayerConfig((p) => ({ ...p, name: e.target.value }))}
                  placeholder="np. Anna Kowalska"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Wiek</label>
                <input
                  type="number"
                  min="18"
                  value={playerConfig.age}
                  onChange={(e) => setPlayerConfig((p) => ({ ...p, age: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-slate-500 block mb-1">Stanowisko na start</label>
                <select
                  value={playerConfig.role}
                  onChange={(e) => setPlayerConfig((p) => ({ ...p, role: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200"
                >
                  {PLAYER_ROLES.filter((r) => r.startable).map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Region</label>
                <select
                  value={playerConfig.region}
                  onChange={(e) => setPlayerConfig((p) => ({ ...p, region: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200"
                >
                  {WOJEWODZTWA.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="text-xs text-slate-500 block mb-1">Partia / przynależność</label>
                <select
                  value={playerConfig.partyId || ""}
                  onChange={(e) => setPlayerConfig((p) => ({ ...p, partyId: e.target.value || null }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200"
                  disabled={parties.length === 0}
                >
                  <option value="">Niezależny polityk (bez partii)</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {p.full}</option>
                  ))}
                </select>
                {parties.length === 0 && (
                  <p className="text-xs text-slate-600 mt-1">Dodaj najpierw partie poniżej, jeśli Twoja postać ma do jednej należeć.</p>
                )}
              </div>
            </div>

            {/* §2: OŚ IDEOLOGICZNA — świadomy wybór, nigdy domyślne "centrum" bez pytania */}
            <div className="mb-4">
              <label className="text-xs text-slate-500 block mb-1.5">Twoja ideologia (oś polityczna)</label>
              <div className="grid grid-cols-7 gap-1">
                {BLOC_KEYS.map((bloc) => (
                  <button
                    key={bloc}
                    onClick={() => setPlayerConfig((p) => ({ ...p, ideology: bloc, platform: null }))}
                    className={`px-1.5 py-2 rounded text-[10px] leading-tight text-center border transition-colors ${
                      playerConfig.ideology === bloc ? "bg-red-600 border-red-500 text-white" : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    {BLOC_LABELS[bloc]}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-600 mt-1.5">{BLOC_DESCRIPTIONS[playerConfig.ideology]}</p>
            </div>

            {/* §3: WIELOWYMIAROWA PLATFORMA PROGRAMOWA (opcjonalne dostrojenie) */}
            <div className="mb-4">
              <label className="text-xs text-slate-500 block mb-2">
                Program szczegółowy (opcjonalnie — domyślnie wyliczony z Twojej ideologii)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {PLATFORM_AXES.map((axis) => (
                  <div key={axis.id}>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-0.5">
                      <span>{axis.left}</span>
                      <span className="text-slate-400">{axis.label}</span>
                      <span>{axis.right}</span>
                    </div>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      value={effectivePlatform[axis.id]}
                      onChange={(e) => setPlatformAxis(axis.id, Number(e.target.value))}
                      className="w-full accent-red-600"
                    />
                  </div>
                ))}
              </div>
              {playerConfig.platform && (
                <button
                  onClick={() => setPlayerConfig((p) => ({ ...p, platform: null }))}
                  className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2 mt-1"
                >
                  przywróć domyślne dla wybranej ideologii
                </button>
              )}
            </div>

            <div className="mb-4">
              <label className="text-xs text-slate-500 block mb-1.5">Priorytety tematyczne (max 4)</label>
              <div className="flex flex-wrap gap-1.5">
                {PLAYER_TOPICS.map((t) => (
                  <button
                    key={t}
                    onClick={() => togglePlayerTopic(t)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors capitalize ${
                      playerConfig.topics.includes(t) ? "bg-red-600 border-red-500 text-white" : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-slate-500 block mb-1.5">Cechy (max 3)</label>
              <div className="flex flex-wrap gap-1.5">
                {PLAYER_TRAITS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => togglePlayerTrait(t.id)}
                    title={t.desc}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      playerConfig.traits.includes(t.id) ? "bg-red-600 border-red-500 text-white" : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {playerConfig.traits.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {playerConfig.traits.map((tid) => (
                    <li key={tid} className="text-xs text-slate-600">
                      <span className="text-slate-400">{PLAYER_TRAIT_MAP[tid]?.label}:</span> {PLAYER_TRAIT_MAP[tid]?.desc}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Styl gry</label>
                <select
                  value={playerConfig.playStyle}
                  onChange={(e) => setPlayerConfig((p) => ({ ...p, playStyle: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200"
                >
                  {PLAY_STYLES.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Poziom trudności</label>
                <select
                  value={playerConfig.difficulty}
                  onChange={(e) => setPlayerConfig((p) => ({ ...p, difficulty: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200"
                >
                  {Object.entries(DIFFICULTY_LEVELS).map(([id, d]) => (
                    <option key={id} value={id}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Ambicja</label>
                <select
                  value={playerConfig.ambition}
                  onChange={(e) => setPlayerConfig((p) => ({ ...p, ambition: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200"
                >
                  {PLAYER_AMBITIONS.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-2">
              Co miesiąc dostaniesz pulę decyzji (media, partia, parlament, kampania i inne) oraz bieżące wydarzenia — Twoje
              wybory wpływają na Twoje statystyki, relacje i (w niewielkim, kontrolowanym stopniu) na sondaż Twojej partii.
            </p>
          </div>
        )}

        {/* SZABLONY KONFIGURACJI */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
            <Sparkles size={14} /> Szablony startowe (opcjonalnie)
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Wybierz gotowy, historyczny punkt startowy — jednym kliknięciem uzupełni datę startu, prezydenta, harmonogram
            najbliższych wyborów oraz listę partii z ich poparciem. Wszystko można potem dowolnie zmienić w polach poniżej.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <button
              onClick={() => applyTemplate(KUMULACJA_TEMPLATE)}
              className="text-left rounded-md p-3 border border-dashed border-amber-500/50 bg-amber-500/5 hover:border-amber-400 transition-colors"
            >
              <p className="text-amber-300 text-sm font-medium flex items-center gap-1.5">📊 Kumulacja</p>
              <p className="text-slate-500 text-xs mt-0.5">wszystkie partie · suma poparcia / 30 scenariuszy</p>
            </button>
            <button
              onClick={() => applyTemplate(buildRandomTemplate())}
              className="text-left rounded-md p-3 border border-dashed border-purple-500/50 bg-purple-500/5 hover:border-purple-400 transition-colors"
            >
              <p className="text-purple-300 text-sm font-medium flex items-center gap-1.5"><Sparkles size={13} /> Szablon losowy</p>
              <p className="text-slate-500 text-xs mt-0.5">losowe partie z całej historii i losowe poparcie</p>
            </button>
            {TEMPLATES.map((tpl) => {
              const isActive = activeTemplateKey === tpl.key;
              return (
                <button
                  key={tpl.key}
                  onClick={() => applyTemplate(tpl)}
                  className={`text-left rounded-md p-3 border transition-colors ${
                    isActive
                      ? "bg-red-600/10 border-red-500"
                      : "bg-slate-950 border-slate-800 hover:border-red-500"
                  }`}
                >
                  <p className="text-slate-100 text-sm font-medium">{tpl.label}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{tpl.sub} · {tpl.parties.length} partii</p>
                  {isActive && <p className="text-red-400 text-[11px] mt-1.5">✓ wczytano — edytuj poniżej wg potrzeb</p>}
                </button>
              );
            })}
          </div>
        </div>

        {/* DATA STARTU */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
            <CalendarClock size={14} /> Data startu symulacji
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={startDate.month}
              onChange={(e) => setStartDate((d) => ({ ...d, month: Number(e.target.value) }))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
            >
              {MONTHS_PL.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={startDate.year}
              onChange={(e) => setStartDate((d) => ({ ...d, year: Number(e.target.value) }))}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
            >
              {Array.from({ length: 71 }, (_, i) => 1990 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        {/* PREZYDENT NA START */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
            <Crown size={14} /> Prezydent RP na start gry
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Imię i nazwisko</label>
              <input
                type="text"
                value={president.name}
                onChange={(e) => setPresident((p) => ({ ...p, name: e.target.value }))}
                placeholder="np. Jan Kowalski"
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Notatka (opcjonalnie)</label>
              <input
                type="text"
                value={president.note}
                onChange={(e) => setPresident((p) => ({ ...p, note: e.target.value }))}
                placeholder="np. niezależny, popierany przez..."
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
              />
            </div>
          </div>
        </div>

        {/* NAJBLIŻSZE WYBORY */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400">
              <Globe2 size={14} /> Daty najbliższych wyborów
            </div>
            <button
              onClick={applyTypicalIntervals}
              className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-2"
            >
              Zastosuj typowe odstępy od daty startu
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Podaj termin pierwszego, najbliższego głosowania każdego typu. Kolejne edycje tych wyborów odbędą się już
            automatycznie w normalnym cyklu (Sejm +4 lata, samorząd/EP/prezydent +5 lat od poprzednich).
          </p>
          <div className="space-y-2">
            {Object.keys(ELECTION_LABELS).map((key) => (
              <div key={key} className="flex items-center gap-3 text-sm bg-slate-950 border border-slate-800 rounded-md px-3 py-2">
                <span className="w-40 text-slate-300">{ELECTION_LABELS[key]}</span>
                <select
                  value={schedule[key].month}
                  onChange={(e) => updateScheduleField(key, "month", e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                >
                  {MONTHS_PL.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
                <select
                  value={schedule[key].year}
                  onChange={(e) => updateScheduleField(key, "year", e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                >
                  {Array.from({ length: 71 }, (_, i) => 1990 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* DODAWANIE PARTII */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
            <Plus size={14} /> Dodaj partię do gry
          </div>

          <div className="mb-4 pb-4 border-b border-slate-800">
            <label className="block text-xs text-slate-500 mb-1">Wyszukaj partię z szablonów historycznych</label>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={partySearch}
                onChange={(e) => setPartySearch(e.target.value)}
                placeholder="np. Samoobrona, PSL, Unia Wolności..."
                className="flex-1 min-w-[200px] bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
              />
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="90"
                value={partySearchStart}
                onChange={(e) => setPartySearchStart(e.target.value)}
                placeholder="poparcie % (opcj.)"
                className="w-40 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
              />
            </div>
            <p className="text-[11px] text-slate-600 mt-1">
              Puste poparcie = średnia z „Kumulacji" (suma ze wszystkich scenariuszy ÷ 30).
            </p>
            {partySearch.trim() && (
              <div className="mt-2 space-y-1.5">
                {partySearchResults.length === 0 && <p className="text-xs text-slate-600">Brak wyników.</p>}
                {partySearchResults.map((r) => {
                  const added = parties.some((p) => p.name === r.name);
                  return (
                    <div key={r.name} className="flex items-center gap-2 text-sm bg-slate-950 border border-slate-800 rounded-md px-3 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-200 truncate">{r.name} <span className="text-slate-500 text-xs">— {r.full}</span></p>
                        <p className="text-slate-600 text-xs">{BLOC_LABELS[r.bloc] || r.bloc}{r.minority ? " · mniejszość narodowa" : ""}</p>
                      </div>
                      <span className="font-mono text-xs text-slate-500">śr. {r.avg}%</span>
                      <button
                        onClick={() => addPoolParty(r)}
                        disabled={added}
                        className="flex items-center gap-1 px-3 py-1 rounded-md bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-xs font-medium transition-colors"
                      >
                        {added ? "Dodana" : <><Plus size={12} /> Dodaj</>}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Skrót nazwy</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="np. NP"
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Pełna nazwa</label>
              <input
                type="text"
                value={draft.full}
                onChange={(e) => setDraft((d) => ({ ...d, full: e.target.value }))}
                placeholder="np. Nowa Partia"
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Blok ideologiczny</label>
              <select
                value={draft.bloc}
                onChange={(e) => setDraft((d) => ({ ...d, bloc: e.target.value }))}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
              >
                {BLOC_KEYS.map((b) => (
                  <option key={b} value={b}>{BLOC_LABELS[b]}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Kolor</label>
                <input
                  type="color"
                  value={draft.color}
                  onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                  className="w-12 h-9 bg-slate-800 border border-slate-700 rounded cursor-pointer"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-slate-500 mb-1">Poparcie startowe %</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="90"
                  value={draft.start}
                  onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                />
              </div>
            </div>
            <button
              onClick={addPartyDraft}
              disabled={!draft.name.trim()}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-medium transition-colors"
            >
              <Plus size={15} /> Dodaj
            </button>
          </div>
          <label className="flex items-center gap-2 mt-3 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={draft.minority}
              onChange={(e) => setDraft((d) => ({ ...d, minority: e.target.checked }))}
              className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 accent-red-600"
            />
            Partia mniejszości narodowej (zwolniona z progu wyborczego do Sejmu)
          </label>
        </div>

        {/* PARTIE POGRUPOWANE W BLOKI */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
            <Landmark size={14} /> Partie w grze, wg bloku ideologicznego
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {BLOC_KEYS.map((bloc) => {
              const inBloc = parties.filter((p) => p.bloc === bloc);
              return (
                <div key={bloc} className="bg-slate-950 border border-slate-800 rounded-md p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">{BLOC_LABELS[bloc]}</p>
                  {inBloc.length === 0 && <p className="text-xs text-slate-700 italic">brak partii</p>}
                  <div className="space-y-1.5">
                    {inBloc.map((p) => (
                      <div key={p.id} className="rounded-md border border-slate-800 bg-slate-900/60 p-2.5">
                        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_1.7fr_100px_auto] gap-2 items-center">
                          <input
                            type="color"
                            value={p.color}
                            onChange={(e) => changePartyDraftColor(p.id, e.target.value)}
                            title="Zmień kolor partii"
                            className="w-7 h-7 shrink-0 rounded-full border border-slate-700 bg-transparent cursor-pointer p-0 overflow-hidden [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full"
                          />
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-slate-600 mb-0.5">Skrót</label>
                            <input
                              type="text"
                              value={p.name}
                              onChange={(e) => changePartyDraftField(p.id, "name", e.target.value)}
                              placeholder="np. KO"
                              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm font-medium text-slate-200 focus:outline-none focus:border-red-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-slate-600 mb-0.5">Pełna nazwa</label>
                            <input
                              type="text"
                              value={p.full}
                              onChange={(e) => changePartyDraftField(p.id, "full", e.target.value)}
                              placeholder="Pełna nazwa partii"
                              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-red-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-slate-600 mb-0.5">Poparcie %</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              max="90"
                              value={p.start}
                              onChange={(e) => changePartyDraftStart(p.id, e.target.value)}
                              onBlur={() => commitPartyDraftStart(p.id)}
                              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-sm font-mono text-slate-200 focus:outline-none focus:border-red-500"
                            />
                          </div>
                          <div className="flex items-center justify-end gap-1">
                            {p.minority && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30" title="Zwolniona z progu wyborczego do Sejmu">
                                MN
                              </span>
                            )}
                            <button
                              onClick={() => removePartyDraft(p.id)}
                              title="Usuń partię"
                              className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-600 mt-3">
            Po dodaniu partii możesz tutaj zmieniać jej <span className="text-slate-500">skrót, pełną nazwę, kolor i poparcie startowe</span>.
            Zmiana nazwy nie zmienia wewnętrznego ID partii, więc nie psuje jej późniejszych danych w symulacji. Wpisane wartości
            poparcia startowego zostaną automatycznie znormalizowane do sumy 100%. Do rozpoczęcia gry potrzebne są co najmniej 2 partie.
          </p>
        </div>

        {/* LICZBA MANDATÓW W SEJMIE */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
            <Landmark size={14} /> Liczba mandatów w Sejmie
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="1"
              step="1"
              value={sejmSeatsTotal}
              onChange={(e) => setSejmSeatsTotal(Math.max(1, Math.round(Number(e.target.value) || 0)))}
              className="w-28 bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 font-mono"
            />
            <span className="text-xs text-slate-500">
              większość bezwzględna: <span className="font-mono text-slate-400">{Math.floor(sejmSeatsTotal / 2) + 1}</span>
            </span>
            {sejmSeatsTotal !== SEJM_SEATS && (
              <button
                onClick={() => setSejmSeatsTotal(SEJM_SEATS)}
                className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2"
              >
                przywróć domyślne ({SEJM_SEATS})
              </button>
            )}
          </div>
          <p className="text-xs text-slate-600 mt-2">
            Domyślnie ustawowe 460 mandatów. Zmiana wpływa na podział mandatów metodą d'Hondta oraz próg większości
            potrzebnej do utworzenia rządu.
          </p>
        </div>

        {/* PROGI WYBORCZE */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
            <Landmark size={14} /> Progi wyborcze
          </div>
          <div className="flex flex-wrap gap-6">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Sejm (partie mniejszości narodowej są zwolnione)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0" max="50" step="0.5"
                  value={settings.sejmThreshold}
                  onChange={(e) => setSettings((s) => ({ ...s, sejmThreshold: Math.max(0, Number(e.target.value) || 0) }))}
                  className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 font-mono"
                /> %
                {settings.sejmThreshold !== 5 && (
                  <button
                    onClick={() => setSettings((s) => ({ ...s, sejmThreshold: 5 }))}
                    className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2"
                  >
                    domyślne (5%)
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Parlament Europejski</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0" max="50" step="0.5"
                  value={settings.epThreshold}
                  onChange={(e) => setSettings((s) => ({ ...s, epThreshold: Math.max(0, Number(e.target.value) || 0) }))}
                  className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 font-mono"
                /> %
                {settings.epThreshold !== 5 && (
                  <button
                    onClick={() => setSettings((s) => ({ ...s, epThreshold: 5 }))}
                    className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2"
                  >
                    domyślne (5%)
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-600 mt-2">
            Domyślnie ustawowe 5%. Senat nie ma progu wyborczego (okręgi jednomandatowe). Zmiana wpływa na podział
            mandatów metodą d'Hondta w kolejnych wyborach danego typu.
          </p>
        </div>

        {/* OPCJE ZAAWANSOWANE / TRYB GRY */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
            <Settings2 size={14} /> Opcje zaawansowane (włącz/wyłącz)
          </div>

          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.dissolutionEnabled}
                onChange={(e) => setSettings((s) => ({ ...s, dissolutionEnabled: e.target.checked }))}
                className="w-3.5 h-3.5 mt-0.5 rounded border-slate-700 bg-slate-800 accent-red-600"
              />
              <span className="flex-1">
                <span className="font-medium">Rozwiązywanie partii</span> — partia, która nie przekroczy progu wyborczego
                (0 mandatów w Sejmie), ma szansę rozwiązać się na stałe.
                {settings.dissolutionEnabled && (
                  <span className="flex items-center gap-2 mt-1.5">
                    Szansa:
                    <input
                      type="number" min="0" max="100" step="1"
                      value={settings.dissolutionChance}
                      onChange={(e) => setSettings((s) => ({ ...s, dissolutionChance: Number(e.target.value) }))}
                      className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
                    /> %
                  </span>
                )}
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.newPartiesEnabled}
                onChange={(e) => setSettings((s) => ({ ...s, newPartiesEnabled: e.target.checked }))}
                className="w-3.5 h-3.5 mt-0.5 rounded border-slate-700 bg-slate-800 accent-red-600"
              />
              <span className="flex-1">
                <span className="font-medium">Tryb "nowych partii"</span> — co miesiąc szansa, że partia znana z innego
                szablonu historycznego (a jeszcze nieobecna w tej grze) dołączy do rywalizacji z 1% poparcia.
                {settings.newPartiesEnabled && (
                  <span className="flex items-center gap-2 mt-1.5">
                    Szansa na miesiąc:
                    <input
                      type="number" min="0" max="100" step="1"
                      value={settings.newPartiesChance}
                      onChange={(e) => setSettings((s) => ({ ...s, newPartiesChance: Number(e.target.value) }))}
                      className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
                    /> %
                  </span>
                )}
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.randomEventsEnabled}
                onChange={(e) => setSettings((s) => ({ ...s, randomEventsEnabled: e.target.checked }))}
                className="w-3.5 h-3.5 mt-0.5 rounded border-slate-700 bg-slate-800 accent-red-600"
              />
              <span className="flex-1">
                <span className="font-medium">Nieprzewidywalne wydarzenia losowe</span> — kryzysy gospodarcze i
                bezpieczeństwa, protesty, rozłamy i fuzje partii oraz rzadkie „czarne łabędzie” zmieniające scenę polityczną.
                {settings.randomEventsEnabled && (
                  <span className="flex items-center gap-2 mt-1.5">
                    Szansa na miesiąc:
                    <input
                      type="number" min="0" max="100" step="1"
                      value={settings.randomEventsChance}
                      onChange={(e) => setSettings((s) => ({ ...s, randomEventsChance: Number(e.target.value) }))}
                      className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-200"
                    /> %
                  </span>
                )}
              </span>
            </label>
          </div>
        </div>

        {/* START */}
        <div className="flex items-center justify-between gap-4 mb-10">
          <p className="text-xs text-slate-500">
            {parties.length} {parties.length === 1 ? "partia dodana" : "partii dodanych"}
            {!canStart && (
              <span className="text-red-400">
                {" — "}
                {parties.length < 2 ? "dodaj co najmniej 2 partie" : "podaj imię i nazwisko prezydenta"}
              </span>
            )}
          </p>
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium transition-colors text-sm"
          >
            Rozpocznij grę <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TRYB GRACZA — zakładka "Moja postać"
// ---------------------------------------------------------------------------

const PLAYER_STAT_LABELS = {
  popularity: "Popularność",
  recognition: "Rozpoznawalność",
  mediaSkill: "Zdolności medialne",
  leadership: "Przywództwo",
  debateSkill: "Debaty",
  organization: "Organizacja",
  credibility: "Wiarygodność",
  partyInfluence: "Wpływ w partii",
  publicTrust: "Zaufanie społeczne",
  coalitionSkill: "Zdolność koalicyjna",
  fundraising: "Fundraising",
  stamina: "Kondycja",
  scandalRisk: "Ryzyko skandalu",
  factionSupport: "Poparcie frakcji",
};

const WORLD_STAT_LABELS = {
  economy: "Gospodarka",
  unemployment: "Bezrobocie",
  inflation: "Inflacja",
  publicServices: "Usługi publiczne",
  security: "Bezpieczeństwo",
  governmentApproval: "Poparcie dla rządu",
  politicalTemperature: "Temperatura polityczna",
  mediaTemperature: "Temperatura medialna",
};

function StatBar({ label, value, invert, hideNumber }) {
  const v = clamp(value, 0, 100);
  const color = invert ? (v > 65 ? "#EF4444" : v > 35 ? "#EAB308" : "#22C55E") : (v > 65 ? "#22C55E" : v > 35 ? "#EAB308" : "#EF4444");
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-500 font-mono">{hideNumber ? describeLevel(v, invert) : Math.round(v)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §17 INFORMACJE JAWNE / SZACOWANE / UKRYTE
// ---------------------------------------------------------------------------
// Przy niższej jakości informacji (trudniejsze poziomy trudności) gracz nie
// widzi dokładnych liczb — dostaje opisowe kubełki. Zlecenie analizy sondażowej
// (decyzja "order_polling_analysis") odsłania dokładne liczby na dany miesiąc.
function describeLevel(value, invert) {
  const v = clamp(value, 0, 100);
  const buckets = invert
    ? [[0, 35, "niskie"], [35, 65, "umiarkowane"], [65, 101, "wysokie"]]
    : [[0, 35, "niska"], [35, 65, "umiarkowana"], [65, 101, "wysoka"]];
  const bucket = buckets.find(([lo, hi]) => v >= lo && v < hi);
  return bucket ? bucket[2] : "umiarkowana";
}

function infoRevealed(player, diff) {
  return diff.infoQuality >= 1 || !!player.analyticsBoughtThisMonth;
}

function CoalitionNegotiationPanel({ state, onNegotiate, onAutoForm }) {
  const pending = state.pendingCoalition;
  const [selected, setSelected] = useState(() => new Set());
  if (!pending) return null;
  const { sejmSeats, sejmSeatsTotal, playerPartyId } = pending;
  const majority = majorityFor(sejmSeatsTotal || SEJM_SEATS);
  const partners = Object.keys(sejmSeats)
    .filter((id) => id !== playerPartyId && (sejmSeats[id] || 0) > 0 && state.registry[id])
    .map((id) => {
      const p = state.registry[id];
      const rel = getRelation(state.playerRelations, "npc_leader_" + id);
      const distance = Math.abs((BLOC_RANK[p.bloc] ?? 3) - (BLOC_RANK[state.registry[playerPartyId]?.bloc] ?? 3));
      return { id, party: p, seats: sejmSeats[id], relation: rel.score, distance };
    })
    .sort((a, b) => b.seats - a.seats);

  const ownSeats = sejmSeats[playerPartyId] || 0;
  const selectedSeats = ownSeats + [...selected].reduce((sum, id) => sum + (sejmSeats[id] || 0), 0);
  const wouldHaveMajority = selectedSeats >= majority;

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="bg-slate-900 border border-red-900/40 rounded-lg p-4 mb-6">
      <div className="text-sm uppercase tracking-wide text-red-400 mb-2">§13 Negocjacje koalicyjne</div>
      <p className="text-xs text-slate-500 mb-3">
        Twoja partia zdobyła {ownSeats} mandatów. Potrzebujesz {majority} do większości. Zaznacz partnerów, którym chcesz
        zaproponować koalicję — każdy odpowie z pewnym prawdopodobieństwem zależnym od zbieżności ideologicznej i relacji.
      </p>
      <div className="space-y-2 mb-3">
        {partners.map((p) => (
          <label key={p.id} className="flex items-center justify-between text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 cursor-pointer">
            <span className="flex items-center gap-2">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="rounded border-slate-700 bg-slate-950" />
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.party.color }} />
              {p.party.name}
            </span>
            <span className="text-xs text-slate-500 font-mono">{p.seats} mand. · relacja {Math.round(p.relation)}</span>
          </label>
        ))}
        {partners.length === 0 && <p className="text-sm text-slate-500">Brak potencjalnych partnerów z mandatami.</p>}
      </div>
      <p className={`text-xs mb-3 ${wouldHaveMajority ? "text-green-400" : "text-yellow-500"}`}>
        Szacowana koalicja: {selectedSeats}/{sejmSeatsTotal} mandatów {wouldHaveMajority ? "— wystarczy na większość." : "— to może nie wystarczyć na większość."}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => onNegotiate([...selected])}
          disabled={selected.size === 0}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white"
        >
          Zaproponuj koalicję zaznaczonym
        </button>
        <button onClick={onAutoForm} className="px-3 py-1.5 rounded-md text-xs text-slate-400 hover:text-slate-200 border border-slate-700">
          Oddaj decyzję automatycznemu silnikowi
        </button>
      </div>
    </div>
  );
}

// §2/§3: pełny kreator własnej partii, otwierany zamiast automatycznego
// generowania nazwy/koloru/ideologii — priorytet #1 z prośby o naprawę
// tworzenia własnej partii ("nie ustawiaj centrum bez pytania gracza").
function FoundPartyModal({ player, existingColors, existing, onConfirm, onCancel, onRemove }) {
  const [name, setName] = useState(existing?.name || `Ruch ${player.name.split(" ")[0]}`);
  const [abbreviation, setAbbreviation] = useState(existing?.abbreviation || "");
  const [fullName, setFullName] = useState(existing?.fullName || "");
  const [color, setColor] = useState(existing?.color || randomColor(existingColors));
  const [bloc, setBloc] = useState(existing?.bloc || player.ideology || "centrum");
  const [platform, setPlatform] = useState(existing?.platform || player.platform || defaultPlatformForBloc(bloc));

  function setPlatformAxis(axisId, value) {
    setPlatform((prev) => ({ ...prev, [axisId]: value }));
  }

  function handleConfirm() {
    const abbr = abbreviation.trim() || name.trim().slice(0, 6).toUpperCase();
    onConfirm({
      name: name.trim() || `Ruch ${player.name}`,
      abbreviation: abbr,
      fullName: fullName.trim() || name.trim(),
      color,
      bloc,
      platform,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-5 max-w-2xl w-full my-8">
        <h3 className="text-lg font-serif font-bold text-slate-50 mb-1">Załóż własną partię</h3>
        <p className="text-xs text-slate-500 mb-4">
          To Twoja decyzja programowa — wybierz ideologię świadomie, nie musisz osiadać w centrum.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Nazwa partii</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Skrót</label>
            <input value={abbreviation} onChange={(e) => setAbbreviation(e.target.value)} placeholder="np. ABC" className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500 block mb-1">Pełna nazwa (opcjonalnie)</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Kolor</label>
            <div className="flex items-center gap-2">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-8 rounded border border-slate-700 bg-transparent cursor-pointer p-0" />
              <div className="flex gap-1">
                {PALETTE.slice(0, 6).map((c) => (
                  <button key={c} onClick={() => setColor(c)} className="w-5 h-5 rounded-full border border-slate-700" style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs text-slate-500 block mb-1.5">Ideologia</label>
          <div className="grid grid-cols-7 gap-1">
            {BLOC_KEYS.map((b) => (
              <button
                key={b}
                onClick={() => { setBloc(b); setPlatform(defaultPlatformForBloc(b)); }}
                className={`px-1.5 py-2 rounded text-[10px] leading-tight text-center border transition-colors ${
                  bloc === b ? "bg-red-600 border-red-500 text-white" : "bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500"
                }`}
              >
                {BLOC_LABELS[b]}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-1.5">{BLOC_DESCRIPTIONS[bloc]}</p>
        </div>

        <div className="mb-5">
          <label className="text-xs text-slate-500 block mb-2">Program szczegółowy</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PLATFORM_AXES.map((axis) => (
              <div key={axis.id}>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-0.5">
                  <span>{axis.left}</span>
                  <span className="text-slate-400">{axis.label}</span>
                  <span>{axis.right}</span>
                </div>
                <input type="range" min="-100" max="100" value={platform[axis.id]} onChange={(e) => setPlatformAxis(axis.id, Number(e.target.value))} className="w-full accent-red-600" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-between gap-2">
          <div>
            {existing && (
              <button onClick={onRemove} className="text-xs text-red-400 hover:text-red-300 underline underline-offset-2">
                Usuń tę decyzję
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 rounded-md text-sm text-slate-400 border border-slate-700 hover:bg-slate-800">
              Anuluj
            </button>
            <button onClick={handleConfirm} className="px-4 py-1.5 rounded-md text-sm font-medium bg-red-600 hover:bg-red-500 text-white">
              Załóż partię
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerModeTab({ state, onToggleDecision, onNegotiateCoalition, onAutoFormGovernment, onChooseAmbition }) {
  const player = state.player;
  const registry = state.registry;
  const npcs = state.npcs || {};
  const relations = state.playerRelations || {};
  const turn = state.currentTurn || { availableDecisionIds: [], chosen: [], monthlyGoals: [], activeEventId: null };
  const diff = DIFFICULTY_LEVELS[player.difficulty] || DIFFICULTY_LEVELS.normal;
  const maxActivities = Math.max(1, 3 + (diff.activityBonus ?? 0));
  const chosenCount = (turn.chosen || []).length;
  const infoOk = infoRevealed(player, diff);

  const party = player.partyId ? registry[player.partyId] : null;
  const ownLeaderId = ownLeaderNpcId(player);
  const ownLeader = ownLeaderId ? npcs[ownLeaderId] : null;
  const ownLeaderRelation = ownLeaderId ? getRelation(relations, ownLeaderId) : null;

  const activeEvent = turn.activeEventId ? PLAYER_EVENT_LIBRARY.find((e) => e.id === turn.activeEventId) : null;
  const eventCtx = { playerName: player.name, partyName: party?.name || "", region: player.region };

  const availableDecisions = (turn.availableDecisionIds || [])
    .map((id) => DECISION_LIBRARY.find((d) => d.id === id))
    .filter(Boolean);

  const relationEntries = Object.entries(relations)
    .filter(([, r]) => r.score !== 0 || r.trust !== 0)
    .map(([npcId, r]) => ({ npcId, npc: npcs[npcId], ...r }))
    .filter((r) => r.npc)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 6);

  const topSegments = [...ELECTORATE_SEGMENTS]
    .map((s) => ({ ...s, value: (player.segmentSupport && player.segmentSupport[s.id]) || 30 }))
    .sort((a, b) => b.value - a.value);

  const playerRegionData = state.regionalStrength ? state.regionalStrength.find((r) => r.name === player.region) : null;

  // §9: frakcje wewnątrz partii gracza.
  const playerFactions = player.partyId && state.factions ? state.factions[player.partyId] : null;

  // §11: aktywne (nierozwiązane) skandale gracza, najnowsze pierwsze.
  const activeScandals = (state.activeScandals || []).filter((s) => s.status !== "zakończony").slice().reverse();

  // §12: tryb kampanii — aktywny, gdy do najbliższych wyborów zostało ≤ 12 miesięcy.
  const upcomingElections = state.schedule
    ? Object.entries(state.schedule)
        .map(([type, date]) => ({ type, date, monthsLeft: monthsBetween(state.date, date) }))
        .filter((e) => e.monthsLeft >= 0)
        .sort((a, b) => a.monthsLeft - b.monthsLeft)
    : [];
  const nextElection = upcomingElections[0] || null;
  const campaignActive = nextElection && nextElection.monthsLeft <= 12;

  const recentResolved = (state.playerDecisionHistory || []).slice(-5).reverse();

  const chartData = (state.monthlySnapshots || []).slice(-36);

  return (
    <div className="mb-8">
      {/* AMBICJA OSIĄGNIĘTA — §19 */}
      {player.ambitionAchieved && (
        <div className="bg-gradient-to-r from-red-950 to-slate-900 border border-red-700 rounded-lg p-4 mb-6">
          <p className="text-sm uppercase tracking-wide text-red-400 mb-1">Cel osiągnięty 🏆</p>
          <p className="text-slate-200 text-sm mb-3">„{ambitionLabel(player.ambition)}” — możesz kontynuować karierę z nowym celem.</p>
          <div className="flex flex-wrap gap-2">
            {PLAYER_AMBITIONS.filter((a) => a.id !== player.ambition).map((a) => (
              <button
                key={a.id}
                onClick={() => onChooseAmbition(a.id)}
                className="px-2.5 py-1 rounded-full text-xs border border-slate-700 text-slate-300 hover:border-red-500"
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* KONIEC KARIERY — §38 */}
      {player.retired && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 mb-6">
          <p className="text-sm uppercase tracking-wide text-slate-400 mb-2">Kariera zakończona</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><p className="text-slate-500 text-xs">Miesięcy w polityce</p><p className="text-slate-200 font-mono">{player.monthsInPolitics}</p></div>
            <div><p className="text-slate-500 text-xs">Najwyższa popularność</p><p className="text-slate-200 font-mono">{Math.round(player.peakPopularity)}</p></div>
            <div><p className="text-slate-500 text-xs">Najwyższe poparcie partii</p><p className="text-slate-200 font-mono">{(player.peakPartyPoll || 0).toFixed(1)}%</p></div>
            <div><p className="text-slate-500 text-xs">Wybory: wygrane/przegrane</p><p className="text-slate-200 font-mono">{player.electionsWon}/{player.electionsLost}</p></div>
          </div>
        </div>
      )}

      {/* KOALICJA — §13 */}
      <CoalitionNegotiationPanel state={state} onNegotiate={onNegotiateCoalition} onAutoForm={onAutoFormGovernment} />

      {/* NAGŁÓWEK POSTACI */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-red-500 font-mono mb-1">{roleLabel(player.role)}</p>
            <h2 className="text-2xl font-serif font-bold text-slate-50">{player.name}</h2>
            <p className="text-sm text-slate-400 mt-1">
              {party ? `${party.full} · ` : "Niezależny polityk · "}
              {player.region} · {player.age} lat · poziom kariery {player.careerLevel}
            </p>
            <p className="text-xs text-slate-500 mt-1">Ambicja: {ambitionLabel(player.ambition)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Aktywności w tym miesiącu</p>
            <p className="text-lg font-mono text-slate-200">{chosenCount} / {maxActivities}</p>
            <p className="text-xs text-slate-600 mt-1">Poziom trudności: {diff.label}</p>
            {!infoOk && <p className="text-xs text-yellow-600 mt-1">Niepełne informacje — zleć analizę, by zobaczyć dokładne liczby.</p>}
            {infoOk && player.analyticsBoughtThisMonth && <p className="text-xs text-green-500 mt-1">Analiza aktywna na ten miesiąc.</p>}
          </div>
        </div>

        {player.traits.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {player.traits.map((tid) => (
              <span key={tid} title={PLAYER_TRAIT_MAP[tid]?.desc} className="px-2 py-0.5 rounded-full text-xs border border-slate-700 text-slate-400">
                {PLAYER_TRAIT_MAP[tid]?.label || tid}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* STATYSTYKI */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-sm uppercase tracking-wide text-slate-400 mb-3">Statystyki</div>
          <div className="space-y-2.5">
            {Object.entries(PLAYER_STAT_LABELS).map(([k, label]) => (
              <StatBar key={k} label={label} value={player.stats[k] || 0} invert={k === "scandalRisk"} />
            ))}
          </div>
        </div>

        {/* ZASOBY + RELACJA Z LIDEREM + CELE */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
          <div>
            <div className="text-sm uppercase tracking-wide text-slate-400 mb-2">Zasoby</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5">
                <p className="text-slate-500">Energia</p>
                <p className="text-slate-200 font-mono">{Math.round(player.resources.energy)}/100</p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5">
                <p className="text-slate-500">Kapitał polit.</p>
                <p className="text-slate-200 font-mono">{Math.round(player.resources.politicalCapital)}</p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5">
                <p className="text-slate-500">Budżet</p>
                <p className="text-slate-200 font-mono">{Math.round(player.resources.budget)}</p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5">
                <p className="text-slate-500">Doświadczenie</p>
                <p className="text-slate-200 font-mono">{player.xp}/{xpToNextLevel(player.careerLevel)}</p>
              </div>
            </div>
          </div>

          {ownLeader && (
            <div>
              <div className="text-sm uppercase tracking-wide text-slate-400 mb-2">Lider partii</div>
              <p className="text-sm text-slate-300">{ownLeader.name}</p>
              <p className="text-xs text-slate-500 mb-1">
                Relacja: {infoOk ? `${Math.round(ownLeaderRelation.score)} / 100` : describeLevel((ownLeaderRelation.score + 100) / 2)}
              </p>
              <StatBar label="Zaufanie lidera" value={(ownLeaderRelation.score + 100) / 2} hideNumber={!infoOk} />
            </div>
          )}

          {turn.monthlyGoals && turn.monthlyGoals.length > 0 && (
            <div>
              <div className="text-sm uppercase tracking-wide text-slate-400 mb-2">Cele miesiąca</div>
              <ul className="space-y-1 text-xs text-slate-400 list-disc list-inside">
                {turn.monthlyGoals.map((g) => (
                  <li key={g.id}>{g.text}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* SYTUACJA W KRAJU / WYDARZENIE */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
          <div>
            <div className="text-sm uppercase tracking-wide text-slate-400 mb-2">Sytuacja w kraju</div>
            <div className="space-y-2">
              {["economy", "governmentApproval", "politicalTemperature", "security"].map((k) => (
                <StatBar key={k} label={WORLD_STAT_LABELS[k]} value={(state.world && state.world[k]) || 50} invert={k === "politicalTemperature"} hideNumber={!infoOk} />
              ))}
              <StatBar
                label="Stabilność rządu (§9)"
                value={Number.isFinite(state.governmentStability) ? state.governmentStability : 50}
                hideNumber={!infoOk}
              />
            </div>
          </div>
          {activeEvent && (
            <div className="bg-slate-950 border border-red-900/40 rounded-md p-3">
              <p className="text-xs uppercase tracking-wide text-red-400 mb-1">Wydarzenie miesiąca</p>
              <p className="text-sm text-slate-200">{activeEvent.title}</p>
              <p className="text-xs text-slate-500 mt-1">{activeEvent.text(eventCtx)}</p>
            </div>
          )}
        </div>
      </div>

      {/* ELEKTORAT — §5 */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
        <div className="text-sm uppercase tracking-wide text-slate-400 mb-3">Nastroje w segmentach elektoratu</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {topSegments.map((s) => (
            <StatBar key={s.id} label={s.label} value={s.value} hideNumber={!infoOk} />
          ))}
        </div>
      </div>

      {/* REGION GRACZA — §32 */}
      {playerRegionData && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="text-sm uppercase tracking-wide text-slate-400 mb-3">Twój region: {player.region}</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatBar label="Poparcie lokalne" value={playerRegionData.support} hideNumber={!infoOk} />
            <StatBar label="Organizacja struktur" value={playerRegionData.organization} hideNumber={!infoOk} />
            <StatBar label="Twoja lokalna popularność" value={playerRegionData.localPopularity} hideNumber={!infoOk} />
          </div>
        </div>
      )}

      {/* RELACJE */}
      {relationEntries.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="text-sm uppercase tracking-wide text-slate-400 mb-3">Relacje</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {relationEntries.map((r) => (
              <div key={r.npcId} className="flex items-center justify-between text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2">
                <div>
                  <p className="text-slate-200">{r.npc.name}</p>
                  <p className="text-xs text-slate-500">{r.npc.role}{r.npc.partyId && registry[r.npc.partyId] ? ` · ${registry[r.npc.partyId].name}` : ""}</p>
                </div>
                <span className={`font-mono text-sm ${r.score >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {infoOk ? `${r.score >= 0 ? "+" : ""}${Math.round(r.score)}` : describeLevel((r.score + 100) / 2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DECYZJE DO WYBORU */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm uppercase tracking-wide text-slate-400">Decyzje tego miesiąca</div>
          <span className="text-xs text-slate-500">wybrano {chosenCount}/{maxActivities}</span>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Wybierz opcję w wybranych decyzjach (kliknięcie ponowne odznacza), a następnie kliknij „Kolejny miesiąc” u góry ekranu,
          aby rozstrzygnąć skutki i przejść dalej.
        </p>
        <div className="space-y-4">
          {availableDecisions.map((decision) => {
            const chosenForThis = (turn.chosen || []).find((c) => c.decisionId === decision.id);
            return (
              <div key={decision.id} className="bg-slate-950 border border-slate-800 rounded-md p-3">
                <p className="text-sm text-slate-200 font-medium">{decision.title}</p>
                <p className="text-xs text-slate-500 mb-2">{decision.desc}</p>
                <div className="flex flex-wrap gap-2">
                  {decision.options.map((opt) => {
                    const isChosen = chosenForThis && chosenForThis.optionId === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => onToggleDecision(decision.id, opt.id)}
                        className={`text-left px-3 py-1.5 rounded-md text-xs border transition-colors ${
                          isChosen ? "bg-red-600 border-red-500 text-white" : "bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500"
                        }`}
                      >
                        <span className="block">{opt.label}</span>
                        <span className={`block mt-0.5 ${isChosen ? "text-red-100" : "text-slate-600"}`}>ryzyko: {opt.risk}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {availableDecisions.length === 0 && (
            <p className="text-sm text-slate-500">Brak dostępnych decyzji w tej turze — spróbuj w kolejnym miesiącu.</p>
          )}
        </div>
      </div>

      {/* CO SIĘ ZMIENIŁO OSTATNIO — §28 reakcje grup */}
      {recentResolved.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="text-sm uppercase tracking-wide text-slate-400 mb-3">Co się zmieniło ostatnio</div>
          <div className="space-y-3">
            {recentResolved.map((d, idx) => (
              <div key={idx} className="text-sm bg-slate-950 border border-slate-800 rounded-md p-3">
                <p className="text-slate-200">{d.title} <span className="text-slate-500">→ {d.optionLabel}</span></p>
                <p className="text-xs text-slate-500 mt-1">{d.narrative}</p>
                {d.groupReactions && d.groupReactions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {d.groupReactions.map((g, gi) => (
                      <span
                        key={gi}
                        className={`px-2 py-0.5 rounded-full text-xs border ${
                          g.tone === "positive" ? "border-green-800 text-green-400" : g.tone === "negative" ? "border-red-800 text-red-400" : "border-slate-700 text-slate-400"
                        }`}
                      >
                        {g.group}: {g.text}
                      </span>
                    ))}
                  </div>
                )}
                {d.segmentReactions && d.segmentReactions.length > 0 && (
                  <p className="text-xs text-slate-600 mt-2">
                    {d.segmentReactions.map((s) => s.text).join(" ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FRAKCJE W PARTII — §9 */}
      {playerFactions && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
          <div className="text-sm uppercase tracking-wide text-slate-400 mb-3">Frakcje w Twojej partii</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {playerFactions.map((f) => (
              <div key={f.id} className="bg-slate-950 border border-slate-800 rounded-md p-3">
                <p className="text-sm text-slate-200 mb-1">{f.label}</p>
                <StatBar label="Poparcie w partii" value={f.support} hideNumber={!infoOk} />
                <StatBar label="Lojalność" value={f.loyalty} hideNumber={!infoOk} />
              </div>
            ))}
          </div>
          {playerFactions.find((f) => f.id === "radical")?.support > 50 && (
            <p className="text-xs text-yellow-600 mt-2">⚠️ Frakcja radykalna zdobywa przewagę — rośnie ryzyko rozłamu lub buntu.</p>
          )}
        </div>
      )}

      {/* SKANDALE — §11 */}
      {activeScandals.length > 0 && (
        <div className="bg-slate-900 border border-red-900/40 rounded-lg p-4 mb-6">
          <div className="text-sm uppercase tracking-wide text-red-400 mb-3">Aktywne skandale</div>
          <div className="space-y-2">
            {activeScandals.map((s) => (
              <div key={s.id} className="bg-slate-950 border border-slate-800 rounded-md p-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="text-slate-200">
                    {"🔥".repeat(s.level)} {s.topic}
                  </p>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border ${
                      s.status === "eskalujący" ? "border-red-700 text-red-400" : s.status === "wygasający" ? "border-slate-700 text-slate-500" : "border-yellow-700 text-yellow-500"
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Źródło: {s.source} · powiązane z: {s.originDecision} ({s.createdDate})
                </p>
                <StatBar label="Zainteresowanie mediów" value={s.mediaInterest} hideNumber={!infoOk} />
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-2">
            Skandale wygasają naturalnie w czasie, ale decyzja „Reakcja na zarzuty medialne” (kategoria: kryzys) pozwala nimi zarządzać.
          </p>
        </div>
      )}

      {/* KAMPANIA — §12 */}
      {campaignActive && nextElection && (
        <div className="bg-slate-900 border border-red-900/40 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm uppercase tracking-wide text-red-400">Tryb kampanii</div>
            <span className="text-xs text-slate-400">
              {ELECTION_TITLES[nextElection.type]} za {nextElection.monthsLeft} {nextElection.monthsLeft === 1 ? "miesiąc" : "mies."}
            </span>
          </div>
          {state.regionalStrength && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
              {[...state.regionalStrength].sort((a, b) => b.support - a.support).slice(0, 8).map((r) => (
                <div key={r.name} className={`bg-slate-950 border rounded-md p-2 text-xs ${r.name === player.region ? "border-red-700" : "border-slate-800"}`}>
                  <p className="text-slate-300 truncate">{r.name}</p>
                  <p className="text-slate-500 font-mono">{infoOk ? `${Math.round(r.support)}%` : describeLevel(r.support)}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-600">
            Wybierz decyzje z kategorii „kampania” (wiec, objazd regionu, reklama, debata) poniżej, by wzmocnić swoją pozycję przed
            zbliżającymi się wyborami — działania w Twoim regionie ({player.region}) mają dodatkowy efekt lokalny.
          </p>
        </div>
      )}

      {/* WYKRESY — §33 */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
        <div className="text-sm uppercase tracking-wide text-slate-400 mb-3">Trend postaci w czasie</div>
        {chartData.length < 2 ? (
          <p className="text-sm text-slate-500">Brak wystarczającej historii — wróć po kilku miesiącach gry.</p>
        ) : (
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="popularity" name="Popularność" stroke="#ef4444" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="recognition" name="Rozpoznawalność" stroke="#eab308" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="credibility" name="Wiarygodność" stroke="#22c55e" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="partyInfluence" name="Wpływ w partii" stroke="#38bdf8" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* HISTORIA KARIERY */}
      {state.playerCareerHistory && state.playerCareerHistory.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-sm uppercase tracking-wide text-slate-400 mb-3">Historia kariery</div>
          <ul className="space-y-1.5 text-sm">
            {[...state.playerCareerHistory].slice(-10).reverse().map((h) => (
              <li key={h.id} className="text-slate-400">
                <span className="text-slate-600 font-mono text-xs mr-2">{h.date}</span>{h.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PolskiSymulatorPolityczny() {
  const [state, setState] = useState(null);
  const [activeTab, setActiveTab] = useState("panel");
  const [saves, setSaves] = useState(() => readSavesFromStorage());
  const [autosave] = useState(() => {
    const raw = readAutosaveFromStorage();
    return raw ? migrateGameState(raw) : raw;
  });
  const [saveNameDraft, setSaveNameDraft] = useState("");
  const [chartRange, setChartRange] = useState("recent");
  // Partie ukryte na wykresie trendu (domyślnie wszystkie widoczne) — pozwala
  // ograniczyć wykres do wybranych partii, a oś Y skaluje się automatycznie
  // do zakresu tylko widocznych linii.
  const [hiddenChartPartyIds, setHiddenChartPartyIds] = useState(() => new Set());
  // Gdy włączone, partie pojawiające się po raz pierwszy w historii sondaży
  // (np. nowo powstałe w trybie "nowe partie") są automatycznie dodawane do
  // ukrytych — wykres nie rośnie im same z siebie.
  const [dontAutoShowNewParties, setDontAutoShowNewParties] = useState(false);
  const knownChartPartyIdsRef = useRef(null);

  // §29: TRYB SYMULACJI — "symuluj automatycznie do daty". Gracz wpisuje
  // docelowy miesiąc/rok, a przycisk rozgrywa tyle miesięcy naraz (przez tę
  // samą pętlę co advanceFast), z poszanowaniem ustawienia stopOnElections.
  const [simulateUntilDraft, setSimulateUntilDraft] = useState(null);

  function toggleChartPartyVisibility(id) {
    setHiddenChartPartyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Autosave: po każdej zmianie stanu gry (kolejny miesiąc, edycja sondaży, itd.)
  // aktualny stan trafia do localStorage, aby dało się go wznowić po zamknięciu karty.
  useEffect(() => {
    if (state) writeAutosaveToStorage(state);
  }, [state]);

  function saveCurrentGame(name) {
    const trimmed = (name || "").trim();
    if (!trimmed || !state) return;
    setSaves((prev) => {
      const next = { ...prev, [trimmed]: { state, savedAt: new Date().toISOString() } };
      writeSavesToStorage(next);
      return next;
    });
    setSaveNameDraft("");
  }

  function loadSavedGame(name) {
    setSaves((prev) => {
      const entry = prev[name];
      if (entry && requirePlayerModeAccess(entry.state)) {
        setState(migrateGameState(entry.state));
        setActiveTab("panel");
      }
      return prev;
    });
  }

  function deleteSavedGame(name) {
    setSaves((prev) => {
      const next = { ...prev };
      delete next[name];
      writeSavesToStorage(next);
      return next;
    });
  }

  function exportCurrentGame() {
    if (!state) return;
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `symulator-zapis-${fmtDate(state.date).replace(/\s+/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importGameFromFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!requirePlayerModeAccess(parsed)) return;
        setState(migrateGameState(parsed));
        setActiveTab("panel");
      } catch (e) {
        alert("Nie udało się wczytać pliku — sprawdź, czy to poprawny plik zapisu (.json) wyeksportowany z tej gry.");
      }
    };
    reader.readAsText(file);
  }

  // Zanim gra się zacznie (state === null, ekran konfiguracji jest widoczny),
  // poniższe hooki muszą mieć bezpieczne dane wejściowe — stąd safeState.
  const safeState = state || { polls: {}, registry: {}, sejmSeats: {}, senatSeats: {}, epSeats: {}, schedule: {}, date: { year: 2025, month: 1 }, presidentHistory: [], governmentHistory: [], sejmSeatsTotal: SEJM_SEATS };

  // Partie aktualnie "w grze" (biorące udział w sondażach) — wynikają wprost
  // z kluczy obiektu state.polls, dzięki czemu dodanie/usunięcie partii
  // automatycznie propaguje się wszędzie tam, gdzie jest to potrzebne.
  const activeParties = useMemo(
    () => Object.keys(safeState.polls).filter((id) => safeState.registry[id]).map((id) => safeState.registry[id]),
    [safeState.polls, safeState.registry]
  );

  const partyOrderBySize = useMemo(
    () => [...activeParties].sort((a, b) => safeState.polls[b.id] - safeState.polls[a.id]),
    [activeParties, safeState.polls]
  );

  // Kolejność ideologiczna licząca się z CAŁYM rejestrem partii (również tych
  // usuniętych), tak aby archiwalne mandaty zawsze dało się poprawnie ułożyć.
  const ideologicalOrder = useMemo(() => computeIdeologicalOrder(Object.values(safeState.registry)), [safeState.registry]);

  function nextMonth(d) {
    let m = d.month + 1;
    let y = d.year;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    return { year: y, month: m };
  }

  // §28: rdzeń logiki jednego miesiąca, wydzielony z advance() tak, by można
  // go było wywołać w pętli w advanceFast() (tempo kwartalne/roczne). Zwraca
  // nowy stan ORAZ listę powodów, dla których szybka symulacja powinna się
  // zatrzymać w tym miesiącu (wybory, kryzys, ważne wydarzenie itd.).
  function computeAdvancedState(prev) {
      const stopReasons = [];
      const settings = prev.settings || {};
      const prevActiveParties = Object.keys(prev.polls).filter((id) => prev.registry[id]).map((id) => prev.registry[id]);
      const newDate = nextMonth(prev.date);
      const dateLabel = fmtDate(newDate);

      // --- TRYB GRACZA: rozwiązanie decyzji/wydarzenia gracza z bieżącej tury.
      // Dzieje się PRZED randomWalk/maybeShock — jedyny "twardy" efekt na resztę
      // silnika to niewielka addytywna korekta poparcia WŁASNEJ partii gracza,
      // naniesiona tuż przed normalizacją sondaży (tak samo jak inne mechanizmy:
      // szoki, nowe partie). Mandaty, D'Hondt i harmonogram wyborów są nietknięte.
      let playerPatch = null;
      if (prev.gameMode === "player" && prev.player && !prev.player.retired) {
        playerPatch = resolvePlayerMonth(prev, (prev.currentTurn && prev.currentTurn.chosen) || [], dateLabel);
      }

      const walked = randomWalk(prev.polls);
      const { polls: shockedPolls, note } = maybeShock(walked, prevActiveParties);

      const label = `${MONTHS_PL[newDate.month - 1]} '${String(newDate.year).slice(2)}`;

      let { schedule, sejmSeats, senatSeats, epSeats, sejmikControl, government, president, log, electionsArchive, registry, presidentHistory, governmentHistory, sejmSeatsTotal } = prev;
      sejmSeatsTotal = Number(sejmSeatsTotal) > 0 ? sejmSeatsTotal : SEJM_SEATS;
      let polls = shockedPolls;
      registry = { ...registry };
      log = [...log];
      schedule = { ...schedule };
      electionsArchive = [...electionsArchive];
      let pendingCoalitionResult = prev.pendingCoalition || null;
      let playerElectionSeatLoss = false;
      presidentHistory = [...(presidentHistory || [{ from: { ...prev.startDate }, to: null, name: prev.president.name, note: prev.president.note }])];
      governmentHistory = [...(governmentHistory || [{ from: { ...prev.startDate }, to: null, label: prev.government.label, coalition: prev.government.coalition, pm: prev.government.pm }])];

      // Naniesienie wpływu gracza na sondaż jego partii (jeśli dotyczy) — zawsze
      // PRZED sprawdzeniem harmonogramu wyborów, tak aby ewentualne wybory w tym
      // samym miesiącu liczyły mandaty już z uwzględnieniem działań gracza.
      if (playerPatch && playerPatch.partyDelta && prev.player.partyId && polls[prev.player.partyId] !== undefined) {
        polls = { ...polls, [prev.player.partyId]: Math.max(0.01, polls[prev.player.partyId] + playerPatch.partyDelta) };
        polls = normalize(polls);
      }

      // §12: jeśli gracz założył w tym miesiącu nową partię, dopisujemy ją do
      // registry/polls TAK SAMO jak istniejący mechanizm "nowych partii" —
      // przez addPollEntry, bez ręcznego przeliczania sum (normalize zajmie się resztą).
      if (playerPatch && playerPatch.registryPatch) {
        registry[playerPatch.registryPatch.id] = playerPatch.registryPatch;
        polls = addPollEntry(polls, playerPatch.pollsPatchId, Math.max(0.1, playerPatch.pollsPatchStart));
        log.push({ date: fmtDate(newDate), text: `🆕 ${playerPatch.registryPatch.full} — nowe ugrupowanie założone przez ${playerPatch.player.name}.` });
      }

      if (note) log.push({ date: fmtDate(newDate), text: `📰 ${note}` });

      // Nieprzewidywalne wydarzenia losowe całej sceny (kryzysy, rozłamy, fuzje, "czarne łabędzie").
      // Domyślnie włączone — w starszych zapisach brak ustawienia traktujemy jak "włączone".
      if (settings.randomEventsEnabled !== false && Math.random() * 100 < (settings.randomEventsChance ?? 18)) {
        const protectedIds = prev.player && prev.player.partyId ? [prev.player.partyId] : [];
        const rounds = Math.random() < 0.15 ? 2 : 1; // czasem wydarzenia dzieją się lawinowo
        for (let i = 0; i < rounds; i++) {
          const ev = rollRandomWorldEvent(polls, registry, government, protectedIds);
          if (!ev) break;
          polls = ev.polls;
          ev.notes.forEach((n) => {
            log.push({ date: fmtDate(newDate), text: `${n.major ? "⚡" : "🌀"} ${n.text}` });
            if (n.major && prev.gameMode === "player") stopReasons.push(`Ważne wydarzenie na scenie politycznej: ${n.text}`);
          });
        }
      }

      if (sameDate(newDate, schedule.sejm) && prevActiveParties.length) {
        const exempt = minorityExemptIds(polls, registry);
        sejmSeats = dhondt(polls, sejmSeatsTotal, settings.sejmThreshold ?? 5, exempt);
        senatSeats = dhondt(polls, SENAT_SEATS, 0);

        // BUGFIX: jeśli partia gracza-posła/senatora nie przekroczyła progu
        // i nie zdobyła żadnego mandatu w Sejmie, gracz NIE może pozostać posłem
        // — traci mandat i wraca do bycia (nadal aktywnym politycznie) działaczem
        // swojej partii, jeśli w niej pozostaje, albo niezależnym.
        if (playerPatch && playerPatch.player.role === "mp" && playerPatch.player.partyId) {
          if ((sejmSeats[playerPatch.player.partyId] || 0) === 0) {
            playerElectionSeatLoss = true;
          }
        }

        // §13: jeśli gracz jest liderem partii, która zdobyła mandaty, NIE
        // nadpisujemy jego wyboru automatycznym formGovernment() — czeka na
        // ręczne negocjacje koalicyjne (patrz negotiateCoalition w komponencie).
        // We wszystkich innych przypadkach (tryb symulacji, gracz nie jest
        // liderem, gracz bez partii/mandatów) rząd formuje się jak dotychczas.
        const playerIsNegotiatingLeader =
          prev.gameMode === "player" && prev.player && !prev.player.retired &&
          (playerPatch ? playerPatch.player.role : prev.player.role) === "party_leader" &&
          (playerPatch ? playerPatch.player.partyId : prev.player.partyId) &&
          (sejmSeats[(playerPatch ? playerPatch.player.partyId : prev.player.partyId)] || 0) > 0;

        let pendingCoalitionOut = null;
        if (playerIsNegotiatingLeader) {
          const playerPartyId = playerPatch ? playerPatch.player.partyId : prev.player.partyId;
          government = { label: "Rząd nie sformowany — trwają negocjacje koalicyjne", coalition: [], pm: null, total: 0 };
          pendingCoalitionOut = { sejmSeats, sejmSeatsTotal, playerPartyId, date: fmtDate(newDate) };
          log.push({ date: fmtDate(newDate), text: `🤝 Jako lider/liderka partii rozpoczynasz negocjacje koalicyjne po wyborach parlamentarnych.` });
          stopReasons.push("Negocjacje koalicyjne po wyborach parlamentarnych");
        } else {
          government = formGovernment(sejmSeats, government.coalition, prevActiveParties, majorityFor(sejmSeatsTotal));
        }

        schedule.sejm = addYears(newDate, 4);
        governmentHistory[governmentHistory.length - 1] = { ...governmentHistory[governmentHistory.length - 1], to: newDate };
        governmentHistory.push({ from: newDate, to: null, label: government.label, coalition: government.coalition, pm: government.pm });
        const winnerId = [...prevActiveParties].sort((a, b) => polls[b.id] - polls[a.id])[0].id;
        const sejmTurnout = estimateTurnout("sejm", prev.world);
        const { regionalResults: sejmRegional } = simulateSejmikiDetailed(polls);
        log.push({
          date: fmtDate(newDate),
          text: `🗳️ Wybory parlamentarne (Sejm + Senat). Frekwencja: ${sejmTurnout}%. Zwycięzca: ${registry[winnerId].full}. Nowy rząd: ${government.label} (${government.total}/${sejmSeatsTotal} mandatów), premier: ${government.pm ? registry[government.pm].full : "brak"}.`,
        });
        if (settings.stopOnElections !== false) stopReasons.push("Wybory parlamentarne");
        electionsArchive.push({
          type: "sejm",
          date: fmtDate(newDate),
          polls,
          sejmSeats,
          senatSeats,
          government,
          winnerId,
          sejmSeatsTotal,
          turnout: sejmTurnout,
          regionalResults: sejmRegional,
        });
        if (pendingCoalitionOut) {
          pendingCoalitionResult = pendingCoalitionOut;
        } else {
          pendingCoalitionResult = null;
        }

        // Rozwiązywanie się partii, które nie zdobyły żadnego mandatu.
        if (settings.dissolutionEnabled) {
          prevActiveParties.forEach((p) => {
            if ((sejmSeats[p.id] || 0) > 0) return;
            if (Object.keys(polls).length <= 2) return;
            if (Math.random() * 100 < (settings.dissolutionChance ?? 15)) {
              polls = removePollEntry(polls, p.id);
              log.push({ date: fmtDate(newDate), text: `🪦 Partia ${p.full} rozwiązuje się po nieprzekroczeniu progu wyborczego.` });
            }
          });
        }
      }

      let samorzadRegionalWinners = null;

      if (sameDate(newDate, schedule.europarlament) && prevActiveParties.length) {
        epSeats = dhondt(polls, EP_SEATS, settings.epThreshold ?? 5, []);
        schedule.europarlament = addYears(newDate, 5);
        const winnerId = [...prevActiveParties].sort((a, b) => polls[b.id] - polls[a.id])[0].id;
        const { regionalResults: epRegional } = simulateSejmikiDetailed(polls);
        const epTurnout = estimateTurnout("europarlament", prev.world);
        log.push({ date: fmtDate(newDate), text: `🇪🇺 Wybory do Parlamentu Europejskiego rozstrzygnięte (53 mandaty). Frekwencja: ${epTurnout}%.` });
        if (settings.stopOnElections !== false) stopReasons.push("Wybory europarlamentarne");
        electionsArchive.push({ type: "europarlament", date: fmtDate(newDate), polls, epSeats, winnerId, turnout: epTurnout, regionalResults: epRegional });
      }

      if (sameDate(newDate, schedule.samorzad)) {
        const samorzadDetailed = simulateSejmikiDetailed(polls);
        sejmikControl = samorzadDetailed.control;
        samorzadRegionalWinners = samorzadDetailed.regionalWinners;
        schedule.samorzad = addYears(newDate, 5);
        const samorzadTurnout = estimateTurnout("samorzad", prev.world);
        log.push({ date: fmtDate(newDate), text: `🏛️ Wybory samorządowe (sejmiki wojewódzkie) rozstrzygnięte. Frekwencja: ${samorzadTurnout}%.` });
        if (settings.stopOnElections !== false) stopReasons.push("Wybory samorządowe");
        electionsArchive.push({
          type: "samorzad",
          date: fmtDate(newDate),
          polls,
          sejmikControl,
          turnout: samorzadTurnout,
          regionalResults: samorzadDetailed.regionalResults,
          regionalWinners: samorzadDetailed.regionalWinners,
        });
      }

      let playerPresidentResult = null; // null = nie dotyczy, true/false = wygrana/przegrana gracza-kandydata
      if (sameDate(newDate, schedule.prezydent) && prevActiveParties.length >= 2) {
        const playerIsCandidate = playerPatch && playerPatch.player.pendingCandidacy === "president";
        // Urzędujący prezydent-gracz, który nie zrezygnował z funkcji, automatycznie
        // broni urzędu w kolejnych wyborach — inaczej po prostu "zostawałby" prezydentem
        // na zawsze, nawet gdy wybory wygrywa ktoś inny.
        const playerWasPresident = playerPatch && playerPatch.player.role === "president";
        const playerRunsThisElection = playerIsCandidate || playerWasPresident;
        let contenders = prevActiveParties.map((p) => ({ id: p.id, full: p.full, poll: polls[p.id] }));
        if (playerRunsThisElection) {
          const playerScore = clamp(playerPatch.player.stats.popularity * 0.6 + playerPatch.player.stats.recognition * 0.4, 0, 100);
          const partyBoost = playerPatch.player.partyId ? (polls[playerPatch.player.partyId] || 0) * 0.3 : 0;
          // Urzędujący prezydent startuje z lekką premią (rozpoznawalność urzędu).
          const incumbencyBoost = playerWasPresident ? 8 : 0;
          const virtualPoll = clamp(playerScore * 0.5 + partyBoost + incumbencyBoost, 0.5, 65);
          contenders = [...contenders, { id: "__player__", full: playerPatch.player.name, poll: virtualPoll }];
        }
        const top2 = [...contenders].sort((a, b) => b.poll - a.poll).slice(0, 2);
        const sumFirstRound = top2[0].poll + top2[1].poll;
        const secondRound = {
          [top2[0].id]: Math.round((top2[0].poll / sumFirstRound) * 10000) / 100,
          [top2[1].id]: Math.round((top2[1].poll / sumFirstRound) * 10000) / 100,
        };
        const winner = secondRound[top2[0].id] >= secondRound[top2[1].id] ? top2[0] : top2[1];
        if (winner.id === "__player__") {
          president = { name: playerPatch.player.name, note: `wygrał(a) II turę wyborów prezydenckich ${fmtDate(newDate)} wynikiem ${pct(secondRound[winner.id])} — polityk/polityczka spoza tradycyjnych struktur partyjnych.` };
          playerPresidentResult = true;
        } else {
          president = { name: `Kandydat(ka) obozu ${winner.full}`, note: `wygrał(a) II turę wyborów prezydenckich ${fmtDate(newDate)} wynikiem ${pct(secondRound[winner.id])}` };
          if (playerRunsThisElection) playerPresidentResult = false;
        }
        schedule.prezydent = addYears(newDate, 5);
        presidentHistory[presidentHistory.length - 1] = { ...presidentHistory[presidentHistory.length - 1], to: newDate };
        presidentHistory.push({ from: newDate, to: null, name: president.name, note: president.note });
        const prezydentTurnout = estimateTurnout("prezydent", prev.world);
        const { regionalResults: prezydentRegional } = simulateSejmikiDetailed(polls);
        const { results: secondRoundRegional, winners: secondRoundRegionalWinners } = buildRunoffRegionalResults(
          top2[0].id, top2[0].poll, top2[1].id, top2[1].poll
        );
        log.push({
          date: fmtDate(newDate),
          text: `🎖️ Wybory prezydenckie — II tura (frekwencja: ${prezydentTurnout}%): ${top2[0].full} (${pct(secondRound[top2[0].id])}) vs ${top2[1].full} (${pct(secondRound[top2[1].id])}). Zwycięzca: ${winner.full}.`,
        });
        if (settings.stopOnElections !== false) stopReasons.push("Wybory prezydenckie");
        electionsArchive.push({
          type: "prezydent",
          date: fmtDate(newDate),
          polls,
          finalistIds: [top2[0].id, top2[1].id],
          secondRoundResults: secondRound,
          winnerId: winner.id,
          turnout: prezydentTurnout,
          regionalResults: prezydentRegional,
          secondRoundRegionalResults: secondRoundRegional,
          secondRoundRegionalWinners,
        });
      }

      // Tryb "nowych partii": co miesiąc szansa na to, że partia znana z innego
      // szablonu historycznego, a jeszcze nieobecna w tej rozgrywce, dołączy z 1% poparcia.
      if (settings.newPartiesEnabled && Math.random() * 100 < (settings.newPartiesChance ?? 5)) {
        const activeNames = new Set(Object.values(registry).map((p) => p.name));
        const candidates = GLOBAL_PARTY_POOL.filter((p) => !activeNames.has(p.name));
        // ~35% szans na całkowicie fikcyjną, wygenerowaną partię zamiast tej z puli.
        const useFictional = !candidates.length || Math.random() < 0.35;
        if (candidates.length || useFictional) {
          const pick = useFictional
            ? generateFictionalParty(activeNames)
            : candidates[Math.floor(Math.random() * candidates.length)];
          const id = uniqueId(slugify(pick.name), Object.keys(registry));
          const color = randomColor(Object.values(registry).map((p) => p.color));
          registry[id] = { id, name: pick.name, full: pick.full || pick.name, color, bloc: pick.bloc, minority: false };
          polls = addPollEntry(polls, id, 1);
          log.push({ date: fmtDate(newDate), text: `🆕 Na scenie pojawia się nowa partia: ${pick.full || pick.name} (start: 1%).` });
        }
      }

      const history = [...prev.history, { label, ...polls }];

      // --- TRYB GRACZA: finalizacja miesiąca — log, historie, snapshot, nowa tura ---
      let playerOut = {};
      if (playerPatch) {
        (playerPatch.eventLogEntries || []).forEach((e) => {
          const icon = e.kind === "npc_initiative" ? "♟️" : "🎭";
          log.push({ date: fmtDate(newDate), text: `${icon} ${e.text}` });
        });
        playerPatch.decisionLog.forEach((d) => {
          log.push({ date: fmtDate(newDate), text: `🧑‍💼 [${playerPatch.player.name}] ${d.title} → ${d.optionLabel}: ${d.narrative}` });
        });
        if (playerPatch.leveled) {
          log.push({ date: fmtDate(newDate), text: `⭐ ${playerPatch.player.name} awansuje na poziom kariery ${playerPatch.player.careerLevel}.` });
        }
        if (playerPatch.player.retired) {
          log.push({ date: fmtDate(newDate), text: `🏁 ${playerPatch.player.name} kończy karierę polityczną. Najwyższa popularność w karierze: ${Math.round(playerPatch.player.peakPopularity)}.` });
        }

        const playerDecisionHistory = [
          ...(prev.playerDecisionHistory || []),
          ...playerPatch.decisionLog.map((d, i) => ({ id: `dec_${newDate.year}_${newDate.month}_${i}`, date: fmtDate(newDate), ...d })),
        ].slice(-200);
        const playerEventHistory = (playerPatch.eventLogEntries || []).length
          ? [
              ...(prev.playerEventHistory || []),
              ...playerPatch.eventLogEntries.map((e, i) => ({ id: `evt_${newDate.year}_${newDate.month}_${i}`, date: fmtDate(newDate), ...e })),
            ].slice(-200)
          : prev.playerEventHistory || [];

        const finalPartyPoll = playerPatch.player.partyId ? polls[playerPatch.player.partyId] || 0 : null;
        const peakPartyPoll = Math.max(playerPatch.player.peakPartyPoll || 0, finalPartyPoll || 0);
        const playerWithPeaks = { ...playerPatch.player, peakPartyPoll };

        const monthlySnapshots = [
          ...(prev.monthlySnapshots || []),
          {
            label,
            popularity: playerWithPeaks.stats.popularity,
            recognition: playerWithPeaks.stats.recognition,
            credibility: playerWithPeaks.stats.credibility,
            partyInfluence: playerWithPeaks.stats.partyInfluence,
            partyPoll: finalPartyPoll,
          },
        ].slice(-240);

        // §32: wynik wyborów samorządowych w tym miesiącu (jeśli były) delikatnie
        // koryguje siłę regionalną w regionie gracza, w oparciu o to, czy jego
        // partia kontroluje sejmik w tym województwie.
        let regionalStrengthOut = playerPatch.regionalStrength;
        if (samorzadRegionalWinners && playerWithPeaks.partyId) {
          const controllingParty = samorzadRegionalWinners[playerWithPeaks.region] || null;
          regionalStrengthOut = bumpRegionalStrength(regionalStrengthOut, playerWithPeaks.region, {
            support: controllingParty === playerWithPeaks.partyId ? 4 : -2,
            organization: controllingParty === playerWithPeaks.partyId ? 2 : 0,
            localPopularity: controllingParty === playerWithPeaks.partyId ? 3 : -1,
          });
        }

        // §9: stabilność rządu przeliczana co miesiąc.
        const governmentStability = computeGovernmentStability(
          prev.governmentStability,
          government,
          sejmSeatsTotal,
          playerPatch.world,
          playerWithPeaks,
          playerPatch.playerRelations
        );
        if (governmentStability < 30 && !(Number.isFinite(prev.governmentStability) && prev.governmentStability < 30)) {
          stopReasons.push("Kryzys rządowy — stabilność rządu gwałtownie spadła");
        }

        // §19: sprawdzenie, czy ambicja gracza została właśnie zrealizowana.
        let finalPlayer = playerWithPeaks;
        if (playerPresidentResult === true) {
          finalPlayer = {
            ...finalPlayer,
            role: "president",
            pendingCandidacy: null,
            // Zapamiętujemy rolę sprzed prezydentury tylko jeśli jeszcze jej nie mieliśmy
            // zapisanej (np. urzędujący prezydent wygrywa reelekcję — nie chcemy nadpisać
            // prawdziwej roli sprzed pierwszej wygranej wartością "president").
            roleBeforePresidency: finalPlayer.roleBeforePresidency || (finalPlayer.role !== "president" ? finalPlayer.role : null),
            electionsWon: (finalPlayer.electionsWon || 0) + 1,
          };
          log.push({ date: fmtDate(newDate), text: `🎖️ ${finalPlayer.name} zostaje Prezydentem RP.` });
        } else if (playerPresidentResult === false) {
          const wasIncumbent = finalPlayer.role === "president";
          const fallbackRole = finalPlayer.roleBeforePresidency || (finalPlayer.partyId ? "party_leader" : "independent");
          finalPlayer = { ...finalPlayer, role: fallbackRole, pendingCandidacy: null, roleBeforePresidency: null, electionsLost: (finalPlayer.electionsLost || 0) + 1 };
          log.push({
            date: fmtDate(newDate),
            text: wasIncumbent
              ? `${finalPlayer.name} przegrywa reelekcję na urząd Prezydenta RP i kończy kadencję.`
              : `${finalPlayer.name} przegrywa wybory prezydenckie i wraca do dotychczasowej działalności.`,
          });
        }
        // BUGFIX: utrata mandatu poselskiego po nieprzekroczeniu progu przez partię.
        if (playerElectionSeatLoss) {
          finalPlayer = { ...finalPlayer, role: finalPlayer.partyId ? "activist" : "independent", electionsLost: (finalPlayer.electionsLost || 0) + 1 };
          log.push({
            date: fmtDate(newDate),
            text: `📉 Partia ${registry[finalPlayer.partyId]?.name || ""} nie przekroczyła progu wyborczego — ${finalPlayer.name} traci mandat poselski.`,
          });
        }

        const ambitionStub = { player: finalPlayer, polls, registry, government };
        if (checkAmbition(finalPlayer, ambitionStub)) {
          finalPlayer = { ...finalPlayer, ambitionAchieved: true };
          log.push({ date: fmtDate(newDate), text: `🏆 Cel osiągnięty: „${ambitionLabel(finalPlayer.ambition)}” — ${finalPlayer.name} zapisuje się w historii kariery.` });
        }

        // Nowa tura na przyszły miesiąc — generowana na podstawie już zaktualizowanego stanu
        // (partia gracza, ewentualny nowy rząd po wyborach w tym miesiącu itd.).
        const stubForNextTurn = {
          player: finalPlayer,
          npcs: prev.npcs,
          registry,
          polls,
          government,
          playerRelations: playerPatch.playerRelations,
        };
        const currentTurn = finalPlayer.retired ? null : generatePlayerTurn(stubForNextTurn);

        const playerCareerHistory = [...(prev.playerCareerHistory || [])];
        if (finalPlayer.ambitionAchieved && !prev.player.ambitionAchieved) {
          playerCareerHistory.push({ id: `ambition_${newDate.year}_${newDate.month}`, date: fmtDate(newDate), text: `Cel osiągnięty: ${ambitionLabel(finalPlayer.ambition)}.` });
          stopReasons.push(`Cel osiągnięty: ${ambitionLabel(finalPlayer.ambition)}`);
        }
        if (finalPlayer.role !== prev.player.role) {
          playerCareerHistory.push({ id: `role_${newDate.year}_${newDate.month}`, date: fmtDate(newDate), text: `Zmiana stanowiska: ${roleLabel(prev.player.role)} → ${roleLabel(finalPlayer.role)}.` });
          stopReasons.push(`Zmiana stanowiska: ${roleLabel(prev.player.role)} → ${roleLabel(finalPlayer.role)}`);
        }
        if (finalPlayer.retired) {
          playerCareerHistory.push({ id: `retire_${newDate.year}_${newDate.month}`, date: fmtDate(newDate), text: `Zakończenie kariery politycznej po ${finalPlayer.monthsInPolitics} miesiącach działalności.` });
          stopReasons.push("Koniec kariery politycznej");
        }
        // Gwałtowny wzrost ryzyka skandalu — warto dać graczowi szansę zareagować.
        if ((finalPlayer.stats.scandalRisk || 0) >= 70 && (prev.player.stats.scandalRisk || 0) < 70) {
          stopReasons.push("Ryzyko skandalu gwałtownie wzrosło");
        }
        // §18: inicjatywy NPC oraz oznaczone jako ważne wydarzenia zawsze zatrzymują szybką symulację.
        (playerPatch.eventLogEntries || []).forEach((e) => {
          if (e.kind === "npc_initiative") stopReasons.push(`Inicjatywa otoczenia: ${e.text}`);
          else if (e.important) stopReasons.push(`Ważne wydarzenie: ${e.title}`);
        });
        // §28: nowo dostępna decyzja o dużym znaczeniu dla kariery (np. możliwość
        // założenia partii, kandydowania, wyzwania lidera) — warto się zatrzymać.
        // WAŻNE: porównujemy PRAWDZIWĄ dostępność (decisionAvailable), a nie tylko
        // losowo wylosowaną 8-elementową pulę tej tury — inaczej opcja "migocze"
        // w/poza próbką miesiąc w miesiąc i fałszywie wygląda na "nowo dostępną".
        const criticalDecisions = DECISION_LIBRARY.filter((d) => CAREER_CRITICAL_IDS.has(d.id));
        const prevStubForAvailability = { player: prev.player, registry: prev.registry, government: prev.government };
        const nextStubForAvailability = { player: finalPlayer, registry, government };
        criticalDecisions.forEach((dec) => {
          const wasAvailable = decisionAvailable(dec, prevStubForAvailability);
          const isAvailable = decisionAvailable(dec, nextStubForAvailability);
          if (isAvailable && !wasAvailable) {
            stopReasons.push(`Nowa ważna opcja: ${dec.title}`);
          }
        });

        playerOut = {
          player: finalPlayer,
          playerRelations: playerPatch.playerRelations,
          world: playerPatch.world,
          playerDecisionHistory,
          playerEventHistory,
          playerCareerHistory,
          monthlySnapshots,
          currentTurn,
          regionalStrength: regionalStrengthOut,
          governmentStability,
          factions: ensureFactionsForParties(playerPatch.factions || prev.factions, registry),
          activeScandals: playerPatch.activeScandals || prev.activeScandals,
        };
      }

      // §9: autonomiczny system kryzysów koalicyjnych działa również w
      // zwykłym trybie symulacji (nie tylko w trybie kariery gracza).
      const stabilityWorld = (playerOut && playerOut.world) || prev.world || null;
      const stabilityPlayer = (playerOut && playerOut.player) || prev.player || null;
      let governmentStabilityOut = (playerOut && Number.isFinite(playerOut.governmentStability))
        ? playerOut.governmentStability
        : computeGovernmentStability(
            prev.governmentStability,
            government,
            sejmSeatsTotal,
            stabilityWorld,
            stabilityPlayer,
            (playerOut && playerOut.playerRelations) || prev.playerRelations || {}
          );

      const coalitionBeforeCrisis = [...(government.coalition || [])];
      const instability = clamp((48 - governmentStabilityOut) / 48, 0, 1);
      const coalitionCrisisChance = instability * 0.10;
      if (coalitionBeforeCrisis.length > 1 && Math.random() < coalitionCrisisChance) {
        const departingId = [...coalitionBeforeCrisis]
          .filter((id) => id !== government.pm)
          .sort((a, b) => (sejmSeats[a] || 0) - (sejmSeats[b] || 0))[0];
        if (departingId) {
          const remaining = coalitionBeforeCrisis.filter((id) => id !== departingId);
          const remainingSeats = remaining.reduce((sum, id) => sum + (sejmSeats[id] || 0), 0);
          const majority = majorityFor(sejmSeatsTotal);
          if (remainingSeats >= majority) {
            government = {
              ...government,
              coalition: remaining,
              total: remainingSeats,
              label: `Koalicja po odejściu ${registry[departingId]?.name || departingId}`,
              stable: true,
            };
            log.push({ date: dateLabel, text: `⚠️ Kryzys koalicyjny: ${registry[departingId]?.name || departingId} opuszcza rząd. Pozostali koalicjanci utrzymują większość (${remainingSeats}/${sejmSeatsTotal}).` });
          } else {
            government = {
              ...government,
              coalition: remaining.length ? remaining : [government.pm].filter(Boolean),
              total: remainingSeats,
              label: `Rząd mniejszościowy po odejściu ${registry[departingId]?.name || departingId}`,
              stable: false,
            };
            log.push({ date: dateLabel, text: `🚨 Rozpad większości: ${registry[departingId]?.name || departingId} opuszcza koalicję. Rząd traci większość (${remainingSeats}/${sejmSeatsTotal}) i działa jako mniejszościowy.` });
            stopReasons.push("Rozpad koalicji — rząd utracił większość parlamentarną");
          }
          governmentHistory = [...governmentHistory];
          const lastGovernmentPeriod = governmentHistory[governmentHistory.length - 1];
          if (lastGovernmentPeriod) {
            governmentHistory[governmentHistory.length - 1] = { ...lastGovernmentPeriod, to: { ...newDate } };
          }
          governmentHistory.push({
            from: { ...newDate }, to: null, label: government.label,
            coalition: [...(government.coalition || [])], pm: government.pm,
          });
          governmentStabilityOut = clamp(governmentStabilityOut - (remainingSeats >= majority ? 12 : 24), 0, 100);
        }
      }

      // Przy skrajnie niskiej stabilności premier może podać rząd do dymisji.
      // Nowy gabinet powstaje na bazie aktualnego układu mandatów.
      if (governmentStabilityOut < 12 && Math.random() < 0.18) {
        const previousPm = government.pm;
        const replacement = formGovernment(sejmSeats, [], Object.values(registry), majorityFor(sejmSeatsTotal));
        if (replacement && replacement.pm) {
          government = replacement;
          governmentHistory = [...governmentHistory];
          const lastGovernmentPeriod = governmentHistory[governmentHistory.length - 1];
          if (lastGovernmentPeriod) {
            governmentHistory[governmentHistory.length - 1] = { ...lastGovernmentPeriod, to: { ...newDate } };
          }
          governmentHistory.push({
            from: { ...newDate }, to: null, label: government.label,
            coalition: [...(government.coalition || [])], pm: government.pm,
          });
          log.push({ date: dateLabel, text: `🏛️ Dymisja rządu premiera ${registry[previousPm]?.name || previousPm || "—"}. Po negocjacjach powstaje nowy gabinet: ${government.label}.` });
          stopReasons.push("Dymisja rządu i powołanie nowego gabinetu");
          governmentStabilityOut = clamp(governmentStabilityOut + 22, 0, 100);
        }
      }

      playerOut = { ...playerOut, governmentStability: governmentStabilityOut };

      const nextState = {
        ...prev,
        date: newDate,
        polls,
        registry,
        history,
        schedule,
        sejmSeatsTotal,
        sejmSeats,
        senatSeats,
        epSeats,
        sejmikControl,
        government,
        president,
        presidentHistory,
        governmentHistory,
        electionsArchive,
        log: log.slice(-40),
        pendingCoalition: pendingCoalitionResult,
        ...playerOut,
      };
      return { nextState, stopReasons };
  }

  function advance() {
    setState((prev) => {
      if (!prev) return prev;
      return computeAdvancedState(prev).nextState;
    });
  }

  // §28: SZYBSZE TEMPO ROZGRYWKI — rozgrywa do `monthsCount` miesięcy pod rząd,
  // ale zatrzymuje się natychmiast, gdy w danym miesiącu pojawi się coś ważnego
  // (wybory, kryzys rządowy, ważne wydarzenie, nowa kluczowa decyzja kariery itd.).
  // Podsumowanie okresu (zmiana poparcia, statystyk, XP...) trafia do
  // state.fastForwardSummary, a ewentualny powód zatrzymania do state.fastForwardStop.
  function advanceFast(monthsCount) {
    setState((prev) => {
      if (!prev) return prev;
      const startSnapshot = {
        date: prev.date,
        partyPoll: prev.player && prev.player.partyId ? prev.polls[prev.player.partyId] || 0 : null,
        stats: prev.player ? { ...prev.player.stats } : null,
        xp: prev.player ? prev.player.xp : 0,
        careerLevel: prev.player ? prev.player.careerLevel : 1,
        resources: prev.player ? { ...prev.player.resources } : null,
      };
      let current = prev;
      let monthsRun = 0;
      let stopReasons = [];
      const majorEvents = [];
      for (let i = 0; i < monthsCount; i++) {
        const result = computeAdvancedState(current);
        current = result.nextState;
        monthsRun += 1;
        if (result.stopReasons && result.stopReasons.length) {
          result.stopReasons.forEach((r) => majorEvents.push({ date: fmtDate(current.date), text: r }));
        }
        if ((current.player && current.player.retired) || (result.stopReasons && result.stopReasons.length)) {
          stopReasons = result.stopReasons || [];
          break;
        }
      }
      const endPlayer = current.player;
      const fastForwardSummary = {
        fromDate: fmtDate(startSnapshot.date),
        toDate: fmtDate(current.date),
        monthsRun,
        stoppedEarly: stopReasons.length > 0,
        stopReasons,
        majorEvents: majorEvents.slice(-12),
        partyPollDelta: endPlayer && endPlayer.partyId && startSnapshot.partyPoll !== null
          ? (current.polls[endPlayer.partyId] || 0) - startSnapshot.partyPoll
          : null,
        statDeltas: endPlayer && startSnapshot.stats
          ? Object.fromEntries(Object.keys(startSnapshot.stats).map((k) => [k, (endPlayer.stats[k] || 0) - startSnapshot.stats[k]]))
          : null,
        xpGained: endPlayer ? endPlayer.xp - startSnapshot.xp + (endPlayer.careerLevel - startSnapshot.careerLevel) * 0 : 0,
        careerLevelDelta: endPlayer ? endPlayer.careerLevel - startSnapshot.careerLevel : 0,
        budgetDelta: endPlayer && startSnapshot.resources ? (endPlayer.resources.budget || 0) - startSnapshot.resources.budget : 0,
      };
      return { ...current, fastForwardSummary };
    });
  }

  function dismissFastForwardSummary() {
    setState((prev) => (prev ? { ...prev, fastForwardSummary: null } : prev));
  }

  // §29: "Symuluj automatycznie do daty" — dostępne tylko w trybie symulacji.
  // Liczy liczbę miesięcy dzielących bieżącą datę od wskazanej daty docelowej
  // i rozgrywa je jedną komendą przez tę samą pętlę co advanceFast (a więc
  // z takim samym zatrzymywaniem się na ważnych wydarzeniach/kryzysach —
  // zatrzymywanie na samych wyborach zależy od ustawienia stopOnElections).
  function monthsUntil(from, to) {
    return (to.year - from.year) * 12 + (to.month - from.month);
  }

  function advanceUntilDate(targetDate) {
    if (!state) return;
    const months = monthsUntil(state.date, targetDate);
    if (months <= 0) return;
    advanceFast(Math.min(months, 1200)); // bezpiecznik: maks. 100 lat naraz
  }

  function reset() {
    setState(null);
    setActiveTab("panel");
  }

  // --- TRYB GRACZA: wybór/odznaczenie opcji decyzji w bieżącej turze -------
  // Limit wyborów w miesiącu = 3 aktywności (łagodniej/trudniej wg poziomu
  // trudności — patrz DIFFICULTY_LEVELS.activityBonus).
  const [foundPartyModalOpen, setFoundPartyModalOpen] = useState(false);

  function toggleDecisionChoice(decisionId, optionId) {
    // §2: zamiast od razu auto-generować partię, otwieramy pełny kreator —
    // to jest priorytet #1 z prośby o naprawę tworzenia własnej partii.
    if (decisionId === "found_party" && optionId === "found") {
      setFoundPartyModalOpen(true);
      return;
    }
    setState((prev) => {
      if (!prev.currentTurn) return prev;
      const chosen = prev.currentTurn.chosen || [];
      const existingIdx = chosen.findIndex((c) => c.decisionId === decisionId);
      let nextChosen;
      if (existingIdx >= 0 && chosen[existingIdx].optionId === optionId) {
        nextChosen = chosen.filter((c) => c.decisionId !== decisionId);
      } else if (existingIdx >= 0) {
        nextChosen = chosen.map((c, i) => (i === existingIdx ? { decisionId, optionId } : c));
      } else {
        const bonus = prev.player ? (DIFFICULTY_LEVELS[prev.player.difficulty]?.activityBonus ?? 0) : 0;
        const maxActivities = Math.max(1, 3 + bonus);
        if (chosen.length >= maxActivities) return prev;
        nextChosen = [...chosen, { decisionId, optionId }];
      }
      return { ...prev, currentTurn: { ...prev.currentTurn, chosen: nextChosen } };
    });
  }

  // §2: potwierdzenie kreatora nowej partii — zapisuje pełne, świadomie wybrane
  // przez gracza dane (nazwa/skrót/kolor/ideologia/platforma) do bieżącej tury,
  // żeby resolvePlayerMonth użył ich zamiast wartości auto-generowanych.
  function confirmFoundParty(details) {
    setFoundPartyModalOpen(false);
    setState((prev) => {
      if (!prev.currentTurn) return prev;
      const chosen = prev.currentTurn.chosen || [];
      const bonus = prev.player ? (DIFFICULTY_LEVELS[prev.player.difficulty]?.activityBonus ?? 0) : 0;
      const maxActivities = Math.max(1, 3 + bonus);
      const alreadyChosen = chosen.some((c) => c.decisionId === "found_party");
      if (!alreadyChosen && chosen.length >= maxActivities) return prev;
      const nextChosen = [
        ...chosen.filter((c) => c.decisionId !== "found_party"),
        { decisionId: "found_party", optionId: "found", foundPartyDetails: details },
      ];
      return { ...prev, currentTurn: { ...prev.currentTurn, chosen: nextChosen } };
    });
  }

  function cancelFoundPartyModal() {
    setFoundPartyModalOpen(false);
  }

  function removeFoundPartyChoice() {
    setFoundPartyModalOpen(false);
    setState((prev) => {
      if (!prev.currentTurn) return prev;
      const nextChosen = (prev.currentTurn.chosen || []).filter((c) => c.decisionId !== "found_party");
      return { ...prev, currentTurn: { ...prev.currentTurn, chosen: nextChosen } };
    });
  }

  // --- §13: ręczne negocjacje koalicyjne (tylko gdy gracz jest liderem partii) ---
  // Gracz zaznacza potencjalnych partnerów; każdy z nich "odpowiada" na
  // propozycję na podstawie dystansu ideologicznego (BLOC_RANK) i relacji
  // gracza z jego liderem (npc_leader_<id>) plus odrobiny losowości.
  function negotiateCoalition(selectedPartnerIds) {
    setState((prev) => {
      if (!prev.pendingCoalition || !prev.player) return prev;
      const { sejmSeats, sejmSeatsTotal, playerPartyId } = prev.pendingCoalition;
      const majority = majorityFor(sejmSeatsTotal || SEJM_SEATS);
      const playerBloc = prev.registry[playerPartyId]?.bloc || "centrum";

      const responses = [];
      let relations = { ...(prev.playerRelations || {}) };
      const accepted = [];
      selectedPartnerIds.forEach((pid) => {
        if (pid === playerPartyId) return;
        const partnerBloc = prev.registry[pid]?.bloc || "centrum";
        const distance = Math.abs((BLOC_RANK[partnerBloc] ?? 3) - (BLOC_RANK[playerBloc] ?? 3));
        const rel = getRelation(relations, "npc_leader_" + pid);
        const chance = clamp(0.75 - distance * 0.15 + rel.score / 250, 0.05, 0.95);
        const accept = Math.random() < chance;
        if (accept) {
          accepted.push(pid);
          relations = adjustRelation(relations, "npc_leader_" + pid, 6, fmtDate(prev.date));
        } else {
          relations = adjustRelation(relations, "npc_leader_" + pid, -4, fmtDate(prev.date));
        }
        responses.push({ partyId: pid, accepted: accept });
      });

      const coalitionIds = [playerPartyId, ...accepted];
      const total = coalitionIds.reduce((sum, id) => sum + (sejmSeats[id] || 0), 0);
      const hasMajority = total >= majority;
      const government = {
        label: hasMajority ? "Koalicja utworzona przez gracza" : "Rząd mniejszościowy (negocjacje gracza)",
        coalition: coalitionIds,
        pm: playerPartyId,
        total,
      };

      const governmentHistory = [...(prev.governmentHistory || [])];
      if (governmentHistory.length) {
        governmentHistory[governmentHistory.length - 1] = {
          ...governmentHistory[governmentHistory.length - 1],
          label: government.label,
          coalition: government.coalition,
          pm: government.pm,
        };
      }

      const log = [...prev.log];
      responses.forEach((r) => {
        log.push({
          date: fmtDate(prev.date),
          text: `🤝 ${prev.registry[r.partyId]?.full || r.partyId} ${r.accepted ? "przyjmuje" : "odrzuca"} propozycję koalicyjną.`,
        });
      });
      log.push({
        date: fmtDate(prev.date),
        text: `🏛️ Rząd sformowany w wyniku negocjacji gracza: ${government.label} (${total}/${sejmSeatsTotal || SEJM_SEATS} mandatów).`,
      });

      const player = prev.player.role === "party_leader" ? { ...prev.player, role: "pm" } : prev.player;
      const governmentStability = computeGovernmentStability(prev.governmentStability, government, sejmSeatsTotal, prev.world, player, relations);

      return {
        ...prev,
        government,
        governmentHistory,
        playerRelations: relations,
        log: log.slice(-40),
        pendingCoalition: null,
        player,
        governmentStability,
      };
    });
  }

  // Rezygnacja z ręcznych negocjacji — oddaje formowanie rządu automatycznemu
  // silnikowi (formGovernment), dokładnie tak jak w trybie symulacji.
  function autoFormPendingGovernment() {
    setState((prev) => {
      if (!prev.pendingCoalition) return prev;
      const { sejmSeats, sejmSeatsTotal } = prev.pendingCoalition;
      const activeParties = Object.keys(prev.polls).filter((id) => prev.registry[id]).map((id) => prev.registry[id]);
      const government = formGovernment(sejmSeats, prev.government.coalition, activeParties, majorityFor(sejmSeatsTotal || SEJM_SEATS));
      const governmentHistory = [...(prev.governmentHistory || [])];
      if (governmentHistory.length) {
        governmentHistory[governmentHistory.length - 1] = {
          ...governmentHistory[governmentHistory.length - 1],
          label: government.label,
          coalition: government.coalition,
          pm: government.pm,
        };
      }
      const log = [...prev.log, { date: fmtDate(prev.date), text: `🏛️ Formowanie rządu oddane automatycznemu silnikowi: ${government.label}.` }];
      return { ...prev, government, governmentHistory, log: log.slice(-40), pendingCoalition: null };
    });
  }

  // --- §19: wybór nowej ambicji po osiągnięciu poprzedniej ---
  function chooseNewAmbition(ambitionId) {
    setState((prev) => {
      if (!prev.player) return prev;
      const log = [...prev.log, { date: fmtDate(prev.date), text: `🎯 ${prev.player.name} wyznacza sobie nowy cel: „${ambitionLabel(ambitionId)}”.` }];
      return {
        ...prev,
        player: { ...prev.player, ambition: ambitionId, ambitionAchieved: false },
        log: log.slice(-40),
      };
    });
  }

  const [newPartyDraft, setNewPartyDraft] = useState({ name: "", full: "", color: PALETTE[0], bloc: "centrum", start: "1", minority: false });
  const [draftStartDate, setDraftStartDate] = useState(safeState.date);

  useEffect(() => {
    if (state && activeTab === "ustawienia") setDraftStartDate(state.date);
  }, [activeTab, state]);

  function addParty() {
    const name = newPartyDraft.name.trim();
    if (!name) return;
    setState((prev) => {
      const baseId = slugify(name);
      const id = uniqueId(baseId, Object.keys(prev.registry));
      const startVal = Math.max(0.01, parseFloat(String(newPartyDraft.start).replace(",", ".")) || 1);
      const def = {
        id,
        name,
        full: newPartyDraft.full.trim() || name,
        color: newPartyDraft.color,
        bloc: newPartyDraft.bloc,
        start: startVal,
        minority: newPartyDraft.minority,
      };
      const registry = { ...prev.registry, [id]: def };
      const polls = addPollEntry(prev.polls, id, startVal);
      const log = [
        ...prev.log,
        { date: fmtDate(prev.date), text: `➕ Do gry wchodzi nowa partia: ${def.full} (start: ${pct(polls[id])}).` },
      ].slice(-40);
      return { ...prev, registry, polls, log };
    });
    setNewPartyDraft({ name: "", full: "", color: randomColor([...Object.values(state.registry).map((p) => p.color), newPartyDraft.color]), bloc: "centrum", start: "1", minority: false });
  }

  function removeParty(id) {
    setState((prev) => {
      const activeIds = Object.keys(prev.polls);
      if (!activeIds.includes(id) || activeIds.length <= 2) return prev;
      const def = prev.registry[id];
      const polls = removePollEntry(prev.polls, id);
      const log = [
        ...prev.log,
        { date: fmtDate(prev.date), text: `➖ Partia ${def.full} zostaje wycofana z sondaży i dalszej rywalizacji.` },
      ].slice(-40);
      return { ...prev, polls, log };
    });
  }

  function applyPollEdit(id, newValue) {
    setState((prev) => {
      if (!(id in prev.polls)) return prev;
      const def = prev.registry[id];
      const polls = setPollValue(prev.polls, id, newValue);
      const log = [
        ...prev.log,
        { date: fmtDate(prev.date), text: `✏️ Ręczna korekta sondażu: ${def.name} → ${pct(polls[id])} (reszta partii przeskalowana proporcjonalnie).` },
      ].slice(-40);
      return { ...prev, polls, log };
    });
  }

  function changePartyColor(id, newColor) {
    setState((prev) => {
      if (!prev.registry[id]) return prev;
      const registry = { ...prev.registry, [id]: { ...prev.registry[id], color: newColor } };
      return { ...prev, registry };
    });
  }

  function updateSettings(patch) {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }

  function resetWithCurrentConfig() {
    const parties = Object.keys(state.polls)
      .filter((id) => state.registry[id])
      .map((id) => ({ ...state.registry[id], start: state.polls[id] }));
    if (parties.length < 2) return;
    setState(buildInitialState({ parties, startDate: draftStartDate, president: state.president, settings: state.settings, sejmSeatsTotal: state.sejmSeatsTotal }));
    setActiveTab("panel");
  }

  const hemicycleSejm = useMemo(() => buildHemicycle(safeState.sejmSeats, ideologicalOrder), [safeState.sejmSeats, ideologicalOrder]);
  const hemicycleSenat = useMemo(() => buildHemicycle(safeState.senatSeats, ideologicalOrder), [safeState.senatSeats, ideologicalOrder]);
  const hemicycleEP = useMemo(() => buildHemicycle(safeState.epSeats, ideologicalOrder), [safeState.epSeats, ideologicalOrder]);

  // Alternatywny układ ław — westminsterski (rząd kontra opozycja, naprzeciw
  // siebie) zamiast domyślnego półkolistego hemicyklu. Przełącznik w panelu
  // pozwala podejrzeć Sejm/Senat/PE w obu stylach.
  const [diagramStyle, setDiagramStyle] = useState("hemicycle");
  const coalitionIds = safeState.government?.coalition || [];
  const westminsterSejm = useMemo(() => buildWestminster(safeState.sejmSeats, ideologicalOrder, coalitionIds), [safeState.sejmSeats, ideologicalOrder, coalitionIds]);
  const westminsterSenat = useMemo(() => buildWestminster(safeState.senatSeats, ideologicalOrder, coalitionIds), [safeState.senatSeats, ideologicalOrder, coalitionIds]);
  const westminsterEP = useMemo(() => buildWestminster(safeState.epSeats, ideologicalOrder, coalitionIds), [safeState.epSeats, ideologicalOrder, coalitionIds]);

  // Zwięzła historia głów państwa i szefów rządów — kolejne kadencje tej samej
  // osoby/obozu (prezydent) lub tego samego premiera (nawet przy zmianie
  // składu koalicji) są łączone w jeden wpis do zakładki "Prezydenci i premierzy".
  const presidentBlocks = useMemo(() => buildPresidentBlocks(safeState.presidentHistory), [safeState.presidentHistory]);
  const premierBlocks = useMemo(() => buildPremierBlocks(safeState.governmentHistory), [safeState.governmentHistory]);

  // Wszystkie id partii, które kiedykolwiek pojawiły się w historii sondaży —
  // potrzebne, aby wykres trendu poprawnie rysował linie także dla partii
  // usuniętych w trakcie symulacji.
  const chartPartyIds = useMemo(() => {
    const ids = new Set();
    (safeState.history || []).forEach((row) => Object.keys(row).forEach((k) => { if (k !== "label") ids.add(k); }));
    return Array.from(ids).filter((id) => safeState.registry[id]);
  }, [safeState.history, safeState.registry]);

  // Gdy checkbox "nie dodawaj nowych partii na wykres" jest zaznaczony, każda
  // partia, która pojawia się w chartPartyIds po raz pierwszy (nowo powstała
  // w trakcie symulacji), trafia od razu do ukrytych — nie zaśmieca wykresu.
  useEffect(() => {
    if (!knownChartPartyIdsRef.current) {
      knownChartPartyIdsRef.current = new Set(chartPartyIds);
      return;
    }
    const known = knownChartPartyIdsRef.current;
    const freshlyAdded = chartPartyIds.filter((id) => !known.has(id));
    if (freshlyAdded.length) {
      if (dontAutoShowNewParties) {
        setHiddenChartPartyIds((prev) => {
          const next = new Set(prev);
          freshlyAdded.forEach((id) => next.add(id));
          return next;
        });
      }
      freshlyAdded.forEach((id) => known.add(id));
    }
  }, [chartPartyIds, dontAutoShowNewParties]);

  // Tylko partie niezaznaczone jako ukryte trafiają na wykres — oś Y (domain
  // "dataMax + 5") liczy się wyłącznie na podstawie faktycznie renderowanych
  // linii, więc wykres automatycznie przeskalowuje się do widocznego zakresu.
  const visibleChartPartyIds = useMemo(
    () => chartPartyIds.filter((id) => !hiddenChartPartyIds.has(id)),
    [chartPartyIds, hiddenChartPartyIds]
  );

  // Ekran konfiguracji — dopóki gracz nie uzupełni danych i nie rozpocznie gry,
  // nie ma jeszcze żadnego stanu rozgrywki do wyświetlenia.
  if (!state) {
    return (
      <SetupScreen
        onStart={(config) => {
          if (config.gameMode === "player" && !isPlayerModeUnlocked()) return;
          setState(buildInitialState(config));
          setActiveTab("panel");
        }}
        autosave={autosave}
        saves={saves}
        onContinueAutosave={() => {
          if (autosave && requirePlayerModeAccess(autosave)) {
            setState(autosave);
            setActiveTab("panel");
          }
        }}
        onLoadSave={loadSavedGame}
        onImportFile={importGameFromFile}
      />
    );
  }

  const nextElections = Object.entries(state.schedule)
    .map(([key, d]) => ({ key, d }))
    .sort((a, b) => (a.d.year - b.d.year) * 12 + (a.d.month - b.d.month));

  // Domyślnie wykres pokazuje ostatnie 5 lat (60 miesięcy) dla czytelności,
  // ale cała historia sondaży jest zachowywana w state.history, więc gracz
  // może w każdej chwili przełączyć się na widok pełnej historii symulacji.
  const chartData = chartRange === "all" ? state.history : state.history.slice(-60);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <FeedbackWidget />
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        {/* NAGŁÓWEK */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-6 mb-6">
          <div>
            <p className="text-xs uppercase tracking-widest text-red-500 font-mono mb-1">Symulator sceny politycznej — RP</p>
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-slate-50">{fmtDate(state.date)}</h1>
            <p className="text-slate-400 text-sm mt-1">Start symulacji: {fmtDate(state.startDate)}</p>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm"
            >
              <RotateCcw size={16} /> Reset
            </button>
            <button
              onClick={advance}
              className="flex items-center gap-2 px-5 py-2 rounded-md bg-red-600 hover:bg-red-500 text-white font-medium transition-colors text-sm"
            >
              Kolejny miesiąc <ChevronRight size={16} />
            </button>
            {/* §28: szybsze tempo — dostępne zarówno w symulacji, jak i w trybie
                gracza. W trybie gracza inteligentnie zatrzymuje się na wyborach,
                kryzysach i ważnych wydarzeniach; w symulacji zatrzymuje się co
                najmniej na wyborach (Sejm/Senat/prezydent/europarlament/samorząd). */}
            {!(state.player && state.player.retired) && (
              <div className="flex gap-1.5">
                <button
                  onClick={() => advanceFast(3)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-xs"
                  title="Symuluje do 3 miesięcy, zatrzymując się wcześniej na wyborach lub ważnym wydarzeniu"
                >
                  Symuluj kwartał
                </button>
                <button
                  onClick={() => advanceFast(12)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-xs"
                  title="Symuluje do 12 miesięcy, zatrzymując się wcześniej na wyborach lub ważnym wydarzeniu"
                >
                  Symuluj rok
                </button>
              </div>
            )}
          </div>
        </div>

        {/* §29: AUTOMATYCZNA SYMULACJA — tylko w trybie symulacji (bez gracza,
            który podejmuje decyzje co miesiąc). Pozwala wyłączyć zatrzymywanie
            się na wyborach oraz rozegrać wszystkie miesiące do wskazanej daty
            jedną komendą. */}
        {state.gameMode === "simulation" && !(state.player && state.player.retired) && (
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
              <CalendarClock size={14} /> Automatyczna symulacja
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={state.settings?.stopOnElections !== false}
                  onChange={(e) => updateSettings({ stopOnElections: e.target.checked })}
                  className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 accent-red-600"
                />
                Zatrzymuj symulację na wyborach
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 whitespace-nowrap">Symuluj automatycznie do:</span>
                <select
                  value={(simulateUntilDraft || state.date).month}
                  onChange={(e) =>
                    setSimulateUntilDraft((d) => ({ year: (d || state.date).year, month: Number(e.target.value) }))
                  }
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                >
                  {MONTHS_PL.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
                <select
                  value={(simulateUntilDraft || { year: state.date.year + 1 }).year}
                  onChange={(e) =>
                    setSimulateUntilDraft((d) => ({ month: (d || state.date).month, year: Number(e.target.value) }))
                  }
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                >
                  {Array.from({ length: 61 }, (_, i) => state.date.year + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <button
                  onClick={() => advanceUntilDate(simulateUntilDraft || { year: state.date.year + 1, month: state.date.month })}
                  disabled={monthsUntil(state.date, simulateUntilDraft || { year: state.date.year + 1, month: state.date.month }) <= 0}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-xs font-medium transition-colors"
                >
                  Symuluj do tej daty
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-2">
              Rozegra jedną komendą wszystkie miesiące dzielące bieżącą datę od wskazanej (ta sama logika co „Symuluj kwartał/rok”) —
              zatrzyma się wcześniej przy kryzysie rządowym lub innym ważnym wydarzeniu, a na wyborach tylko jeśli zaznaczona jest
              powyższa opcja.
            </p>
          </div>
        )}

        {/* §28: PODSUMOWANIE SZYBKIEJ SYMULACJI */}
        {state.fastForwardSummary && (
          <div className={`rounded-lg p-4 mb-6 border ${state.fastForwardSummary.stoppedEarly ? "bg-red-950/40 border-red-800" : "bg-slate-900 border-slate-800"}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-wide text-slate-400 mb-1">
                  {state.fastForwardSummary.stoppedEarly ? "⚠️ Szybka symulacja zatrzymana" : "Podsumowanie szybkiej symulacji"}
                </p>
                <p className="text-slate-200 text-sm">
                  {state.fastForwardSummary.fromDate} → {state.fastForwardSummary.toDate} ({state.fastForwardSummary.monthsRun} mies.)
                </p>
              </div>
              <button onClick={dismissFastForwardSummary} className="text-xs text-slate-500 hover:text-slate-300">
                Zamknij
              </button>
            </div>

            {state.fastForwardSummary.stoppedEarly && (
              <div className="mt-2 space-y-1">
                {state.fastForwardSummary.stopReasons.map((r, i) => (
                  <p key={i} className="text-sm text-red-300">• {r}</p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
              {state.fastForwardSummary.partyPollDelta !== null && (
                <div>
                  <p className="text-slate-500">Poparcie partii</p>
                  <p className={`font-mono ${state.fastForwardSummary.partyPollDelta >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {state.fastForwardSummary.partyPollDelta >= 0 ? "+" : ""}{state.fastForwardSummary.partyPollDelta.toFixed(2)} pp
                  </p>
                </div>
              )}
              {state.fastForwardSummary.statDeltas && (
                <div>
                  <p className="text-slate-500">Popularność</p>
                  <p className={`font-mono ${(state.fastForwardSummary.statDeltas.popularity || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {(state.fastForwardSummary.statDeltas.popularity || 0) >= 0 ? "+" : ""}{Math.round(state.fastForwardSummary.statDeltas.popularity || 0)}
                  </p>
                </div>
              )}
              {state.player && (
                <>
                  <div>
                    <p className="text-slate-500">Poziom kariery</p>
                    <p className="font-mono text-slate-200">+{state.fastForwardSummary.careerLevelDelta}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Budżet</p>
                    <p className={`font-mono ${state.fastForwardSummary.budgetDelta >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {state.fastForwardSummary.budgetDelta >= 0 ? "+" : ""}{Math.round(state.fastForwardSummary.budgetDelta)}
                    </p>
                  </div>
                </>
              )}
            </div>

            {state.fastForwardSummary.majorEvents.length > 0 && (
              <div className="mt-3">
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">Najważniejsze wydarzenia okresu</p>
                <ul className="space-y-1">
                  {state.fastForwardSummary.majorEvents.map((e, i) => (
                    <li key={i} className="text-xs text-slate-400">
                      <span className="text-slate-600 font-mono mr-1.5">{e.date}</span>{e.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ZAKŁADKI */}
        <div className="flex gap-2 mb-6 border-b border-slate-800 flex-wrap">
          {[
            ...(state.gameMode === "player" && state.player ? [{ key: "gracz", label: "Moja postać" }] : []),
            { key: "panel", label: "Panel bieżący" },
            { key: "archiwum", label: `Archiwum wyborów (${state.electionsArchive.length})` },
            { key: "wladze", label: "Prezydenci i premierzy" },
            { key: "ustawienia", label: "Ustawienia" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.key
                  ? "border-red-500 text-slate-50"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {tab.key === "ustawienia" && <Settings2 size={14} />}
              {tab.key === "wladze" && <Crown size={14} />}
              {tab.key === "gracz" && <Sparkles size={14} />}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "gracz" && state.player && (
          <PlayerModeTab
            state={state}
            onToggleDecision={toggleDecisionChoice}
            onNegotiateCoalition={negotiateCoalition}
            onAutoFormGovernment={autoFormPendingGovernment}
            onChooseAmbition={chooseNewAmbition}
          />
        )}

        {foundPartyModalOpen && state.player && (
          <FoundPartyModal
            player={state.player}
            existingColors={Object.values(state.registry).map((p) => p.color)}
            existing={(state.currentTurn?.chosen || []).find((c) => c.decisionId === "found_party")?.foundPartyDetails}
            onConfirm={confirmFoundParty}
            onCancel={cancelFoundPartyModal}
            onRemove={removeFoundPartyChoice}
          />
        )}

        {activeTab === "panel" && (
        <>
        {/* KARTY STATUSU */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide mb-2">
              <Landmark size={14} /> Większość rządząca
            </div>
            <p className="text-lg font-semibold text-slate-50">{state.government.label}</p>
            <p className="text-sm text-slate-400 mt-1">
              {state.government.coalition.map((id) => state.registry[id]?.name || id).join(" + ")} — {state.government.total}/{state.sejmSeatsTotal || SEJM_SEATS} mandatów
            </p>
            <p className="text-sm text-slate-500 mt-1">Premier: {state.government.pm ? state.registry[state.government.pm]?.full : "brak"}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide mb-2">
              <Crown size={14} /> Prezydent RP
            </div>
            <p className="text-lg font-semibold text-slate-50">{state.president.name}</p>
            <p className="text-sm text-slate-400 mt-1">{state.president.note}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide mb-2">
              <Sparkles size={14} /> Stabilność rządu
            </div>
            {(() => {
              const stability = Number.isFinite(state.governmentStability) ? state.governmentStability : 50;
              const tone = stability >= 60 ? "bg-emerald-500" : stability >= 30 ? "bg-amber-500" : "bg-red-500";
              const label = stability >= 60 ? "Rząd stabilny" : stability >= 30 ? "Podwyższone ryzyko kryzysu" : "Wysokie ryzyko rozpadu";
              return (
                <>
                  <p className="text-2xl font-semibold text-slate-50">{Math.round(stability)}%</p>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden mt-2">
                    <div className={`${tone} h-full rounded-full`} style={{ width: `${stability}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-2">{label}</p>
                </>
              );
            })()}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wide mb-2">
              <Globe2 size={14} /> Najbliższe wybory
            </div>
            <ul className="text-sm space-y-1">
              {nextElections.slice(0, 4).map((e) => (
                <li key={e.key} className="flex justify-between text-slate-300">
                  <span>{ELECTION_LABELS[e.key]}</span>
                  <span className="text-slate-500 font-mono">{fmtDate(e.d)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* SONDAŻE — TABELA I WYKRES */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-3">Aktualne poparcie</h2>
            <div className="space-y-1.5">
              {partyOrderBySize.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="w-28 truncate text-slate-300">{p.name}</span>
                  <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, state.polls[p.id] * 2.6)}%`, backgroundColor: p.color }} />
                  </div>
                  <span className="w-16 text-right font-mono text-slate-400">{pct(state.polls[p.id])}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm uppercase tracking-wide text-slate-400">Trend sondażowy</h2>
              <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-md p-0.5">
                <button
                  onClick={() => setChartRange("recent")}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${chartRange === "recent" ? "bg-red-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Ostatnie 5 lat
                </button>
                <button
                  onClick={() => setChartRange("all")}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${chartRange === "all" ? "bg-red-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Cała historia
                </button>
              </div>
            </div>

            {/* Wybór partii widocznych na wykresie — kliknięcie ukrywa/pokazuje
                linię, a oś Y automatycznie przeskalowuje się do widocznego zakresu. */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {chartPartyIds.map((id) => {
                const hidden = hiddenChartPartyIds.has(id);
                const p = state.registry[id];
                return (
                  <button
                    key={id}
                    onClick={() => toggleChartPartyVisibility(id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors ${
                      hidden ? "bg-slate-950 border-slate-800 text-slate-600" : "bg-slate-950 border-slate-700 text-slate-300"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: hidden ? "#334155" : p.color }}
                    />
                    {p.name}
                  </button>
                );
              })}
              {chartPartyIds.length > 1 && (
                <>
                  <button
                    onClick={() => setHiddenChartPartyIds(new Set())}
                    className="px-2 py-1 rounded-md text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Pokaż wszystkie
                  </button>
                  <button
                    onClick={() => setHiddenChartPartyIds(new Set(chartPartyIds))}
                    className="px-2 py-1 rounded-md text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    Ukryj wszystkie
                  </button>
                </>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-500 mb-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontAutoShowNewParties}
                onChange={(e) => setDontAutoShowNewParties(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950"
              />
              Nie dodawaj nowych partii na wykres
            </label>

            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" tick={{ fill: "#64748b", fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  domain={[0, "dataMax + 5"]}
                  tickFormatter={(v) => v.toFixed(2)}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", fontSize: 12 }}
                  formatter={(value, name) => [`${Number(value).toFixed(2)}%`, name]}
                />
                {visibleChartPartyIds.map((id) => (
                  <Line key={id} type="monotone" dataKey={id} name={state.registry[id].name} stroke={state.registry[id].color} dot={false} strokeWidth={1.6} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* HEMICYKLE */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm uppercase tracking-wide text-slate-400">Podgląd parlamentów</h2>
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-md p-0.5">
            {[
              { key: "hemicycle", label: "Hemicykl" },
              { key: "westminster", label: "Westminster" },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setDiagramStyle(opt.key)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  diagramStyle === opt.key ? "bg-red-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {[
            { title: "Sejm", seats: state.sejmSeats, total: state.sejmSeatsTotal || SEJM_SEATS, dots: diagramStyle === "hemicycle" ? hemicycleSejm : westminsterSejm },
            { title: "Senat", seats: state.senatSeats, total: SENAT_SEATS, dots: diagramStyle === "hemicycle" ? hemicycleSenat : westminsterSenat },
            { title: "Parlament Europejski", seats: state.epSeats, total: EP_SEATS, dots: diagramStyle === "hemicycle" ? hemicycleEP : westminsterEP },
          ].map((chart) => (
            <div key={chart.title} className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-2">
                {chart.title} <span className="text-slate-600 font-mono">({chart.total})</span>
              </h2>
              <svg viewBox="0 0 560 280" className="w-full h-auto">
                {chart.dots.map((d, i) => (
                  <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={state.registry[d.partyId]?.color || "#475569"} />
                ))}
              </svg>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-slate-400">
                {Object.keys(chart.seats)
                  .filter((id) => chart.seats[id] > 0 && state.registry[id])
                  .sort((a, b) => chart.seats[b] - chart.seats[a])
                  .map((id) => (
                    <span key={id} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: state.registry[id].color }} />
                      {state.registry[id].name} {chart.seats[id]}
                    </span>
                  ))}
              </div>
            </div>
          ))}
        </div>

        {/* SEJMIKI */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-8">
          <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
            <MapPinned size={14} /> Kontrolowane sejmiki wojewódzkie (16)
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(state.sejmikControl)
              .filter((id) => state.sejmikControl[id] > 0 && state.registry[id])
              .sort((a, b) => state.sejmikControl[b] - state.sejmikControl[a])
              .map((id) => (
                <span
                  key={id}
                  className="px-3 py-1.5 rounded-full text-xs font-medium text-slate-950"
                  style={{ backgroundColor: state.registry[id].color }}
                >
                  {state.registry[id].name}: {state.sejmikControl[id]}
                </span>
              ))}
          </div>
        </div>

        {/* DZIENNIK WYDARZEŃ */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-3">Kronika</h2>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-2">
            {[...state.log].reverse().map((entry, i) => (
              <div key={i} className="text-sm border-l-2 border-slate-700 pl-3">
                <span className="text-slate-500 font-mono text-xs">{entry.date}</span>
                <p className="text-slate-300">{entry.text}</p>
              </div>
            ))}
          </div>
        </div>
        </>
        )}

        {activeTab === "archiwum" && (
          <div className="space-y-4 mb-8">
            {state.electionsArchive.length === 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-lg p-8 text-center text-slate-500 text-sm">
                Żadne wybory jeszcze się nie odbyły. Kliknij „Kolejny miesiąc”, aż symulacja dotrze do najbliższego terminu z karty „Najbliższe wybory”.
              </div>
            )}
            {[...state.electionsArchive].reverse().map((e, idx) => (
              <ElectionCard key={idx} entry={e} registry={state.registry} player={state.player} />
            ))}
          </div>
        )}

        {activeTab === "wladze" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* LISTA PREZYDENTÓW */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
                <Crown size={14} /> Lista prezydentów
              </div>
              {presidentBlocks.length === 0 && (
                <p className="text-sm text-slate-500">Brak danych — symulacja jeszcze się nie rozpoczęła.</p>
              )}
              <ol className="space-y-3">
                {presidentBlocks.map((b, idx) => (
                  <li key={idx} className="text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="text-slate-500 font-mono w-5 shrink-0">{idx + 1}.</span>
                      <div>
                        <span className="text-slate-100 font-medium">{b.name}</span>{" "}
                        <span className="text-slate-500 font-mono">{fmtYearRange(b.from, b.to)}</span>
                        {b.terms > 1 && (
                          <span className="text-slate-600"> ({b.terms} kadencje)</span>
                        )}
                        {b.note && <p className="text-slate-500 text-xs mt-0.5">{b.note}</p>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* LISTA PREMIERÓW */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
                <Landmark size={14} /> Lista premierów
              </div>
              {premierBlocks.length === 0 && (
                <p className="text-sm text-slate-500">Brak danych — symulacja jeszcze się nie rozpoczęła.</p>
              )}
              <ol className="space-y-3">
                {premierBlocks.map((b, idx) => {
                  const pmParty = b.pm ? state.registry[b.pm] : null;
                  return (
                    <li key={idx} className="text-sm">
                      <div className="flex items-baseline gap-2">
                        <span className="text-slate-500 font-mono w-5 shrink-0">{idx + 1}.</span>
                        <div>
                          <span className="text-slate-100 font-medium">
                            {pmParty ? `Premier (${pmParty.name})` : "Brak premiera / rząd niesformowany"}
                          </span>{" "}
                          <span className="text-slate-500 font-mono">{fmtYearRange(b.from, b.to)}</span>
                          {b.segments.length > 1 && (
                            <p className="text-slate-500 text-xs mt-0.5">
                              (
                              {b.segments.map((seg, sidx) => {
                                const partyNames = seg.coalition.map((id) => state.registry[id]?.name || id).join(", ");
                                return (
                                  <span key={sidx}>
                                    {sidx > 0 ? "; " : ""}
                                    {fmtYearRange(seg.from, seg.to)} w rządzie {seg.coalition.length > 1 ? "partie" : "partia"} {partyNames}
                                  </span>
                                );
                              })}
                              )
                            </p>
                          )}
                          {b.segments.length === 1 && (
                            <p className="text-slate-500 text-xs mt-0.5">
                              w rządzie {b.segments[0].coalition.length > 1 ? "partie" : "partia"}{" "}
                              {b.segments[0].coalition.map((id) => state.registry[id]?.name || id).join(", ")}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}

        {activeTab === "ustawienia" && (
          <div className="space-y-6 mb-8">
            {/* ZAPISY GRY */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
                <Save size={14} /> Zapisy gry
              </div>
              <p className="text-sm text-slate-500 mb-3">
                Gra zapisuje się automatycznie w przeglądarce po każdej zmianie (autosave) — na ekranie startowym pojawi się
                opcja „Kontynuuj ostatnią grę". Możesz też tworzyć nazwane zapisy albo eksportować/importować grę jako plik.
              </p>

              <div className="flex flex-wrap items-center gap-2 mb-3">
                <input
                  type="text"
                  value={saveNameDraft}
                  onChange={(e) => setSaveNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveCurrentGame(saveNameDraft); }}
                  placeholder={`np. ${fmtDate(state.date)}`}
                  className="flex-1 min-w-[160px] bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                />
                <button
                  onClick={() => saveCurrentGame(saveNameDraft)}
                  disabled={!saveNameDraft.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-medium transition-colors"
                >
                  <Save size={14} /> Zapisz pod tą nazwą
                </button>
                <button
                  onClick={exportCurrentGame}
                  className="flex items-center gap-2 px-4 py-2 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm"
                >
                  <Download size={14} /> Eksportuj do pliku
                </button>
                <label className="flex items-center gap-2 px-4 py-2 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm cursor-pointer">
                  <Upload size={14} /> Wczytaj z pliku
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) importGameFromFile(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {Object.keys(saves).length === 0 && (
                <p className="text-xs text-slate-600">Brak nazwanych zapisów — tylko automatyczny zapis w tle.</p>
              )}
              <div className="space-y-2">
                {Object.entries(saves)
                  .sort((a, b) => new Date(b[1].savedAt) - new Date(a[1].savedAt))
                  .map(([name, entry]) => (
                    <div key={name} className="flex items-center gap-2 text-sm bg-slate-950 border border-slate-800 rounded-md px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-200 truncate">{name}</p>
                        <p className="text-slate-500 text-xs">{fmtDate(entry.state.date)} · zapisano {fmtSavedAt(entry.savedAt)}</p>
                      </div>
                      <button
                        onClick={() => loadSavedGame(name)}
                        className="px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-xs"
                      >
                        Wczytaj
                      </button>
                      <button
                        onClick={() => deleteSavedGame(name)}
                        className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
              </div>
            </div>

            {/* DATA STARTU */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
                <CalendarClock size={14} /> Data startu symulacji
              </div>
              <p className="text-sm text-slate-500 mb-3">
                Zmiana daty startu uruchamia nową symulację od zera (harmonogram wyborów, mandaty i kronika zostają zresetowane),
                z zachowaniem obecnej listy partii i ich aktualnego poparcia jako punktu startowego.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={draftStartDate.month}
                  onChange={(e) => setDraftStartDate((d) => ({ ...d, month: Number(e.target.value) }))}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                >
                  {MONTHS_PL.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
                <select
                  value={draftStartDate.year}
                  onChange={(e) => setDraftStartDate((d) => ({ ...d, year: Number(e.target.value) }))}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                >
                  {Array.from({ length: 71 }, (_, i) => 1990 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <button
                  onClick={resetWithCurrentConfig}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
                >
                  <RotateCcw size={14} /> Uruchom symulację od nowa z tą datą
                </button>
              </div>
            </div>

            {/* PROGI WYBORCZE */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
                <Landmark size={14} /> Progi wyborcze
              </div>
              <div className="flex flex-wrap gap-6">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Sejm (partie mniejszości narodowej zwolnione)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" max="50" step="0.5"
                      value={state.settings?.sejmThreshold ?? 5}
                      onChange={(e) => updateSettings({ sejmThreshold: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 font-mono"
                    /> %
                    {(state.settings?.sejmThreshold ?? 5) !== 5 && (
                      <button
                        onClick={() => updateSettings({ sejmThreshold: 5 })}
                        className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2"
                      >
                        domyślne (5%)
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Parlament Europejski</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" max="50" step="0.5"
                      value={state.settings?.epThreshold ?? 5}
                      onChange={(e) => updateSettings({ epThreshold: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200 font-mono"
                    /> %
                    {(state.settings?.epThreshold ?? 5) !== 5 && (
                      <button
                        onClick={() => updateSettings({ epThreshold: 5 })}
                        className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2"
                      >
                        domyślne (5%)
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-600 mt-2">
                Zmiana zadziała przy najbliższych kolejnych wyborach danego typu (nie przelicza wstecz już rozegranych).
                Senat nie ma progu wyborczego.
              </p>
            </div>

            {/* MECHANIKI ZAAWANSOWANE */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
                <Settings2 size={14} /> Mechaniki zaawansowane
              </div>
              <div className="space-y-3 mb-4">
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!state.settings?.dissolutionEnabled}
                    onChange={(e) => updateSettings({ dissolutionEnabled: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 accent-red-600"
                  />
                  Rozwiązywanie partii po nieprzekroczeniu progu
                  {state.settings?.dissolutionEnabled && (
                    <span className="flex items-center gap-1.5 ml-2">
                      <input
                        type="number" min="0" max="100"
                        value={state.settings.dissolutionChance}
                        onChange={(e) => updateSettings({ dissolutionChance: Number(e.target.value) })}
                        className="w-16 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200"
                      /> %
                    </span>
                  )}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!state.settings?.newPartiesEnabled}
                    onChange={(e) => updateSettings({ newPartiesEnabled: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 accent-red-600"
                  />
                  Tryb "nowych partii" (losowe dołączanie partii z innych szablonów, start 1%)
                  {state.settings?.newPartiesEnabled && (
                    <span className="flex items-center gap-1.5 ml-2">
                      <input
                        type="number" min="0" max="100"
                        value={state.settings.newPartiesChance}
                        onChange={(e) => updateSettings({ newPartiesChance: Number(e.target.value) })}
                        className="w-16 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200"
                      /> % / miesiąc
                    </span>
                  )}
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={state.settings?.randomEventsEnabled !== false}
                    onChange={(e) => updateSettings({ randomEventsEnabled: e.target.checked })}
                    className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 accent-red-600"
                  />
                  Nieprzewidywalne wydarzenia losowe (kryzysy, rozłamy, fuzje, „czarne łabędzie”)
                  {state.settings?.randomEventsEnabled !== false && (
                    <span className="flex items-center gap-1.5 ml-2">
                      <input
                        type="number" min="0" max="100"
                        value={state.settings?.randomEventsChance ?? 18}
                        onChange={(e) => updateSettings({ randomEventsChance: Number(e.target.value) })}
                        className="w-16 bg-slate-800 border border-slate-700 rounded px-1.5 py-1 text-xs text-slate-200"
                      /> % / miesiąc
                    </span>
                  )}
                </label>
              </div>
            </div>

            {/* ZARZĄDZANIE PARTIAMI */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
                <Landmark size={14} /> Partie w grze i ich poparcie
              </div>
              <div className="space-y-2">
                {partyOrderBySize.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-sm bg-slate-950 border border-slate-800 rounded-md px-3 py-2">
                    <input
                      type="color"
                      value={p.color}
                      onChange={(e) => changePartyColor(p.id, e.target.value)}
                      title="Zmień kolor partii"
                      className="w-5 h-5 shrink-0 rounded-full border border-slate-700 bg-transparent cursor-pointer p-0 overflow-hidden [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full"
                    />
                    <div className="w-40 truncate">
                      <p className="text-slate-200 leading-tight flex items-center gap-1.5">
                        {p.name}
                        {p.minority && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30" title="Zwolniona z progu wyborczego do Sejmu">
                            MN
                          </span>
                        )}
                      </p>
                      <p className="text-slate-500 text-xs truncate">{p.full}</p>
                    </div>
                    <span className="text-slate-500 text-xs w-28 shrink-0">{BLOC_LABELS[p.bloc] || p.bloc}</span>
                    <div className="ml-auto">
                      <PollEditor id={p.id} value={state.polls[p.id]} onCommit={applyPollEdit} />
                    </div>
                    <button
                      onClick={() => removeParty(p.id)}
                      disabled={activeParties.length <= 2}
                      title={activeParties.length <= 2 ? "W grze muszą pozostać co najmniej 2 partie" : "Usuń partię"}
                      className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 disabled:opacity-30 disabled:hover:text-slate-500 disabled:hover:bg-transparent transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-600 mt-3">
                Zmiana poparcia, koloru i usuwanie partii działają od razu na trwającej symulacji (pozostałe partie przy zmianie
                poparcia są przeskalowywane proporcjonalnie do 100%). Mandaty i skład rządu aktualizują się dopiero przy
                najbliższych zaplanowanych wyborach.
              </p>
            </div>

            {/* DODAWANIE NOWEJ PARTII */}
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm uppercase tracking-wide text-slate-400 mb-3">
                <Plus size={14} /> Dodaj nową partię
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Skrót nazwy</label>
                  <input
                    type="text"
                    value={newPartyDraft.name}
                    onChange={(e) => setNewPartyDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="np. NP"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Pełna nazwa</label>
                  <input
                    type="text"
                    value={newPartyDraft.full}
                    onChange={(e) => setNewPartyDraft((d) => ({ ...d, full: e.target.value }))}
                    placeholder="np. Nowa Partia"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Blok ideologiczny</label>
                  <select
                    value={newPartyDraft.bloc}
                    onChange={(e) => setNewPartyDraft((d) => ({ ...d, bloc: e.target.value }))}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                  >
                    {BLOC_KEYS.map((b) => (
                      <option key={b} value={b}>{BLOC_LABELS[b]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Kolor</label>
                    <input
                      type="color"
                      value={newPartyDraft.color}
                      onChange={(e) => setNewPartyDraft((d) => ({ ...d, color: e.target.value }))}
                      className="w-12 h-9 bg-slate-800 border border-slate-700 rounded cursor-pointer"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-slate-500 mb-1">Poparcie startowe %</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="90"
                      value={newPartyDraft.start}
                      onChange={(e) => setNewPartyDraft((d) => ({ ...d, start: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm text-slate-200"
                    />
                  </div>
                </div>
                <button
                  onClick={addParty}
                  disabled={!newPartyDraft.name.trim()}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-medium transition-colors"
                >
                  <Plus size={15} /> Dodaj partię
                </button>
              </div>
              <label className="flex items-center gap-2 mt-3 text-xs text-slate-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newPartyDraft.minority}
                  onChange={(e) => setNewPartyDraft((d) => ({ ...d, minority: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 accent-red-600"
                />
                Partia mniejszości narodowej (zwolniona z progu wyborczego do Sejmu)
              </label>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <a
            href="https://tipply.pl/@supekolo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:border-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            💰 Wesprzyj projekt na Tipply
            <ChevronRight size={16} />
          </a>
        </div>

        <div className="mt-6 flex justify-center">
          <a
            href="https://dsj4hillarchitect.tiiny.site/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-5 py-3 text-sm font-semibold text-sky-300 transition-colors hover:border-sky-400 hover:bg-sky-500/20 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            Sprawdź też DSJ 4 Hill Architect
            <ChevronRight size={16} />
          </a>
        </div>

        <p className="text-xs text-slate-600 mt-8 text-center">
          Symulacja fikcyjna. Sondaże zmieniają się losowo (błądzenie losowe + okazjonalne wydarzenia), mandaty liczone metodą D'Hondta,
          sejmiki i wynik prezydencki są uproszczonymi przybliżeniami.
        </p>
      </div>
    </div>
  );
}
