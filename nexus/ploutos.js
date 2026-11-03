/* PLOUTOS : l'interface du module budget dans la console NEXUS.
   Chargé à la demande par index.html (vuePloutos). Utilise les outils de la console (el, s, panneau, jauge, avis…),
   le moteur (ploutos-moteur.js) et le coffre chiffré (ploutos-coffre.js). Tout est calculé dans le navigateur. */
(function () {
"use strict";
const M = window.PloutosMoteur, K = window.PloutosCoffre;

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
const ICONE = (d) => { const g = s("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }); g.innerHTML = d; return g; };
const I = {
  recherche: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', fermer: '<path d="M6 6l12 12M18 6 6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  lien: '<path d="M8 12h8M6 8H5a4 4 0 0 0 0 8h1M18 8h1a4 4 0 0 1 0 8h-1"/>', fichier: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  synchro: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', export: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
};

const P = {
  coffre: null, etat: null, phase: "chargement", erreur: null,
  onglet: memo.lire("onglet", "apercu"), sousReglages: "categories",
  filtres: { periode: "mois", du: "", au: "", compte: "", cible: "", aValider: false, q: "", ...memo.lire("filtres", {}), q: "", aValider: false },
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
      const cle = DEMO ? await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]) : await lireCle(CLE_COFFRE);
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
  addEventListener("online", () => P.coffre && P.coffre.synchroniser());
}
async function faire(action, { redessiner = true } = {}) {
  const r = await P.coffre.faire(action);
  P.etat = P.coffre.etat;
  if (redessiner) dessiner();
  return r;
}

/* ---------------------------------------------------------------- Structure */
const ONGLETS = [
  ["apercu", "Vue d'ensemble"], ["operations", "Opérations"], ["comptes", "Comptes"], ["importer", "Importer"], ["reglages", "Réglages"],
  ["budgets", "Budgets", 2], ["epargne", "Épargne", 3], ["analyses", "Analyses", 4],
];
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
  if (filtres) { Object.assign(P.filtres, filtres); memo.ecrire("filtres", { ...P.filtres, q: "", aValider: false }); }
  P.selection.clear();
  dessiner();
  if (P.racine.getBoundingClientRect().top < 0) scrollTo({ top: 0 });
}
function dessiner() {
  if (!P.racine) return;
  const barre = el("nav", { class: "pl-onglets", "aria-label": "Sections de PLOUTOS" },
    ONGLETS.map(([id, nom, etape]) => {
      const n = id === "operations" && P.etat ? Object.values(P.etat.operations).filter((o) => o.aValider).length : 0;
      return el("button", { type: "button", class: "pl-onglet", "aria-current": P.onglet === id ? "page" : null, disabled: !!etape || P.phase !== "pret",
        title: etape ? "Arrive à l'étape " + etape : null, onclick: () => aller(id) },
        nom, etape ? el("small", null, "ÉTAPE " + etape) : null, n ? el("b", { class: "pl-pastille" }, String(n)) : null);
    }));
  const tete = el("div", { class: "pl-tete" }, barre, el("button", { type: "button", class: "pl-statut", id: "pl-statut" }));
  let corps;
  switch (P.phase) {
    case "chargement": corps = el("div", { class: "vide" }, "Ouverture du coffre…"); break;
    case "cle": corps = vueCle(); break;
    case "ancienne-cle": corps = vueAncienneCle(); break;
    case "erreur": corps = panneau("Coffre indisponible", null, "alerte", el("p", null, P.erreur || "Erreur inconnue."), el("button", { class: "cmd", type: "button", onclick: () => location.reload() }, "Recharger")); break;
    default: corps = ({ apercu: vueApercu, operations: vueOperations, comptes: vueComptes, importer: vueImporter, reglages: vueReglages }[P.onglet] || vueApercu)();
  }
  P.corps = el("div", { class: "pl-corps" }, corps);
  P.racine.replaceChildren(tete, P.corps);
  dessinerStatut();
}
function dessinerStatut() {
  const z = P.racine && P.racine.querySelector("#pl-statut");
  if (!z || !P.coffre) return;
  const st = P.coffre.statut, n = P.coffre.attente.length;
  let texte, classe = "";
  if (P.coffre.local) { texte = DEMO ? "DÉMO · RIEN N'EST GARDÉ" : "COFFRE LOCAL · CET APPAREIL"; classe = "ambre"; }
  else if (st.etat === "synchro") texte = "SYNCHRONISATION…";
  else if (st.etat === "hors-ligne") { texte = "HORS LIGNE" + (n ? " · " + n + " EN ATTENTE" : ""); classe = "ambre"; }
  else if (st.etat === "erreur") { texte = "SYNCHRO EN ÉCHEC"; classe = "rouge"; }
  else if (st.etat === "conflit-initial") { texte = "CHOIX À FAIRE"; classe = "ambre"; }
  else texte = n ? n + " EN ATTENTE" : "COFFRE SYNCHRONISÉ" + (st.derniere ? " · " + quand(st.derniere) : "");
  z.className = "pl-statut " + classe;
  z.replaceChildren(el("i"), texte);
  z.title = st.erreur || (P.coffre.local ? "Les données restent chiffrées sur cet appareil. Ajoute le jeton PLOUTOS_TOKEN pour les retrouver partout (guide, étape 9)." : "Coffre chiffré dans ton dépôt GitHub privé.");
  z.onclick = () => aller("reglages") || (P.sousReglages = "donnees", dessiner());
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
  return el("div", { class: "grille" }, el("div", { class: "s6" }, panneau("Coffre PLOUTOS", el("span", { class: "meta" }, "UNE FOIS PAR APPAREIL"), "",
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
function bornes() { return M.periode(P.filtres.periode, aujourdhui(), P.filtres.du, P.filtres.au); }
function filtreCible(o) {
  const c = P.filtres.cible;
  if (!c) return true;
  if (c.startsWith("g:")) return o.categorie && M.categorie(E(), o.categorie)?.groupe === c.slice(2);
  if (c === "_aucune") return !o.categorie;
  return o.categorie === c;
}
function opsFiltrees({ recherche = true } = {}) {
  const { du, au } = bornes(), f = P.filtres;
  const q = recherche && f.q.trim() ? M.compilerRecherche(E(), f.q) : null;
  return Object.values(E().operations).filter((o) => o.date >= du && o.date <= au && (!f.compte || o.compte === f.compte) && filtreCible(o)
    && (!recherche || !f.aValider || o.aValider) && (!q || q(o)))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.heure || "").localeCompare(a.heure || "") || b.montant - a.montant);
}
function nomCible(c) {
  if (!c) return "Toutes les catégories";
  if (c === "_aucune") return "Non classées";
  if (c.startsWith("g:")) return M.groupe(E(), c.slice(2))?.nom || "Groupe";
  return M.categorie(E(), c)?.nom || "Catégorie";
}
const PERIODES = [["mois", "Ce mois"], ["mois-1", "Mois dernier"], ["3mois", "3 derniers mois"], ["annee", "Cette année"], ["tout", "Tout"], ["perso", "Personnalisée"]];
function barreFiltres({ recherche = false, auChangement }) {
  const f = P.filtres;
  const changer = (k, v) => { f[k] = v; memo.ecrire("filtres", { ...f, q: "", aValider: false }); P.selection.clear(); auChangement(); };
  const periode = el("select", { "aria-label": "Période", onchange: (e) => { changer("periode", e.target.value); } },
    PERIODES.map(([v, n]) => el("option", { value: v, selected: f.periode === v }, n)));
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

/* ---------------------------------------------------------------- Vue d'ensemble */
function tuileSolde(nom, s, compteId) {
  let badge;
  if (!s) badge = el("span", { class: "pl-badge" }, "AUCUNE DONNÉE");
  else if (s.inconnu) badge = el("button", { type: "button", class: "pl-badge ambre", onclick: () => saisirSolde(compteId) }, "SOLDE À SAISIR");
  else if (s.verifie && !s.ancien) badge = el("span", { class: "pl-badge vert", title: "Lu dans un relevé ou saisi le " + dateLongue(s.date) }, "VÉRIFIÉ " + dateCourte(s.date).toUpperCase());
  else badge = el("span", { class: "pl-badge ambre", title: `Dernier solde vérifié le ${dateLongue(s.date)}, plus ${s.mouvementsDepuis} opération(s) importée(s) depuis.` },
    (s.verifie ? "RELEVÉ DU " + dateCourte(s.date).toUpperCase() : "ESTIMÉ") + (s.age > 7 ? " · " + s.age + " J" : ""));
  return el("div", { class: "pl-tuile" }, el("div", { class: "pl-tuile-nom" }, nom),
    el("div", { class: "pl-tuile-val" + (s && s.montant < 0 ? " negatif" : "") }, s && s.montant != null ? euros(s.montant) : "—"), badge);
}
function vueApercu() {
  const etat = E(), ops = Object.values(etat.operations);
  if (!ops.length) return accueilVide();
  const auj = aujourdhui();
  const soldes = etat.config.comptes.map((c) => ({ c, s: M.solde(etat, c.id, auj) }));
  const total = soldes.reduce((t, x) => t + (x.s && x.s.montant != null ? x.s.montant : 0), 0);
  const tousVerifies = soldes.every((x) => !x.s || (x.s.verifie && !x.s.ancien));
  const periode = opsFiltrees({ recherche: false });
  const t = M.totaux(etat, periode);
  const libPeriode = PERIODES.find(([v]) => v === P.filtres.periode)[1].toLowerCase();

  const kpi = (nom, val, sous, classe) => el("div", { class: "pl-kpi " + (classe || "") }, el("div", { class: "pl-tuile-nom" }, nom), el("div", { class: "pl-kpi-val" }, val), sous ? el("div", { class: "secondaire" }, sous) : null);
  const aValider = ops.filter((o) => o.aValider).sort((a, b) => b.date.localeCompare(a.date));

  // Dépenses par groupe
  const groupes = Object.entries(t.parGroupe).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = groupes.length ? groupes[0][1] : 1;
  const barres = groupes.length ? el("div", { class: "pl-barres" }, groupes.map(([gid, v]) => {
    const g = M.groupe(etat, gid);
    return el("button", { type: "button", class: "pl-barre-ligne", onclick: () => aller("operations", { cible: gid === "_aucun" ? "_aucune" : "g:" + gid }) },
      el("span", { class: "pl-barre-nom" }, g ? g.nom : "Non classées"),
      el("span", { class: "pl-barre-piste" }, el("i", { style: `width:${(v / max * 100).toFixed(1)}%;background:${g ? g.couleur : "var(--tres-doux)"}` })),
      el("span", { class: "pl-barre-val" }, euros(v, { rond: true })));
  })) : el("div", { class: "vide" }, "Aucune dépense sur la période.");

  const j = joursEntre(donnees.ploutos.point_budget_date);
  return el("div", { class: "pl-pile" },
    barreFiltres({ auChangement: dessiner }),
    el("div", { class: "grille" },
      el("div", { class: "s12" }, panneau("Soldes", el("span", { class: "meta" }, tousVerifies ? "VÉRIFIÉS" : "CERTAINS ESTIMÉS"), "",
        el("div", { class: "pl-tuiles" }, soldes.map(({ c, s: sd }) => tuileSolde(c.nom, sd, c.id)),
          el("div", { class: "pl-tuile total" }, el("div", { class: "pl-tuile-nom" }, "Patrimoine financier connu"), el("div", { class: "pl-tuile-val" }, euros(total)),
            el("span", { class: "pl-badge" + (tousVerifies ? " vert" : " ambre") }, tousVerifies ? "VÉRIFIÉ" : "EN PARTIE ESTIMÉ"))))),
      el("div", { class: "s12" }, el("div", { class: "pl-kpis" },
        kpi("Salaire reçu", euros(t.salaire), libPeriode),
        kpi("Dépenses", euros(t.depenses), t.nonClassees ? t.nonClassees + " non classée(s)" : libPeriode, "rouge"),
        kpi("Épargne nette", euros(t.epargne, { signe: true }), "versements − retraits + intérêts", t.epargne >= 0 ? "vert" : "rouge"),
        kpi("Revenus − dépenses", euros(t.revenus - t.depenses, { signe: true }), "revenus : " + euros(t.revenus), t.revenus - t.depenses >= 0 ? "vert" : "rouge"))),
      el("div", { class: "s7" }, panneau("Dépenses par groupe", el("span", { class: "meta" }, libPeriode.toUpperCase()), "", barres)),
      el("div", { class: "s5 pile" },
        panneau("À valider", el("span", { class: "compte" }, String(aValider.length)), "",
          aValider.length ? el("div", null, el("ul", { class: "liste" }, aValider.slice(0, 6).map((o) => el("li", null, ligneCompacte(o)))),
            el("button", { type: "button", class: "pl-lien", onclick: () => aller("operations", { periode: "tout", cible: "" }) || (P.filtres.aValider = true, dessiner()) }, "Tout voir →"))
            : el("div", { class: "vide" }, "Tout est classé.")),
        panneau("Point budget", el("span", { class: "meta" }, donnees.ploutos.point_budget.toUpperCase()), "",
          el("div", { class: "jauges", style: "grid-template-columns:1fr" }, jauge({ valeur: 31 - Math.min(j, 31), max: 31, texte: j ? "J-" + j : "AUJ.", lib: j ? "avant le point du mois" : "c'est aujourd'hui", unite: "LE 5 DU MOIS" })))),
      el("div", { class: "s12" }, panneau("12 derniers mois", el("span", { class: "meta" }, "DÉPENSES ET REVENUS"), "", graphiqueMois(M.parMois(etat, ops, 12, aujourdhui()))))));
}
function accueilVide() {
  return el("div", { class: "grille" }, el("div", { class: "s8" }, panneau("Bienvenue dans PLOUTOS", null, "",
    el("ol", { class: "etapes" },
      el("li", null, el("span", null, "Exporte tes relevés LCL et Revolut au format CSV ou Excel, depuis l'appli ou le site de chaque banque.")),
      el("li", null, el("span", null, "Dépose-les dans l'onglet Importer : PLOUTOS reconnaît la banque, écarte les doublons et repère tes virements entre comptes.")),
      el("li", null, el("span", null, "Corrige les quelques opérations à valider : chaque correction peut devenir une règle automatique."))),
    el("button", { type: "button", class: "cmd pl-principal", onclick: () => aller("importer") }, "Importer mes relevés"))));
}
function graphiqueMois(mois) {
  const max = Math.max(1, ...mois.map((m) => Math.max(m.depenses, m.revenus)));
  const W = 720, H = 200, bas = 170, lg = W / mois.length;
  const g = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "pl-graph", role: "img", "aria-label": "Dépenses et revenus des 12 derniers mois" });
  for (let i = 0; i <= 2; i++) g.append(s("line", { x1: 0, x2: W, y1: bas - (bas - 14) * i / 2, y2: bas - (bas - 14) * i / 2, stroke: "rgba(120,200,255,.12)" }));
  mois.forEach((m, i) => {
    const x = i * lg, w = Math.min(18, lg / 3);
    const h1 = (bas - 14) * m.revenus / max, h2 = (bas - 14) * m.depenses / max;
    const titre = `${MOIS_LONGS[Number(m.mois.slice(5)) - 1]} ${m.mois.slice(0, 4)} : revenus ${euros(m.revenus)}, dépenses ${euros(m.depenses)}`;
    const grp = s("g", { class: "pl-graph-mois" }, s("title", null, titre),
      s("rect", { x: x + lg / 2 - w - 1, y: bas - h1, width: w, height: Math.max(h1, 0), fill: "var(--ploutos)", opacity: ".85" }),
      s("rect", { x: x + lg / 2 + 1, y: bas - h2, width: w, height: Math.max(h2, 0), fill: "var(--ambre)", opacity: ".85" }),
      s("text", { x: x + lg / 2, y: H - 10, "text-anchor": "middle" }, MOIS_COURTS[Number(m.mois.slice(5)) - 1]));
    g.append(grp);
  });
  return el("div", null, g, el("div", { class: "pl-legende" }, el("span", null, el("i", { style: "background:var(--ploutos)" }), "Revenus"), el("span", null, el("i", { style: "background:var(--ambre)" }), "Dépenses"),
    el("span", { class: "secondaire" }, "Hors virements entre tes comptes")));
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
    el("span", { class: "pl-op-date" }, dateCourte(o.date)),
    el("span", { class: "pl-op-nom" }, el("b", null, o.commercant), el("span", { class: "secondaire" }, M.compte(E(), o.compte)?.nom || "")),
    pastilleCategorie(o),
    el("span", { class: "pl-op-montant" + (o.montant > 0 ? " positif" : "") }, euros(o.montant, { signe: true })));
}
function ligneOperation(o) {
  const etat = E(), compte = M.compte(etat, o.compte);
  const badges = [];
  if (o.nature === "interne") badges.push(el("span", { class: "pl-badge" }, o.lien ? "INTERNE ↔" : "INTERNE · CONTREPARTIE ATTENDUE"));
  if (o.doublonPossible) badges.push(el("span", { class: "pl-badge rouge" }, "DOUBLON ?"));
  else if (o.aValider && o.categorie) badges.push(el("span", { class: "pl-badge ambre", title: "Classement incertain : vérifie-le puis valide" }, "À VÉRIFIER"));
  if (o.source === "manuel") badges.push(el("span", { class: "pl-badge discret", title: "Classée à la main" }, "MANUEL"));
  const coche = el("input", { type: "checkbox", "aria-label": "Sélectionner", checked: P.selection.has(o.id),
    onclick: (e) => e.stopPropagation(), onchange: (e) => { e.target.checked ? P.selection.add(o.id) : P.selection.delete(o.id); majBarreOps(); } });
  return el("div", { class: "pl-op" + (o.aValider ? " a-valider" : "") + (P.selection.has(o.id) ? " choisie" : ""), "data-id": o.id, onclick: () => detailOperation(o.id), role: "row" },
    el("span", { class: "pl-op-coche" }, coche),
    el("span", { class: "pl-op-date" }, dateCourte(o.date)),
    el("span", { class: "pl-op-nom" }, el("b", null, o.commercant, ...badges.map((b) => [" ", b])),
      el("span", { class: "secondaire" }, (compte ? compte.nom : o.compte) + " · " + o.libelle)),
    pastilleCategorie(o),
    el("span", { class: "pl-op-montant" + (o.montant > 0 ? " positif" : "") }, euros(o.montant, { signe: true })));
}

/** Liste virtuelle : seules les lignes visibles existent dans la page (fluide avec des milliers d'opérations). */
function listeVirtuelle(obtenir) {
  const haut = () => (innerWidth <= 760 ? 74 : 56);
  const zone = el("div", { class: "pl-liste", role: "table", tabindex: "0" });
  const piste = el("div", { class: "pl-piste" });
  zone.append(piste);
  let ops = [], debut = -1, fin = -1;
  function peindre(force) {
    const h = haut(), vue = zone.clientHeight || 600;
    const d = Math.max(0, Math.floor(zone.scrollTop / h) - 8), f = Math.min(ops.length, Math.ceil((zone.scrollTop + vue) / h) + 8);
    if (!force && d === debut && f === fin) return;
    debut = d; fin = f;
    piste.style.height = ops.length * h + "px";
    piste.replaceChildren(...ops.slice(d, f).map((o, i) => { const r = ligneOperation(o); r.style.top = (d + i) * h + "px"; r.style.height = h + "px"; return r; }));
  }
  zone.addEventListener("scroll", () => requestAnimationFrame(() => peindre(false)), { passive: true });
  addEventListener("resize", () => peindre(true));
  return { zone, maj() { ops = obtenir(); peindre(true); if (!ops.length) piste.replaceChildren(el("div", { class: "vide", style: "padding:18px" }, "Aucune opération ne correspond.")); }, ops: () => ops };
}
function vueOperations() {
  const recherche = el("input", { type: "search", class: "pl-recherche", value: P.filtres.q, placeholder: "Rechercher : commerçant, montant (45,90 · >100), date (12/10 · oct), banque, catégorie, « à valider »…",
    "aria-label": "Rechercher dans les opérations", oninput: (e) => { clearTimeout(vueOperations.t); vueOperations.t = setTimeout(() => { P.filtres.q = e.target.value; P.selection.clear(); P.liste.maj(); majBarreOps(); }, 120); } });
  P.liste = listeVirtuelle(() => opsFiltrees());
  P.barreOps = el("div", { class: "pl-resume" });
  const vueEl = el("div", { class: "pl-pile" },
    el("div", { class: "pl-cherche" }, ICONE(I.recherche), recherche),
    barreFiltres({ recherche: true, auChangement: () => { P.liste.maj(); majBarreOps(); dessinerFiltres(); } }),
    P.barreOps,
    el("div", { class: "pl-entete-liste", "aria-hidden": "true" }, el("span"), el("span", null, "Date"), el("span", null, "Opération"), el("span", null, "Catégorie"), el("span", null, "Montant")),
    P.liste.zone);
  requestAnimationFrame(() => { P.liste.maj(); majBarreOps(); });
  setTimeout(() => { if (P.filtres.q) recherche.focus(); }, 0);
  return vueEl;
  function dessinerFiltres() { const ancien = vueEl.querySelector(".pl-filtres"); ancien.replaceWith(barreFiltres({ recherche: true, auChangement: () => { P.liste.maj(); majBarreOps(); dessinerFiltres(); } })); }
}
function majBarreOps() {
  if (!P.barreOps) return;
  const ops = P.liste.ops(), t = M.totaux(E(), ops);
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
  const regle = M.proposerRegle(op, cat);
  const cibles = M.operationsCibles(etat, regle).filter((o) => o.categorie !== cat).length;
  P.suggestion = el("div", { class: "pl-suggestion", role: "status" },
    el("span", null, "Toujours classer ", el("b", null, "« " + op.commercant + " »"), " en ", el("b", null, c.nom), " ?",
      cibles ? el("span", { class: "secondaire" }, ` ${cibles} autre(s) opération(s) déjà importée(s) correspondent.`) : null),
    el("button", { type: "button", class: "cmd pl-principal", onclick: () => { fermerSuggestion(); editeurRegle(regle, { nouvelle: true }); } }, "Créer la règle"),
    el("button", { type: "button", class: "pl-lien", onclick: fermerSuggestion }, "Non merci"));
  document.body.append(P.suggestion);
  clearTimeout(P.suggestionMinuteur);
  P.suggestionMinuteur = setTimeout(fermerSuggestion, 15000);
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
      el("ul", { class: "liste" }, cibles.slice(0, 5).map((o) => el("li", null, el("div", { class: "pl-mini" }, el("span", null, dateCourte(o.date)), el("span", null, o.commercant), el("span", { class: "secondaire" }, o.libelle), el("span", null, euros(o.montant, { signe: true })))))));
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
  const imp = etat.imports.find((i) => i.id === o.import);
  const source = o.source === "manuel" ? "Corrigée à la main" : o.source === "virement" ? "Virement interne repéré automatiquement"
    : o.source && o.source.startsWith("regle:") ? "Règle : " + regleDe(o.source.slice(6)) : "Aucune règle ne correspond";
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
    ["Date", dateLongue(o.date) + (o.heure ? " · " + o.heure.slice(0, 5) : "") + (o.dateValeur !== o.date ? ` (débitée le ${dateLongue(o.dateValeur)})` : "")],
    ["Libellé d'origine", el("code", null, o.libelle)],
    ["Type", o.type || "—"],
    ["Classement", source],
    ["Import", imp ? `${imp.fichier || "fichier"} · ${dateLongue(imp.t.slice(0, 10))}` : "—"],
  ];
  const blocs = [el("dl", { class: "pl-dl" }, lignes.flatMap(([k, v]) => [el("dt", null, k), el("dd", null, v)]))];
  if (lie) blocs.push(el("div", { class: "pl-encart" }, el("b", null, "Virement entre tes comptes"), el("span", null, ` lié à ${euros(lie.montant, { signe: true })} sur ${M.compte(etat, lie.compte)?.nom} le ${dateLongue(lie.date)} (« ${lie.libelle} »). Il ne compte ni en dépense ni en revenu.`)));
  else if (o.nature === "interne") blocs.push(el("div", { class: "pl-encart" }, el("b", null, "Mouvement interne"), el("span", null, " : l'autre côté n'est pas encore importé. Il sera lié automatiquement au prochain import.")));
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
  const candidats = Object.values(etat.operations).filter((x) => x.compte !== o.compte && x.montant === -o.montant && M.ecartJours(x.date, o.date) <= 10)
    .sort((a, b) => M.ecartJours(a.date, o.date) - M.ecartJours(b.date, o.date));
  dialogue("Lier à un virement", candidats.length ? el("div", null, el("p", null, `Opérations de ${euros(-o.montant, { signe: true })} sur un autre compte, à 10 jours au plus :`),
    el("ul", { class: "liste" }, candidats.map((x) => el("li", null, el("button", { type: "button", class: "pl-mini bouton", onclick: async (e) => { e.target.closest(".pl-voile").remove(); await faire({ type: "lier", a: id, b: x.id }, { redessiner: false }); rafraichirVue(); avis("Virement interne lié."); } },
      el("span", null, dateCourte(x.date)), el("span", null, M.compte(etat, x.compte)?.nom), el("span", { class: "secondaire" }, x.libelle), el("span", null, euros(x.montant, { signe: true })))))))
    : el("p", null, "Aucune opération de montant opposé sur tes autres comptes. Importe l'autre relevé, ou classe-la en « Mouvements internes » si elle va vers un compte que PLOUTOS ne suit pas."));
}

