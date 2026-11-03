/* PLOUTOS : moteur sans affichage. Lecture des relevés (LCL, Revolut, format libre), normalisation,
   doublons, virements internes, règles de classement, actions et calculs. Aucune donnée personnelle ici :
   ce fichier est public. Les données de Louis vivent dans le coffre chiffré.
   Fonctionne dans le navigateur (window.PloutosMoteur) et sous Node pour les tests (module.exports). */
(function (racine) {
"use strict";

const M = {};
const VERSION = 2;  // 2 : provenance multiple, mois de rattachement, réglages (migration sans perte depuis 1)
M.VERSION = VERSION;

/* ---------------------------------------------------------------- Outils */
const sansAccents = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Texte comparable : minuscules, sans accents, ponctuation remplacée par des espaces. */
function normaliser(s) {
  return sansAccents(s).toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
M.normaliser = normaliser;

function decoderHtml(s) {
  return String(s ?? "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** "1 010,70", "-174.18", "1,010.70", "12" → centimes entiers (ou null). */
function centimes(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v ?? "").replace(/[\s  €]/g, "").replace(/^\+/, "");
  if (!s || !/\d/.test(s)) return null;
  const negatif = /^-|^\(.*\)$|-$/.test(s);
  s = s.replace(/[()-]/g, "");
  const virgule = s.lastIndexOf(","), point = s.lastIndexOf(".");
  if (virgule > -1 && point > -1) s = virgule > point ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (virgule > -1) s = s.replace(",", ".");
  if (!/^\d*\.?\d*$/.test(s)) return null;
  const n = Math.round(parseFloat(s) * 100);
  return Number.isFinite(n) ? (negatif ? -n : n) : null;
}
M.centimes = centimes;

/** "01/02/2026", "01/02/26", "2026-02-01", "2026-02-01 12:00:00" → "2026-02-01". */
function dateIso(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const a = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}
M.dateIso = dateIso;

const jours = (iso) => Date.parse(iso + "T00:00:00Z") / 864e5;
M.ecartJours = (a, b) => Math.abs(jours(a) - jours(b));

/** Empreinte stable (FNV-1a sur 2 × 32 bits), pour des identifiants identiques sur tous les appareils. */
function empreinte(texte) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    h2 = (h2 ^ (h2 >>> 15)) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
M.empreinte = empreinte;

/* ---------------------------------------------------------------- Lecture des fichiers */
/** Octets → texte : UTF-8 si possible, sinon Windows-1252 (exports bancaires plus anciens). */
function decoderOctets(octets) {
  let t;
  try { t = new TextDecoder("utf-8", { fatal: true }).decode(octets); }
  catch { t = new TextDecoder("windows-1252").decode(octets); }
  return t.replace(/^﻿/, "");
}
M.decoderOctets = decoderOctets;

function detecterSeparateur(texte) {
  const lignes = texte.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let meilleur = ";", score = -1;
  for (const sep of [";", ",", "\t", "|"]) {
    const n = lignes.map((l) => lireLigneCsv(l, sep).length);
    // Plus de colonnes = séparateur plus probable : un relevé LCL où chaque montant a une virgule décimale
    // se découpe aussi en 2 colonnes régulières sur « , », mais en 4 à 8 sur « ; ».
    const moyenne = n.reduce((t, x) => t + x, 0) / (n.length || 1);
    const s = n.filter((x) => x > 1).length * 10 - new Set(n).size + (moyenne >= 3 ? 5 : 0);
    if (s > score) { score = s; meilleur = sep; }
  }
  return meilleur;
}
function lireLigneCsv(ligne, sep) { return lireCsv(ligne, sep)[0] || []; }
/** CSV avec guillemets, retours à la ligne dans les champs, séparateur au choix. */
function lireCsv(texte, sep) {
  sep = sep || detecterSeparateur(texte);
  const lignes = []; let ligne = [], champ = "", guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"') { if (texte[i + 1] === '"') { champ += '"'; i++; } else guillemets = false; }
      else champ += c;
    } else if (c === '"' && champ === "") guillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ); champ = "";
      if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne);
  return lignes;
}
M.lireCsv = lireCsv;

/* ---------------------------------------------------------------- Commerçant lisible */
const PREFIXES = /^(cb|carte|paiement par carte|prlv sepa|prlv|prelevement|vir inst|vir sepa|vir|virement|virement de|uep|ppg|sumup|sq|zettle|izettle|paypal|sp|pos)\s+/;
function commercant(libelle) {
  let s = decoderHtml(libelle).replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?\s*$/, "");  // date de la carte en fin de libellé
  s = s.replace(/^Virement de\s*:\s*/i, "").replace(/^(CB|PRLV SEPA|PRLV|VIR INST|VIR SEPA|VIREMENT|VIR\.?PERMANENT|VIR)\s+/i, "")
    .replace(/^(UEP|PPG|SUMUP|SQ|ZETTLE)\s*\*\s*/i, "")
    .replace(/^To\s+/, "").replace(/^Paiement envoyé par\s+(M|MME|MLLE)?\.?\s*/i, "").replace(/^Virement de\s*:\s*/i, "")
    .replace(/\s*\*\s*/g, " ").replace(/\s+\d{3,}\S*$/, "").replace(/\s{2,}/g, " ").trim();
  if (!s) s = decoderHtml(libelle).trim();
  // Majuscules partout (libellés LCL) : on passe en casse de titre, plus lisible.
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|[\s'’.-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  return s;
}
M.commercant = commercant;

/* ---------------------------------------------------------------- Profils d'import */
// Un profil reconnaît un fichier (lignes = tableaux de cellules) et le transforme en opérations normalisées :
// { compte, date, dateValeur, montant (centimes), libelle, type, cle } + soldes relevés { compte, date, montant }.
const PROFILS = {};
M.PROFILS = PROFILS;

PROFILS.lcl = {
  id: "lcl", banque: "lcl", nom: "LCL (CSV de l'espace client)",
  reconnaitre(lignes) {
    if (lignes.length < 2) return 0;
    const ok = lignes.filter((l) => /^\d{2}\/\d{2}\/\d{4}$/.test((l[0] || "").trim()) && centimes(l[1]) != null).length;
    const soldes = lignes.filter((l) => l.length <= 5 && /^\d{4,5}\s?\w+$/.test((l[3] || "").trim())).length;
    return ok / lignes.length > 0.9 ? (soldes ? 1 : 0.7) : 0;
  },
  lire(lignes, options = {}) {
    const compte = options.compte || "lcl-courant";
    const operations = [], soldes = [], avertissements = [];
    let ouverture = null, cloture = null, numero = null;
    for (const l of lignes) {
      const date = dateIso(l[0]), montant = centimes(l[1]);
      if (!date || montant == null) continue;
      if (l.length <= 5 && /^\d{4,5}\s?\w+$/.test((l[3] || "").trim())) {  // ligne de solde : date;solde;;numéro de compte
        numero = l[3].trim();
        if (!ouverture) ouverture = { date, montant }; else cloture = { date, montant };
        continue;
      }
      const type = (l[2] || "").trim();
      const libelle = ((l[4] || "").trim() || (l[5] || "").trim() || type || "Opération").replace(/\s{2,}/g, " ");
      // Carte : la date d'achat est dans le libellé (« CB FRESH 31/12/25 » ou « RETRAIT DU 16/03 »).
      let dateAchat = null;
      const m = libelle.match(/(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\s*$/);
      if (m) {
        let annee = m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : date.slice(0, 4);
        if (!m[3] && Number(m[2]) > Number(date.slice(5, 7))) annee = String(Number(annee) - 1);
        const d = `${annee}-${m[2]}-${m[1]}`;
        if (!isNaN(Date.parse(d)) && M.ecartJours(d, date) <= 40) dateAchat = d;
      }
      operations.push({ compte, date: dateAchat || date, dateValeur: date, montant, libelle, type,
        cle: [compte, date, montant, normaliser(libelle)].join("|") });
    }
    if (cloture) soldes.push({ compte, date: cloture.date, montant: cloture.montant });
    let controle = null;
    if (ouverture && cloture) {
      const calcule = ouverture.montant + operations.reduce((t, o) => t + o.montant, 0);
      controle = { ok: calcule === cloture.montant, ecart: cloture.montant - calcule, ouverture, cloture };
      if (!controle.ok) avertissements.push("Le relevé ne tombe pas juste : il manque peut-être des lignes.");
    }
    return { operations, soldes, controle, numero, avertissements, ignorees: {} };
  },
};

const ALIAS_REVOLUT = {
  type: ["type"], produit: ["produit", "product"], debut: ["date de debut", "started date"], fin: ["date de fin", "completed date"],
  description: ["description"], montant: ["montant", "amount"], frais: ["frais", "fee"], devise: ["devise", "currency"],
  etat: ["etat", "state"], solde: ["solde", "balance"],
};
function colonnes(entete, alias) {
  const n = entete.map(normaliser), r = {};
  for (const [cle, noms] of Object.entries(alias)) r[cle] = n.findIndex((x) => noms.includes(x));
  return r;
}
const PRODUITS_REVOLUT = {
  "valeur actuelle": "revolut-courant", current: "revolut-courant", courant: "revolut-courant",
  depot: "revolut-epargne", savings: "revolut-epargne", deposit: "revolut-epargne", epargne: "revolut-epargne",
};
const TERMINE = ["termine", "completed"];

PROFILS.revolut = {
  id: "revolut", banque: "revolut", nom: "Revolut (relevé CSV)",
  reconnaitre(lignes) {
    if (!lignes.length) return 0;
    const c = colonnes(lignes[0], ALIAS_REVOLUT);
    return c.debut > -1 && c.description > -1 && c.montant > -1 && c.etat > -1 ? 1 : 0;
  },
  lire(lignes) {
    const c = colonnes(lignes[0], ALIAS_REVOLUT);
    const operations = [], ignorees = {}, avertissements = [], derniers = {};
    lignes.slice(1).forEach((l, rang) => {
      const etat = normaliser(l[c.etat]);
      if (!TERMINE.includes(etat)) { ignorees[l[c.etat] || "?"] = (ignorees[l[c.etat] || "?"] || 0) + 1; return; }
      const produit = normaliser(l[c.produit] ?? "valeur actuelle");
      const compte = PRODUITS_REVOLUT[produit];
      if (!compte) { avertissements.push(`Produit Revolut inconnu : « ${l[c.produit]} » (ligne ignorée).`); return; }
      if (c.devise > -1 && l[c.devise] && l[c.devise].toUpperCase() !== "EUR") {
        avertissements.push(`Opération en ${l[c.devise]} ignorée : seuls les comptes en euros sont suivis.`); return;
      }
      const debut = (l[c.debut] || "").trim(), fin = (l[c.fin] || "").trim() || debut;
      const montant = centimes(l[c.montant]) - (c.frais > -1 ? centimes(l[c.frais]) || 0 : 0);
      const libelle = decoderHtml(l[c.description]).trim() || l[c.type];
      const op = { compte, date: dateIso(debut), dateValeur: dateIso(fin), heure: debut.slice(11, 19), montant, libelle,
        type: (l[c.type] || "").trim(), cle: [compte, debut, montant, normaliser(libelle)].join("|") };
      if (!op.date) return;
      operations.push(op);
      const solde = c.solde > -1 ? centimes(l[c.solde]) : null;
      // Le dernier solde connu est celui de l'opération terminée le plus tard (à égalité : la dernière du fichier).
      if (solde != null && (!derniers[compte] || fin >= derniers[compte].fin)) derniers[compte] = { fin, montant: solde, rang };
    });
    const soldes = Object.entries(derniers).map(([compte, d]) => ({ compte, date: dateIso(d.fin), montant: d.montant }));
    return { operations, soldes, controle: null, avertissements, ignorees };
  },
};

/** Profil défini par Louis pour un fichier inconnu : colonnes choisies à la main, gardé dans la configuration. */
M.profilLibre = (p) => ({
  id: p.id, banque: p.banque, nom: p.nom, libre: true,
  reconnaitre(lignes) {
    if (!lignes.length || !p.signature) return 0;
    return normaliser(lignes[0].join("|")) === p.signature ? 1 : 0;
  },
  lire(lignes) {
    const operations = [], avertissements = [];
    lignes.slice(p.entete ? 1 : 0).forEach((l) => {
      const date = dateIso(l[p.colDate]);
      let montant = p.colMontant > -1 ? centimes(l[p.colMontant]) : null;
      if (montant == null && p.colDebit > -1) {
        const d = centimes(l[p.colDebit]), cr = centimes(l[p.colCredit]);
        montant = (cr || 0) - Math.abs(d || 0);
        if (d == null && cr == null) montant = null;
      }
      const libelle = String(l[p.colLibelle] ?? "").trim();
      if (!date || montant == null) return;
      operations.push({ compte: p.compte, date, dateValeur: date, montant, libelle, type: "",
        cle: [p.compte, date, montant, normaliser(libelle)].join("|") });
    });
    return { operations, soldes: [], controle: null, avertissements, ignorees: {} };
  },
});

/** Trouve le profil d'un fichier. Renvoie { profil, lignes } ou { profil: null, lignes } si inconnu. */
M.reconnaitre = function (lignes, profilsLibres = []) {
  const candidats = [...Object.values(PROFILS), ...profilsLibres.map(M.profilLibre)];
  let meilleur = null, score = 0;
  for (const p of candidats) { const s = p.reconnaitre(lignes); if (s > score) { score = s; meilleur = p; } }
  return { profil: score >= 0.7 ? meilleur : null, score };
};

/** Lit un fichier déjà découpé en lignes. Résultat prêt à être proposé à Louis avant enregistrement. */
M.lireReleve = function (lignes, { profilsLibres = [], nomFichier = "" } = {}) {
  const { profil } = M.reconnaitre(lignes, profilsLibres);
  if (!profil) return { reconnu: false, lignes };
  const r = profil.lire(lignes);
  for (const o of r.operations) o.commercant = commercant(o.libelle);
  const dates = r.operations.map((o) => o.dateValeur).sort();
  return { reconnu: true, profil: profil.id, banque: profil.banque, nomProfil: profil.nom, nomFichier,
    periode: dates.length ? { du: dates[0], au: dates.at(-1) } : null, ...r };
};

/* ---------------------------------------------------------------- Catégories par défaut */
// Identifiants stables : un renommage ne touche jamais les opérations. Types : depense, revenu, interne.
const G = (id, nom, type, couleur, categories) => ({ id, nom, type, couleur, categories });
const ARBRE = [
  G("logement", "Logement et charges", "depense", "#7cc8ff", ["Loyer", "Électricité", "Gaz", "Eau", "Assurance habitation", "Internet fixe", "Charges diverses", "Équipement du logement"]),
  G("alimentation", "Alimentation", "depense", "#4ff0a6", ["Courses alimentaires", "Boulangerie", "Restaurants", "Fast-food", "Livraison de repas", "Cafés et boissons", "Snacks"]),
  G("transport", "Transport et mobilité", "depense", "#ffb547", ["Carburant", "Transports en commun", "Train", "Avion", "Taxi / VTC", "Stationnement", "Péages", "Entretien du véhicule", "Assurance automobile", "Autres frais de mobilité"]),
  G("abonnements", "Abonnements et services numériques", "depense", "#b48cff", ["Téléphone", "Streaming vidéo", "Streaming musical", "Intelligence artificielle", "Logiciels", "Cloud et stockage", "Jeux et services numériques", "Autres abonnements"]),
  G("shopping", "Shopping et achats personnels", "depense", "#ff8fd1", ["Vêtements", "Chaussures", "Accessoires", "Électronique", "Informatique", "Produits de beauté", "Hygiène", "Achats divers"]),
  G("loisirs", "Loisirs et vie sociale", "depense", "#4fdcff", ["Sorties", "Bars", "Cinéma", "Concerts", "Événements", "Activités sportives", "Jeux vidéo", "Voyages et vacances", "Cadeaux"]),
  G("sante", "Santé et bien-être", "depense", "#8ef0e0", ["Pharmacie", "Consultations médicales", "Mutuelle", "Soins", "Sport et fitness", "Coiffeur", "Bien-être"]),
  G("etudes", "Études et vie professionnelle", "depense", "#ffd36e", ["Fournitures", "Livres", "Matériel informatique", "Formations", "Certifications", "Frais professionnels"]),
  G("finances", "Finances et frais bancaires", "depense", "#ff7a6b", ["Frais bancaires", "Commissions", "Intérêts débiteurs", "Assurances financières", "Impôts et taxes", "Paiements en plusieurs fois", "Autres frais financiers"]),
  G("divers", "Divers", "depense", "#9fb3c4", ["Dépenses exceptionnelles", "Dons", "Remboursements effectués", "Retrait d'espèces", "Paiements entre amis", "Dépenses non classées"]),
  G("revenus", "Revenus", "revenu", "#4ff0a6", ["Salaire", "Primes", "Remboursements reçus", "Aide familiale", "Intérêts d'épargne", "Autres revenus"]),
  G("interne", "Mouvements internes", "interne", "#7f98ab", ["Virement entre mes comptes", "Versement vers l'épargne", "Retrait de l'épargne", "Compte non suivi"]),
];
const slug = (s) => normaliser(s).replace(/ /g, "-").slice(0, 32);
const ID_CATEGORIE = {  // raccourcis lisibles pour les règles de base et les virements internes
  amis: "divers-paiements-entre-amis", especes: "divers-retrait-d-especes", nonclasse: "divers-depenses-non-classees",
  virement: "interne-virement-entre-mes-comptes", versement: "interne-versement-vers-l-epargne", retrait: "interne-retrait-de-l-epargne",
  interets: "revenus-interets-d-epargne", salaire: "revenus-salaire", remboursement: "revenus-remboursements-recus",
  nonSuivi: "interne-compte-non-suivi", aide: "revenus-aide-familiale",
};
M.ID_CATEGORIE = ID_CATEGORIE;

/** Conventions de calcul réglables (décisions D1 à D3 du contrat, valeurs recommandées par défaut). */
M.reglagesParDefaut = () => ({ seuilSalaire: 25 });

M.configParDefaut = function () {
  const groupes = [], categories = [];
  ARBRE.forEach((g, i) => {
    groupes.push({ id: g.id, nom: g.nom, type: g.type, couleur: g.couleur, ordre: i, masque: false, archive: false });
    g.categories.forEach((nom, j) => categories.push({
      id: g.id + "-" + slug(nom), groupe: g.id, nom, ordre: j, archivee: false,
      masquee: nom === "Autres revenus",  // Louis n'a qu'un salaire : catégorie masquée tant qu'elle ne sert pas
    }));
  });
  return {
    version: VERSION,
    banques: [{ id: "lcl", nom: "LCL", profils: ["lcl"] }, { id: "revolut", nom: "Revolut", profils: ["revolut"] }],
    comptes: [
      { id: "lcl-courant", banque: "lcl", nom: "LCL compte courant", type: "courant" },
      { id: "revolut-courant", banque: "revolut", nom: "Revolut compte courant", type: "courant" },
      { id: "revolut-epargne", banque: "revolut", nom: "Revolut épargne", type: "epargne" },
    ],
    groupes, categories, regles: [], basesInactives: [], soldes: [], budgets: [], objectifs: [], profilsLibres: [],
    reglages: M.reglagesParDefaut(),
  };
};

/* ---------------------------------------------------------------- Règles de base (enseignes nationales) */
// [motif (début de mot, sans accents), catégorie, sens facultatif "debit" | "credit", champ facultatif "type"].
// Les motifs les plus longs passent en premier : « uber eats » avant « uber », « boulangerie » avant « boulanger ».
const C = (g, nom) => g + "-" + slug(nom);
const BASE = [
  // Alimentation
  ...["carrefour", "leclerc", "lidl", "aldi", "auchan", "intermarche", "super u", "hyper u", "u express", "monoprix", "franprix",
    "casino", "picard", "netto", "grand frais", "biocoop", "costco", "cora", "match", "spar", "leader price", "naturalia", "g20"]
    .map((m) => [m, C("alimentation", "Courses alimentaires")]),
  ...["boulangerie", "boulang", "marie blachere", "patisserie"].map((m) => [m, C("alimentation", "Boulangerie")]),
  ...["mcdonald", "mc donald", "burger king", "bk ", "kfc", "quick", "subway", "five guys", "o tacos", "tasty crousty", "pizza hut", "dominos", "domino s", "popeyes"]
    .map((m) => [m, C("alimentation", "Fast-food")]),
  ...["uber eats", "deliveroo", "just eat"].map((m) => [m, C("alimentation", "Livraison de repas")]),
  ...["starbucks", "columbus cafe", "cafe", "coffee"].map((m) => [m, C("alimentation", "Cafés et boissons")]),
  ...["restaurant", "brasserie", "bistrot", "pizzeria", "creperie", "sushi", "la table"].map((m) => [m, C("alimentation", "Restaurants")]),
  ...["laduree", "relay", "selecta"].map((m) => [m, C("alimentation", "Snacks")]),
  // Transport
  ...["costco gas", "totalenergies", "esso", "shell", "avia", "station u", "carrefour station"].map((m) => [m, C("transport", "Carburant")]),
  ...["ratp", "cts", "tcl", "tisseo", "solea", "ile de france mobilites", "navigo", "rtm", "tan ", "star "].map((m) => [m, C("transport", "Transports en commun")]),
  ...["sncf", "ouigo", "trainline", "sbb", "db bahn", "tgv", "ter ", "flixbus", "blablacar"].map((m) => [m, C("transport", "Train")]),
  ...["easyjet", "ryanair", "air france", "transavia", "volotea", "vueling", "lufthansa", "wizz"].map((m) => [m, C("transport", "Avion")]),
  ...["uber", "bolt", "heetch", "g7", "taxi"].map((m) => [m, C("transport", "Taxi / VTC")]),
  ...["indigo", "parking", "parcus", "effia", "saemes", "q park", "onepark", "zenpark"].map((m) => [m, C("transport", "Stationnement")]),
  ...["autorout", "sanef", "aprr", "vinci autoroutes", "peage", "ulys", "bip go"].map((m) => [m, C("transport", "Péages")]),
  ...["garage", "norauto", "feu vert", "midas", "speedy", "point s", "controle technique"].map((m) => [m, C("transport", "Entretien du véhicule")]),
  // Abonnements
  ...["free mobile", "sfr", "bouygues telecom", "sosh", "red by sfr", "orange"].map((m) => [m, C("abonnements", "Téléphone")]),
  ...["free telecom", "freebox", "livebox"].map((m) => [m, C("logement", "Internet fixe")]),
  ...["netflix", "disney", "amazon prime", "prime video", "canal", "crunchyroll", "paramount", "apple tv", "molotov"].map((m) => [m, C("abonnements", "Streaming vidéo")]),
  ...["spotify", "deezer", "apple music", "youtube music", "tidal"].map((m) => [m, C("abonnements", "Streaming musical")]),
  ...["openai", "chatgpt", "anthropic", "claude ai", "midjourney", "mistral ai", "perplexity"].map((m) => [m, C("abonnements", "Intelligence artificielle")]),
  ...["microsoft", "adobe", "notion", "canva", "1password", "nordvpn", "github"].map((m) => [m, C("abonnements", "Logiciels")]),
  ...["icloud", "google one", "dropbox", "google storage"].map((m) => [m, C("abonnements", "Cloud et stockage")]),
  ...["nitroserv", "bisecthosting", "discord", "twitch"].map((m) => [m, C("abonnements", "Jeux et services numériques")]),
  ...["apple com bill", "apple", "myheritage", "uber one", "google play"].map((m) => [m, C("abonnements", "Autres abonnements")]),
  // Shopping
  ...["fnac", "darty", "boulanger", "rhinoshield", "apple store", "cdiscount"].map((m) => [m, C("shopping", "Électronique")]),
  ...["ldlc", "materiel net", "topachat", "grosbill"].map((m) => [m, C("shopping", "Informatique")]),
  ...["zara", "h m", "uniqlo", "kiabi", "jules", "celio", "primark", "zalando", "vinted", "shein", "bershka", "pull bear", "lacoste", "nike", "adidas"]
    .map((m) => [m, C("shopping", "Vêtements")]),
  ...["jd sports", "jd ", "courir", "snipes", "foot locker", "sizeer"].map((m) => [m, C("shopping", "Chaussures")]),
  ...["sephora", "nocibe", "yves rocher", "marionnaud", "kiko"].map((m) => [m, C("shopping", "Produits de beauté")]),
  ...["normal"].map((m) => [m, C("shopping", "Hygiène")]),
  ...["amazon", "action", "gifi", "hema", "la foir fouille", "aliexpress", "temu", "ebay", "cultura", "la poste", "deutsche post"].map((m) => [m, C("shopping", "Achats divers")]),
  ...["ikea", "leroy merlin", "castorama", "conforama", "maisons du monde", "but "].map((m) => [m, C("logement", "Équipement du logement")]),
  // Logement
  ...["loyer", "quittance"].map((m) => [m, C("logement", "Loyer"), "debit"]),
  ...["edf", "totalenergies electricite", "ekwateur", "engie"].map((m) => [m, C("logement", "Électricité")]),
  ...["veolia", "suez", "eau de"].map((m) => [m, C("logement", "Eau")]),
  // Loisirs
  ...["kinepolis", "ugc", "pathe", "gaumont", "cinema", "mk2", "cgr"].map((m) => [m, C("loisirs", "Cinéma")]),
  ...["au bureau", "pub ", "bar "].map((m) => [m, C("loisirs", "Bars")]),
  ...["weezevent", "ticketmaster", "see tickets", "shotgun", "dice "].map((m) => [m, C("loisirs", "Événements")]),
  ...["decathlon", "padel", "urban soccer", "climbing", "escalade", "bowling"].map((m) => [m, C("loisirs", "Activités sportives")]),
  ...["steam", "instant gaming", "electronic a", "ea electronic", "playstation", "nintendo", "xbox", "supercell", "rockstar", "epic games", "riot", "blizzard", "g2a", "eneba", "hellcase", "micromania"]
    .map((m) => [m, C("loisirs", "Jeux vidéo")]),
  ...["booking", "airbnb", "hotel", "expedia", "parc asterix", "disneyland", "europa park"].map((m) => [m, C("loisirs", "Voyages et vacances")]),
  // Santé
  ...["pharma", "pharmacie"].map((m) => [m, C("sante", "Pharmacie")]),
  ...["dr ", "docteur", "medecin", "doctolib", "selarl", "dentiste", "kine"].map((m) => [m, C("sante", "Consultations médicales")]),
  ["mutuelle", C("sante", "Mutuelle"), "debit"],
  // Remboursement de soins : déduit des dépenses de santé (contrat, nature « remboursement »), jamais un revenu.
  ["mutuelle", C("sante", "Consultations médicales"), "credit"],
  ["cpam", C("sante", "Consultations médicales"), "credit"],
  ["ameli", C("sante", "Consultations médicales"), "credit"],
  ...["basic fit", "fitness park", "keepcool", "neoness", "on air", "myprotein"].map((m) => [m, C("sante", "Sport et fitness")]),
  ...["coiffure", "coiffeur", "barber", "hair"].map((m) => [m, C("sante", "Coiffeur")]),
  // Études
  ...["barnes noble", "gibert", "decitre", "librairie", "kindle"].map((m) => [m, C("etudes", "Livres")]),
  ...["bureau vallee", "papeterie"].map((m) => [m, C("etudes", "Fournitures")]),
  ...["udemy", "coursera", "openclassrooms"].map((m) => [m, C("etudes", "Formations")]),
  // Finances
  ...["forfait lcl", "cotisation", "frais d abonnement", "frais de tenue"].map((m) => [m, C("finances", "Frais bancaires")]),
  ...["commission", "frais"].map((m) => [m, C("finances", "Commissions")]),
  ["agios", C("finances", "Intérêts débiteurs")],
  ...["predica", "prevoyance"].map((m) => [m, C("finances", "Assurances financières")]),
  ...["dgfip", "impot", "tresor public", "amende", "antai"].map((m) => [m, C("finances", "Impôts et taxes")]),
  ...["sofinco", "cofidis", "oney", "alma", "klarna", "floa", "younited", "scalapay"].map((m) => [m, C("finances", "Paiements en plusieurs fois")]),
  // Divers et revenus
  ...["lydia", "wero", "paylib", "sumeria"].map((m) => [m, ID_CATEGORIE.amis]),
  ...["restos du coeur", "croix rouge", "unicef", "secours populaire", "don "].map((m) => [m, C("divers", "Dons")]),
  ...["retrait", "dab "].map((m) => [m, ID_CATEGORIE.especes, "debit"]),
  ...["salaire", "paie "].map((m) => [m, ID_CATEGORIE.salaire, "credit"]),
  // Selon le type d'opération indiqué par la banque
  ["interets", ID_CATEGORIE.interets, null, "type"],
  ["remboursement des frais", C("finances", "Frais bancaires"), null, "type"],
  ["retrait dab", ID_CATEGORIE.especes, null, "type"],
  ["dab", ID_CATEGORIE.especes, null, "type"],
];
// Revolut : « To Prénom N » (débit) et « Virement de : … » (crédit) sont des virements à des personnes.
const BASE_SPECIALES = [
  { id: "base-revolut-to", conditions: [{ champ: "libelle", op: "regex", valeur: "^to [a-z]" }, { champ: "type", op: "contient", valeur: "virement" }], action: { categorie: ID_CATEGORIE.amis } },
  { id: "base-revolut-de", conditions: [{ champ: "libelle", op: "regex", valeur: "^virement de " }], action: { categorie: ID_CATEGORIE.amis } },
];
M.reglesDeBase = function () {
  const regles = BASE.map(([motif, categorie, sens, champ]) => {
    const conditions = [{ champ: champ || "libelle", op: "mot", valeur: motif }];
    if (sens) conditions.push({ champ: "sens", op: "egal", valeur: sens });
    return { id: "base-" + slug(motif) + (sens ? "-" + sens : "") + (champ ? "-" + champ : ""), origine: "base", conditions, action: { categorie } };
  });
  for (const r of BASE_SPECIALES) regles.push({ ...r, origine: "base" });
  // Les motifs sur le type d'opération d'abord, puis les plus longs : du plus précis au plus général.
  const poids = (r) => (r.conditions[0].champ === "type" ? 1000 : 0) + (r.conditions[0].op === "regex" ? 500 : 0) + String(r.conditions[0].valeur).length + (r.conditions.length > 1 ? 0.5 : 0);
  return regles.sort((a, b) => poids(b) - poids(a));
};

/* ---------------------------------------------------------------- Moteur de règles */
function valeurChamp(op, champ) {
  switch (champ) {
    case "libelle": return normaliser(op.libelle);
    case "commercant": return normaliser(op.commercant);
    case "type": return normaliser(op.type);
    case "compte": return op.compte;
    case "montant": return Math.abs(op.montant);
    case "sens": return op.montant < 0 ? "debit" : "credit";
    default: return "";
  }
}
const cacheRegex = new Map();
function regex(source) {
  if (!cacheRegex.has(source)) { try { cacheRegex.set(source, new RegExp(source, "i")); } catch { cacheRegex.set(source, /$^/); } }
  return cacheRegex.get(source);
}
function condition(op, c) {
  const v = valeurChamp(op, c.champ);
  switch (c.op) {
    case "contient": return String(v).includes(normaliser(c.valeur));
    case "commence": return String(v).startsWith(normaliser(c.valeur));
    case "egal": return c.champ === "compte" || c.champ === "sens" ? v === c.valeur : String(v) === normaliser(c.valeur);
    case "mot": return (" " + v + " ").includes(" " + normaliser(c.valeur) + (String(c.valeur).endsWith(" ") ? " " : ""));
    case "regex": return regex(c.valeur).test(String(v));
    case "entre": return v >= Math.round(Number(c.valeur) * 100) && v <= Math.round(Number(c.valeur2) * 100);
    default: return false;
  }
}
M.regleCorrespond = (op, r) => r.conditions.length > 0 && r.conditions.every((c) => condition(op, c));

/** Règles dans l'ordre d'application : celles de Louis (par priorité), puis les règles de base actives. */
M.reglesActives = function (config) {
  const inactives = new Set(config.basesInactives || []);
  const perso = (config.regles || []).filter((r) => r.active !== false).sort((a, b) => (a.priorite ?? 100) - (b.priorite ?? 100));
  return [...perso, ...BASES.filter((r) => !inactives.has(r.id))];
};
const BASES = M.reglesDeBase();
M.BASES = BASES;

/* ---------------------------------------------------------------- État et classement */
M.etatVide = () => ({ config: M.configParDefaut(), operations: {}, imports: [], journal: [] });

const index = (etat) => {
  if (!etat._index || etat._index.v !== etat._v) {
    etat._index = { v: etat._v, categories: new Map(etat.config.categories.map((c) => [c.id, c])), groupes: new Map(etat.config.groupes.map((g) => [g.id, g])), comptes: new Map(etat.config.comptes.map((c) => [c.id, c])) };
  }
  return etat._index;
};
const toucher = (etat) => { etat._v = (etat._v || 0) + 1; };
M.categorie = (etat, id) => index(etat).categories.get(id) || null;
M.groupe = (etat, id) => index(etat).groupes.get(id) || null;
M.compte = (etat, id) => index(etat).comptes.get(id) || null;
M.natureDe = function (etat, idCategorie) {
  const c = M.categorie(etat, idCategorie);
  const g = c && M.groupe(etat, c.groupe);
  return g ? g.type : null;
};

/** Classe une opération (sauf correction manuelle ou virement interne lié). Renvoie true si elle a changé. */
function classer(etat, op, regles) {
  if (op.source === "manuel" || op.lien) return false;
  const avant = op.categorie + "|" + op.source;
  const r = regles.find((x) => M.regleCorrespond(op, x));
  if (r) {
    op.categorie = r.action.categorie;
    op.source = "regle:" + r.id;
    if (r.action.commercant) op.commercant = r.action.commercant;
    op.aValider = !!op.doublonPossible;
  } else if (!op.source || op.source.startsWith("regle:") || op.source === "aucune") {
    op.categorie = null; op.source = "aucune"; op.aValider = true;
  }
  op.nature = op.categorie ? M.natureDe(etat, op.categorie) : (op.montant < 0 ? "depense" : "revenu");
  if (r && r.action.nature) op.nature = r.action.nature;
  return avant !== op.categorie + "|" + op.source;
}
M.classer = classer;

/* ---------------------------------------------------------------- Virements entre mes comptes */
const TYPES_VIREMENT = /virement|ajout de fonds|transfer|topup|top up|recharge/;
const INDICES_VIREMENT = /revolut|revolk|lcl|bourso|compte d epargne|savings|epargne|recharge sur apple pay|recharge|top up/;
/** Indice dans le libellé seul (pas le type) : sert à repérer un virement interne dont la contrepartie manque. */
const indiceInterne = (op) => INDICES_VIREMENT.test(normaliser(op.libelle));
function ressembleVirement(op) {
  if (/^(dab|retrait dab|atm)$/.test(normaliser(op.type))) return false;
  return TYPES_VIREMENT.test(normaliser(op.type)) || INDICES_VIREMENT.test(normaliser(op.libelle));
}
function categorieInterne(etat, a, b) {
  const ta = M.compte(etat, a.compte)?.type, tb = M.compte(etat, b.compte)?.type;
  if (ta === tb) return ID_CATEGORIE.virement;
  const versEpargne = (ta === "epargne" && a.montant > 0) || (tb === "epargne" && b.montant > 0);
  return versEpargne ? ID_CATEGORIE.versement : ID_CATEGORIE.retrait;
}
/** Lie les paires sortie / entrée de même montant entre deux comptes de Louis, à 4 jours d'écart au plus. */
M.detecterVirements = function (etat, ids) {
  const ops = Object.values(etat.operations);
  const candidates = (ids ? ids.map((id) => etat.operations[id]).filter(Boolean) : ops).filter((o) => !o.lien && o.source !== "manuel");
  const libres = ops.filter((o) => !o.lien && o.source !== "manuel");
  const parMontant = new Map();
  for (const o of libres) { const k = Math.abs(o.montant); if (!parMontant.has(k)) parMontant.set(k, []); parMontant.get(k).push(o); }
  let liees = 0;
  for (const a of candidates.sort((x, y) => x.date.localeCompare(y.date))) {
    if (a.lien || a.montant === 0) continue;
    const b = (parMontant.get(Math.abs(a.montant)) || [])
      .filter((o) => o !== a && !o.lien && o.compte !== a.compte && o.montant === -a.montant && M.ecartJours(o.date, a.date) <= 4
        && ressembleVirement(a) && ressembleVirement(o))
      .sort((x, y) => M.ecartJours(x.date, a.date) - M.ecartJours(y.date, a.date))[0];
    if (!b) continue;
    const cat = categorieInterne(etat, a, b);
    for (const [x, y] of [[a, b], [b, a]]) {
      x.lien = y.id; x.categorie = cat; x.nature = "interne"; x.source = "virement"; x.aValider = false; x.contrepartieAttendue = false;
    }
    liees++;
  }
  return liees;
};

/** Reprise (contrat C15) : une opération non classée qui annule une opération classée du même tiers (même compte,
 *  montant opposé, 10 jours au plus) prend sa catégorie et reste « à vérifier ». Le couple est noté des deux côtés. */
M.detecterReprises = function (etat, ids) {
  const ops = Object.values(etat.operations);
  const cibles = (ids ? ids.map((id) => etat.operations[id]).filter(Boolean) : ops).filter((o) => !o.categorie && !o.lien && o.source !== "manuel");
  let n = 0;
  for (const x of cibles) {
    const tiers = normaliser(x.commercant || x.libelle);
    const y = ops.filter((o) => o !== x && o.compte === x.compte && o.montant === -x.montant && o.categorie && !o.lien && !o.reprise
      && normaliser(o.commercant || o.libelle) === tiers && M.ecartJours(o.dateValeur, x.dateValeur) <= 10)
      .sort((a, b) => M.ecartJours(a.dateValeur, x.dateValeur) - M.ecartJours(b.dateValeur, x.dateValeur))[0];
    if (!y) continue;
    Object.assign(x, { categorie: y.categorie, source: "reprise", reprise: y.id, aValider: true, nature: M.natureDe(etat, y.categorie) });
    y.reprise = x.id; n++;
  }
  return n;
};

M.delier = function (etat, id) {
  const a = etat.operations[id];
  if (!a || !a.lien) return [];
  const b = etat.operations[a.lien], touches = [a];
  if (b) touches.push(b);
  const regles = M.reglesActives(etat.config);
  for (const o of touches) { o.lien = null; o.source = o.source === "manuel" ? "manuel" : null; o.categorie = o.source === "manuel" ? o.categorie : null; classer(etat, o, regles); }
  return touches.map((o) => o.id);
};

/* ---------------------------------------------------------------- Import : doublons et ajout */
/** Prépare les opérations d'un relevé : identifiants stables et repérage des doublons contre le coffre. */
M.preparerImport = function (etat, releve) {
  const existantes = new Map();  // clé → nombre d'occurrences déjà dans le coffre
  for (const o of Object.values(etat.operations)) existantes.set(o.cle, (existantes.get(o.cle) || 0) + 1);
  const vues = new Map(), nouvelles = [], doublons = [];
  for (const o of releve.operations) {
    const n = (vues.get(o.cle) || 0) + 1;
    vues.set(o.cle, n);
    const op = { ...o, id: "op_" + empreinte(o.cle + "#" + n), occurrence: n };
    if (n <= (existantes.get(o.cle) || 0) || etat.operations[op.id]) doublons.push(op); else nouvelles.push(op);
  }
  // Presque-doublon : même compte, même jour, même montant, libellé différent, déjà présent d'un autre import.
  const parJour = new Map();
  for (const o of Object.values(etat.operations)) { const k = o.compte + "|" + o.dateValeur + "|" + o.montant; if (!parJour.has(k)) parJour.set(k, []); parJour.get(k).push(o); }
  for (const op of nouvelles) {
    const proches = (parJour.get(op.compte + "|" + op.dateValeur + "|" + op.montant) || []).filter((x) => x.cle !== op.cle);
    if (proches.length) op.doublonPossible = proches[0].id;
  }
  return { nouvelles, doublons };
};

/** Simulation d'un import pour l'aperçu (n'altère pas l'état). */
M.apercuImport = function (etat, releve) {
  const copie = M.cloner(etat);
  const action = M.actionImport(releve, "apercu");
  const r = M.appliquer(copie, action);
  const ajoutees = (r.ids || []).map((id) => copie.operations[id]);
  return {
    lues: releve.operations.length, nouvelles: ajoutees.length, doublons: r.doublons || 0,
    classees: ajoutees.filter((o) => o.categorie && !o.aValider).length,
    aValider: ajoutees.filter((o) => o.aValider).length,
    internes: ajoutees.filter((o) => M.natureOp(copie, o) === "interne").length,
    aRapprocher: ajoutees.filter((o) => M.natureOp(copie, o) === "rapprocher").length,
    soldeIgnore: !!(releve.controle && releve.controle.ok === false),
    possibles: ajoutees.filter((o) => o.doublonPossible).length,
    comptes: [...new Set(releve.operations.map((o) => o.compte))],
    ecarts: r.ecarts || [], operations: ajoutees,
  };
};

M.actionImport = function (releve, idImport) {
  return {
    type: "import",
    import: { id: idImport, fichier: releve.nomFichier, banque: releve.banque, profil: releve.profil, periode: releve.periode,
      controle: releve.controle ? { ok: releve.controle.ok, ecart: releve.controle.ecart } : null, ignorees: releve.ignorees || {} },
    operations: releve.operations.map(({ compte, date, dateValeur, heure, montant, libelle, type, cle, commercant }) =>
      ({ compte, date, dateValeur, heure, montant, libelle, type, cle, commercant })),
    soldes: releve.soldes || [],
  };
};

/* ---------------------------------------------------------------- Soldes */
const provenances = (o) => (Array.isArray(o.imports) ? [...o.imports] : o.import ? [o.import] : []);
M.provenances = provenances;
const ordreRefs = (a, b) => a.date.localeCompare(b.date) || (a.t || "").localeCompare(b.t || "");
const RANG_STATUT = { atteste: 0, calcule: 1, ancien: 2, inconnu: 3 };

/** Opérations postérieures à une référence (C16). Relevé : fin de journée, sauf opérations du même jour arrivées
 *  par un import plus récent qui ne les contenait pas. Saisie : selon « inclut les opérations du jour ». */
function apresReference(ref, ops) {
  return ops.filter((o) => {
    if (o.dateValeur > ref.date) return true;
    if (o.dateValeur !== ref.date) return false;
    if (ref.source === "saisie") return ref.inclutJour === false;
    return !!ref.import && !provenances(o).includes(ref.import) && (o.importT || "") > (ref.t || "");
  });
}

/** Solde d'un compte (C17) : référence + opérations postérieures. Statut en toutes lettres :
 *  « atteste » (rien depuis la référence), « calcule » (référence + opérations), « ancien » (dernière info > 3 jours). */
M.solde = function (etat, compteId, aujourdhui) {
  const refs = etat.config.soldes.filter((s) => s.compte === compteId).sort(ordreRefs);
  const ref = refs.at(-1);
  const ops = Object.values(etat.operations).filter((o) => o.compte === compteId);
  if (!ref) {
    if (!ops.length) return null;
    return { montant: null, inconnu: true, date: null, statut: "inconnu", ids: ops.map((o) => o.id) };
  }
  const apres = apresReference(ref, ops).sort((a, b) => a.dateValeur.localeCompare(b.dateValeur));
  const montant = ref.montant + apres.reduce((t, o) => t + o.montant, 0);
  const derniere = [ref.date, ...apres.map((o) => o.dateValeur)].sort().at(-1);
  const age = aujourdhui ? Math.max(0, Math.round(jours(aujourdhui) - jours(derniere))) : 0;
  const statut = age > 3 ? "ancien" : apres.length ? "calcule" : "atteste";
  return { montant, statut, verifie: statut === "atteste", date: derniere, dateReference: ref.date, reference: ref, source: ref.source,
    age, ancien: statut === "ancien", mouvementsDepuis: apres.length, ids: apres.map((o) => o.id), ecart: ref.ecart || 0 };
};

/** Patrimoine (C19) : somme des soldes des comptes suivis ; son statut est le moins bon de ses composants. */
M.patrimoine = function (etat, aujourdhui) {
  const comptes = etat.config.comptes.filter((c) => !c.archive).map((c) => ({ compte: c, solde: M.solde(etat, c.id, aujourdhui) })).filter((x) => x.solde);
  const connus = comptes.filter((x) => x.solde.montant != null);
  const statut = comptes.reduce((pire, x) => (RANG_STATUT[x.solde.statut] > RANG_STATUT[pire] ? x.solde.statut : pire), "atteste");
  return { montant: connus.reduce((t, x) => t + x.solde.montant, 0), statut: comptes.length ? statut : "inconnu", comptes,
    complet: connus.length === comptes.length, date: connus.map((x) => x.solde.date).sort()[0] || null };
};

/** Contrôle de cohérence (C20) : entre deux références d'un compte, ancienne + opérations = nouvelle, au centime. */
M.controles = function (etat) {
  const res = [];
  for (const c of etat.config.comptes) {
    const refs = etat.config.soldes.filter((s) => s.compte === c.id).sort(ordreRefs);
    const ops = Object.values(etat.operations).filter((o) => o.compte === c.id);
    for (let i = 1; i < refs.length; i++) {
      const a = refs[i - 1], b = refs[i];
      const dans = ops.filter((o) => (a.inclutJour === false ? o.dateValeur >= a.date : o.dateValeur > a.date)
        && (b.inclutJour === false ? o.dateValeur < b.date : o.dateValeur <= b.date));
      const attendu = a.montant + dans.reduce((t, o) => t + o.montant, 0);
      res.push({ compte: c.id, du: a.date, au: b.date, depart: a.montant, mouvements: attendu - a.montant, attendu, reel: b.montant, ecart: b.montant - attendu, ids: dans.map((o) => o.id) });
    }
  }
  return res;
};

/** Solde jour par jour (pour les courbes), recalé sur chaque solde de référence. */
M.historiqueSolde = function (etat, compteId) {
  const refs = etat.config.soldes.filter((s) => s.compte === compteId).sort((a, b) => a.date.localeCompare(b.date));
  const ops = Object.values(etat.operations).filter((o) => o.compte === compteId).sort((a, b) => a.dateValeur.localeCompare(b.dateValeur));
  if (!refs.length) return [];
  const derniere = refs.at(-1);
  // On part de la dernière référence et on remonte le temps : solde(veille) = solde(jour) − mouvements(jour).
  const parJour = new Map();
  for (const o of ops) parJour.set(o.dateValeur, (parJour.get(o.dateValeur) || 0) + o.montant);
  const datesOps = [...parJour.keys()].sort();
  const points = [];
  let solde = derniere.montant;
  for (const o of ops) if (o.dateValeur > derniere.date) solde += o.montant;
  const fin = datesOps.length && datesOps.at(-1) > derniere.date ? datesOps.at(-1) : derniere.date;
  const debut = datesOps[0] || derniere.date;
  for (let t = jours(fin); t >= jours(debut); t--) {
    const d = new Date(t * 864e5).toISOString().slice(0, 10);
    const ref = refs.find((r) => r.date === d);
    if (ref && d !== fin) solde = ref.montant;  // recalage
    points.push({ date: d, montant: solde });
    solde -= parJour.get(d) || 0;
  }
  return points.reverse();
};

/* ---------------------------------------------------------------- Actions (toute modification passe par ici) */
// Une action est rejouable : la même action appliquée deux fois ne crée rien en double. C'est ce qui permet
// de fusionner proprement les modifications faites sur deux appareils.
M.cloner = (etat) => {
  const { _index, ...reste } = etat;
  return typeof structuredClone === "function" ? structuredClone(reste) : JSON.parse(JSON.stringify(reste));
};
const resumeCategorie = (etat, id) => { const c = M.categorie(etat, id); return c ? c.nom : "non classée"; };

M.appliquer = function (etat, action) {
  const ent = { id: action.id, t: action.t, appareil: action.appareil, type: action.type, resume: "", details: null };
  const regles = () => M.reglesActives(etat.config);
  const out = { ids: [], journal: ent };
  const ops = etat.operations, cfg = etat.config;
  switch (action.type) {
    case "import": {
      if (etat.imports.some((i) => i.id === action.import.id)) { ent.resume = "Import déjà présent"; break; }
      const t = action.t || new Date().toISOString();
      const { nouvelles, doublons } = M.preparerImport(etat, { operations: action.operations });
      const ecarts = [];
      for (const op of nouvelles) {
        Object.assign(op, { import: action.import.id, imports: [action.import.id], importT: t, categorie: null, source: null, nature: null, lien: null, aValider: true, note: "" });
        ops[op.id] = op;
      }
      // Provenance multiple (C10) : une opération déjà connue garde la trace de chaque import qui l'a relue.
      for (const d of doublons) {
        const o = ops[d.id];
        if (o) { o.imports = provenances(o); if (!o.imports.includes(action.import.id)) o.imports.push(action.import.id); }
      }
      const ids = nouvelles.map((o) => o.id);
      M.detecterVirements(etat, ids);
      const rs = regles();
      for (const id of ids) classer(etat, ops[id], rs);
      M.detecterReprises(etat, ids);
      // Import partiel (C12) : un relevé qui ne tombe pas juste n'apporte pas de solde de référence.
      const partiel = action.import.controle && action.import.controle.ok === false;
      for (const s of partiel ? [] : action.soldes || []) {
        const calcule = M.soldeAu(etat, s.compte, s.date, action.import.id);
        const ecart = calcule != null && calcule !== s.montant ? s.montant - calcule : 0;
        cfg.soldes = cfg.soldes.filter((x) => !(x.compte === s.compte && x.date === s.date && x.source === "releve"));
        cfg.soldes.push({ id: "solde_" + empreinte(action.import.id + s.compte), compte: s.compte, date: s.date, montant: s.montant, source: "releve", import: action.import.id, t, inclutJour: true, ecart });
        if (ecart) ecarts.push({ compte: s.compte, date: s.date, ecart });
      }
      etat.imports.push({ ...action.import, t, ajoutees: ids.length, doublons: doublons.length, ecarts, soldeIgnore: !!partiel });
      out.ids = ids; out.doublons = doublons.length; out.ecarts = ecarts;
      ent.resume = `Import ${action.import.fichier || ""} : ${ids.length} opération(s) ajoutée(s), ${doublons.length} déjà connue(s)`;
      ent.details = { import: action.import.id, ajoutees: ids.length, doublons: doublons.length };
      break;
    }
    case "supprimer-import": {
      const imp = etat.imports.find((i) => i.id === action.importId);
      if (!imp) { ent.resume = "Import introuvable"; break; }
      // C10 : seules les opérations qu'aucun autre import ne contient disparaissent ; les autres gardent leurs corrections.
      const ids = [], gardees = [];
      for (const o of Object.values(ops)) {
        const p = provenances(o);
        if (!p.includes(action.importId)) continue;
        const reste = p.filter((x) => x !== action.importId);
        if (reste.length) { o.imports = reste; if (o.import === action.importId) o.import = reste[0]; gardees.push(o.id); }
        else ids.push(o.id);
      }
      const lies = ids.map((id) => ops[id].lien).filter((l) => l && !ids.includes(l));
      for (const id of ids) delete ops[id];
      const rs = regles();
      for (const l of lies) { const o = ops[l]; if (o) { o.lien = null; o.source = null; o.categorie = null; classer(etat, o, rs); } }
      cfg.soldes = cfg.soldes.filter((s) => s.import !== action.importId);
      etat.imports = etat.imports.filter((i) => i.id !== action.importId);
      ent.resume = `Import ${imp.fichier || ""} supprimé : ${ids.length} opération(s) retirée(s)` + (gardees.length ? `, ${gardees.length} gardée(s) car présentes dans un autre import` : "");
      ent.details = { import: action.importId, retirees: ids.length, ids, gardees };
      out.ids = ids;
      break;
    }
    case "classer-ia": {
      // Classement proposé par l'IA pour les opérations qu'aucune règle ne reconnaît. Les réponses sûres deviennent
      // des règles (fournies par l'interface, avec leurs identifiants) pour ne plus jamais redemander à l'IA.
      for (const r of action.regles || []) if (r && r.action?.categorie && !cfg.regles.some((x) => x.id === r.id)) cfg.regles.push({ priorite: 60, active: true, origine: "ia", ...r });
      for (const x of action.resultats || []) {
        const o = ops[x.id];
        if (!o || o.source === "manuel" || o.lien || o.categorie || !M.categorie(etat, x.categorie)) continue;
        o.categorie = x.categorie; o.source = "ia"; o.aValider = !x.sur; o.nature = M.natureDe(etat, x.categorie) || o.nature;
        out.ids.push(o.id);
      }
      ent.resume = `${out.ids.length} opération(s) classée(s) par l'IA` + ((action.regles || []).length ? `, ${action.regles.length} règle(s) créée(s)` : "");
      ent.details = { ids: out.ids };
      break;
    }
    case "categoriser": {
      const avant = {};
      const nature = M.natureDe(etat, action.categorie);
      for (const id of action.ids) {
        const o = ops[id]; if (!o) continue;
        avant[id] = o.categorie;
        if (o.lien && nature !== "interne") M.delier(etat, id);
        o.categorie = action.categorie; o.source = "manuel"; o.aValider = false; o.nature = nature || o.nature;
        o.doublonPossible = null;
        out.ids.push(id);
      }
      ent.resume = `${out.ids.length} opération(s) classée(s) en ${resumeCategorie(etat, action.categorie)}`;
      ent.details = { ids: out.ids, avant, apres: action.categorie };
      break;
    }
    case "valider": {
      for (const id of action.ids) { const o = ops[id]; if (o) { o.aValider = false; o.doublonPossible = null; out.ids.push(id); } }
      ent.resume = `${out.ids.length} opération(s) validée(s)`; ent.details = { ids: out.ids };
      break;
    }
    case "supprimer-operations": {  // doublon confirmé : l'opération est retirée, l'import reste
      for (const id of action.ids) { if (ops[id]) { const l = ops[id].lien; delete ops[id]; out.ids.push(id); if (l && ops[l]) { M.delier(etat, l); } } }
      ent.resume = `${out.ids.length} opération(s) supprimée(s) (doublon)`; ent.details = { ids: out.ids };
      break;
    }
    case "note": {
      const o = ops[action.idOp]; if (!o) break;
      ent.details = { ids: [o.id], avant: o.note, apres: action.note };
      o.note = action.note; out.ids.push(o.id);
      ent.resume = "Note modifiée";
      break;
    }
    case "lier": {
      const a = ops[action.a], b = ops[action.b];
      if (!a || !b) break;
      M.delier(etat, a.id); M.delier(etat, b.id);
      const cat = categorieInterne(etat, a, b);
      for (const [x, y] of [[a, b], [b, a]]) Object.assign(x, { lien: y.id, categorie: cat, nature: "interne", source: "manuel", aValider: false });
      out.ids = [a.id, b.id]; ent.resume = "Virement interne lié à la main"; ent.details = { ids: out.ids };
      break;
    }
    case "delier": {
      out.ids = M.delier(etat, action.idOp);
      ent.resume = "Virement interne délié"; ent.details = { ids: out.ids };
      break;
    }
    case "solde": {
      // C16 : la saisie dit si le montant inclut déjà les opérations du jour. C18 : l'écart avec le calcul est gardé.
      const inclutJour = action.inclutJour !== false;
      const s = { id: action.id || "solde_" + empreinte(action.compte + action.date + action.montant), compte: action.compte, date: action.date, montant: action.montant, source: "saisie", t: action.t, inclutJour };
      cfg.soldes = cfg.soldes.filter((x) => x.id !== s.id && !(x.compte === s.compte && x.date === s.date && x.source === "saisie"));
      const calcule = M.soldeAu(etat, s.compte, s.date, null, inclutJour);
      s.ecart = calcule != null && calcule !== s.montant ? s.montant - calcule : 0;
      cfg.soldes.push(s);
      ent.resume = `Solde saisi : ${M.compte(etat, action.compte)?.nom || action.compte} au ${action.date}`;
      ent.details = { compte: action.compte, montant: action.montant };
      break;
    }
    case "rattacher": {  // C6 : mois de rattachement choisi à la main (null = règle automatique)
      for (const id of action.ids) { const o = ops[id]; if (!o) continue; o.moisForce = action.mois || null; out.ids.push(id); }
      ent.resume = action.mois ? `${out.ids.length} opération(s) comptée(s) en ${action.mois}` : `${out.ids.length} opération(s) : mois automatique`;
      ent.details = { ids: out.ids, mois: action.mois || null };
      break;
    }
    case "reglages": {
      ent.details = { avant: { ...cfg.reglages }, apres: action.reglages };
      cfg.reglages = { ...M.reglagesParDefaut(), ...cfg.reglages, ...action.reglages };
      ent.resume = "Réglages de calcul modifiés";
      break;
    }
    case "supprimer-solde": {
      cfg.soldes = cfg.soldes.filter((x) => x.id !== action.idSolde);
      ent.resume = "Solde de référence supprimé";
      break;
    }
    case "regle": {  // ajout ou modification
      const i = cfg.regles.findIndex((r) => r.id === action.regle.id);
      ent.details = { avant: i > -1 ? cfg.regles[i] : null, apres: action.regle };
      if (i > -1) cfg.regles[i] = action.regle; else cfg.regles.push({ priorite: 100, active: true, ...action.regle });
      ent.resume = (i > -1 ? "Règle modifiée : " : "Règle créée : ") + M.decrireRegle(etat, action.regle);
      if (action.appliquer) out.ids = M.appliquerRegle(etat, action.regle.id);
      if (out.ids.length) ent.resume += ` (appliquée à ${out.ids.length} opération(s))`;
      break;
    }
    case "supprimer-regle": {
      const r = cfg.regles.find((x) => x.id === action.idRegle);
      cfg.regles = cfg.regles.filter((x) => x.id !== action.idRegle);
      ent.resume = "Règle supprimée" + (r ? " : " + M.decrireRegle(etat, r) : ""); ent.details = { avant: r };
      break;
    }
    case "appliquer-regle": {
      out.ids = M.appliquerRegle(etat, action.idRegle);
      ent.resume = `Règle appliquée à ${out.ids.length} opération(s)`; ent.details = { ids: out.ids };
      break;
    }
    case "base": {  // activer / désactiver une règle de base
      const set = new Set(cfg.basesInactives);
      action.active ? set.delete(action.idRegle) : set.add(action.idRegle);
      cfg.basesInactives = [...set];
      ent.resume = `Règle de base ${action.active ? "réactivée" : "désactivée"}`;
      break;
    }
    case "reclasser": {  // repasser les règles sur tout ce qui n'est pas corrigé à la main
      const rs = regles();
      for (const o of Object.values(ops)) if (classer(etat, o, rs)) out.ids.push(o.id);
      M.detecterReprises(etat);
      ent.resume = `${out.ids.length} opération(s) reclassée(s)`;
      break;
    }
    case "groupe": {
      const i = cfg.groupes.findIndex((g) => g.id === action.groupe.id);
      ent.details = { avant: i > -1 ? cfg.groupes[i] : null, apres: action.groupe };
      if (i > -1) cfg.groupes[i] = { ...cfg.groupes[i], ...action.groupe }; else cfg.groupes.push({ type: "depense", ordre: cfg.groupes.length, masque: false, archive: false, couleur: "#9fb3c4", ...action.groupe });
      ent.resume = (i > -1 ? "Groupe modifié : " : "Groupe créé : ") + (action.groupe.nom || cfg.groupes[i]?.nom);
      toucher(etat);
      for (const o of Object.values(ops)) if (o.categorie && M.categorie(etat, o.categorie)?.groupe === action.groupe.id && o.nature !== "interne") o.nature = M.natureDe(etat, o.categorie);
      break;
    }
    case "categorie": {
      const i = cfg.categories.findIndex((c) => c.id === action.categorie.id);
      ent.details = { avant: i > -1 ? cfg.categories[i] : null, apres: action.categorie };
      if (i > -1) cfg.categories[i] = { ...cfg.categories[i], ...action.categorie };
      else cfg.categories.push({ ordre: cfg.categories.filter((c) => c.groupe === action.categorie.groupe).length, masquee: false, archivee: false, ...action.categorie });
      const c = cfg.categories.find((x) => x.id === action.categorie.id);
      ent.resume = (i > -1 ? "Catégorie modifiée : " : "Catégorie créée : ") + c.nom;
      toucher(etat);
      for (const o of Object.values(ops)) if (o.categorie === c.id && !o.lien) o.nature = M.natureDe(etat, c.id);
      break;
    }
    case "fusionner": {  // une catégorie utilisée ne disparaît pas : ses opérations et règles passent dans une autre
      for (const o of Object.values(ops)) if (o.categorie === action.source) { o.categorie = action.cible; out.ids.push(o.id); }
      for (const r of cfg.regles) if (r.action.categorie === action.source) r.action.categorie = action.cible;
      for (const b of cfg.budgets) if (b.cible === action.source) b.cible = action.cible;
      const c = cfg.categories.find((x) => x.id === action.source);
      if (c) c.archivee = true;
      ent.resume = `Catégorie ${c ? c.nom : ""} fusionnée dans ${resumeCategorie(etat, action.cible)} (${out.ids.length} opérations)`;
      toucher(etat);
      break;
    }
    case "importer-regles": {
      let n = 0;
      for (const r of action.regles || []) {
        if (!r || !Array.isArray(r.conditions) || !r.action?.categorie) continue;
        const i = cfg.regles.findIndex((x) => x.id === r.id);
        if (i > -1) cfg.regles[i] = r; else cfg.regles.push({ priorite: 100, active: true, ...r });
        n++;
      }
      for (const c of action.categories || []) if (c?.id && !cfg.categories.some((x) => x.id === c.id)) cfg.categories.push({ ordre: 99, masquee: false, archivee: false, ...c });
      toucher(etat);
      if (action.appliquer) { const rs = regles(); for (const o of Object.values(ops)) if (classer(etat, o, rs)) out.ids.push(o.id); }
      ent.resume = `${n} règle(s) importée(s)` + (out.ids.length ? `, ${out.ids.length} opération(s) reclassée(s)` : "");
      break;
    }
    case "compte": {
      const i = cfg.comptes.findIndex((c) => c.id === action.compte.id);
      if (i > -1) cfg.comptes[i] = { ...cfg.comptes[i], ...action.compte }; else cfg.comptes.push(action.compte);
      ent.resume = "Compte modifié : " + (action.compte.nom || action.compte.id);
      toucher(etat);
      break;
    }
    case "profil": {
      cfg.profilsLibres = (cfg.profilsLibres || []).filter((p) => p.id !== action.profil.id).concat(action.profil);
      ent.resume = "Format de fichier enregistré : " + action.profil.nom;
      break;
    }
    default:
      ent.resume = "Action inconnue : " + action.type;
  }
  toucher(etat);
  if (action.id && action.type !== "import-apercu" && !etat.journal.some((j) => j.id === action.id)) etat.journal.push(ent);
  return out;
};

/** Solde calculé à une date, à partir de la référence précédente (pour repérer un écart avec un relevé). */
M.soldeAu = function (etat, compteId, date, sauf, inclutJour = true) {
  const ref = etat.config.soldes.filter((s) => s.compte === compteId && s.date < date && (!sauf || s.import !== sauf)).sort(ordreRefs).at(-1);
  if (!ref) return null;
  const debut = ref.inclutJour === false ? (o) => o.dateValeur >= ref.date : (o) => o.dateValeur > ref.date;
  const fin = inclutJour ? (o) => o.dateValeur <= date : (o) => o.dateValeur < date;
  return ref.montant + Object.values(etat.operations).filter((o) => o.compte === compteId && debut(o) && fin(o)).reduce((t, o) => t + o.montant, 0);
};

/** Applique une règle aux opérations déjà importées (jamais aux corrections manuelles ni aux virements liés). */
M.appliquerRegle = function (etat, idRegle) {
  const r = etat.config.regles.find((x) => x.id === idRegle);
  if (!r) return [];
  const ids = [];
  for (const o of Object.values(etat.operations)) {
    if (o.source === "manuel" || o.lien || !M.regleCorrespond(o, r)) continue;
    o.categorie = r.action.categorie; o.source = "regle:" + r.id; o.aValider = false;
    o.nature = r.action.nature || M.natureDe(etat, r.action.categorie);
    if (r.action.commercant) o.commercant = r.action.commercant;
    ids.push(o.id);
  }
  return ids;
};
/** Opérations qu'une règle toucherait si on l'appliquait maintenant (aperçu). */
M.operationsCibles = (etat, regle) => Object.values(etat.operations).filter((o) => o.source !== "manuel" && !o.lien && M.regleCorrespond(o, regle));

const NOMS_CHAMPS = { libelle: "libellé", commercant: "commerçant", type: "type", compte: "compte", montant: "montant", sens: "sens" };
const NOMS_OPS = { contient: "contient", commence: "commence par", egal: "est", mot: "contient le mot", regex: "correspond à", entre: "entre" };
M.decrireRegle = function (etat, r) {
  const conds = r.conditions.map((c) => {
    if (c.champ === "sens") return c.valeur === "debit" ? "dépense" : "rentrée d'argent";
    if (c.champ === "compte") return "compte " + (M.compte(etat, c.valeur)?.nom || c.valeur);
    if (c.op === "entre") return `montant entre ${c.valeur} et ${c.valeur2} €`;
    return `${NOMS_CHAMPS[c.champ]} ${NOMS_OPS[c.op]} « ${String(c.valeur).trim()} »`;
  }).join(" et ");
  return conds + " → " + resumeCategorie(etat, r.action.categorie);
};

/** Règle proposée après une correction manuelle : « commerçant contient X » (+ sens). */
M.proposerRegle = function (op, categorie) {
  const mot = normaliser(op.commercant).split(" ").filter((m) => m.length > 1 && !/^\d+$/.test(m)).slice(0, 3).join(" ");
  return {
    id: "regle_" + empreinte(mot + categorie + Date.now()),
    nom: "",
    conditions: [{ champ: "commercant", op: "contient", valeur: mot || normaliser(op.libelle).slice(0, 24) },
      { champ: "sens", op: "egal", valeur: op.montant < 0 ? "debit" : "credit" }],
    action: { categorie }, priorite: 50, active: true, origine: "correction", creeeDepuis: op.id,
  };
};

/* ---------------------------------------------------------------- Recherche et filtres */
const MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
/** Transforme une recherche (« uber >20 oct revolut ») en filtre. Tous les mots doivent correspondre. */
M.compilerRecherche = function (etat, requete) {
  const mots = normaliser(String(requete).replace(/(\d),(\d)/g, "$1.$2").replace(/([<>]=?)\s+/g, "$1"))
    .length ? String(requete).toLowerCase().replace(/(\d),(\d)/g, "$1.$2").split(/\s+/).filter(Boolean) : [];
  const tests = [];
  const cats = etat.config.categories, grps = etat.config.groupes, comptes = etat.config.comptes, banques = etat.config.banques;
  for (let i = 0; i < mots.length; i++) {
    const brut = mots[i], m = normaliser(brut);
    let r;
    if ((r = brut.match(/^([<>]=?)(\d+(?:\.\d+)?)$/))) {
      const v = Math.round(Number(r[2]) * 100), op = r[1];
      tests.push((o) => { const a = Math.abs(o.montant); return op === ">" ? a > v : op === ">=" ? a >= v : op === "<" ? a < v : a <= v; });
    } else if ((r = brut.match(/^-?(\d+)(?:\.(\d{1,2}))?€?$/)) && (r[2] || Number(r[1]) < 10000) && !/^\d{4}$/.test(brut)) {
      const v = Math.round(Number(r[1] + "." + (r[2] || "0")) * 100);
      const entier = !r[2];
      tests.push((o) => { const a = Math.abs(o.montant); return entier ? Math.floor(a / 100) === v / 100 || normaliser(o.libelle).includes(m) : a === v; });
    } else if ((r = brut.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) {
      const j = r[1].padStart(2, "0"), mo = r[2].padStart(2, "0"), a = r[3] ? (r[3].length === 2 ? "20" + r[3] : r[3]) : null;
      tests.push((o) => o.dateValeur.slice(5) === `${mo}-${j}` && (!a || o.dateValeur.startsWith(a)));
    } else if (/^\d{4}$/.test(brut)) {
      tests.push((o) => o.dateValeur.startsWith(brut) || normaliser(o.libelle).includes(brut));
    } else if (m.length >= 3 && MOIS.some((x) => x.startsWith(m))) {
      const n = String(MOIS.findIndex((x) => x.startsWith(m)) + 1).padStart(2, "0");
      tests.push((o) => o.dateValeur.slice(5, 7) === n || normaliser(o.commercant).includes(m));
    } else if (m === "a" && normaliser(mots[i + 1] || "") === "valider") { i++; tests.push((o) => o.aValider); }
    else if (m === "valider" || m === "avalider") tests.push((o) => o.aValider);
    else if (m === "non" && normaliser(mots[i + 1] || "").startsWith("class")) { i++; tests.push((o) => !o.categorie); }
    else if (m === "interne" || m === "internes") tests.push((o) => M.natureOp(etat, o) === "interne");
    else if (m === "rapprocher") tests.push((o) => M.natureOp(etat, o) === "rapprocher");
    else if (m) {
      const idsCats = new Set(cats.filter((c) => normaliser(c.nom).includes(m)).map((c) => c.id));
      const idsGrps = new Set(grps.filter((g) => normaliser(g.nom).includes(m)).map((g) => g.id));
      const idsComptes = new Set(comptes.filter((c) => normaliser(c.nom).includes(m) || banques.some((b) => b.id === c.banque && normaliser(b.nom).includes(m))).map((c) => c.id));
      tests.push((o) => normaliser(o.libelle).includes(m) || normaliser(o.commercant).includes(m) || normaliser(o.note).includes(m)
        || idsCats.has(o.categorie) || (o.categorie && idsGrps.has(M.categorie(etat, o.categorie)?.groupe)) || idsComptes.has(o.compte));
    }
  }
  return (o) => tests.every((t) => t(o));
};

/** Bornes d'une période nommée. */
M.periode = function (nom, aujourdhui, du, au) {
  const [a, m] = aujourdhui.split("-").map(Number);
  const debutMois = (an, mo) => `${an + Math.floor((mo - 1) / 12)}-${String(((mo - 1) % 12 + 12) % 12 + 1).padStart(2, "0")}-01`;
  const finMois = (an, mo) => { const d = new Date(Date.UTC(an, mo, 0)); return d.toISOString().slice(0, 10); };
  switch (nom) {
    case "mois": return { du: debutMois(a, m), au: finMois(a, m) };
    case "mois-1": { const d = new Date(Date.UTC(a, m - 2, 1)); return { du: d.toISOString().slice(0, 10), au: finMois(d.getUTCFullYear(), d.getUTCMonth() + 1) }; }
    case "3mois": { const d = new Date(Date.UTC(a, m - 3, 1)); return { du: d.toISOString().slice(0, 10), au: finMois(a, m) }; }
    case "annee": return { du: `${a}-01-01`, au: `${a}-12-31` };
    case "perso": return { du: du || "0000-01-01", au: au || "9999-12-31" };
    default: return { du: "0000-01-01", au: "9999-12-31" };
  }
};

/* ---------------------------------------------------------------- Calculs : le seul module qui produit des chiffres */
// Toutes les vues lisent leurs chiffres ici (contrat, section 5). Chaque indicateur renvoie { valeur, ids } :
// la valeur en centimes et la liste exacte des opérations qui la composent, pour « justifier » chaque nombre.

const reglages = (etat) => ({ ...M.reglagesParDefaut(), ...(etat.config.reglages || {}) });
M.reglages = reglages;

/** Date qui range l'opération dans un mois (C5, C6) : date de débit ; un salaire versé à partir du seuil (25 par
 *  défaut) compte pour le mois suivant ; un rattachement choisi à la main l'emporte. Ne touche jamais les soldes. */
M.dateRattachement = function (etat, o) {
  if (o.moisForce) return o.moisForce + "-01";
  const d = o.dateValeur || o.date;
  if (o.categorie === ID_CATEGORIE.salaire && o.montant > 0 && Number(d.slice(8, 10)) >= reglages(etat).seuilSalaire) {
    const [a, m] = d.split("-").map(Number);
    return new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
  }
  return d;
};
M.moisDe = (etat, o) => M.dateRattachement(etat, o).slice(0, 7);
/** Le rattachement diffère-t-il du mois de débit ? (pour afficher « compté en novembre ») */
M.decale = (etat, o) => M.moisDe(etat, o) !== (o.dateValeur || o.date).slice(0, 7);

/** Nature d'une opération (contrat, section 3). Exactement une parmi : depense, remboursement, revenu, interne,
 *  rapprocher (virement sans contrepartie), hors (vers un compte à moi non suivi). Calculée, jamais devinée ailleurs. */
M.natureOp = function (etat, o) {
  if (o.lien) return "interne";
  const type = o.categorie ? M.natureDe(etat, o.categorie) : null;
  if (o.categorie === ID_CATEGORIE.nonSuivi) return "hors";
  if (type === "interne") return o.source === "manuel" ? "interne" : "rapprocher";
  if (type === "depense") return o.montant < 0 ? "depense" : "remboursement";
  if (type === "revenu") return "revenu";
  if (o.source !== "manuel" && indiceInterne(o)) return "rapprocher";  // C14
  return o.montant < 0 ? "depense" : "revenu";  // non classée : comptée, et signalée « à vérifier »
};
M.aRapprocher = (etat, o) => M.natureOp(etat, o) === "rapprocher";

const seau = () => ({ valeur: 0, ids: [] });
const verser = (b, o, v) => { b.valeur += v; b.ids.push(o.id); };

/** Indicateurs d'un ensemble d'opérations (déjà filtré sur la période par M.moisDe). Montants en centimes. */
M.indicateurs = function (etat, ops) {
  const r = {
    depenses: seau(), remboursements: seau(), revenus: seau(), salaire: seau(), interets: seau(), aide: seau(), autresRevenus: seau(),
    misDeCote: seau(), internes: seau(), aRapprocher: { ...seau(), nombre: 0 }, horsPerimetre: seau(), aVerifier: { ...seau(), nombre: 0 },
    nonClassees: { ...seau(), nombre: 0 }, parGroupe: {}, parCategorie: {}, revenusParCategorie: {},
  };
  const epargne = new Set(etat.config.comptes.filter((c) => c.type === "epargne").map((c) => c.id));
  for (const o of ops) {
    const n = M.natureOp(etat, o);
    if (epargne.has(o.compte)) verser(r.misDeCote, o, o.montant);
    if (n === "depense" || n === "remboursement") {
      const v = -o.montant;  // une dépense est positive, un remboursement la diminue
      verser(r.depenses, o, v);
      if (n === "remboursement") verser(r.remboursements, o, o.montant);
      const c = o.categorie ? M.categorie(etat, o.categorie) : null;
      const g = c ? c.groupe : "_aucun", k = o.categorie || "_aucune";
      verser(r.parGroupe[g] ||= seau(), o, v);
      verser(r.parCategorie[k] ||= seau(), o, v);
    } else if (n === "revenu") {
      verser(r.revenus, o, o.montant);
      const k = o.categorie || "_aucune";
      verser(r.revenusParCategorie[k] ||= seau(), o, o.montant);
      if (o.categorie === ID_CATEGORIE.salaire) verser(r.salaire, o, o.montant);
      else if (o.categorie === ID_CATEGORIE.interets) verser(r.interets, o, o.montant);
      else if (o.categorie === ID_CATEGORIE.aide) verser(r.aide, o, o.montant);
      else verser(r.autresRevenus, o, o.montant);
    } else if (n === "interne") verser(r.internes, o, o.montant);
    else if (n === "rapprocher") { verser(r.aRapprocher, o, o.montant); r.aRapprocher.nombre++; }
    else if (n === "hors") verser(r.horsPerimetre, o, o.montant);
    if (!o.categorie && !o.lien && n !== "rapprocher") { verser(r.nonClassees, o, o.montant); r.nonClassees.nombre++; }
    if ((o.aValider || o.doublonPossible) && n !== "rapprocher") { verser(r.aVerifier, o, Math.abs(o.montant)); r.aVerifier.nombre++; }
  }
  r.resultat = { valeur: r.revenus.valeur - r.depenses.valeur, ids: [...r.revenus.ids, ...r.depenses.ids] };
  r.tauxEpargne = { valeur: r.revenus.valeur > 0 ? r.resultat.valeur / r.revenus.valeur : null, ids: r.resultat.ids };
  return r;
};

/** Opérations rattachées à une période (bornes incluses, dates ISO). */
M.opsPeriode = (etat, ops, du, au) => ops.filter((o) => { const d = M.dateRattachement(etat, o); return d >= du && d <= au; });

/** Compatibilité : ancien format des totaux, dérivé des indicateurs (mêmes chiffres partout). */
M.totaux = function (etat, ops) {
  const r = M.indicateurs(etat, ops);
  const plat = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.valeur]));
  return { depenses: r.depenses.valeur, revenus: r.revenus.valeur, epargne: r.misDeCote.valeur, parGroupe: plat(r.parGroupe),
    parCategorie: { ...plat(r.parCategorie), ...plat(r.revenusParCategorie) }, nonClassees: r.nonClassees.nombre, salaire: r.salaire.valeur };
};

