// Contrat financier PLOUTOS : tests de référence T1 à T21 (le T22 se joue en local sur les vrais relevés, jamais publié).
// Chaque test part de données fictives écrites ici et vérifie un résultat exact au centime.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../nexus/ploutos-moteur.js");

/* Fabrique de relevés fictifs */
const fr = (iso) => iso.split("-").reverse().join("/");
const eur = (c) => (c / 100).toFixed(2).replace(".", ",");  // virgule décimale, comme les vrais exports LCL
/** LCL : lignes [date ISO, centimes, type, libellé] ; ouverture/clôture facultatives [date, centimes]. */
function lcl(lignes, { ouverture, cloture } = {}) {
  const l = [];
  if (ouverture) l.push(`${fr(ouverture[0])};${eur(ouverture[1])};;01234 567890A`);
  for (const [d, m, type, lib] of lignes) l.push(`${fr(d)};${eur(m)};${type};;${lib};;`);
  if (cloture) l.push(`${fr(cloture[0])};${eur(cloture[1])};;01234 567890A`);
  // Le profil LCL veut au moins deux lignes : une ligne de solde d'ouverture seule (sans clôture) n'a aucun effet.
  if (l.length < 2) l.unshift(`${fr(lignes[0][0])};0,00;;01234 567890A`);
  return M.lireReleve(M.lireCsv(l.join("\n")));
}
/** Revolut : lignes [produit, début ISO avec heure, fin, description, centimes, frais centimes, type, solde centimes]. */
function revolut(lignes) {
  const l = ["Type,Produit,Date de début,Date de fin,Description,Montant,Frais,Devise,État,Solde"];
  for (const [produit, debut, fin, desc, m, frais, type, solde] of lignes)
    l.push(`${type || "Paiement par carte"},${produit},${debut},${fin || debut},${desc},${(m / 100).toFixed(2)},${((frais || 0) / 100).toFixed(2)},EUR,TERMINÉ,${solde == null ? "" : (solde / 100).toFixed(2)}`);
  return M.lireReleve(M.lireCsv(l.join("\n")));
}
let n = 0;
const importer = (etat, releve, t = "2026-02-01T10:00:00Z") => M.appliquer(etat, { ...M.actionImport(releve, "imp" + ++n), id: "act" + n, t });
const ops = (etat) => Object.values(etat.operations);
const mois = (etat, m) => M.indicateurs(etat, ops(etat).filter((o) => M.moisDe(etat, o) === m));
const trouve = (etat, mot) => ops(etat).filter((o) => M.normaliser(o.libelle).includes(mot));

test("T1 virement LCL → Revolut : apparié, ni dépense ni revenu, patrimoine inchangé", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-01-05", -20000, "Virement", "VIR INST MONREVOLUT"]], { ouverture: ["2026-01-01", 100000], cloture: ["2026-01-05", 80000] }));
  importer(e, revolut([["Valeur actuelle", "2026-01-05 10:00:00", null, "Paiement envoyé par M JEAN DUPONT", 20000, 0, "Ajout de fonds", 20000]]));
  const [a] = trouve(e, "monrevolut");
  assert.ok(a.lien);
  const r = mois(e, "2026-01");
  assert.equal(r.depenses.valeur, 0);
  assert.equal(r.revenus.valeur, 0);
  assert.equal(M.patrimoine(e, "2026-01-05").montant, 100000);
});

test("T2 versement vers l'épargne : interne, mis de côté +50", () => {
  const e = M.etatVide();
  importer(e, revolut([
    ["Valeur actuelle", "2026-01-13 11:56:18", null, "À EUR Compte d'épargne", -5000, 0, "Virement", 10000],
    ["Dépôt", "2026-01-13 11:56:18", null, "À EUR Compte d'épargne", 5000, 0, "Virement", 5000],
  ]));
  const r = mois(e, "2026-01");
  assert.equal(r.misDeCote.valeur, 5000);
  assert.equal(r.depenses.valeur, 0);
  assert.ok(ops(e).every((o) => M.natureOp(e, o) === "interne"));
});

