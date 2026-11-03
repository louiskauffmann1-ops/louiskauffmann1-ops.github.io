/* PLOUTOS : l'interface du module budget dans la console NEXUS.
   Chargé à la demande par index.html (vuePloutos). Utilise les outils de la console (el, s, panneau, jauge, avis…),
   le moteur (ploutos-moteur.js) et le coffre chiffré (ploutos-coffre.js). Tout est calculé dans le navigateur. */
(function () {
"use strict";
const M = window.PloutosMoteur, K = window.PloutosCoffre;
// Polices du système de design, chargées à part : sans réseau, PLOUTOS s'affiche quand même (polices de secours).
if (!document.querySelector("link[data-ploutos-polices]")) {
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap";
  l.setAttribute("data-ploutos-polices", "");
  document.head.append(l);
}

/* ---------------------------------------------------------------- Outils */
const fmtEuro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const fmtEuroRond = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euros = (c, { signe = false, rond = false } = {}) => (c == null ? "—" : (signe && c > 0 ? "+" : "") + (rond ? fmtEuroRond : fmtEuro).format(c / 100));
const MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS_LONGS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const dateCourte = (iso) => iso ? `${Number(iso.slice(8, 10))} ${MOIS_COURTS[Number(iso.slice(5, 7)) - 1]}` : "";
const dateLongue = (iso) => iso ? `${Number(iso.slice(8, 10))} ${MOIS_LONGS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "";
const aujourdhui = () => jourParis(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const memo = { lire(k, d) { try { const v = localStorage.getItem("ploutos-" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  ecrire(k, v) { try { localStorage.setItem("ploutos-" + k, JSON.stringify(v)); } catch {} } };
const ICONE = (d) => { const g = s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true", class: "pl-ic" }); g.innerHTML = d; return g; };
const I = {
  recherche: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', fermer: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  lien: '<path d="M8 12h8M6 8H5a4 4 0 0 0 0 8h1M18 8h1a4 4 0 0 1 0 8h-1"/>', fichier: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  synchro: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', export: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  apercu: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  operations: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  epargne: '<path d="M12 21c-4.4 0-8-3.1-8-7 0-3.1 2.3-5.7 5.5-6.6"/><path d="M12 21c4.4 0 8-3.1 8-7s-3.6-7-8-7"/><path d="M12 3v4M10 5h4"/>',
  comptes: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>',
  reglages: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  alerte: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>', fleche: '<path d="m9 6 6 6-6 6"/>',
};
/* Statuts en toutes lettres (contrat C17, C21) : jamais une coche seule. */
const STATUTS = { atteste: ["Attesté", "vert"], calcule: ["Calculé", "miel"], ancien: ["Ancien", "corail"], inconnu: ["À saisir", "corail"] };
const puce = (texte, ton = "", titre) => el("span", { class: "pl-puce " + ton, title: titre || null }, texte);
const puceStatut = (statut, date) => { const [t, ton] = STATUTS[statut] || STATUTS.inconnu; return puce(t + (date ? " · au " + dateCourte(date) : ""), ton,
  { atteste: "Lu dans un relevé ou saisi, sans opération depuis.", calcule: "Dernier solde connu + opérations importées depuis.", ancien: "Dernière information de plus de 3 jours : importe un relevé ou saisis le solde.", inconnu: "Aucun solde de référence : saisis celui affiché par ta banque." }[statut]); };
const initiales = (nom) => { const m = nom.replace(/compte courant/i, "").split(/\s+/).filter(Boolean); return (m.length > 1 ? m[0][0] + m[1][0] : (m[0] || "?").slice(0, 2)).toUpperCase(); };

const P = {
  coffre: null, etat: null, phase: "chargement", erreur: null,
  onglet: memo.lire("onglet", "apercu"), sousReglages: "categories",
  filtres: { du: "", au: "", compte: "", cible: "", ...memo.lire("filtres", {}), periode: "mois", mois: "", q: "", aValider: false, ids: null, titreIds: "", formule: "" },
  selection: new Set(), importsEnCours: null, racine: null, corps: null, liste: null, suggestion: null,
};
const E = () => P.etat;

/* ---------------------------------------------------------------- Ouverture du coffre */
function stockageIdb() {
  let db;
  const ouvrir = () => db || (db = new Promise((ok, ko) => {
    const r = indexedDB.open("ploutos", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("coffre");
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  }));
  const tx = async (mode, f) => { const d = await ouvrir(); return new Promise((ok, ko) => { const t = d.transaction("coffre", mode); const r = f(t.objectStore("coffre")); t.oncomplete = () => ok(r && r.result); t.onerror = () => ko(t.error); }); };
  return {
    lire: (k) => tx("readonly", (st) => st.get(k)).then((v) => v ?? null),
    ecrire: (k, v) => tx("readwrite", (st) => st.put(v, k)),
    effacer: (k) => tx("readwrite", (st) => st.delete(k)),
    toutEffacer: () => tx("readwrite", (st) => st.clear()),
  };
}
function stockageMemoire() { const m = new Map(); return { lire: async (k) => m.get(k) ?? null, ecrire: async (k, v) => { m.set(k, v); }, effacer: async (k) => { m.delete(k); }, toutEffacer: async () => m.clear() }; }
function nomAppareil() {
  let n = memo.lire("appareil", null);
  if (!n) { n = (/Mobi|Android|iPhone/.test(navigator.userAgent) ? "téléphone" : "ordinateur") + "-" + Math.random().toString(36).slice(2, 6); memo.ecrire("appareil", n); }
  return n;
}

async function ouvrir() {
  if (P.ouverture) return P.ouverture;
  P.ouverture = (async () => {
    try {
      const cle = DEMO ? await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) : ((await cleCoffreEnCours) || await lireCle(CLE_COFFRE));
      if (!cle) { P.phase = "cle"; return dessiner(); }
      await demarrer(cle);
    } catch (e) { console.error(e); P.phase = "erreur"; P.erreur = e.message; dessiner(); }
  })();
  return P.ouverture;
}
async function demarrer(cle, ancienne) {
  const distant = DEMO ? null : (donnees && donnees.ploutos && donnees.ploutos.coffre) || null;
  const stockage = DEMO ? stockageMemoire() : stockageIdb();
  P.coffre = new K.Coffre({ cle: ancienne || cle, stockage, distant, appareil: nomAppareil() });
  try { P.etat = await P.coffre.charger(); }
  catch (e) {
    if (e.code === "cle") { P.phase = "ancienne-cle"; P.cleActuelle = cle; P.stockage = stockage; return dessiner(); }
    throw e;
  }
  if (ancienne) { await P.coffre.rechiffrer(cle); P.etat = P.coffre.etat; avis("Coffre rechiffré avec ta nouvelle phrase secrète."); }
  P.phase = "pret";
  P.coffre.surChangement(() => {
    const recus = P.coffre.statut.recus;
    P.etat = P.coffre.etat;
    dessinerStatut();
    if (P.coffre.statut.etat === "conflit-initial") conflitInitial();
    if (recus && !document.querySelector(".pl-voile, .pl-flottant")) { P.coffre.statut.recus = false; dessiner(); }
  });
  dessiner();
  if (distant) P.coffre.synchroniser();
  if (iaDispo() && aClasserIA().length) setTimeout(() => classerIA({ silencieux: true }), 2500);
  addEventListener("online", () => P.coffre && P.coffre.synchroniser());
}
async function faire(action, { redessiner = true } = {}) {
  const r = await P.coffre.faire(action);
  P.etat = P.coffre.etat;
  if (redessiner) dessiner();
  return r;
}

/* ---------------------------------------------------------------- Structure */
// Fintech Premium : barre latérale sur ordinateur, pastilles en haut sur téléphone (la barre NEXUS occupe le bas).
// Budgets arrivera avec P3 ; Importer et Paramètres sont des boutons à part.
const ONGLETS = [["apercu", "Vue globale", "apercu"], ["operations", "Opérations", "operations"], ["epargne", "Épargne", "epargne"], ["comptes", "Comptes", "comptes"]];
const TITRES = { apercu: "Vue globale", operations: "Opérations", epargne: "Épargne", comptes: "Comptes", importer: "Importer des relevés", reglages: "Paramètres" };
const MOIS_NOMS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function vue() {
  if (!P.racine) {
    P.racine = el("div", { class: "pl" });
    ouvrir();
  }
  dessiner();
  return P.racine;
}
function aller(onglet, filtres) {
  P.onglet = onglet; memo.ecrire("onglet", onglet);
  if (onglet === "apercu" && !filtres && P.filtres.periode !== "mois") { P.filtres.periode = "mois"; P.filtres.aValider = false; }
  if (!filtres || !("ids" in filtres)) Object.assign(P.filtres, { ids: null, titreIds: "", formule: "" });
  if (filtres) { Object.assign(P.filtres, filtres); memo.ecrire("filtres", { compte: P.filtres.compte, cible: P.filtres.cible, du: P.filtres.du, au: P.filtres.au }); }
  P.selection.clear();
  dessiner();
  if (P.racine.getBoundingClientRect().top < 0) scrollTo({ top: 0 });
}
/** « Justifier » un chiffre : la liste des opérations montre exactement celles qui le composent (contrat, section 5). */
function justifier(titre, ids, formule = "") {
  aller("operations", { ids: [...ids], titreIds: titre, formule, q: "", aValider: false });
}
function dessiner() {
  if (!P.racine) return;
  const pret = P.phase === "pret";
  const nVerif = pret ? Object.values(P.etat.operations).filter((o) => o.aValider).length : 0;
  const bouton = (id, nom, icone, extra) => el("button", { type: "button", class: "pl-onglet" + (extra || ""), "aria-current": P.onglet === id ? "page" : null, disabled: !pret, onclick: () => aller(id) },
    ICONE(I[icone]), el("span", null, nom), id === "operations" && nVerif ? el("b", { class: "pl-pastille", title: nVerif + " à vérifier" }, String(nVerif)) : null);
  const cote = el("nav", { class: "pl-cote", "aria-label": "Sections de PLOUTOS" },
    el("div", { class: "pl-marque" }, el("span", { class: "pl-logo", "aria-hidden": "true" }, "P"), el("b", null, "Ploutos")),
    el("div", { class: "pl-nav" }, ONGLETS.map(([id, nom, ic]) => bouton(id, nom, ic)), bouton("reglages", "Paramètres", "reglages", " secondaire")),
    el("button", { type: "button", class: "pl-importer", disabled: !pret, "aria-current": P.onglet === "importer" ? "page" : null, onclick: () => aller("importer") }, ICONE(I.plus), el("span", null, "Importer")),
    el("button", { type: "button", class: "pl-statut", id: "pl-statut" }));
  let corps;
  switch (P.phase) {
    case "chargement": corps = el("div", { class: "pl-vide" }, "Ouverture du coffre…"); break;
    case "cle": corps = vueCle(); break;
    case "ancienne-cle": corps = vueAncienneCle(); break;
    case "erreur": corps = carte("Coffre indisponible", null, el("p", null, P.erreur || "Erreur inconnue."), el("button", { class: "pl-btn", type: "button", onclick: () => location.reload() }, "Recharger")); break;
    default: corps = ({ apercu: vueApercu, operations: vueOperations, epargne: vueEpargne, comptes: vueComptes, importer: vueImporter, reglages: vueReglages }[P.onglet] || vueApercu)();
  }
  const recherche = pret ? el("label", { class: "pl-cherche-haut" }, ICONE(I.recherche),
    el("input", { type: "search", placeholder: "Rechercher une opération", "aria-label": "Rechercher une opération", value: P.onglet === "operations" ? P.filtres.q : "",
      onkeydown: (e) => { if (e.key === "Enter") aller("operations", { q: e.target.value, periode: "tout" }); } })) : null;
  const haut = el("header", { class: "pl-haut" }, el("h1", null, TITRES[P.onglet] || "PLOUTOS"), P.onglet !== "operations" ? recherche : null);
  const bandeau = DEMO ? el("div", { class: "pl-bandeau", role: "note" }, "Données fictives · rien n'est enregistré") : null;
  P.corps = el("main", { class: "pl-zone" }, bandeau, haut, el("div", { class: "pl-corps" }, corps));
  P.racine.replaceChildren(cote, P.corps);
  const actif = cote.querySelector('[aria-current="page"]');
  if (actif && innerWidth <= 760) requestAnimationFrame(() => { const a = actif.getBoundingClientRect(), c = cote.getBoundingClientRect(); cote.scrollLeft += a.left - c.left - 12; });
  dessinerStatut();
}
/** Carte de base du système de design (remplace le panneau NEXUS dans PLOUTOS). */
function carte(titre, meta, ...contenu) {
  return el("section", { class: "pl-carte" }, titre ? el("div", { class: "pl-carte-tete" }, el("h2", null, titre), meta || null) : null, ...contenu);
}
function dessinerStatut() {
  const z = P.racine && P.racine.querySelector("#pl-statut");
  if (!z || !P.coffre) return;
  const st = P.coffre.statut, n = P.coffre.attente.length;
  let texte, classe = "";
  if (P.coffre.local) { texte = DEMO ? "Démo, rien n'est gardé" : "Sur cet appareil seulement"; classe = "miel"; }
  else if (st.etat === "synchro") texte = "Synchronisation…";
  else if (st.etat === "hors-ligne") { texte = "Hors ligne" + (n ? " · " + n + " en attente" : ""); classe = "miel"; }
  else if (st.etat === "erreur") { texte = "Synchro en échec"; classe = "corail"; }
  else if (st.etat === "conflit-initial") { texte = "Choix à faire"; classe = "miel"; }
  else texte = n ? n + " en attente d'envoi" : "Coffre synchronisé";
  z.className = "pl-statut " + classe;
  z.replaceChildren(el("i"), el("span", null, texte));
  z.title = st.erreur || (P.coffre.local ? "Les données restent chiffrées sur cet appareil. Ajoute le jeton PLOUTOS_TOKEN pour les retrouver partout (guide, étape 9)." : "Coffre chiffré dans ton dépôt GitHub privé.");
  z.onclick = () => { P.sousReglages = "donnees"; aller("reglages"); };
}

/* ---------------------------------------------------------------- Clé du coffre */
function vueCle() {
  const champ = el("input", { type: "password", autocomplete: "current-password", placeholder: "Phrase secrète NEXUS", "aria-label": "Phrase secrète NEXUS" });
  const msg = el("p", { class: "secondaire" });
  const form = el("form", { class: "pl-cle", onsubmit: async (ev) => {
    ev.preventDefault(); msg.textContent = "Vérification…";
    try {
      if (paquetCourant) await dechiffrer(paquetCourant, await deriver(champ.value, paquetCourant));
    } catch { msg.textContent = "Ce n'est pas la bonne phrase secrète."; return; }
    msg.textContent = "Ouverture du coffre…";
    const cle = await preparerCleCoffre(champ.value);
    champ.value = ""; P.ouverture = null; P.phase = "chargement"; dessiner();
    try { await demarrer(cle); } catch (e) { P.phase = "erreur"; P.erreur = e.message; dessiner(); }
  } }, champ, el("button", { class: "cmd", type: "submit" }, "Ouvrir le coffre"), msg);
  return el("div", { class: "grille" }, el("div", { class: "s6" }, panneau("Coffre PLOUTOS", el("span", { class: "meta" }, "une fois par appareil"), "",
    el("p", null, "Tes données financières sont chiffrées avec ta phrase secrète NEXUS. Retape-la une seule fois sur cet appareil pour créer la clé du coffre."),
    form)));
}
function vueAncienneCle() {
  const champ = el("input", { type: "password", placeholder: "Ancienne phrase secrète", "aria-label": "Ancienne phrase secrète" });
  const msg = el("p", { class: "secondaire" });
  return el("div", { class: "grille" }, el("div", { class: "s6" }, panneau("Coffre chiffré avec une autre phrase", null, "alerte",
    el("p", null, "Ton coffre a été chiffré avec ton ancienne phrase secrète. Tape-la une fois : PLOUTOS rechiffre tout avec la nouvelle."),
    el("form", { class: "pl-cle", onsubmit: async (ev) => {
      ev.preventDefault(); msg.textContent = "Déchiffrement…";
      const ancienne = await K.deriverCle(champ.value);
      try { await demarrer(P.cleActuelle, ancienne); } catch { msg.textContent = "Ce n'est pas l'ancienne phrase secrète."; }
    } }, champ, el("button", { class: "cmd", type: "submit" }, "Rechiffrer le coffre"), msg))));
}
function conflitInitial() {
  if (document.querySelector(".pl-conflit")) return;
  dialogue("Un coffre existe déjà en ligne", el("div", { class: "pl-conflit" },
    el("p", null, "Cet appareil a des données jamais envoyées, et ton dépôt GitHub contient déjà un coffre. Lequel garder ?")), [
    ["Garder le coffre en ligne", async (f) => { f(); await P.coffre.resoudreConflitInitial("en-ligne"); P.etat = P.coffre.etat; dessiner(); }, true],
    ["Le remplacer par cet appareil", async (f) => { f(); await P.coffre.resoudreConflitInitial("cet-appareil"); P.etat = P.coffre.etat; dessiner(); }],
  ]);
}

/* ---------------------------------------------------------------- Filtres */
// La période de référence est UN mois (le mois en cours à l'ouverture), qu'on fait défiler avec ‹ ›.
const moisCourant = () => aujourdhui().slice(0, 7);
const moisChoisi = () => P.filtres.mois || moisCourant();
function decalerMois(m, n) { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); }
function finDuMois(m) { return new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10); }
const nomMois = (m, annee = true) => { const n = MOIS_NOMS[Number(m.slice(5, 7)) - 1]; return n[0].toUpperCase() + n.slice(1) + (annee ? " " + m.slice(0, 4) : ""); };
function bornes() {
  const f = P.filtres;
  if (f.periode === "mois") { const m = moisChoisi(); return { du: m + "-01", au: finDuMois(m) }; }
  return M.periode(f.periode, aujourdhui(), f.du, f.au);
}
/** ‹ Novembre 2026 › : change de mois ; « Revenir à ce mois » quand on s'en éloigne. */
function navigateurMois(auChangement) {
  const f = P.filtres, m = moisChoisi(), courant = m === moisCourant();
  const aller_ = (n) => { f.periode = "mois"; f.mois = decalerMois(m, n); P.selection.clear(); auChangement(); };
  if (f.periode !== "mois") return el("div", { class: "pl-mois" },
    el("button", { type: "button", class: "pl-lien", onclick: () => { f.periode = "mois"; f.mois = ""; auChangement(); } }, "Revenir au mois en cours"));
  return el("div", { class: "pl-mois" },
    el("button", { type: "button", class: "pl-mois-fleche", "aria-label": "Mois précédent", onclick: () => aller_(-1) }, "‹"),
    el("span", { class: "pl-mois-nom", "aria-live": "polite" }, nomMois(m)),
    el("button", { type: "button", class: "pl-mois-fleche", "aria-label": "Mois suivant", disabled: courant, onclick: () => aller_(1) }, "›"),
    !courant ? el("button", { type: "button", class: "pl-lien", onclick: () => { f.periode = "mois"; f.mois = ""; auChangement(); } }, "Revenir à " + nomMois(moisCourant(), false).toLowerCase()) : null);
}
function filtreCible(o) {
  const c = P.filtres.cible;
  if (!c) return true;
  if (c.startsWith("g:")) return o.categorie && M.categorie(E(), o.categorie)?.groupe === c.slice(2);
  if (c === "_aucune") return !o.categorie;
  return o.categorie === c;
}
const rangOps = (etat) => (a, b) => M.dateRattachement(etat, b).localeCompare(M.dateRattachement(etat, a)) || b.dateValeur.localeCompare(a.dateValeur)
  || (b.heure || "").localeCompare(a.heure || "") || b.montant - a.montant;
/** Opérations de la période, rangées par mois de rattachement (date de débit, mois de paie) : mêmes règles que les calculs. */
function opsFiltrees({ recherche = true } = {}) {
  const etat = E(), f = P.filtres;
  const q = recherche && f.q.trim() ? M.compilerRecherche(etat, f.q) : null;
  if (recherche && f.ids) return f.ids.map((id) => etat.operations[id]).filter((o) => o && (!q || q(o))).sort(rangOps(etat));
  const { du, au } = bornes();
  return M.opsPeriode(etat, Object.values(etat.operations), du, au).filter((o) => (!f.compte || o.compte === f.compte) && filtreCible(o)
    && (!recherche || !f.aValider || o.aValider) && (!q || q(o))).sort(rangOps(etat));
}
function nomCible(c) {
  if (!c) return "Toutes les catégories";
  if (c === "_aucune") return "Non classées";
  if (c.startsWith("g:")) return M.groupe(E(), c.slice(2))?.nom || "Groupe";
  return M.categorie(E(), c)?.nom || "Catégorie";
}
const PERIODES = [["mois", "Par mois"], ["annee", "Cette année"], ["tout", "Tout l'historique"], ["perso", "Dates choisies"]];
function barreFiltres({ recherche = false, auChangement }) {
  const f = P.filtres;
  const changer = (k, v) => { f[k] = v; memo.ecrire("filtres", { compte: f.compte, cible: f.cible, du: f.du, au: f.au }); P.selection.clear(); auChangement(); };
  const periode = el("div", { class: "pl-periode-groupe" }, navigateurMois(auChangement),
    el("select", { "aria-label": "Période", class: "pl-periode", onchange: (e) => { f.mois = ""; changer("periode", e.target.value); } },
      PERIODES.map(([v, n]) => el("option", { value: v, selected: f.periode === v }, n))));
  const dates = f.periode === "perso" ? [
    el("input", { type: "date", value: f.du, "aria-label": "Du", onchange: (e) => changer("du", e.target.value) }),
    el("input", { type: "date", value: f.au, "aria-label": "Au", onchange: (e) => changer("au", e.target.value) })] : [];
  const compte = el("select", { "aria-label": "Compte", onchange: (e) => changer("compte", e.target.value) },
    el("option", { value: "" }, "Tous les comptes"), E().config.comptes.map((c) => el("option", { value: c.id, selected: f.compte === c.id }, c.nom)));
  const cible = el("button", { type: "button", class: "pl-choix" + (f.cible ? " actif" : ""), onclick: (e) => selecteur(e.currentTarget, {
    valeur: f.cible, groupes: true, creation: false, choisir: (v) => changer("cible", v) }) }, nomCible(f.cible), el("span", { "aria-hidden": "true" }, " ▾"));
  const effacer = f.cible || f.compte ? el("button", { type: "button", class: "pl-lien", onclick: () => { f.cible = ""; f.compte = ""; changer("q", f.q); } }, "Effacer les filtres") : null;
  const items = [periode, ...dates, compte, cible];
  if (recherche) {
    items.push(el("label", { class: "pl-bascule" }, el("input", { type: "checkbox", checked: f.aValider, onchange: (e) => changer("aValider", e.target.checked) }), "À valider seulement"));
  }
  items.push(effacer);
  return el("div", { class: "pl-filtres" }, items);
}

/* ---------------------------------------------------------------- Vue globale */
const FORMULES = {
  depenses: "Dépenses du mois moins les remboursements reçus, sans les virements entre tes comptes.",
  revenus: "Salaire (mois de paie), aide familiale, intérêts et autres rentrées du mois.",
  resultat: "Revenus moins dépenses du mois.",
  misDeCote: "Versements vers l'épargne moins retraits, plus les intérêts.",
};
/** Patrimoine jour par jour (somme des comptes, dernier solde connu de chacun) pour la courbe du haut. */
function courbePatrimoine(etat, jours = 90) {
  const series = etat.config.comptes.map((c) => M.historiqueSolde(etat, c.id)).filter((x) => x.length);
  if (!series.length) return [];
  const fin = series.map((x) => x.at(-1).date).sort().at(-1);
  const debut = new Date(Date.parse(fin) - (jours - 1) * 864e5).toISOString().slice(0, 10);
  const points = [];
  const idx = series.map(() => 0), vals = series.map(() => null);
  for (let t = Date.parse(debut); t <= Date.parse(fin); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10);
    series.forEach((x, i) => { while (idx[i] < x.length && x[idx[i]].date <= d) vals[i] = x[idx[i]++].montant; });
    if (vals.some((v) => v != null)) points.push({ date: d, montant: vals.reduce((t2, v) => t2 + (v || 0), 0) });
  }
  return points;
}
function sparkline(points) {
  if (points.length < 2) return null;
  const W = 320, H = 72, min = Math.min(...points.map((p) => p.montant)), max = Math.max(...points.map((p) => p.montant)), e = max - min || 1;
  const xy = points.map((p, i) => [i / (points.length - 1) * W, H - 6 - (p.montant - min) / e * (H - 12)]);
  const ligne = xy.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" ");
  const g = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "pl-spark", role: "img", "aria-label": `Patrimoine sur ${points.length} jours : de ${euros(points[0].montant)} à ${euros(points.at(-1).montant)}` },
    s("defs", null, s("linearGradient", { id: "pl-degrade", x1: 0, x2: 0, y1: 0, y2: 1 }, s("stop", { offset: "0", "stop-color": "var(--pl-vert)", "stop-opacity": ".28" }), s("stop", { offset: "1", "stop-color": "var(--pl-vert)", "stop-opacity": "0" }))),
    s("path", { d: ligne + ` L${W} ${H} L0 ${H} Z`, fill: "url(#pl-degrade)" }),
    s("path", { d: ligne, fill: "none", stroke: "var(--pl-vert)", "stroke-width": "2", "stroke-linejoin": "round", "stroke-linecap": "round" }));
  return g;
}
function carteCompte(etat, c, sol) {
  const montant = sol && sol.montant != null ? euros(sol.montant) : "—";
  return el("button", { type: "button", class: "pl-compte", onclick: () => aller("comptes") },
    el("span", { class: "pl-avatar", "aria-hidden": "true" }, initiales(c.nom)),
    el("span", { class: "pl-compte-nom" }, c.nom.replace(/ compte courant$/i, "")),
    el("b", { class: "pl-montant" + (sol && sol.montant < 0 ? " negatif" : "") }, montant),
    sol ? puceStatut(sol.statut, sol.date) : puce("Aucun relevé"),
    sol && sol.ecart ? puce("Écart " + euros(sol.ecart, { signe: true }), "corail", "Différence entre le solde saisi ou relevé et le solde calculé à la même date. Rien n'est corrigé en silence.") : null);
}
function vueApercu() {
  const etat = E(), ops = Object.values(etat.operations);
  if (!ops.length) return accueilVide();
  const auj = aujourdhui(), f = P.filtres;
  if (f.periode !== "mois") { f.periode = "mois"; }
  const m = moisChoisi(), nom = nomMois(m, m.slice(0, 4) !== auj.slice(0, 4));
  const r = M.indicateurs(etat, opsFiltrees({ recherche: false }));
  const pat = M.patrimoine(etat, auj);

  // Patrimoine : la somme des comptes suivis, avec le statut du moins bon (C19)
  const hero = el("section", { class: "pl-hero" },
    el("div", { class: "pl-hero-gauche" },
      el("div", { class: "pl-hero-tete" }, el("span", null, "Patrimoine"), puceStatut(pat.statut, pat.date)),
      el("div", { class: "pl-hero-montant" }, pat.complet ? euros(pat.montant) : euros(pat.montant) + " *"),
      el("p", { class: "pl-doux" }, pat.complet ? "Somme de tes comptes suivis. Les virements entre eux s'annulent." : "* Un compte n'a pas encore de solde de référence : saisis-le dans Comptes."),
      sparkline(courbePatrimoine(etat))),
    el("div", { class: "pl-comptes" }, pat.comptes.map((x) => carteCompte(etat, x.compte, x.solde))));

  // Le mois : quatre chiffres, chacun justifiable
  const kpi = (cle, titre, valeur, ids, ton, sous) => el("button", { type: "button", class: "pl-kpi", onclick: () => justifier(`${titre} · ${nom}`, ids, FORMULES[cle]), title: FORMULES[cle] },
    el("span", { class: "pl-kpi-nom" }, titre), el("b", { class: "pl-montant " + (ton || "") }, valeur), sous ? el("span", { class: "pl-kpi-sous" }, sous) : null,
    el("span", { class: "pl-justifier" }, "Justifier ", ICONE(I.fleche)));
  const sousRevenus = [r.salaire.valeur ? "salaire " + euros(r.salaire.valeur, { rond: true }) : null, r.aide.valeur ? "aide " + euros(r.aide.valeur, { rond: true }) : null,
    r.interets.valeur ? "intérêts " + euros(r.interets.valeur) : null, r.autresRevenus.valeur ? "autres " + euros(r.autresRevenus.valeur, { rond: true }) : null].filter(Boolean).join(" · ");
  const kpis = el("div", { class: "pl-kpis" },
    kpi("revenus", "Revenus", euros(r.revenus.valeur), r.revenus.ids, "positif", sousRevenus || null),
    kpi("depenses", "Dépenses", euros(r.depenses.valeur), r.depenses.ids, "", r.remboursements.valeur ? "dont " + euros(r.remboursements.valeur) + " remboursés" : null),
    kpi("resultat", "Résultat", euros(r.resultat.valeur, { signe: true }), r.resultat.ids, r.resultat.valeur >= 0 ? "positif" : "negatif",
      r.tauxEpargne.valeur != null ? Math.round(r.tauxEpargne.valeur * 100) + " % des revenus" : null),
    kpi("misDeCote", "Mis de côté", euros(r.misDeCote.valeur, { signe: true }), r.misDeCote.ids, "lilas", null));

  // Répartition par groupe : barre empilée + lignes
  const groupes = Object.entries(r.parGroupe).filter(([, v]) => v.valeur !== 0).sort((a, b) => b[1].valeur - a[1].valeur);
  const total = groupes.reduce((t, [, v]) => t + Math.max(0, v.valeur), 0) || 1;
  const couleur = (gid) => M.groupe(etat, gid)?.couleur || "var(--pl-doux)";
  const pile = el("div", { class: "pl-pile-barre", role: "img", "aria-label": "Répartition des dépenses par groupe" },
    groupes.filter(([, v]) => v.valeur > 0).map(([gid, v]) => el("i", { style: `width:${(v.valeur / total * 100).toFixed(2)}%;background:${couleur(gid)}`, title: (M.groupe(etat, gid)?.nom || "Non classées") + " : " + euros(v.valeur) })));
  const lignesGroupes = groupes.length ? el("div", { class: "pl-groupes" }, groupes.map(([gid, v]) => el("button", { type: "button", class: "pl-groupe-ligne", onclick: () => justifier(`${M.groupe(etat, gid)?.nom || "Non classées"} · ${nom}`, v.ids, FORMULES.depenses) },
    el("i", { style: "background:" + couleur(gid) }), el("span", null, M.groupe(etat, gid)?.nom || "Pas encore classées"),
    el("span", { class: "pl-doux" }, Math.round(v.valeur / total * 100) + " %"), el("b", { class: "pl-montant" }, euros(v.valeur))))) : el("p", { class: "pl-doux" }, "Aucune dépense ce mois-ci.");

  // Alertes : sur tout l'historique, tant qu'elles ne sont pas traitées
  const tout = M.indicateurs(etat, ops);
  const alertes = [];
  if (tout.aRapprocher.nombre) alertes.push(el("button", { type: "button", class: "pl-alerte miel", onclick: () => justifier("Virements à rapprocher", tout.aRapprocher.ids, "Virements vers ou depuis un compte à toi dont l'autre côté manque. Ils ne comptent ni en dépense ni en revenu tant qu'ils ne sont pas réglés.") },
    ICONE(I.alerte), el("span", null, el("b", null, tout.aRapprocher.nombre + (tout.aRapprocher.nombre > 1 ? " virements à rapprocher" : " virement à rapprocher")), el("span", null, "L'autre côté manque. Exclus des dépenses en attendant.")), ICONE(I.fleche)));
  if (tout.aVerifier.nombre) alertes.push(el("button", { type: "button", class: "pl-alerte", onclick: () => justifier("À vérifier", tout.aVerifier.ids, "Classement incertain, reprise ou doublon possible : confirme ou corrige.") },
    ICONE(I.alerte), el("span", null, el("b", null, tout.aVerifier.nombre + " à vérifier"), el("span", null, "Classement incertain ou doublon possible.")), ICONE(I.fleche)));
  if (tout.horsPerimetre.valeur) alertes.push(el("button", { type: "button", class: "pl-alerte discret", onclick: () => justifier("Vers des comptes non suivis", tout.horsPerimetre.ids, "Argent envoyé vers un compte à toi que PLOUTOS ne suit pas : ni dépense, ni revenu.") },
    ICONE(I.comptes), el("span", null, el("b", null, euros(-tout.horsPerimetre.valeur) + " vers des comptes non suivis"), el("span", null, "Ni dépense ni revenu.")), ICONE(I.fleche)));

  const recentes = ops.sort((a, b) => b.dateValeur.localeCompare(a.dateValeur) || (b.heure || "").localeCompare(a.heure || "")).slice(0, 6);
  return el("div", { class: "pl-pile" },
    hero,
    alertes.length ? el("div", { class: "pl-alertes" }, alertes) : null,
    el("div", { class: "pl-grille" },
      el("section", { class: "pl-carte pl-mois-carte" },
        el("div", { class: "pl-carte-tete" }, el("h2", null, "Bilan du mois"), navigateurMois(dessiner)),
        kpis, pile, lignesGroupes),
      carte("Dernières opérations", el("button", { type: "button", class: "pl-lien", onclick: () => aller("operations", { periode: "tout", cible: "", compte: "" }) }, "Tout voir"),
        el("div", { class: "pl-recentes" }, recentes.map(ligneCompacte)))),
    carte("Les 12 derniers mois", el("span", { class: "pl-doux" }, "par mois de rattachement · sans les virements internes"), graphiqueMois(M.parMois(etat, ops, 12, auj))));
}
function accueilVide() {
  return el("div", { class: "pl-pile" }, el("section", { class: "pl-carte pl-bienvenue" },
    el("h2", null, "Aucun relevé pour l'instant"),
    el("p", { class: "pl-doux" }, "PLOUTOS ne se connecte pas à ta banque et ne garde aucun identifiant. Tu exportes un relevé CSV ou Excel depuis LCL ou Revolut, et tu le déposes ici."),
    el("ol", { class: "pl-etapes" },
      el("li", null, "Exporte le relevé de chaque compte."),
      el("li", null, "Dépose les fichiers, plusieurs à la fois : les doublons et les virements entre tes comptes sont repérés."),
      el("li", null, "Vérifie le rapport, puis confirme. Rien n'est enregistré avant.")),
    el("button", { type: "button", class: "pl-btn principal", onclick: () => aller("importer") }, ICONE(I.plus), "Importer mes relevés")));
}
function graphiqueMois(mois, { series = [["revenus", "Revenus", "var(--pl-vert)"], ["depenses", "Dépenses", "var(--pl-lilas)"]] } = {}) {
  const max = Math.max(1, ...mois.flatMap((m) => series.map(([k]) => Math.abs(m[k]))));
  const W = 720, H = 200, bas = 170, lg = W / mois.length, n = series.length;
  const g = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "pl-graph", role: "img", "aria-label": series.map((x) => x[1]).join(" et ") + " des 12 derniers mois" });
  for (let i = 0; i <= 2; i++) g.append(s("line", { x1: 0, x2: W, y1: bas - (bas - 14) * i / 2, y2: bas - (bas - 14) * i / 2, stroke: "var(--pl-ligne)" }));
  mois.forEach((m, i) => {
    const x = i * lg, w = Math.min(16, lg / (n + 1.5));
    const titre = `${MOIS_LONGS[Number(m.mois.slice(5)) - 1]} ${m.mois.slice(0, 4)} : ` + series.map(([k, nomS]) => `${nomS.toLowerCase()} ${euros(m[k])}`).join(", ");
    const grp = s("g", { class: "pl-graph-mois" }, s("title", null, titre));
    series.forEach(([k, , c], j) => {
      const h = (bas - 14) * Math.abs(m[k]) / max;
      grp.append(s("rect", { x: x + lg / 2 - (n * (w + 2)) / 2 + j * (w + 2), y: bas - h, width: w, height: Math.max(h, 0), rx: 4, fill: m[k] < 0 ? "var(--pl-corail)" : c }));
    });
    grp.append(s("text", { x: x + lg / 2, y: H - 10, "text-anchor": "middle" }, MOIS_COURTS[Number(m.mois.slice(5)) - 1]));
    g.append(grp);
  });
  return el("div", null, g, el("div", { class: "pl-legende" }, series.map(([, nomS, c]) => el("span", null, el("i", { style: "background:" + c }), nomS)),
    el("span", { class: "pl-doux" }, "montants arrondis à l'affichage")));
}

/* ---------------------------------------------------------------- Opérations */
function pastilleCategorie(o, { bouton = true } = {}) {
  const c = o.categorie && M.categorie(E(), o.categorie), g = c && M.groupe(E(), c.groupe);
  const contenu = [el("i", { style: "background:" + (g ? g.couleur : "transparent") }), c ? c.nom : "À classer"];
  if (!bouton) return el("span", { class: "pl-cat" + (c ? "" : " vide") }, contenu);
  return el("button", { type: "button", class: "pl-cat" + (c ? "" : " vide"), title: c ? g.nom + " › " + c.nom + " (changer)" : "Choisir une catégorie",
    onclick: (e) => { e.stopPropagation(); choisirCategorie(e.currentTarget, [o.id]); } }, contenu);
}
function choisirCategorie(ancre, ids) {
  const premier = E().operations[ids[0]];
  selecteur(ancre, { valeur: premier && premier.categorie, choisir: async (cat) => {
    if (!cat) return;
    await faire({ type: "categoriser", ids, categorie: cat }, { redessiner: false });
    P.selection.clear();
    rafraichirVue();
    if (ids.length === 1) proposerRegleApres(E().operations[ids[0]], cat);
    else avis(ids.length + " opérations classées en " + M.categorie(E(), cat).nom);
  } });
}
function rafraichirVue() { if (P.onglet === "operations" && P.liste) { P.liste.maj(); majBarreOps(); majOnglets(); } else dessiner(); }
function majOnglets() {
  const n = Object.values(E().operations).filter((o) => o.aValider).length;
  const b = P.racine.querySelector('.pl-onglet:nth-child(2)');
  if (!b) return;
  b.querySelector(".pl-pastille")?.remove();
  if (n) b.append(el("b", { class: "pl-pastille" }, String(n)));
}
function ligneCompacte(o) {
  return el("div", { class: "pl-op compacte", onclick: () => detailOperation(o.id) },
    el("span", { class: "pl-avatar petit", "aria-hidden": "true" }, initiales(o.commercant || "?")),
    el("span", { class: "pl-op-nom" }, el("b", null, o.commercant), el("span", { class: "pl-doux" }, dateCourte(o.dateValeur) + " · " + (M.compte(E(), o.compte)?.nom || ""))),
    el("span", { class: "pl-op-montant" + (o.montant > 0 ? " positif" : "") }, euros(o.montant, { signe: true })));
}
/** Provenance du classement (contrat C22) : toi, règle, règle de base, IA, virement, reprise. */
function provenance(o) {
  if (!o.source || o.source === "aucune") return null;
  if (o.source === "manuel") return ["Toi", "Classée à la main"];
  if (o.source === "virement") return ["Auto", "Virement interne repéré automatiquement"];
  if (o.source === "ia") return ["IA", "Proposée par l'IA"];
  if (o.source === "reprise") return ["Reprise", "Annule une opération du même tiers"];
  if (o.source.startsWith("regle:")) return o.source.startsWith("regle:base-") ? ["Base", "Règle de base"] : ["Règle", "Ta règle"];
  return null;
}
/** Pastilles d'état d'une opération : nature particulière, à vérifier, mois de rattachement décalé. */
function badgesOperation(etat, o) {
  const b = [], n = M.natureOp(etat, o);
  if (n === "interne") b.push(puce(o.lien ? "Interne ↔" : "Interne", "", "Virement entre tes comptes : ni dépense ni revenu"));
  if (n === "rapprocher") b.push(puce("À rapprocher", "miel", "L'autre côté de ce virement manque : exclu des dépenses et revenus"));
  if (n === "hors") b.push(puce("Compte non suivi", "", "Vers un compte à toi que PLOUTOS ne suit pas"));
  if (n === "remboursement") b.push(puce("Remboursement", "vert", "Déduit des dépenses de sa catégorie"));
  if (o.doublonPossible) b.push(puce("Doublon ?", "corail"));
  else if (o.aValider && o.categorie) b.push(puce("À vérifier", "miel", "Classement incertain : vérifie-le puis valide"));
  if (M.decale(etat, o)) b.push(puce("compté en " + nomMois(M.moisDe(etat, o), false).toLowerCase(), "lilas", "Mois de rattachement différent du mois de débit (mois de paie ou choix manuel)"));
  return b;
}
function ligneOperation(o) {
  const etat = E(), compte = M.compte(etat, o.compte);
  const badges = badgesOperation(etat, o);
  const prov = provenance(o);
  if (prov) badges.push(puce(prov[0], prov[0] === "IA" ? "lilas discret" : "discret", prov[1]));
  const coche = el("input", { type: "checkbox", "aria-label": "Sélectionner", checked: P.selection.has(o.id),
    onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? P.selection.add(o.id) : P.selection.delete(o.id); majBarreOps(); } });
  return el("div", { class: "pl-op" + (o.aValider ? " a-valider" : "") + (P.selection.has(o.id) ? " choisie" : ""), "data-id": o.id, onclick: () => detailOperation(o.id), role: "row" },
    el("span", { class: "pl-op-coche" }, coche),
    el("span", { class: "pl-op-date", title: o.date !== o.dateValeur ? "Achat le " + dateLongue(o.date) : null }, dateCourte(o.dateValeur)),
    el("span", { class: "pl-op-nom" }, el("span", { class: "pl-op-titre" }, el("b", null, o.commercant), ...badges),
      el("span", { class: "pl-doux" }, (compte ? compte.nom : o.compte) + " · " + o.libelle)),
    pastilleCategorie(o),
    el("span", { class: "pl-op-montant" + (o.montant > 0 ? " positif" : "") }, euros(o.montant, { signe: true })));
}

/** Liste virtuelle : seules les lignes visibles existent dans la page (fluide avec des milliers d'opérations). */
function listeVirtuelle(obtenir) {
  const haut = () => (innerWidth <= 760 ? 74 : 56);
  const zone = el("div", { class: "pl-liste", role: "table", tabindex: "0" });
  const piste = el("div", { class: "pl-piste" });
  zone.append(piste);
  let ops = [], lignes = [], debut = -1, fin = -1;
  // Une ligne d'en-tête par mois (nom, dépenses, rentrées), puis ses opérations.
  function decouper() {
    lignes = []; let m = null, tete = null;
    const etat = E();
    for (const o of ops) {
      const mo = M.moisDe(etat, o);
      if (mo !== m) { m = mo; tete = { entete: m, ops: [] }; lignes.push(tete); }
      tete.ops.push(o);
      lignes.push(o);
    }
    for (const t of lignes) if (t.entete) { const r = M.indicateurs(etat, t.ops); Object.assign(t, { n: t.ops.length, depenses: r.depenses.valeur, revenus: r.revenus.valeur }); delete t.ops; }
  }
  const ligneMois = (x) => el("div", { class: "pl-op-mois", role: "row" }, el("b", null, nomMois(x.entete)),
    el("span", null, x.n + " op. · dépenses ", el("b", null, euros(x.depenses)), " · revenus ", el("b", { class: "positif" }, euros(x.revenus))));
  function peindre(force) {
    const h = haut(), vue = zone.clientHeight || 600;
    const d = Math.max(0, Math.floor(zone.scrollTop / h) - 8), f = Math.min(lignes.length, Math.ceil((zone.scrollTop + vue) / h) + 8);
    if (!force && d === debut && f === fin) return;
    debut = d; fin = f;
    piste.style.height = lignes.length * h + "px";
    piste.replaceChildren(...lignes.slice(d, f).map((o, i) => { const r = o.entete ? ligneMois(o) : ligneOperation(o); r.style.top = (d + i) * h + "px"; r.style.height = h + "px"; return r; }));
  }
  zone.addEventListener("scroll", () => requestAnimationFrame(() => peindre(false)), { passive: true });
  addEventListener("resize", () => peindre(true));
  return { zone, maj() { ops = obtenir(); decouper(); peindre(true); if (!ops.length) piste.replaceChildren(el("div", { class: "vide", style: "padding:18px" }, "Aucune opération ne correspond.")); }, ops: () => ops };
}
function vueOperations() {
  const recherche = el("input", { type: "search", class: "pl-recherche", value: P.filtres.q, placeholder: "Rechercher : commerçant, montant (45,90 · >100), date (12/10 · oct), banque, catégorie, « à valider »…",
    "aria-label": "Rechercher dans les opérations", oninput: (e) => { clearTimeout(vueOperations.t); vueOperations.t = setTimeout(() => { P.filtres.q = e.target.value; P.selection.clear(); P.liste.maj(); majBarreOps(); }, 120); } });
  P.liste = listeVirtuelle(() => opsFiltrees());
  P.barreOps = el("div", { class: "pl-resume" });
  const f = P.filtres;
  const justif = f.ids ? el("div", { class: "pl-justif" },
    el("div", null, el("span", { class: "pl-doux" }, "Justification"), el("b", null, f.titreIds), f.formule ? el("span", { class: "pl-doux" }, f.formule) : null),
    el("button", { type: "button", class: "pl-btn", onclick: () => aller("operations") }, "Voir toutes les opérations")) : null;
  const vueEl = el("div", { class: "pl-pile" },
    justif,
    el("div", { class: "pl-cherche" }, ICONE(I.recherche), recherche),
    f.ids ? null : barreFiltres({ recherche: true, auChangement: () => { P.liste.maj(); majBarreOps(); dessinerFiltres(); } }),
    P.barreOps,
    el("div", { class: "pl-entete-liste", "aria-hidden": "true" }, el("span"), el("span", null, "Date"), el("span", null, "Opération"), el("span", null, "Catégorie"), el("span", null, "Montant")),
    P.liste.zone);
  requestAnimationFrame(() => { P.liste.maj(); majBarreOps(); });
  setTimeout(() => { if (P.filtres.q) recherche.focus(); }, 0);
  return vueEl;
  function dessinerFiltres() { const ancien = vueEl.querySelector(".pl-filtres"); if (ancien) ancien.replaceWith(barreFiltres({ recherche: true, auChangement: () => { P.liste.maj(); majBarreOps(); dessinerFiltres(); } })); }
}
function majBarreOps() {
  if (!P.barreOps) return;
  const ops = P.liste.ops(), ind = M.indicateurs(E(), ops), t = { depenses: ind.depenses.valeur, revenus: ind.revenus.valeur };
  const sel = [...P.selection].filter((id) => E().operations[id]);
  const tout = el("input", { type: "checkbox", "aria-label": "Tout sélectionner", checked: sel.length > 0 && sel.length === ops.length,
    onchange: (e) => { P.selection = new Set(e.target.checked ? ops.map((o) => o.id) : []); P.liste.maj(); majBarreOps(); } });
  const enfants = [el("label", { class: "pl-tout" }, tout)];
  if (sel.length) {
    enfants.push(el("b", null, sel.length + " sélectionnée(s)"),
      el("button", { type: "button", class: "cmd", onclick: (e) => choisirCategorie(e.currentTarget, sel) }, "Classer…"),
      el("button", { type: "button", class: "cmd", onclick: async () => { await faire({ type: "valider", ids: sel }, { redessiner: false }); P.selection.clear(); rafraichirVue(); avis(sel.length + " opération(s) validée(s)"); } }, "Valider"),
      el("button", { type: "button", class: "pl-lien", onclick: () => { P.selection.clear(); P.liste.maj(); majBarreOps(); } }, "Annuler"));
  } else {
    enfants.push(el("span", null, el("b", null, String(ops.length)), " opération(s)"),
      el("span", null, "dépenses ", el("b", null, euros(t.depenses))), el("span", null, "revenus ", el("b", { class: "positif" }, euros(t.revenus))),
      ops.length ? el("button", { type: "button", class: "pl-lien", onclick: () => telecharger("ploutos-operations.csv", M.exporterCsv(E(), ops), "text/csv") }, "Exporter en CSV") : null);
    const n = aClasserIA().length;
    if (P.iaEnCours) enfants.push(el("span", { class: "pl-badge vert" }, "CLASSEMENT AUTOMATIQUE EN COURS…"));
    else if (n && iaDispo()) enfants.push(el("button", { type: "button", class: "cmd pl-principal", onclick: () => classerIA() }, `Classer automatiquement (${n})`));
    else if (n && !DEMO) enfants.push(el("span", { class: "secondaire", title: "Ajoute la clé Claude (guide, étape 7) : PLOUTOS classera seul les commerçants inconnus." }, `${n} sans règle · classement automatique : clé Claude à ajouter`));
  }
  P.barreOps.replaceChildren(...enfants);
}

/* ---------------------------------------------------------------- Sélecteur de catégorie */
let flottant = null;
function fermerFlottant() { if (flottant) { flottant.remove(); flottant = null; document.removeEventListener("pointerdown", clicDehors, true); } }
function clicDehors(e) { if (flottant && !flottant.contains(e.target)) fermerFlottant(); }
function selecteur(ancre, { valeur, choisir, creation = true, groupes = false }) {
  fermerFlottant();
  const etat = E();
  const champ = el("input", { type: "search", placeholder: "Rechercher une catégorie…", "aria-label": "Rechercher une catégorie", autocomplete: "off" });
  const liste = el("div", { class: "pl-sel-liste", role: "listbox" });
  const boite = el("div", { class: "pl-flottant pl-selecteur", role: "dialog", "aria-label": "Choisir une catégorie" },
    el("div", { class: "pl-sel-tete" }, ICONE(I.recherche), champ, el("button", { type: "button", class: "pl-x", "aria-label": "Fermer", onclick: fermerFlottant }, ICONE(I.fermer))), liste);
  let items = [], actif = 0;
  const choix = (v) => { fermerFlottant(); ancre.focus && ancre.focus(); choisir(v); };
  function remplir() {
    const q = champ.value.trim();
    items = []; const enfants = [];
    const ajouter = (valeurItem, contenu, classe) => {
      const i = items.length;
      const b = el("div", { class: "pl-sel-item " + (classe || ""), role: "option", id: "pl-sel-" + i, "aria-selected": "false",
        onpointerdown: (e) => e.preventDefault(), onclick: () => (valeurItem === "__creer" ? creer(q) : choix(valeurItem)) }, contenu);
      if (valeurItem === valeur) b.classList.add("courante");
      items.push({ v: valeurItem, b }); enfants.push(b);
    };
    if (groupes && !q) { ajouter("", "Toutes les catégories"); ajouter("_aucune", "Non classées"); }
    if (!q && !groupes) {
      const freq = M.categoriesFrequentes(etat, 5);
      if (freq.length) {
        enfants.push(el("div", { class: "pl-sel-groupe" }, "Les plus utilisées"));
        for (const id of freq) { const c = M.categorie(etat, id), g = M.groupe(etat, c.groupe); ajouter(id, [el("i", { style: "background:" + g.couleur }), c.nom, el("small", null, g.nom)]); }
      }
    }
    for (const { groupe, categories } of M.chercherCategories(etat, q)) {
      if (groupes) ajouter("g:" + groupe.id, [el("i", { style: "background:" + groupe.couleur }), el("b", null, groupe.nom), el("small", null, "tout le groupe")], "titre");
      else enfants.push(el("div", { class: "pl-sel-groupe" }, el("i", { style: "background:" + groupe.couleur }), groupe.nom));
      for (const c of categories) ajouter(c.id, [c.nom], "enfant");
    }
    if (creation && q && !etat.config.categories.some((c) => M.normaliser(c.nom) === M.normaliser(q))) ajouter("__creer", ["Créer la catégorie « ", el("b", null, q), " »…"], "creer");
    if (!items.length) enfants.push(el("div", { class: "vide", style: "padding:10px" }, "Aucune catégorie."));
    liste.replaceChildren(...enfants);
    actif = Math.max(0, items.findIndex((x) => x.v === valeur && !q));
    if (q) actif = 0;
    marquer();
  }
  function marquer() {
    items.forEach((x, i) => x.b.setAttribute("aria-selected", i === actif ? "true" : "false"));
    if (items[actif]) { items[actif].b.scrollIntoView({ block: "nearest" }); champ.setAttribute("aria-activedescendant", items[actif].b.id); }
  }
  function creer(nom) {
    fermerFlottant();
    const etat2 = E();
    const actuelle = valeur && M.categorie(etat2, valeur);
    const groupe = el("select", { "aria-label": "Groupe" }, etat2.config.groupes.filter((g) => !g.archive).sort((a, b) => a.ordre - b.ordre)
      .map((g) => el("option", { value: g.id, selected: actuelle && actuelle.groupe === g.id }, g.nom)));
    const champNom = el("input", { type: "text", value: nom, "aria-label": "Nom" });
    dialogue("Nouvelle catégorie", el("div", { class: "pl-form" }, el("label", null, "Nom", champNom), el("label", null, "Dans le groupe", groupe)), [
      ["Créer", async (fermer) => {
        const n = champNom.value.trim(); if (!n) return;
        const id = groupe.value + "-" + M.normaliser(n).replace(/ /g, "-").slice(0, 28) + "-" + uid().slice(-4);
        await faire({ type: "categorie", categorie: { id, groupe: groupe.value, nom: n } }, { redessiner: false });
        fermer(); choisir(id);
      }, true]]);
  }
  champ.addEventListener("input", remplir);
  champ.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { actif = Math.min(items.length - 1, actif + 1); marquer(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { actif = Math.max(0, actif - 1); marquer(); e.preventDefault(); }
    else if (e.key === "Enter") { e.preventDefault(); const it = items[actif]; if (it) it.b.click(); }
    else if (e.key === "Escape") { fermerFlottant(); ancre.focus && ancre.focus(); }
  });
  document.body.append(boite);
  flottant = boite;
  if (innerWidth <= 760) boite.classList.add("plein");
  else {
    const r = ancre.getBoundingClientRect(), largeur = 340, hauteur = Math.min(420, innerHeight - 40);
    const gauche = Math.min(Math.max(12, r.right - largeur), innerWidth - largeur - 12);
    const dessous = innerHeight - r.bottom > hauteur + 12;
    Object.assign(boite.style, { left: gauche + "px", width: largeur + "px", maxHeight: hauteur + "px", top: (dessous ? r.bottom + 6 : Math.max(12, r.top - hauteur - 6)) + "px" });
  }
  remplir();
  champ.focus();
  setTimeout(() => document.addEventListener("pointerdown", clicDehors, true), 0);
}

/* ---------------------------------------------------------------- Dialogues */
function dialogue(titre, contenu, boutons = [], { large = false } = {}) {
  fermerFlottant();
  const voile = el("div", { class: "pl-voile", role: "presentation" });
  const fermer = () => { voile.remove(); document.removeEventListener("keydown", echap); };
  const echap = (e) => { if (e.key === "Escape" && !flottant) fermer(); };
  const boite = el("div", { class: "pl-dialogue panneau" + (large ? " large" : ""), role: "dialog", "aria-modal": "true", "aria-label": titre },
    el("div", { class: "p-titre" }, el("h2", null, titre), el("button", { type: "button", class: "pl-x", "aria-label": "Fermer", onclick: fermer }, ICONE(I.fermer))),
    el("div", { class: "pl-dialogue-corps" }, contenu),
    boutons.length ? el("div", { class: "pl-dialogue-pied" }, boutons.map(([texte, action, principal, danger]) =>
      el("button", { type: "button", class: "cmd" + (principal ? " pl-principal" : "") + (danger ? " pl-danger" : ""), onclick: () => action(fermer) }, texte))) : null);
  voile.append(boite);
  voile.addEventListener("pointerdown", (e) => { if (e.target === voile) fermer(); });
  document.addEventListener("keydown", echap);
  document.body.append(voile);
  const premier = boite.querySelector("input, select, textarea");
  (premier || boite.querySelector(".pl-dialogue-pied .cmd") || boite).focus?.();
  return { fermer, boite };
}
function confirmer(titre, texte, libelle, action, danger = true) {
  dialogue(titre, el("p", null, texte), [["Annuler", (f) => f()], [libelle, async (f) => { f(); await action(); }, !danger, danger]]);
}

/* ---------------------------------------------------------------- Règle après correction */
function proposerRegleApres(op, cat) {
  const etat = E();
  const c = M.categorie(etat, cat);
  avis(`Classée en ${c.nom}`);
  const deja = etat.config.regles.some((r) => r.action.categorie === cat && M.regleCorrespond(op, r));
  if (deja || !op.commercant) return;
  fermerSuggestion();
  // PLOUTOS apprend tout seul : la correction devient une règle, appliquée aux opérations semblables (sauf corrections manuelles).
  const regle = M.proposerRegle(op, cat);
  faire({ type: "regle", regle, appliquer: true }, { redessiner: false }).then((res) => {
    rafraichirVue();
    const autres = res.ids.filter((id) => id !== op.id).length;
    P.suggestion = el("div", { class: "pl-suggestion", role: "status" },
      el("span", null, "Retenu : ", el("b", null, "« " + op.commercant + " »"), " → ", el("b", null, c.nom), ".",
        el("span", { class: "secondaire" }, autres ? ` ${autres} autre(s) opération(s) classée(s) pareil, et les prochaines aussi.` : " Les prochaines seront classées pareil.")),
      el("button", { type: "button", class: "pl-lien", onclick: () => { fermerSuggestion(); editeurRegle(E().config.regles.find((r) => r.id === regle.id) || regle); } }, "Modifier"),
      el("button", { type: "button", class: "pl-lien danger", onclick: async () => { fermerSuggestion(); await faire({ type: "supprimer-regle", idRegle: regle.id }, { redessiner: false }); await faire({ type: "reclasser" }, { redessiner: false }); rafraichirVue(); avis("Règle annulée."); } }, "Annuler"));
    document.body.append(P.suggestion);
    clearTimeout(P.suggestionMinuteur);
    P.suggestionMinuteur = setTimeout(fermerSuggestion, 12000);
  });
}
function fermerSuggestion() { if (P.suggestion) { P.suggestion.remove(); P.suggestion = null; } }

/* ---------------------------------------------------------------- Éditeur de règle */
const CHAMPS = [["commercant", "Commerçant"], ["libelle", "Libellé d'origine"], ["type", "Type d'opération"], ["compte", "Compte"], ["sens", "Sens"], ["montant", "Montant (€)"]];
const OPS_TEXTE = [["contient", "contient"], ["commence", "commence par"], ["egal", "est exactement"], ["mot", "contient le mot"], ["regex", "expression régulière"]];
function editeurRegle(regle, { nouvelle = false } = {}) {
  const etat = E();
  const r = JSON.parse(JSON.stringify(regle));
  const zoneConds = el("div", { class: "pl-conds" });
  const apercu = el("div", { class: "pl-apercu-regle" });
  const appliquer = el("input", { type: "checkbox", checked: true });
  const renommer = el("input", { type: "text", value: r.action.commercant || "", placeholder: "facultatif", "aria-label": "Renommer le commerçant en" });
  let boutonCat;
  const majCat = () => { const c = M.categorie(etat, r.action.categorie); boutonCat.replaceChildren(c ? c.nom : "Choisir…", el("span", { "aria-hidden": "true" }, " ▾")); majApercu(); };
  boutonCat = el("button", { type: "button", class: "pl-choix", onclick: (e) => selecteur(e.currentTarget, { valeur: r.action.categorie, choisir: (v) => { r.action.categorie = v; majCat(); } }) });
  function ligneCond(c, i) {
    const champ = el("select", { "aria-label": "Champ", onchange: (e) => { c.champ = e.target.value; c.op = { compte: "egal", sens: "egal", montant: "entre" }[c.champ] || "contient"; c.valeur = c.champ === "sens" ? "debit" : c.champ === "compte" ? etat.config.comptes[0].id : ""; dessinerConds(); } },
      CHAMPS.map(([v, n]) => el("option", { value: v, selected: c.champ === v }, n)));
    let op, valeur;
    if (c.champ === "compte") {
      op = el("span", { class: "pl-op-fixe" }, "est");
      valeur = el("select", { onchange: (e) => { c.valeur = e.target.value; majApercu(); } }, etat.config.comptes.map((x) => el("option", { value: x.id, selected: c.valeur === x.id }, x.nom)));
    } else if (c.champ === "sens") {
      op = el("span", { class: "pl-op-fixe" }, "est");
      valeur = el("select", { onchange: (e) => { c.valeur = e.target.value; majApercu(); } }, [["debit", "une dépense"], ["credit", "une rentrée d'argent"]].map(([v, n]) => el("option", { value: v, selected: c.valeur === v }, n)));
    } else if (c.champ === "montant") {
      op = el("span", { class: "pl-op-fixe" }, "entre");
      valeur = el("span", { class: "pl-entre" },
        el("input", { type: "number", step: "0.01", min: "0", value: c.valeur ?? "", "aria-label": "Minimum", oninput: (e) => { c.valeur = e.target.value; majApercu(); } }), " et ",
        el("input", { type: "number", step: "0.01", min: "0", value: c.valeur2 ?? "", "aria-label": "Maximum", oninput: (e) => { c.valeur2 = e.target.value; majApercu(); } }));
    } else {
      op = el("select", { "aria-label": "Condition", onchange: (e) => { c.op = e.target.value; majApercu(); } }, OPS_TEXTE.map(([v, n]) => el("option", { value: v, selected: c.op === v }, n)));
      valeur = el("input", { type: "text", value: c.valeur, "aria-label": "Valeur", oninput: (e) => { c.valeur = e.target.value; majApercu(); } });
    }
    return el("div", { class: "pl-cond" }, i ? el("span", { class: "pl-et" }, "ET") : el("span", { class: "pl-et" }, "SI"), champ, op, valeur,
      r.conditions.length > 1 ? el("button", { type: "button", class: "pl-x", "aria-label": "Retirer la condition", onclick: () => { r.conditions.splice(i, 1); dessinerConds(); } }, ICONE(I.fermer)) : el("span"));
  }
  function dessinerConds() {
    zoneConds.replaceChildren(...r.conditions.map(ligneCond),
      el("button", { type: "button", class: "pl-lien", onclick: () => { r.conditions.push({ champ: "libelle", op: "contient", valeur: "" }); dessinerConds(); } }, "+ Ajouter une condition"));
    majApercu();
  }
  function valide() { return r.action.categorie && r.conditions.length && r.conditions.every((c) => c.champ === "montant" ? c.valeur !== "" && c.valeur2 !== "" : String(c.valeur ?? "").trim()); }
  function majApercu() {
    if (!valide()) { apercu.replaceChildren(el("span", { class: "secondaire" }, "Complète la règle pour voir les opérations concernées.")); return; }
    const cibles = M.operationsCibles(etat, r);
    const autres = cibles.filter((o) => o.categorie !== r.action.categorie);
    apercu.replaceChildren(el("div", null, el("b", null, String(cibles.length)), " opération(s) déjà importée(s) correspondent", autres.length !== cibles.length ? ` (dont ${autres.length} à reclasser)` : "", ". Les corrections manuelles ne sont jamais touchées."),
      el("ul", { class: "liste" }, cibles.slice(0, 5).map((o) => el("li", null, el("div", { class: "pl-mini" }, el("span", null, dateCourte(o.dateValeur)), el("span", null, o.commercant), el("span", { class: "secondaire" }, o.libelle), el("span", null, euros(o.montant, { signe: true })))))));
  }
  const contenu = el("div", { class: "pl-form" },
    el("div", { class: "pl-tuile-nom" }, "Conditions"), zoneConds,
    el("label", null, "Alors classer en", boutonCat),
    el("label", null, "Renommer le commerçant en", renommer),
    el("label", { class: "pl-bascule" }, appliquer, "Classer aussi les opérations déjà importées qui correspondent"),
    apercu);
  majCat(); dessinerConds();
  const boutons = [["Annuler", (f) => f()]];
  if (!nouvelle) boutons.push(["Supprimer", (f) => confirmer("Supprimer la règle", "Les opérations déjà classées par cette règle gardent leur catégorie.", "Supprimer", async () => { f(); await faire({ type: "supprimer-regle", idRegle: r.id }); })]);
  boutons.push(["Enregistrer", async (f) => {
    if (!valide()) return avis("Complète les conditions et la catégorie.", true);
    r.action.commercant = renommer.value.trim() || undefined;
    for (const c of r.conditions) if (c.champ === "montant") { c.valeur = String(c.valeur); c.valeur2 = String(c.valeur2); }
    f();
    const res = await faire({ type: "regle", regle: r, appliquer: appliquer.checked });
    avis("Règle enregistrée" + (res.ids.length ? " et appliquée à " + res.ids.length + " opération(s)" : ""));
  }, true]);
  dialogue(nouvelle ? "Nouvelle règle" : "Modifier la règle", contenu, boutons, { large: true });
}

/* ---------------------------------------------------------------- Détail d'une opération */
function detailOperation(id) {
  const etat = E(), o = etat.operations[id];
  if (!o) return;
  const compte = M.compte(etat, o.compte), lie = o.lien && etat.operations[o.lien], proche = o.doublonPossible && etat.operations[o.doublonPossible];
  const imps = M.provenances(o).map((id) => etat.imports.find((i) => i.id === id)).filter(Boolean);
  const nature = M.natureOp(etat, o);
  const reprise = o.reprise && etat.operations[o.reprise];
  const source = o.source === "manuel" ? "Corrigée à la main" : o.source === "virement" ? "Virement interne repéré automatiquement"
    : o.source === "ia" ? "Proposée par l'IA" : o.source === "reprise" ? "Reprise d'une opération du même tiers"
    : o.source && o.source.startsWith("regle:") ? "Règle : " + regleDe(o.source.slice(6)) : "Aucune règle ne correspond";
  const NATURES = { depense: "Dépense", remboursement: "Remboursement (déduit des dépenses)", revenu: "Revenu", interne: "Virement entre tes comptes", rapprocher: "Virement à rapprocher (exclu des totaux)", hors: "Vers un compte non suivi (à part)" };
  const moisAuto = (() => { const x = { ...o, moisForce: null }; return M.moisDe(etat, x); })();
  const choixMois = el("select", { "aria-label": "Mois de rattachement", onchange: async (e) => {
    const v = e.target.value; await faire({ type: "rattacher", ids: [id], mois: v === moisAuto ? null : v }, { redessiner: false }); rafraichirVue(); avis("Compté en " + nomMois(v).toLowerCase()); } },
    [-1, 0, 1].map((k) => decalerMois(o.dateValeur.slice(0, 7), k)).map((mo) => el("option", { value: mo, selected: M.moisDe(etat, o) === mo }, nomMois(mo) + (mo === moisAuto ? " (automatique)" : ""))));
  const note = el("textarea", { rows: 2, placeholder: "Ajouter une note…", "aria-label": "Note" }, o.note || "");
  const histo = etat.journal.filter((j) => j.details && Array.isArray(j.details.ids) && j.details.ids.includes(id)).slice(-8).reverse();
  let d;
  const actions = [];
  if (o.aValider) actions.push(el("button", { type: "button", class: "cmd pl-principal", onclick: async () => { d.fermer(); await faire({ type: "valider", ids: [id] }, { redessiner: false }); rafraichirVue(); } }, "Valider"));
  if (o.lien) actions.push(el("button", { type: "button", class: "cmd", onclick: async () => { d.fermer(); await faire({ type: "delier", idOp: id }, { redessiner: false }); rafraichirVue(); avis("Virement délié : les deux opérations sont reclassées."); } }, "Ce n'est pas un virement interne"));
  else actions.push(el("button", { type: "button", class: "cmd", onclick: () => { d.fermer(); lierA(id); } }, ICONE(I.lien), "Lier à un virement…"));
  const lignes = [
    ["Montant", el("b", { class: o.montant > 0 ? "positif" : "" }, euros(o.montant, { signe: true }))],
    ["Catégorie", pastilleCategorie(o)],
    ["Compte", compte ? compte.nom : o.compte],
    ["Nature", NATURES[nature]],
    ["Débitée le", dateLongue(o.dateValeur) + (o.heure ? " · " + o.heure.slice(0, 5) : "")],
    o.date !== o.dateValeur ? ["Achetée le", dateLongue(o.date)] : null,
    ["Comptée en", choixMois],
    ["Libellé d'origine", el("code", null, o.libelle)],
    ["Type", o.type || "—"],
    ["Classement", source],
    ["Lue dans", imps.length ? imps.map((i) => `${i.fichier || "fichier"} (${dateCourte(i.t.slice(0, 10))})`).join(", ") : "—"],
  ].filter(Boolean);
  const blocs = [el("dl", { class: "pl-dl" }, lignes.flatMap(([k, v]) => [el("dt", null, k), el("dd", null, v)]))];
  if (lie) blocs.push(el("div", { class: "pl-encart" }, el("b", null, "Virement entre tes comptes"), el("span", null, ` lié à ${euros(lie.montant, { signe: true })} sur ${M.compte(etat, lie.compte)?.nom} le ${dateLongue(lie.date)} (« ${lie.libelle} »). Il ne compte ni en dépense ni en revenu.`)));
  else if (nature === "rapprocher") blocs.push(el("div", { class: "pl-encart miel" }, el("b", null, "Virement à rapprocher"),
    el("span", null, " : il ressemble à un virement vers ou depuis un compte à toi, mais l'autre côté manque. Il est exclu des dépenses et revenus en attendant. S'il arrive au prochain import, il sera lié tout seul."),
    el("div", { class: "pl-boutons" },
      el("button", { type: "button", class: "pl-btn", onclick: () => { d.fermer(); lierA(id); } }, ICONE(I.lien), "Lier à l'autre côté…"),
      el("button", { type: "button", class: "pl-btn", onclick: async () => { d.fermer(); await faire({ type: "categoriser", ids: [id], categorie: M.ID_CATEGORIE.nonSuivi }, { redessiner: false }); rafraichirVue(); avis("Compté à part : vers un compte non suivi."); } }, "Compte à moi non suivi"),
      el("button", { type: "button", class: "pl-btn", onclick: (e) => choisirCategorie(e.currentTarget, [id]) }, o.montant < 0 ? "C'est une dépense…" : "C'est une rentrée…"))));
  if (reprise) blocs.push(el("div", { class: "pl-encart" }, el("b", null, "Reprise"), el("span", null, ` : annule ${euros(reprise.montant, { signe: true })} du ${dateLongue(reprise.dateValeur)} (« ${reprise.libelle} »). Les deux s'annulent dans les totaux.`)));
  if (proche) blocs.push(el("div", { class: "pl-encart rouge" }, el("b", null, "Doublon possible"), el("span", null, ` : une opération du même jour et du même montant existe déjà (« ${proche.libelle} »).`),
    el("div", { class: "pl-boutons" },
      el("button", { type: "button", class: "cmd pl-danger", onclick: async () => { d.fermer(); await faire({ type: "supprimer-operations", ids: [id] }, { redessiner: false }); rafraichirVue(); avis("Doublon supprimé."); } }, "C'est un doublon : supprimer"),
      el("button", { type: "button", class: "cmd", onclick: async () => { d.fermer(); await faire({ type: "valider", ids: [id] }, { redessiner: false }); rafraichirVue(); } }, "Ce n'est pas un doublon"))));
  blocs.push(note);
  blocs.push(el("div", { class: "pl-boutons" }, actions));
  if (histo.length) blocs.push(el("details", { class: "pl-histo" }, el("summary", null, "Historique (" + histo.length + ")"),
    el("ul", { class: "liste" }, histo.map((j) => el("li", null, el("div", { class: "pl-mini" }, el("span", null, quand(j.t)), el("span", null, j.resume), el("span", { class: "secondaire" }, j.appareil)))))));
  d = dialogue(o.commercant, el("div", { class: "pl-detail" }, blocs));
  note.addEventListener("change", async () => { await faire({ type: "note", idOp: id, note: note.value }, { redessiner: false }); avis("Note enregistrée"); });
}
function regleDe(idRegle) {
  const r = E().config.regles.find((x) => x.id === idRegle) || M.BASES.find((x) => x.id === idRegle);
  return r ? M.decrireRegle(E(), r) + (r.origine === "base" ? " (règle de base)" : "") : "règle supprimée";
}
function lierA(id) {
  const etat = E(), o = etat.operations[id];
  const candidats = Object.values(etat.operations).filter((x) => x.compte !== o.compte && x.montant === -o.montant && M.ecartJours(x.dateValeur, o.dateValeur) <= 10)
    .sort((a, b) => M.ecartJours(a.dateValeur, o.dateValeur) - M.ecartJours(b.dateValeur, o.dateValeur));
  dialogue("Lier à un virement", candidats.length ? el("div", null, el("p", null, `Opérations de ${euros(-o.montant, { signe: true })} sur un autre compte, à 10 jours au plus :`),
    el("ul", { class: "liste" }, candidats.map((x) => el("li", null, el("button", { type: "button", class: "pl-mini bouton", onclick: async (e) => { e.target.closest(".pl-voile").remove(); await faire({ type: "lier", a: id, b: x.id }, { redessiner: false }); rafraichirVue(); avis("Virement interne lié."); } },
      el("span", null, dateCourte(x.date)), el("span", null, M.compte(etat, x.compte)?.nom), el("span", { class: "secondaire" }, x.libelle), el("span", null, euros(x.montant, { signe: true })))))))
    : el("p", null, "Aucune opération de montant opposé sur tes autres comptes. Importe l'autre relevé, ou classe-la en « Compte non suivi » si elle va vers un compte à toi que PLOUTOS ne suit pas."));
}

/* ---------------------------------------------------------------- Comptes */
function saisirSolde(compteId) {
  const c = M.compte(E(), compteId);
  const montant = el("input", { type: "text", inputmode: "decimal", placeholder: "ex. 1 234,56", "aria-label": "Solde" });
  const date = el("input", { type: "date", value: aujourdhui(), "aria-label": "Date" });
  const avec = el("input", { type: "radio", name: "pl-jour", checked: true }), sans = el("input", { type: "radio", name: "pl-jour" });
  dialogue("Solde de référence · " + c.nom, el("div", { class: "pl-form" },
    el("p", { class: "pl-doux" }, "Le solde affiché par ta banque. PLOUTOS s'en sert comme point de départ attesté, et te montre l'écart avec son propre calcul."),
    el("label", null, "Solde (€)", montant), el("label", null, "Au", date),
    el("fieldset", { class: "pl-choix-jour" }, el("legend", null, "Ce solde inclut-il déjà les opérations de ce jour-là ?"),
      el("label", { class: "pl-bascule" }, avec, "Oui, elles sont déjà dedans"),
      el("label", { class: "pl-bascule" }, sans, "Non, c'est le solde du matin"))), [
    ["Annuler", (f) => f()],
    ["Enregistrer", async (f) => {
      const v = M.centimes(montant.value);
      if (v == null || !date.value) return avis("Montant ou date invalide.", true);
      f(); await faire({ type: "solde", compte: compteId, date: date.value, montant: v, inclutJour: avec.checked });
      const ref = E().config.soldes.filter((x) => x.compte === compteId && x.source === "saisie").at(-1);
      avis(ref && ref.ecart ? `Solde enregistré. Écart de ${euros(ref.ecart, { signe: true })} avec le calcul : à expliquer.` : "Solde enregistré.", !!(ref && ref.ecart));
    }, true]]);
}
function vueComptes() {
  const etat = E(), auj = aujourdhui();
  const controles = M.controles(etat);
  const cartes = etat.config.comptes.map((c) => {
    const sol = M.solde(etat, c.id, auj);
    const n = Object.values(etat.operations).filter((o) => o.compte === c.id).length;
    const ctl = controles.filter((x) => x.compte === c.id && x.ecart);
    let justif = null;
    if (sol && sol.reference) {
      const r = sol.reference;
      justif = el("dl", { class: "pl-calcul" },
        el("dt", null, `Référence du ${dateCourte(r.date)} (${r.source === "releve" ? "relevé" : "saisie"}${r.source === "saisie" && r.inclutJour === false ? ", avant les opérations du jour" : ""})`), el("dd", null, euros(r.montant)),
        el("dt", null, `+ ${sol.mouvementsDepuis} opération(s) depuis`), el("dd", null, euros(sol.montant - r.montant, { signe: true })),
        el("dt", null, el("b", null, "= Solde " + (STATUTS[sol.statut] || STATUTS.inconnu)[0].toLowerCase())), el("dd", null, el("b", null, euros(sol.montant))));
    }
    return el("section", { class: "pl-carte pl-compte-carte" },
      el("div", { class: "pl-compte-tete" }, el("span", { class: "pl-avatar", "aria-hidden": "true" }, initiales(c.nom)),
        el("div", null, el("h2", null, c.nom), el("span", { class: "pl-doux" }, (etat.config.banques.find((b) => b.id === c.banque)?.nom || "") + (c.type === "epargne" ? " · épargne" : " · courant"))),
        sol ? puceStatut(sol.statut, sol.date) : puce("Aucun relevé")),
      el("div", { class: "pl-hero-montant petit" + (sol && sol.montant < 0 ? " negatif" : "") }, sol && sol.montant != null ? euros(sol.montant) : "—"),
      justif,
      sol && sol.ecart ? el("div", { class: "pl-encart corail" }, el("b", null, "Écart de " + euros(sol.ecart, { signe: true })), el("span", null, " entre ta dernière référence et le solde que PLOUTOS calculait à cette date. Il manque peut-être un relevé, ou une opération a été mal lue. Rien n'est corrigé en silence.")) : null,
      ctl.map((x) => el("div", { class: "pl-encart corail" }, el("b", null, `Contrôle du ${dateCourte(x.du)} au ${dateCourte(x.au)} : écart de ${euros(x.ecart, { signe: true })}`),
        el("span", null, ` (${euros(x.depart)} + ${euros(x.mouvements, { signe: true })} devrait faire ${euros(x.attendu)}, la référence dit ${euros(x.reel)}).`))),
      el("div", { class: "pl-boutons" },
        sol && sol.ids && sol.ids.length ? el("button", { type: "button", class: "pl-btn", onclick: () => justifier(`Opérations depuis la référence · ${c.nom}`, sol.ids, "Ajoutées au dernier solde de référence pour obtenir le solde calculé.") }, "Justifier le solde") : null,
        el("button", { type: "button", class: "pl-btn", onclick: () => aller("operations", { compte: c.id, periode: "tout", cible: "" }) }, n + " opérations"),
        el("button", { type: "button", class: "pl-btn principal", onclick: () => saisirSolde(c.id) }, "Saisir le solde")));
  });
  const imports = [...etat.imports].sort((a, x) => x.t.localeCompare(a.t));
  const seules = (i) => Object.values(etat.operations).filter((o) => { const p = M.provenances(o); return p.length === 1 && p[0] === i.id; }).length;
  return el("div", { class: "pl-pile" },
    el("div", { class: "pl-grille trois" }, cartes),
    carte("Imports", el("span", { class: "pl-doux" }, imports.length + " fichier(s)"),
      imports.length ? el("ul", { class: "pl-imports" }, imports.map((i) => el("li", null,
        ICONE(I.fichier),
        el("span", null, el("b", null, i.fichier || "Relevé"), el("span", { class: "pl-doux" },
          `${etat.config.banques.find((b) => b.id === i.banque)?.nom || ""} · importé le ${dateLongue(i.t.slice(0, 10))}${i.periode ? " · du " + dateCourte(i.periode.du) + " au " + dateCourte(i.periode.au) : ""} · ${i.ajoutees} ajoutée(s), ${i.doublons} déjà connue(s)`)),
        i.controle ? puce(i.controle.ok ? "Relevé juste" : "Écart " + euros(i.controle.ecart), i.controle.ok ? "vert" : "corail") : null,
        i.soldeIgnore ? puce("Solde non retenu", "miel", "Le relevé ne tombe pas juste : son solde de clôture n'est pas pris comme référence") : null,
        el("button", { type: "button", class: "pl-lien danger", onclick: () => confirmer("Supprimer cet import",
          `${seules(i)} opération(s) lues seulement dans « ${i.fichier} » seront retirées, ainsi que son solde relevé. Celles que d'autres imports contiennent restent, avec tes corrections. L'action reste dans le journal.`,
          "Supprimer l'import", async () => { await faire({ type: "supprimer-import", importId: i.id }); avis("Import supprimé."); }) }, "Supprimer"))))
        : el("p", { class: "pl-doux" }, "Aucun import pour l'instant."),
      el("button", { type: "button", class: "pl-btn", onclick: () => aller("importer") }, ICONE(I.plus), "Importer un relevé")));
}

/* ---------------------------------------------------------------- Épargne */
function vueEpargne() {
  const etat = E(), auj = aujourdhui();
  const comptes = etat.config.comptes.filter((c) => c.type === "epargne");
  const ids = new Set(comptes.map((c) => c.id));
  const ops = Object.values(etat.operations);
  const opsEp = ops.filter((o) => ids.has(o.compte));
  const mois = M.parMois(etat, ops, 12, auj);
  const annee = M.indicateurs(etat, M.opsPeriode(etat, ops, auj.slice(0, 4) + "-01-01", auj.slice(0, 4) + "-12-31"));
  const soldes = comptes.map((c) => ({ c, s: M.solde(etat, c.id, auj) }));
  const total = soldes.reduce((t, x) => t + (x.s && x.s.montant || 0), 0);
  if (!comptes.length) return carte("Épargne", null, el("p", { class: "pl-doux" }, "Aucun compte d'épargne suivi."));
  return el("div", { class: "pl-pile" },
    el("section", { class: "pl-hero" }, el("div", { class: "pl-hero-gauche" },
      el("div", { class: "pl-hero-tete" }, el("span", null, "Épargne"), soldes[0] && soldes[0].s ? puceStatut(soldes[0].s.statut, soldes[0].s.date) : null),
      el("div", { class: "pl-hero-montant" }, euros(total)),
      el("p", { class: "pl-doux" }, comptes.map((c) => c.nom).join(", "))),
      el("div", { class: "pl-kpis deux" },
        el("button", { type: "button", class: "pl-kpi", onclick: () => justifier("Mis de côté · " + auj.slice(0, 4), annee.misDeCote.ids, FORMULES.misDeCote) },
          el("span", { class: "pl-kpi-nom" }, "Mis de côté en " + auj.slice(0, 4)), el("b", { class: "pl-montant lilas" }, euros(annee.misDeCote.valeur, { signe: true })), el("span", { class: "pl-justifier" }, "Justifier ", ICONE(I.fleche))),
        el("button", { type: "button", class: "pl-kpi", onclick: () => justifier("Intérêts · " + auj.slice(0, 4), annee.interets.ids, "Intérêts versés sur l'épargne, comptés en revenus.") },
          el("span", { class: "pl-kpi-nom" }, "Intérêts " + auj.slice(0, 4)), el("b", { class: "pl-montant positif" }, euros(annee.interets.valeur)), el("span", { class: "pl-justifier" }, "Justifier ", ICONE(I.fleche))))),
    carte("Mis de côté, mois par mois", el("span", { class: "pl-doux" }, "versements − retraits + intérêts"), graphiqueMois(mois, { series: [["misDeCote", "Mis de côté", "var(--pl-lilas)"]] })),
    carte("Mouvements de l'épargne", el("button", { type: "button", class: "pl-lien", onclick: () => aller("operations", { compte: comptes[0].id, periode: "tout", cible: "" }) }, "Tout voir"),
      el("div", { class: "pl-recentes" }, opsEp.sort((a, b) => b.dateValeur.localeCompare(a.dateValeur)).slice(0, 8).map(ligneCompacte))),
    el("p", { class: "pl-doux pl-note" }, "Objectifs d'épargne : prévus avec les budgets (étape suivante)."));
}

/* ---------------------------------------------------------------- Importer */
let xlsxPromesse = null;
function chargerXlsx() {
  return xlsxPromesse ||= new Promise((ok, ko) => {
    const sc = el("script", { src: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" });
    sc.onload = ok; sc.onerror = () => { xlsxPromesse = null; ko(new Error("Impossible de charger le lecteur Excel. Vérifie ta connexion ou exporte en CSV.")); };
    document.head.append(sc);
  });
}
async function lireFichier(f) {
  let lignes;
  if (/\.xlsx?$/i.test(f.name)) {
    await chargerXlsx();
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    lignes = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: "dd/mm/yyyy", defval: "" }).map((r) => r.map((x) => String(x ?? ""))).filter((r) => r.some((x) => x.trim()));
  } else lignes = M.lireCsv(M.decoderOctets(new Uint8Array(await f.arrayBuffer())));
  return M.lireReleve(lignes, { profilsLibres: E().config.profilsLibres || [], nomFichier: f.name });
}
async function recevoirFichiers(fichiers) {
  P.importsEnCours = [];
  for (const f of fichiers) {
    try { P.importsEnCours.push({ fichier: f, releve: await lireFichier(f) }); }
    catch (e) { P.importsEnCours.push({ fichier: f, erreur: e.message }); }
  }
  calculerApercus();
  dessiner();
}
function calculerApercus() {
  let sim = M.cloner(E());
  for (const it of P.importsEnCours) {
    if (!it.releve || !it.releve.reconnu) continue;
    it.apercu = M.apercuImport(sim, it.releve);
    M.appliquer(sim, { ...M.actionImport(it.releve, "sim-" + it.fichier.name), id: null });
  }
}
function vueImporter() {
  const entree = el("input", { type: "file", accept: ".csv,.txt,.xlsx,.xls", multiple: true, hidden: true, onchange: (e) => recevoirFichiers([...e.target.files]) });
  const zone = el("label", { class: "pl-depot", tabindex: "0",
    ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add("survol"); }, ondragleave: (e) => e.currentTarget.classList.remove("survol"),
    ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove("survol"); recevoirFichiers([...e.dataTransfer.files]); },
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); entree.click(); } } },
    entree, ICONE(I.export), el("b", null, "Dépose tes relevés ici"), el("span", { class: "secondaire" }, "ou touche pour choisir · CSV ou Excel · LCL, Revolut (courant et épargne) · plusieurs fichiers à la fois"));
  const blocs = [el("div", { class: "s12" }, panneau("Importer des relevés", el("span", { class: "meta" }, "rien n'est enregistré avant ta confirmation"), "", zone))];
  if (P.importsEnCours) {
    for (const it of P.importsEnCours) blocs.push(el("div", { class: "s6" }, carteImport(it)));
    const prets = P.importsEnCours.filter((i) => i.apercu);
    if (prets.length) blocs.push(el("div", { class: "s12 pl-boutons" },
      el("button", { type: "button", class: "cmd pl-principal", onclick: enregistrerImports }, prets.length > 1 ? `Enregistrer les ${prets.length} relevés` : "Enregistrer ce relevé"),
      el("button", { type: "button", class: "cmd", onclick: () => { P.importsEnCours = null; dessiner(); } }, "Annuler")));
  }
  blocs.push(el("div", { class: "s12" }, panneau("Où trouver tes relevés", null, "", el("ul", { class: "pl-aide" },
    el("li", null, el("b", null, "LCL : "), "site lcl.fr › Mes comptes › compte courant › Télécharger les opérations › format CSV (ou Excel), période au choix."),
    el("li", null, el("b", null, "Revolut : "), "appli › compte › … › Relevé › Excel ou CSV, période au choix. Le même fichier contient le compte courant et l'épargne."),
    el("li", null, "Tu peux réimporter une période qui chevauche la précédente : les opérations déjà connues sont ignorées.")))));
  return el("div", { class: "grille" }, blocs);
}
function carteImport(it) {
  if (it.erreur) return panneau(it.fichier.name, null, "alerte", el("p", null, it.erreur));
  const r = it.releve;
  if (!r.reconnu) return formulaireFormat(it);
  const a = it.apercu, etat = E();
  const ign = Object.entries(r.ignorees || {});
  return panneau(it.fichier.name, el("span", { class: "meta" }, r.nomProfil), "",
    el("dl", { class: "pl-dl" },
      el("dt", null, "Comptes"), el("dd", null, a.comptes.map((c) => M.compte(etat, c)?.nom || c).join(", ")),
      el("dt", null, "Période"), el("dd", null, r.periode ? `du ${dateLongue(r.periode.du)} au ${dateLongue(r.periode.au)}` : "—"),
      el("dt", null, "Opérations lues"), el("dd", null, String(a.lues)),
      el("dt", null, "Nouvelles"), el("dd", null, el("b", null, String(a.nouvelles))),
      el("dt", null, "Déjà connues"), el("dd", null, String(a.doublons) + (a.possibles ? ` · ${a.possibles} doublon(s) possible(s) à vérifier` : "")),
      el("dt", null, "Classées"), el("dd", null, String(a.classees)),
      el("dt", null, "À vérifier"), el("dd", null, el("b", { class: a.aValider ? "ambre" : "" }, String(a.aValider))),
      el("dt", null, "Virements internes"), el("dd", null, String(a.internes)),
      a.aRapprocher ? [el("dt", null, "À rapprocher"), el("dd", null, el("b", { class: "ambre" }, String(a.aRapprocher)), " (l'autre côté manque : exclus des totaux)")] : null,
      el("dt", null, "Solde lu"), el("dd", null, (r.soldes || []).map((s0) => `${M.compte(etat, s0.compte)?.nom} : ${euros(s0.montant)} au ${dateCourte(s0.date)}`).join(" · ") || "aucun (tu pourras le saisir)"),
      r.controle ? [el("dt", null, "Contrôle"), el("dd", { class: r.controle.ok ? "positif" : "ambre" }, r.controle.ok ? "Le relevé tombe juste (solde de départ + opérations = solde final)." : "Écart de " + euros(r.controle.ecart) + " : des lignes manquent peut-être. Les opérations seront importées, mais pas ce solde de clôture.")] : null,
      ign.length ? [el("dt", null, "Ignorées"), el("dd", null, ign.map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", ") + " (seules les opérations terminées comptent)")] : null),
    ...(a.ecarts || []).map((e) => el("div", { class: "pl-encart rouge" }, `Écart de ${euros(e.ecart)} entre le solde calculé et le relevé pour ${M.compte(etat, e.compte)?.nom} au ${dateCourte(e.date)} : une période manque peut-être entre deux imports.`)),
    ...(r.avertissements || []).map((t) => el("div", { class: "pl-encart" }, t)));
}
function formulaireFormat(it) {
  const lignes = it.releve.lignes.slice(0, 6), nb = Math.max(...lignes.map((l) => l.length));
  const cols = [...Array(nb).keys()];
  const sel = (lib, def, vide) => el("label", null, lib, el("select", null, vide ? el("option", { value: "-1" }, "—") : null,
    cols.map((i) => el("option", { value: i, selected: i === def }, `Colonne ${i + 1} (${String(lignes[0][i] ?? "").slice(0, 18)})`))));
  const entete = el("input", { type: "checkbox", checked: true });
  const cDate = sel("Date", 0), cMontant = sel("Montant", 1, true), cDebit = sel("Ou débit", -1, true), cCredit = sel("et crédit", -1, true), cLib = sel("Libellé", 2);
  const compte = el("select", null, E().config.comptes.map((c) => el("option", { value: c.id }, c.nom)));
  const nom = el("input", { type: "text", value: "Format " + it.fichier.name.replace(/\.\w+$/, "") });
  return panneau(it.fichier.name, el("span", { class: "meta" }, "format inconnu"), "",
    el("p", null, "PLOUTOS ne reconnaît pas ce fichier. Indique les colonnes une fois : le format sera retenu pour les prochains imports."),
    el("div", { class: "pl-tableau" }, el("table", null, lignes.map((l) => el("tr", null, cols.map((i) => el("td", null, l[i] ?? "")))))),
    el("div", { class: "pl-form deux" }, el("label", { class: "pl-bascule" }, entete, "La première ligne contient les titres"), cDate, cMontant, cDebit, cCredit, cLib,
      el("label", null, "Compte", compte), el("label", null, "Nom du format", nom)),
    el("button", { type: "button", class: "cmd pl-principal", onclick: async () => {
      const v = (lab) => Number(lab.querySelector("select").value);
      const c = M.compte(E(), compte.value);
      const profil = { id: "libre_" + uid(), nom: nom.value.trim() || "Format libre", banque: c.banque, compte: c.id, entete: entete.checked,
        colDate: v(cDate), colMontant: v(cMontant), colDebit: v(cDebit), colCredit: v(cCredit), colLibelle: v(cLib),
        signature: entete.checked ? M.normaliser(it.releve.lignes[0].join("|")) : null };
      if (profil.colMontant < 0 && (profil.colDebit < 0 || profil.colCredit < 0)) return avis("Choisis la colonne du montant, ou celles du débit et du crédit.", true);
      await faire({ type: "profil", profil }, { redessiner: false });
      it.releve = M.lireReleve(it.releve.lignes, { profilsLibres: [profil], nomFichier: it.fichier.name });
      if (!it.releve.reconnu) { const p = M.profilLibre(profil); const r = p.lire(it.releve.lignes); it.releve = { reconnu: true, profil: profil.id, banque: c.banque, nomProfil: profil.nom, nomFichier: it.fichier.name, periode: null, ...r }; for (const o of it.releve.operations) o.commercant = M.commercant(o.libelle); }
      calculerApercus(); dessiner();
    } }, "Lire le fichier avec ce format"));
}
async function enregistrerImports() {
  const prets = P.importsEnCours.filter((i) => i.apercu);
  let ajoutees = 0, aValider = 0;
  for (const it of prets) {
    const r = await faire({ ...M.actionImport(it.releve, "imp_" + uid()) }, { redessiner: false });
    ajoutees += r.ids.length;
    aValider += r.ids.filter((id) => E().operations[id]?.aValider).length;
  }
  P.importsEnCours = null;
  avis(`${ajoutees} opération(s) ajoutée(s)` + (aValider ? `, ${aValider} à vérifier` : ""));
  if (aValider && iaDispo()) setTimeout(() => classerIA(), 1500);
  if (aValider) { aller("operations", { periode: "tout", cible: "", compte: "" }); P.filtres.aValider = true; dessiner(); }
  else aller("apercu");
}