/** Dépenses et revenus mois par mois, par mois de rattachement, avec les mêmes formules que M.indicateurs. */
M.parMois = function (etat, ops, nbMois, aujourdhui) {
  const fin = aujourdhui.slice(0, 7);
  const [a, m] = fin.split("-").map(Number);
  const mois = [];
  for (let i = nbMois - 1; i >= 0; i--) { const d = new Date(Date.UTC(a, m - 1 - i, 1)); mois.push(d.toISOString().slice(0, 7)); }
  const groupes = new Map(mois.map((mo) => [mo, []]));
  for (const o of ops) groupes.get(M.moisDe(etat, o))?.push(o);
  return mois.map((mo) => {
    const r = M.indicateurs(etat, groupes.get(mo));
    return { mois: mo, depenses: r.depenses.valeur, revenus: r.revenus.valeur, resultat: r.resultat.valeur, misDeCote: r.misDeCote.valeur };
  });
};

/** Catégories les plus utilisées (pour le haut du sélecteur). */
M.categoriesFrequentes = function (etat, n = 5) {
  const compte = {};
  for (const o of Object.values(etat.operations)) if (o.categorie && o.source === "manuel") compte[o.categorie] = (compte[o.categorie] || 0) + 3;
  for (const o of Object.values(etat.operations)) if (o.categorie) compte[o.categorie] = (compte[o.categorie] || 0) + 1;
  return Object.entries(compte).sort((a, b) => b[1] - a[1]).map(([id]) => id)
    .filter((id) => { const c = M.categorie(etat, id); return c && !c.masquee && !c.archivee; }).slice(0, n);
};