test("T3 recharge Apple Pay le lendemain : appariée", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-02-03", -2084, "Carte", "CB REVOLUT 03/02/26"]]));
  importer(e, revolut([["Valeur actuelle", "2026-02-04 08:00:00", null, "Recharge sur Apple Pay", 2084, 0, "Ajout de fonds", 2084]]));
  assert.ok(ops(e).every((o) => o.lien && M.natureOp(e, o) === "interne"));
});

test("T4 deux virements identiques le même jour : deux paires distinctes", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-03-02", -10000, "Virement", "VIR INST MONREVOLUT"], ["2026-03-02", -10000, "Virement", "VIR INST MONREVOLUT"]]));
  importer(e, revolut([
    ["Valeur actuelle", "2026-03-02 09:00:00", null, "Paiement envoyé par M JEAN DUPONT", 10000, 0, "Ajout de fonds", 10000],
    ["Valeur actuelle", "2026-03-02 09:05:00", null, "Paiement envoyé par M JEAN DUPONT", 10000, 0, "Ajout de fonds", 20000],
  ]));
  const liens = ops(e).map((o) => o.lien);
  assert.equal(liens.filter(Boolean).length, 4);
  assert.equal(new Set(liens).size, 4, "aucune opération liée deux fois");
});

test("T5 contrepartie absente : à rapprocher, hors dépenses, alerte", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-03-16", -20000, "Virement", "VIR INST REVOLK"], ["2026-03-17", -1000, "Carte", "CB CAFE DU PARC 16/03/26"]]));
  const r = mois(e, "2026-03");
  assert.equal(r.depenses.valeur, 1000);
  assert.equal(r.aRapprocher.nombre, 1);
  assert.equal(r.aRapprocher.valeur, -20000);
  assert.equal(r.revenus.valeur, 0);
});

test("T6 contrepartie arrivée plus tard : appariée, alerte levée", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-03-16", -20000, "Virement", "VIR INST REVOLK"]]));
  importer(e, revolut([["Valeur actuelle", "2026-03-16 12:00:00", null, "Paiement envoyé par M JEAN DUPONT", 20000, 0, "Ajout de fonds", 20000]]));
  const r = mois(e, "2026-03");
  assert.equal(r.aRapprocher.nombre, 0);
  assert.equal(r.depenses.valeur, 0);
});

test("T6 bis compte à moi non suivi : sortie hors périmètre, montrée à part", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-03-27", -50000, "Virement", "VIR INST BOURSOLK"]]));
  const [o] = ops(e);
  assert.equal(M.natureOp(e, o), "rapprocher");
  M.appliquer(e, { type: "categoriser", ids: [o.id], categorie: M.ID_CATEGORIE.nonSuivi, id: "c1" });
  const r = mois(e, "2026-03");
  assert.equal(r.horsPerimetre.valeur, -50000);
  assert.equal(r.aRapprocher.nombre, 0);
  assert.equal(r.depenses.valeur, 0);
});

test("T7 remboursement carte : déduit du shopping, pas un revenu", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-04-02", -14919, "Carte", "CB AMAZON PAYMENTS 01/04/26"], ["2026-04-09", 6999, "Carte", "AMAZON PAYMENTS REMBOURSEMENT"]]));
  const r = mois(e, "2026-04");
  assert.equal(r.depenses.valeur, 7920);
  assert.equal(r.parGroupe.shopping.valeur, 7920);
  assert.equal(r.remboursements.valeur, 6999);
  assert.equal(r.revenus.valeur, 0);
});

test("T8 remboursement mutuelle : déduit de la santé", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-04-03", -2500, "Carte", "CB PHARMACIE DU CENTRE 02/04/26"], ["2026-04-12", 756, "Virement", "VIREMENT Mutuelle Generale"]]));
  const r = mois(e, "2026-04");
  assert.equal(r.parGroupe.sante.valeur, 1744);
  assert.equal(r.depenses.valeur, 1744);
  assert.equal(r.revenus.valeur, 0);
});