/* ---------------------------------------------------------------- Réglages */
function vueReglages() {
  const sous = [["categories", "Catégories"], ["regles", "Règles"], ["calculs", "Calculs"], ["donnees", "Données et coffre"]];
  const corps = { categories: reglagesCategories, regles: reglagesRegles, calculs: reglagesCalculs, donnees: reglagesDonnees }[P.sousReglages]();
  return el("div", { class: "pl-pile" },
    el("div", { class: "pl-segments", role: "tablist" }, sous.map(([id, n]) => el("button", { type: "button", role: "tab", class: "pl-segment", "aria-selected": P.sousReglages === id ? "true" : "false", onclick: () => { P.sousReglages = id; dessiner(); } }, n))),
    corps);
}
/** Conventions de calcul (décisions D1 à D3), en clair et réglables. */
function reglagesCalculs() {
  const etat = E(), rg = M.reglages(etat);
  const seuil = el("input", { type: "number", min: "1", max: "31", value: rg.seuilSalaire, "aria-label": "Jour à partir duquel le salaire compte pour le mois suivant", class: "pl-petit-champ" });
  const decales = Object.values(etat.operations).filter((o) => M.decale(etat, o)).length;
  return el("div", { class: "pl-pile" },
    carte("Mois d'une opération", null,
      el("p", null, "Une opération compte dans le mois où elle est ", el("b", null, "débitée"), " (date de valeur LCL, date de fin Revolut). La date d'achat reste affichée. C'est la seule convention qui tombe juste avec les soldes.")),
    carte("Mois de paie", el("span", { class: "pl-doux" }, decales + " opération(s) décalée(s)"),
      el("label", { class: "pl-ligne-reglage" }, "Un salaire versé à partir du", seuil, "compte pour le mois suivant."),
      el("p", { class: "pl-doux" }, "Ne touche que les totaux du mois, jamais les soldes. Chaque opération peut aussi être déplacée à la main depuis son détail (« Comptée en »)."),
      el("button", { type: "button", class: "pl-btn principal", onclick: async () => {
        const v = Math.round(Number(seuil.value));
        if (!(v >= 1 && v <= 31)) return avis("Choisis un jour entre 1 et 31.", true);
        await faire({ type: "reglages", reglages: { seuilSalaire: v } }); avis("Réglage enregistré.");
      } }, "Enregistrer")),
    carte("Ce qui compte où", null, el("ul", { class: "pl-aide" },
      el("li", null, el("b", null, "Dépenses : "), "dépenses moins remboursements (mutuelle, retour d'achat), dans la catégorie remboursée."),
      el("li", null, el("b", null, "Revenus : "), "salaire, aide familiale (montrée à part), intérêts, autres rentrées."),
      el("li", null, el("b", null, "Ni l'un ni l'autre : "), "virements entre tes comptes, virements à rapprocher, envois vers un compte à toi non suivi."),
      el("li", null, el("b", null, "Mis de côté : "), "versements vers l'épargne moins retraits, plus intérêts."))));
}
function demanderTexte(titre, libelle, valeur, valider) {
  const champ = el("input", { type: "text", value: valeur || "", "aria-label": libelle });
  dialogue(titre, el("div", { class: "pl-form" }, el("label", null, libelle, champ)), [["Annuler", (f) => f()], ["Enregistrer", async (f) => { const v = champ.value.trim(); if (!v) return; f(); await valider(v); }, true]]);
  champ.select();
}
function reglagesCategories() {
  const etat = E();
  const usage = {};
  for (const o of Object.values(etat.operations)) if (o.categorie) usage[o.categorie] = (usage[o.categorie] || 0) + 1;
  const groupes = [...etat.config.groupes].filter((g) => !g.archive).sort((a, b) => a.ordre - b.ordre);
  const TYPES = { depense: "dépenses", revenu: "revenus", interne: "mouvements internes" };
  return el("div", { class: "grille" }, groupes.map((g) => {
    const cats = etat.config.categories.filter((c) => c.groupe === g.id && !c.archivee).sort((a, b) => a.ordre - b.ordre);
    return el("div", { class: "s6" }, el("section", { class: "panneau pl-groupe" + (g.masque ? " masque" : ""), style: `--m:${g.couleur}` },
      el("div", { class: "p-titre" }, el("h2", null, g.nom), el("span", { class: "meta" }, TYPES[g.type] + (g.masque ? " · masqué" : ""))),
      el("ul", { class: "liste" }, cats.map((c) => el("li", null, el("div", { class: "pl-cat-ligne" + (c.masquee ? " masquee" : "") },
        el("span", null, c.nom, c.masquee ? el("small", null, " (masquée)") : null),
        el("span", { class: "secondaire" }, (usage[c.id] || 0) + " op."),
        el("span", { class: "pl-boutons" },
          el("button", { type: "button", class: "pl-lien", onclick: () => demanderTexte("Renommer la catégorie", "Nouveau nom", c.nom, (v) => faire({ type: "categorie", categorie: { id: c.id, nom: v } })) }, "Renommer"),
          el("button", { type: "button", class: "pl-lien", onclick: () => faire({ type: "categorie", categorie: { id: c.id, masquee: !c.masquee } }) }, c.masquee ? "Afficher" : "Masquer"),
          usage[c.id] ? el("button", { type: "button", class: "pl-lien", onclick: (e) => selecteur(e.currentTarget, { creation: false, choisir: (cible) => cible && cible !== c.id && confirmer("Fusionner",
            `Les ${usage[c.id]} opération(s) et les règles de « ${c.nom} » passent dans « ${M.categorie(etat, cible).nom} ». « ${c.nom} » est archivée.`, "Fusionner", () => faire({ type: "fusionner", source: c.id, cible }), false) }) }, "Fusionner…")
            : el("button", { type: "button", class: "pl-lien", onclick: () => faire({ type: "categorie", categorie: { id: c.id, archivee: true } }) }, "Archiver")))))),
      el("div", { class: "pl-boutons" },
        el("button", { type: "button", class: "pl-lien", onclick: () => demanderTexte("Nouvelle catégorie · " + g.nom, "Nom", "", (v) => faire({ type: "categorie", categorie: { id: g.id + "-" + M.normaliser(v).replace(/ /g, "-").slice(0, 28) + "-" + uid().slice(-4), groupe: g.id, nom: v } })) }, "+ Catégorie"),
        el("button", { type: "button", class: "pl-lien", onclick: () => demanderTexte("Renommer le groupe", "Nouveau nom", g.nom, (v) => faire({ type: "groupe", groupe: { id: g.id, nom: v } })) }, "Renommer le groupe"),
        el("button", { type: "button", class: "pl-lien", onclick: () => faire({ type: "groupe", groupe: { id: g.id, masque: !g.masque } }) }, g.masque ? "Afficher le groupe" : "Masquer le groupe"))));
  }), el("div", { class: "s12" }, el("button", { type: "button", class: "cmd", onclick: () => {
    const nom = el("input", { type: "text", "aria-label": "Nom du groupe" });
    const type = el("select", null, el("option", { value: "depense" }, "Dépenses"), el("option", { value: "revenu" }, "Revenus"));
    dialogue("Nouveau groupe", el("div", { class: "pl-form" }, el("label", null, "Nom", nom), el("label", null, "Type", type)), [["Annuler", (f) => f()], ["Créer", async (f) => {
      if (!nom.value.trim()) return; f(); await faire({ type: "groupe", groupe: { id: "g-" + M.normaliser(nom.value).replace(/ /g, "-").slice(0, 24) + "-" + uid().slice(-4), nom: nom.value.trim(), type: type.value } });
    }, true]]);
  } }, ICONE(I.plus), "Nouveau groupe")));
}
function reglagesRegles() {
  const etat = E();
  const usage = {};
  for (const o of Object.values(etat.operations)) if (o.source && o.source.startsWith("regle:")) usage[o.source.slice(6)] = (usage[o.source.slice(6)] || 0) + 1;
  const perso = [...etat.config.regles].sort((a, b) => (a.priorite ?? 100) - (b.priorite ?? 100));
  const inactives = new Set(etat.config.basesInactives);
  const filtreBase = el("input", { type: "search", placeholder: "Chercher une enseigne…", "aria-label": "Chercher une règle de base" });
  const listeBase = el("ul", { class: "liste pl-bases" });
  const peindreBases = () => {
    const q = M.normaliser(filtreBase.value);
    listeBase.replaceChildren(...M.BASES.filter((r) => !q || M.normaliser(M.decrireRegle(etat, r)).includes(q)).slice(0, 80).map((r) => el("li", null, el("label", { class: "pl-regle-base" },
      el("input", { type: "checkbox", checked: !inactives.has(r.id), onchange: (e) => faire({ type: "base", idRegle: r.id, active: e.target.checked }, { redessiner: false }) }),
      el("span", null, M.decrireRegle(etat, r)), el("span", { class: "secondaire" }, (usage[r.id] || 0) + " op.")))));
  };
  filtreBase.addEventListener("input", peindreBases);
  peindreBases();
  return el("div", { class: "grille" },
    el("div", { class: "s12" }, panneau("Tes règles", el("span", { class: "compte" }, String(perso.length)), "",
      el("p", { class: "secondaire" }, "Appliquées avant les règles de base, dans cet ordre. Une correction manuelle n'est jamais écrasée."),
      perso.length ? el("ul", { class: "liste" }, perso.map((r) => el("li", null, el("div", { class: "pl-regle" + (r.active === false ? " inactive" : "") },
        el("input", { type: "checkbox", checked: r.active !== false, "aria-label": "Règle active", onchange: (e) => faire({ type: "regle", regle: { ...r, active: e.target.checked } }, { redessiner: false }) }),
        el("span", null, M.decrireRegle(etat, r)),
        el("span", { class: "secondaire" }, (usage[r.id] || 0) + " op."),
        el("span", { class: "pl-boutons" },
          el("button", { type: "button", class: "pl-lien", onclick: async () => { const res = await faire({ type: "appliquer-regle", idRegle: r.id }); avis("Appliquée à " + res.ids.length + " opération(s)"); } }, "Appliquer"),
          el("button", { type: "button", class: "pl-lien", onclick: () => editeurRegle(r) }, "Modifier"))))))
        : el("div", { class: "vide" }, "Aucune règle personnelle. Corrige une catégorie dans Opérations : PLOUTOS te proposera d'en créer une."),
      el("div", { class: "pl-boutons" },
        el("button", { type: "button", class: "cmd", onclick: () => editeurRegle({ id: "regle_" + uid(), conditions: [{ champ: "commercant", op: "contient", valeur: "" }], action: { categorie: null }, priorite: 50, active: true, origine: "manuelle" }, { nouvelle: true }) }, ICONE(I.plus), "Nouvelle règle"),
        el("button", { type: "button", class: "cmd", onclick: () => confirmer("Repasser toutes les règles", "Les opérations classées par une règle ou non classées sont reclassées avec les règles actuelles. Tes corrections manuelles et les virements internes ne bougent pas.", "Reclasser",
          async () => { const r = await faire({ type: "reclasser" }); avis(r.ids.length + " opération(s) reclassée(s)"); }, false) }, "Repasser les règles sur tout")))),
    el("div", { class: "s12" }, panneau("Règles de base", el("span", { class: "meta" }, (M.BASES.length - inactives.size) + " actives sur " + M.BASES.length), "",
      el("p", { class: "secondaire" }, "Enseignes nationales courantes. Décoche celles qui ne te conviennent pas."), filtreBase, listeBase)));
}
function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = el("a", { href: url, download: nom });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function reglagesDonnees() {
  const etat = E(), c = P.coffre, st = c.statut;
  const entreeRegles = el("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: async (e) => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      const res = await faire({ type: "importer-regles", regles: j.regles || [], categories: j.categories || [], appliquer: true });
      avis(`${(j.regles || []).length} règle(s) importée(s), ${res.ids.length} opération(s) reclassée(s)`);
    } catch { avis("Fichier de règles illisible.", true); }
  } });
  const journal = [...etat.journal].reverse().slice(0, 150);
  return el("div", { class: "grille" },
    el("div", { class: "s6" }, panneau("Coffre", el("span", { class: "meta" }, c.local ? "sur cet appareil" : "synchronisé"), "",
      el("dl", { class: "pl-dl" },
        el("dt", null, "Stockage"), el("dd", null, c.local ? "Chiffré sur cet appareil seulement" : "Chiffré dans ton dépôt GitHub privé " + donnees.ploutos.coffre.depot),
        el("dt", null, "Cet appareil"), el("dd", null, nomAppareil()),
        el("dt", null, "Dernière synchro"), el("dd", null, st.derniere ? quand(st.derniere) : "—"),
        el("dt", null, "En attente d'envoi"), el("dd", null, String(c.attente.length)),
        el("dt", null, "Opérations"), el("dd", null, String(Object.keys(etat.operations).length)),
        st.erreur ? [el("dt", null, "Problème"), el("dd", { class: "ambre" }, st.erreur)] : null),
      c.local && !DEMO ? el("div", { class: "pl-encart" }, "Pour retrouver PLOUTOS sur ton téléphone et ton ordinateur, ajoute le jeton PLOUTOS_TOKEN (guide, étape 9). Ce que tu as importé ici sera envoyé à la première synchronisation.") : null,
      el("div", { class: "pl-boutons" },
        !c.local ? el("button", { type: "button", class: "cmd", onclick: async () => { await c.synchroniser(); dessiner(); avis(c.statut.erreur || "Coffre synchronisé.", !!c.statut.erreur); } }, ICONE(I.synchro), "Synchroniser") : null,
        !DEMO ? el("button", { type: "button", class: "cmd pl-danger", onclick: () => confirmer("Effacer le coffre de cet appareil",
          c.local ? "Attention : sans jeton, cet appareil est le seul endroit où ton coffre existe. Exporte d'abord une sauvegarde." : "La copie locale est effacée. Ton coffre en ligne reste intact et sera rechargé.",
          "Effacer", async () => { await stockageIdb().toutEffacer(); location.reload(); }) }, "Effacer de cet appareil") : null))),
    el("div", { class: "s6" }, panneau("Exporter et importer", null, "",
      el("div", { class: "pl-boutons colonne" },
        el("button", { type: "button", class: "cmd", onclick: () => telecharger(`ploutos-sauvegarde-${aujourdhui()}.json`, JSON.stringify(c.exporter(), null, 1), "application/json") }, ICONE(I.export), "Sauvegarde complète (JSON)"),
        el("button", { type: "button", class: "cmd", onclick: () => telecharger(`ploutos-operations-${aujourdhui()}.csv`, M.exporterCsv(etat, Object.values(etat.operations).sort((a, b) => a.date.localeCompare(b.date))), "text/csv") }, ICONE(I.export), "Toutes les opérations (CSV pour Excel)"),
        el("button", { type: "button", class: "cmd", onclick: () => telecharger(`ploutos-regles-${aujourdhui()}.json`, JSON.stringify({ regles: etat.config.regles }, null, 1), "application/json") }, ICONE(I.export), "Mes règles (JSON)"),
        el("label", { class: "cmd" }, entreeRegles, ICONE(I.fichier), "Importer des règles (JSON)")),
      el("p", { class: "secondaire" }, "Les fichiers exportés sont en clair : range-les dans un endroit sûr."))),
    el("div", { class: "s12" }, panneau("Journal des modifications", el("span", { class: "compte" }, String(etat.journal.length)), "",
      journal.length ? el("ul", { class: "liste" }, journal.map((j) => el("li", null, el("div", { class: "pl-mini" }, el("span", null, quand(j.t)), el("span", null, j.resume), el("span", { class: "secondaire" }, j.appareil || "")))))
        : el("div", { class: "vide" }, "Rien pour l'instant."))));
}