/** Recherche dans les catégories (sans accents, aussi par nom de groupe). */
M.chercherCategories = function (etat, texte, { inclureMasquees = false } = {}) {
  const q = normaliser(texte);
  const res = [];
  const groupes = [...etat.config.groupes].filter((g) => !g.archive && (inclureMasquees || !g.masque)).sort((a, b) => a.ordre - b.ordre);
  for (const g of groupes) {
    const cats = etat.config.categories.filter((c) => c.groupe === g.id && !c.archivee && (inclureMasquees || !c.masquee)).sort((a, b) => a.ordre - b.ordre);
    const groupeOk = q && normaliser(g.nom).includes(q);
    const trouvees = q ? cats.filter((c) => groupeOk || normaliser(c.nom).includes(q) || normaliser(c.nom).split(" ").some((m) => m.startsWith(q))) : cats;
    if (trouvees.length) res.push({ groupe: g, categories: trouvees });
  }
  return res;
};

/* ---------------------------------------------------------------- Stockage : découpage en fichiers */
/** Découpe l'état en fichiers du coffre : config, imports, journal, opérations par année. */
M.versFichiers = function (etat) {
  const fichiers = {
    "config.json": { version: VERSION, config: etat.config },
    "imports.json": { version: VERSION, imports: etat.imports },
    "journal.json": { version: VERSION, journal: etat.journal.slice(-5000) },
  };
  const parAn = {};
  for (const o of Object.values(etat.operations)) (parAn[o.date.slice(0, 4)] ||= []).push(o);
  for (const [an, ops] of Object.entries(parAn)) fichiers[`operations-${an}.json`] = { version: VERSION, operations: ops.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) };
  return fichiers;
};
M.depuisFichiers = function (fichiers) {
  const etat = M.etatVide();
  if (fichiers["config.json"]) etat.config = { ...M.configParDefaut(), ...fichiers["config.json"].config };
  if (fichiers["imports.json"]) etat.imports = fichiers["imports.json"].imports || [];
  if (fichiers["journal.json"]) etat.journal = fichiers["journal.json"].journal || [];
  for (const [nom, f] of Object.entries(fichiers)) if (/^operations-\d{4}\.json$/.test(nom)) for (const o of f.operations || []) etat.operations[o.id] = o;
  if (fichiers["config.json"] && (fichiers["config.json"].version || 1) < VERSION) M.migrer(etat);
  toucher(etat);
  return etat;
};