test("T9 salaire du 30 : compté le mois suivant, solde du 30 inchangé", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-09-30", 124035, "Virement", "VIR SEPA EMPLOYEUR SALAIRE SEPTEMBRE"]], { ouverture: ["2026-09-01", 1000], cloture: ["2026-09-30", 125035] }));
  const [o] = ops(e);
  assert.equal(o.categorie, M.ID_CATEGORIE.salaire);
  assert.equal(mois(e, "2026-10").revenus.valeur, 124035);
  assert.equal(mois(e, "2026-10").salaire.valeur, 124035);
  assert.equal(mois(e, "2026-09").revenus.valeur, 0);
  assert.ok(M.decale(e, o));
  assert.equal(M.solde(e, "lcl-courant", "2026-09-30").montant, 125035);
  // Réglable : seuil au 31 → retour en septembre ; rattachement à la main l'emporte
  M.appliquer(e, { type: "reglages", reglages: { seuilSalaire: 31 }, id: "r1" });
  assert.equal(mois(e, "2026-09").revenus.valeur, 124035);
  M.appliquer(e, { type: "rattacher", ids: [o.id], mois: "2026-11", id: "r2" });
  assert.equal(mois(e, "2026-11").revenus.valeur, 124035);
});

test("T10 salaire versé en double puis repris : revenus nets, reprise signalée", () => {
  const e = M.etatVide();
  importer(e, lcl([
    ["2026-09-04", 98533, "Virement", "VIR SEPA EMPLOYEUR SALAIRE"],
    ["2026-09-07", 98533, "Virement", "VIR SEPA EMPLOYEUR SALAIRE"],
    ["2026-09-08", -98533, "Virement", "VIR SEPA EMPLOYEUR SALAIRE"],
  ]));
  const r = mois(e, "2026-09");
  assert.equal(r.revenus.valeur, 98533);
  assert.equal(r.depenses.valeur, 0);
  const reprise = ops(e).find((o) => o.montant < 0);
  assert.equal(reprise.source, "reprise");
  assert.ok(reprise.aValider && reprise.reprise);
  assert.equal(r.aVerifier.nombre, 1);
});

test("T11 frais bancaires LCL et frais Revolut", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-01-31", -200, "", "FORFAIT LCL ESSENTIEL"]]));
  importer(e, revolut([["Valeur actuelle", "2026-01-12 05:00:00", null, "Frais d'abonnement Metal", 0, 999, "Valider le paiement", 1000]]));
  const r = mois(e, "2026-01");
  assert.equal(r.parGroupe.finances.valeur, 1199);
  assert.equal(r.depenses.valeur, 1199);
});

test("T12 intérêts d'épargne : revenu et mis de côté", () => {
  const e = M.etatVide();
  importer(e, revolut([1, 2, 3, 4, 5].map((j) => ["Dépôt", `2026-01-0${j} 05:00:00`, null, `Intérêts nets versés le ${j}`, 1, 0, "Intérêts", j])));
  const r = mois(e, "2026-01");
  assert.equal(r.revenus.valeur, 5);
  assert.equal(r.interets.valeur, 5);
  assert.equal(r.salaire.valeur, 0);
  assert.equal(r.misDeCote.valeur, 5);
});

test("T13 mois par date de débit : achat le 31/07, débit le 1/08", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-08-01", -3000, "Carte", "CB FNAC 31/07/26"]]));
  const [o] = ops(e);
  assert.equal(o.date, "2026-07-31");
  assert.equal(M.moisDe(e, o), "2026-08");
  assert.equal(mois(e, "2026-08").depenses.valeur, 3000);
  assert.equal(mois(e, "2026-07").depenses.valeur, 0);
  assert.equal(M.parMois(e, ops(e), 2, "2026-08-15")[1].depenses, 3000);
});