/* ---------------------------------------------------------------- Classement automatique par l'IA
   Les règles passent d'abord (gratuites). Seules les opérations qu'aucune règle ne reconnaît partent à Claude (Haiku),
   avec le libellé, le montant et le type, jamais les soldes ni les comptes. Chaque réponse sûre devient une règle :
   le même commerçant ne repart jamais à l'IA. Coût : une fraction de centime par import. */
const iaDispo = () => !DEMO && !!(donnees && donnees.jarvis && donnees.jarvis.cle);
const aClasserIA = () => Object.values(E().operations).filter((o) => !o.categorie && !o.lien && o.source !== "manuel");
async function classerIA({ silencieux = false } = {}) {
  if (!iaDispo() || P.iaEnCours) return null;
  const etat = E(), ops = aClasserIA().slice(0, 150);
  if (!ops.length) return null;
  P.iaEnCours = true; majBarreOps();
  try {
    const groupes = [...etat.config.groupes].filter((g) => !g.archive).sort((a, b) => a.ordre - b.ordre);
    const cats = groupes.flatMap((g) => etat.config.categories.filter((c) => c.groupe === g.id && !c.archivee).map((c) => `${c.id} = ${g.nom} › ${c.nom}`));
    const lignes = ops.map((o, i) => `${i}\t${o.montant < 0 ? "dépense" : "rentrée"} ${(Math.abs(o.montant) / 100).toFixed(2)} €\t${o.type || ""}\t${o.commercant}\t${o.libelle}`);
    const consigne = [
      "Tu classes des opérations bancaires françaises (comptes d'un particulier, en France) dans des catégories de budget.",
      "Catégories autorisées (identifiant = groupe › catégorie) :", ...cats, "",
      "Pour chaque opération, réponds par un objet {\"i\": numéro, \"c\": identifiant de catégorie, \"s\": true si tu es sûr, false sinon}.",
      "Sûr = tu connais l'enseigne ou le libellé ne laisse aucun doute. Une personne physique (prénom nom) : divers-paiements-entre-amis, s false.",
      "Si tu ne sais vraiment pas, utilise divers-depenses-non-classees avec s false. Une rentrée d'argent n'est jamais une dépense.",
      "Réponds uniquement par le tableau JSON, sans texte autour.",
    ].join("\n");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": donnees.jarvis.cle, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: donnees.jarvis.modele || "claude-haiku-5-5", max_tokens: 6000, thinking: { type: "disabled" }, output_config: { effort: "low" },
        system: consigne, messages: [{ role: "user", content: "Opérations (numéro, sens et montant, type, commerçant, libellé) :\n" + lignes.join("\n") }] }),
    });
    if (!r.ok) throw new Error("Claude a répondu " + r.status);
    const texte = (await r.json()).content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = JSON.parse(texte.slice(texte.indexOf("["), texte.lastIndexOf("]") + 1));
    const resultats = [], regles = [], vus = new Set();
    for (const x of Array.isArray(json) ? json : []) {
      const o = ops[Number(x.i)];
      if (!o || !M.categorie(etat, x.c)) continue;
      const sur = x.s === true && x.c !== "divers-depenses-non-classees";
      resultats.push({ id: o.id, categorie: x.c, sur });
      if (sur && o.commercant) {
        const regle = { ...M.proposerRegle(o, x.c), origine: "ia", priorite: 60 };
        regle.id = "ia_" + uid() + regles.length;
        const cle = regle.conditions[0].valeur + "|" + regle.conditions[1].valeur;
        if (!vus.has(cle) && !etat.config.regles.some((y) => M.regleCorrespond(o, y))) { vus.add(cle); regles.push(regle); }
      }
    }
    const res = await faire({ type: "classer-ia", resultats, regles }, { redessiner: false });
    rafraichirVue();
    const doutes = resultats.filter((x) => !x.sur).length;
    if (res.ids.length) avis(`Classement automatique : ${res.ids.length} opération(s)` + (doutes ? `, dont ${doutes} à vérifier` : ""));
    return res;
  } catch (e) {
    console.error(e);
    if (!silencieux) avis("Classement automatique impossible : " + e.message, true);
    return null;
  } finally { P.iaEnCours = false; majBarreOps(); }
}

/* ---------------------------------------------------------------- Résumé pour l'accueil NEXUS */
function resume() {
  if (P.phase !== "pret" || !P.etat || !Object.keys(P.etat.operations).length) return null;
  const { du, au } = M.periode("mois", aujourdhui());
  const r = M.indicateurs(P.etat, M.opsPeriode(P.etat, Object.values(P.etat.operations), du, au));
  return { depenses: r.depenses.valeur, revenus: r.revenus.valeur, aValider: Object.values(P.etat.operations).filter((o) => o.aValider).length };
}

window.Ploutos = { vue, ouvrir, resume, _etat: () => P };
})();