/* ---------------------------------------------------------------- Comptes */
function saisirSolde(compteId) {
  const c = M.compte(E(), compteId);
  const montant = el("input", { type: "text", inputmode: "decimal", placeholder: "ex. 1 234,56", "aria-label": "Solde" });
  const date = el("input", { type: "date", value: aujourdhui(), "aria-label": "Date" });
  dialogue("Solde de référence · " + c.nom, el("div", { class: "pl-form" },
    el("p", { class: "secondaire" }, "Le solde affiché par ta banque à cette date, toutes opérations comprises. PLOUTOS s'en sert comme point de départ vérifié."),
    el("label", null, "Solde (€)", montant), el("label", null, "Au", date)), [
    ["Annuler", (f) => f()],
    ["Enregistrer", async (f) => {
      const v = M.centimes(montant.value);
      if (v == null || !date.value) return avis("Montant ou date invalide.", true);
      f(); await faire({ type: "solde", compte: compteId, date: date.value, montant: v }); avis("Solde enregistré.");
    }, true]]);
}
function vueComptes() {
  const etat = E(), auj = aujourdhui();
  return el("div", { class: "grille" }, etat.config.banques.map((b) => {
    const comptes = etat.config.comptes.filter((c) => c.banque === b.id);
    const imports = etat.imports.filter((i) => i.banque === b.id).sort((a, x) => x.t.localeCompare(a.t));
    return el("div", { class: "s6" }, panneau(b.nom, el("span", { class: "meta" }, comptes.length + " COMPTE(S)"), "",
      el("div", { class: "pl-tuiles" }, comptes.map((c) => {
        const s0 = M.solde(etat, c.id, auj);
        const n = Object.values(etat.operations).filter((o) => o.compte === c.id).length;
        const t = tuileSolde(c.nom, s0, c.id);
        t.append(el("div", { class: "pl-boutons" },
          el("button", { type: "button", class: "pl-lien", onclick: () => aller("operations", { compte: c.id, periode: "tout", cible: "" }) }, n + " opérations →"),
          el("button", { type: "button", class: "pl-lien", onclick: () => saisirSolde(c.id) }, "Saisir le solde")));
        return t;
      })),
      el("h3", { class: "pl-sous-titre" }, "Imports"),
      imports.length ? el("ul", { class: "liste" }, imports.map((i) => el("li", null, el("div", { class: "pl-import" },
        ICONE(I.fichier),
        el("span", null, el("b", null, i.fichier || "Relevé"), el("span", { class: "secondaire" },
          `importé le ${dateLongue(i.t.slice(0, 10))} · ${i.periode ? "du " + dateCourte(i.periode.du) + " au " + dateCourte(i.periode.au) : ""} · ${i.ajoutees} ajoutée(s), ${i.doublons} déjà connue(s)`
          + (i.controle ? (i.controle.ok ? " · relevé juste" : " · écart de " + euros(i.controle.ecart)) : "") + ((i.ecarts || []).length ? " · écart de solde à vérifier" : ""))),
        el("button", { type: "button", class: "pl-lien danger", onclick: () => confirmer("Supprimer cet import",
          `Les ${Object.values(etat.operations).filter((o) => o.import === i.id).length} opération(s) ajoutées par « ${i.fichier} » seront retirées, ainsi que son solde relevé. Tes règles et catégories ne bougent pas. L'action reste dans le journal.`,
          "Supprimer l'import", async () => { await faire({ type: "supprimer-import", importId: i.id }); avis("Import supprimé."); }) }, "Supprimer")))))
        : el("div", { class: "vide" }, "Aucun import pour l'instant."),
      el("button", { type: "button", class: "cmd", onclick: () => aller("importer") }, "Importer un relevé " + b.nom)));
  }));
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
  const blocs = [el("div", { class: "s12" }, panneau("Importer des relevés", el("span", { class: "meta" }, "RIEN N'EST ENREGISTRÉ AVANT TA CONFIRMATION"), "", zone))];
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
  return panneau(it.fichier.name, el("span", { class: "meta" }, r.nomProfil.toUpperCase()), "",
    el("dl", { class: "pl-dl" },
      el("dt", null, "Comptes"), el("dd", null, a.comptes.map((c) => M.compte(etat, c)?.nom || c).join(", ")),
      el("dt", null, "Période"), el("dd", null, r.periode ? `du ${dateLongue(r.periode.du)} au ${dateLongue(r.periode.au)}` : "—"),
      el("dt", null, "Opérations lues"), el("dd", null, String(a.lues)),
      el("dt", null, "Nouvelles"), el("dd", null, el("b", null, String(a.nouvelles))),
      el("dt", null, "Déjà connues"), el("dd", null, String(a.doublons) + (a.possibles ? ` · ${a.possibles} doublon(s) possible(s) à vérifier` : "")),
      el("dt", null, "Classées"), el("dd", null, String(a.classees)),
      el("dt", null, "À vérifier"), el("dd", null, el("b", { class: a.aValider ? "ambre" : "" }, String(a.aValider))),
      el("dt", null, "Virements internes"), el("dd", null, String(a.internes)),
      el("dt", null, "Solde lu"), el("dd", null, (r.soldes || []).map((s0) => `${M.compte(etat, s0.compte)?.nom} : ${euros(s0.montant)} au ${dateCourte(s0.date)}`).join(" · ") || "aucun (tu pourras le saisir)"),
      r.controle ? [el("dt", null, "Contrôle"), el("dd", { class: r.controle.ok ? "positif" : "ambre" }, r.controle.ok ? "Le relevé tombe juste (solde de départ + opérations = solde final)." : "Écart de " + euros(r.controle.ecart) + " : des lignes manquent peut-être.")] : null,
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
  return panneau(it.fichier.name, el("span", { class: "meta" }, "FORMAT INCONNU"), "",
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
  if (aValider) { aller("operations", { periode: "tout", cible: "", compte: "" }); P.filtres.aValider = true; dessiner(); }
  else aller("apercu");
}

/* ---------------------------------------------------------------- Réglages */
function vueReglages() {
  const sous = [["categories", "Catégories"], ["regles", "Règles"], ["donnees", "Données et coffre"]];
  const corps = { categories: reglagesCategories, regles: reglagesRegles, donnees: reglagesDonnees }[P.sousReglages]();
  return el("div", { class: "pl-pile" },
    el("div", { class: "filtres" }, sous.map(([id, n]) => el("button", { type: "button", class: "filtre", "aria-pressed": P.sousReglages === id ? "true" : "false", onclick: () => { P.sousReglages = id; dessiner(); } }, n))),
    corps);
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
      el("div", { class: "p-titre" }, el("h2", null, g.nom), el("span", { class: "meta" }, TYPES[g.type].toUpperCase() + (g.masque ? " · MASQUÉ" : ""))),
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
    el("div", { class: "s12" }, panneau("Règles de base", el("span", { class: "meta" }, (M.BASES.length - inactives.size) + " ACTIVES SUR " + M.BASES.length), "",
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
    el("div", { class: "s6" }, panneau("Coffre", el("span", { class: "meta" }, c.local ? "LOCAL" : "SYNCHRONISÉ"), "",
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

/* ---------------------------------------------------------------- Résumé pour l'accueil NEXUS */
function resume() {
  if (P.phase !== "pret" || !P.etat || !Object.keys(P.etat.operations).length) return null;
  const { du, au } = M.periode("mois", aujourdhui());
  const t = M.totaux(P.etat, Object.values(P.etat.operations).filter((o) => o.date >= du && o.date <= au));
  return { depenses: t.depenses, revenus: t.revenus, aValider: Object.values(P.etat.operations).filter((o) => o.aValider).length };
}

window.Ploutos = { vue, ouvrir, resume, _etat: () => P };
})();