const JANVIER = [
  ["2026-01-03", -140, "Carte", "CB CAFE DU PARC 02/01/26"],
  ["2026-01-03", -140, "Carte", "CB CAFE DU PARC 02/01/26"],
  ["2026-01-10", -2000, "Carte", "CB BOULANGERIE MAX 09/01/26"],
  ["2026-01-20", -1500, "Carte", "CB CINEMA 19/01/26"],
  ["2026-01-28", -900, "Carte", "CB PHARMACIE 27/01/26"],
];
const A = () => lcl(JANVIER.slice(0, 3), { ouverture: ["2026-01-01", 10000], cloture: ["2026-01-15", 7720] });
const B = () => lcl(JANVIER, { ouverture: ["2026-01-01", 10000], cloture: ["2026-01-31", 5320] });

test("T14 réimport du même fichier : rien d'ajouté", () => {
  const e = M.etatVide();
  importer(e, B());
  const r = importer(e, B());
  assert.equal(r.ids.length, 0);
  assert.equal(r.doublons, 5);
  assert.equal(ops(e).length, 5);
});

test("T15 fichiers qui se chevauchent : union sans doublon, deux cafés gardés", () => {
  const e = M.etatVide();
  importer(e, A()); importer(e, B());
  assert.equal(ops(e).length, 5);
  assert.equal(trouve(e, "cafe").length, 2);
});

test("T16 suppression d'un import chevauché : B reste entier, ses soldes aussi", () => {
  const e = M.etatVide();
  const ia = "imp" + (n + 1);
  importer(e, A()); importer(e, B());
  M.appliquer(e, { type: "supprimer-import", importId: ia, id: "del" });
  assert.equal(ops(e).length, 5);
  assert.ok(ops(e).every((o) => !M.provenances(o).includes(ia)));
  assert.equal(M.solde(e, "lcl-courant", "2026-01-31").montant, 5320);
  assert.equal(e.config.soldes.length, 1);
});

test("T17 import partiel : importé, clôture non retenue", () => {
  const e = M.etatVide();
  const r = lcl(JANVIER.slice(0, 3), { ouverture: ["2026-01-01", 10000], cloture: ["2026-01-15", 9000] });
  assert.equal(r.controle.ok, false);
  importer(e, r);
  assert.equal(ops(e).length, 3);
  assert.equal(e.config.soldes.length, 0);
  assert.ok(e.imports[0].soldeIgnore);
});

test("T18 presque-doublon entre deux exports : gardé, à vérifier", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-02-10", -1250, "Carte", "CB MONOPRIX 09/02/26"]]));
  importer(e, lcl([["2026-02-10", -1250, "Carte", "CB MONOPRIX PARIS 09/02/26"]]));
  assert.equal(ops(e).length, 2);
  const r = mois(e, "2026-02");
  assert.equal(r.aVerifier.nombre, 1);
});

test("T19 solde saisi le matin sans les opérations du jour", () => {
  const e = M.etatVide();
  M.appliquer(e, { type: "solde", compte: "lcl-courant", date: "2026-05-04", montant: 7000, inclutJour: false, id: "s1", t: "2026-05-04T08:00:00Z" });
  importer(e, lcl([["2026-05-04", -2000, "Carte", "CB BOULANGERIE 04/05/26"]]), "2026-05-04T20:00:00Z");
  const s = M.solde(e, "lcl-courant", "2026-05-04");
  assert.equal(s.montant, 5000);
  assert.equal(s.statut, "calcule");
  // Saisie qui inclut déjà la journée : l'opération du jour n'est pas recomptée
  const f = M.etatVide();
  M.appliquer(f, { type: "solde", compte: "lcl-courant", date: "2026-05-04", montant: 5000, inclutJour: true, id: "s2", t: "2026-05-04T21:00:00Z" });
  importer(f, lcl([["2026-05-04", -2000, "Carte", "CB BOULANGERIE 04/05/26"]]), "2026-05-05T08:00:00Z");
  assert.equal(M.solde(f, "lcl-courant", "2026-05-05").montant, 5000);
});