/** Migration 1 → 2, sans aucune suppression : catégories par défaut manquantes ajoutées, provenance initialisée,
 *  réglages par défaut, règles rejouées sur les opérations non corrigées à la main. Le coffre garde une copie
 *  de la version 1 (PloutosCoffre) avant le premier envoi. Idempotente. */
M.migrer = function (etat) {
  const cfg = etat.config, def = M.configParDefaut();
  for (const g of def.groupes) if (!cfg.groupes.some((x) => x.id === g.id)) cfg.groupes.push({ ...g, ordre: cfg.groupes.length });
  for (const c of def.categories) if (!cfg.categories.some((x) => x.id === c.id)) cfg.categories.push(c);
  cfg.reglages = { ...M.reglagesParDefaut(), ...(cfg.reglages || {}) };
  for (const o of Object.values(etat.operations)) o.imports = provenances(o);
  toucher(etat);
  const rs = M.reglesActives(cfg);
  for (const o of Object.values(etat.operations)) classer(etat, o, rs);
  M.detecterReprises(etat);
  cfg.version = VERSION;
  toucher(etat);
  return etat;
};

/** Export lisible dans Excel : une ligne par opération, séparateur point-virgule, virgule décimale. */
M.exporterCsv = function (etat, ops) {
  const q = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
  const lignes = [["Date", "Date de valeur", "Compte", "Commerçant", "Libellé d'origine", "Montant", "Nature", "Groupe", "Catégorie", "Classement", "Note"].map(q).join(";")];
  for (const o of ops) {
    const c = M.categorie(etat, o.categorie), g = c && M.groupe(etat, c.groupe);
    lignes.push([o.date, o.dateValeur, M.compte(etat, o.compte)?.nom || o.compte, o.commercant, o.libelle, (o.montant / 100).toFixed(2).replace(".", ","),
      o.nature, g?.nom || "", c?.nom || "", o.source, o.note].map(q).join(";"));
  }
  return "﻿" + lignes.join("\r\n");
};

if (typeof module !== "undefined" && module.exports) module.exports = M;
else racine.PloutosMoteur = M;
})(typeof globalThis !== "undefined" ? globalThis : this);