test("T20 écart à l'arrivée d'une référence : affiché, rien d'absorbé", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-11-02", -1000, "Carte", "CB CAFE 01/11/26"]], { ouverture: ["2026-10-31", 65697], cloture: ["2026-11-02", 64697] }));
  M.appliquer(e, { type: "solde", compte: "lcl-courant", date: "2026-11-03", montant: 99434, id: "s", t: "2026-11-03T18:00:00Z" });
  const ref = e.config.soldes.find((s) => s.source === "saisie");
  assert.equal(ref.ecart, 99434 - 64697);
  assert.equal(M.solde(e, "lcl-courant", "2026-11-03").ecart, 34737);
  const c = M.controles(e).find((x) => x.compte === "lcl-courant");
  assert.equal(c.ecart, 34737);
});

test("T21 patrimoine : somme des comptes, statut du moins bon", () => {
  const e = M.etatVide();
  M.appliquer(e, { type: "solde", compte: "lcl-courant", date: "2026-11-03", montant: 99434, id: "a" });
  M.appliquer(e, { type: "solde", compte: "revolut-courant", date: "2026-11-03", montant: 43459, id: "b" });
  M.appliquer(e, { type: "solde", compte: "revolut-epargne", date: "2026-10-25", montant: 50000, id: "c" });
  const p = M.patrimoine(e, "2026-11-03");
  assert.equal(p.montant, 192893);
  assert.equal(p.statut, "ancien");
});

test("cohérence transverse : totaux, parMois et indicateurs donnent les mêmes chiffres", () => {
  const e = M.etatVide();
  importer(e, B());
  importer(e, lcl([["2026-01-16", -20000, "Virement", "VIR INST REVOLK"], ["2026-01-29", 500, "Virement", "VIR INST AMI SANS NOM"]]));
  const tous = ops(e);
  const r = M.indicateurs(e, tous), t = M.totaux(e, tous), m = M.parMois(e, tous, 1, "2026-01-31")[0];
  assert.equal(t.depenses, r.depenses.valeur);
  assert.equal(m.depenses, r.depenses.valeur);
  assert.equal(m.revenus, r.revenus.valeur);
  assert.equal(r.depenses.valeur, 4680);  // le virement sans contrepartie n'est pas une dépense
  // Chaque indicateur est justifié par ses opérations
  const somme = (ids) => ids.reduce((s, id) => s - e.operations[id].montant, 0);
  assert.equal(somme(r.depenses.ids), r.depenses.valeur);
});

test("migration 1 → 2 sans perte : catégories ajoutées, provenance, reclassement", () => {
  const e = M.etatVide();
  importer(e, lcl([["2026-04-12", 756, "Virement", "VIREMENT Mutuelle Generale"], ["2026-04-13", -500, "Carte", "CB FNAC 12/04/26"]]));
  const fichiers = JSON.parse(JSON.stringify(M.versFichiers(e)));
  // Simule un coffre v1 : ancienne version, sans provenance multiple, sans la catégorie « Compte non suivi », ancien classement
  for (const f of Object.values(fichiers)) f.version = 1;
  fichiers["config.json"].config.categories = fichiers["config.json"].config.categories.filter((c) => c.id !== M.ID_CATEGORIE.nonSuivi);
  delete fichiers["config.json"].config.reglages;
  for (const f of Object.keys(fichiers).filter((k) => k.startsWith("operations-"))) for (const o of fichiers[f].operations) {
    delete o.imports;
    if (o.montant > 0) { o.categorie = M.ID_CATEGORIE.remboursement; o.source = "regle:base-mutuelle-credit"; }
  }
  const avant = Object.keys(fichiers).filter((k) => k.startsWith("operations-")).reduce((t, k) => t + fichiers[k].operations.length, 0);
  const e2 = M.depuisFichiers(fichiers);
  assert.equal(ops(e2).length, avant);
  assert.ok(M.categorie(e2, M.ID_CATEGORIE.nonSuivi));
  assert.ok(ops(e2).every((o) => M.provenances(o).length === 1));
  assert.equal(ops(e2).find((o) => o.montant > 0).categorie, "sante-consultations-medicales");
  assert.equal(e2.config.reglages.seuilSalaire, 25);
  assert.equal(M.versFichiers(e2)["config.json"].version, 2);
});
