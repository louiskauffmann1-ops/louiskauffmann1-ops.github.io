// Tests du moteur et du coffre PLOUTOS (node --test tests/). Données fictives uniquement.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../nexus/ploutos-moteur.js");
const { Coffre, deriverCle, sceller, ouvrirEnveloppe } = require("../nexus/ploutos-coffre.js");

const LCL = [
  "01/01/2026;-100,00;;01234 567890A",
  "01/01/2026;150;Virement;;;VIR.PERMANENT DUPONT;;",
  "02/01/2026;-10,49;Carte;;CB  PRIMEUR DU COIN  31/12/25;;0;Divers",
  "06/01/2026;-1,4;Carte;;CB  CAFE DU PARC     05/01/26;;0;Divers",
  "06/01/2026;-1,4;Carte;;CB  CAFE DU PARC     05/01/26;;0;Divers",
  "07/01/2026;-24,71;Carte;;CB  UBER   * EATS PE 05/01/26;;0;Divers",
  "08/01/2026;-12,00;Carte;;CB  UBER   * TRIP    07/01/26;;0;Divers",
  "09/01/2026;-20,00;Carte;;CB  BOULANGERIE MAX  08/01/26;;0;Divers",
  "09/01/2026;-300,00;Carte;;CB  BOULANGER       08/01/26;;0;Divers",
  "10/01/2026;-200;Virement;;VIR INST MONREVOLUT;;;",
  "12/01/2026;3;Virement;;;VIREMENT Mutuelle Generale;;",
  "15/01/2026;-50;Retrait DAB;;;CB  RETRAIT DU  14/01;;Liquide",
  "31/01/2026;1000;Virement;;;VIR INST EMPLOYEUR SA;;",
  "31/01/2026;-2;;;FORFAIT LCL ESSENTIEL;;;",
  "31/01/2026;431,00;;01234 567890A",
].join("\n");
const REVOLUT = [
  "Type,Produit,Date de début,Date de fin,Description,Montant,Frais,Devise,État,Solde",
  "Ajout de fonds,Valeur actuelle,2026-01-10 16:40:16,2026-01-10 16:40:17,Paiement envoyé par M JEAN DUPONT,200.00,0.00,EUR,TERMINÉ,250.00",
  "Paiement par carte,Valeur actuelle,2026-01-11 10:00:00,2026-01-12 10:00:00,Netflix,-14.99,0.00,EUR,TERMINÉ,235.01",
  "Valider le paiement,Valeur actuelle,2026-01-12 05:00:00,2026-01-12 05:00:00,Frais d'abonnement Metal,0.00,9.99,EUR,TERMINÉ,225.02",
  "Virement,Valeur actuelle,2026-01-13 11:56:18,2026-01-13 11:56:18,À EUR Compte d'épargne,-50.00,0.00,EUR,TERMINÉ,175.02",
  "DAB,Valeur actuelle,2026-01-14 20:31:42,2026-01-15 06:18:11,Retrait d'espèces,-50.00,0.00,EUR,TERMINÉ,125.02",
  "Paiement par carte,Valeur actuelle,2026-01-16 13:16:49,,MyHeritage,-0.95,0.00,EUR,RENVOYÉ,",
  "Paiement par carte,Valeur actuelle,2026-01-17 13:16:49,,Anthropic,-21.54,0.00,EUR,EN ATTENTE,",
  "Virement,Dépôt,2026-01-13 11:56:18,2026-01-13 11:56:18,À EUR Compte d'épargne,50.00,0.00,EUR,TERMINÉ,50.00",
  "Intérêts,Dépôt,2026-01-20 05:11:20,2026-01-20 05:11:20,\"Intérêts nets versés pour Compte d&#39;épargne le Jan 20, 2026\",0.01,0.00,EUR,TERMINÉ,50.01",
].join("\n");

const lire = (texte, nom) => M.lireReleve(M.lireCsv(texte), { nomFichier: nom });
let n = 0;
const importer = (etat, releve) => M.appliquer(etat, { ...M.actionImport(releve, "imp" + ++n), id: "act" + n, t: "2026-02-01T10:00:00Z" });
const parCommercant = (etat, mot) => Object.values(etat.operations).filter((o) => M.normaliser(o.libelle).includes(mot));

test("outils : montants, dates, CSV", () => {
  assert.equal(M.centimes("1 010,70"), 101070);
  assert.equal(M.centimes("-174,18"), -17418);
  assert.equal(M.centimes("1,010.70"), 101070);
  assert.equal(M.centimes("0.00"), 0);
  assert.equal(M.dateIso("01/02/26"), "2026-02-01");
  assert.equal(M.dateIso("2026-02-01 12:00:00"), "2026-02-01");
  assert.deepEqual(M.lireCsv('a;"b;c";"d ""e"""\n1;2;3'), [["a", "b;c", 'd "e"'], ["1", "2", "3"]]);
});

test("LCL : soldes, date d'achat, contrôle du relevé", () => {
  const r = lire(LCL, "lcl.csv");
  assert.equal(r.profil, "lcl");
  assert.equal(r.operations.length, 13);
  assert.deepEqual(r.soldes, [{ compte: "lcl-courant", date: "2026-01-31", montant: 43100 }]);
  assert.ok(r.controle.ok, "ouverture + mouvements = clôture");
  const primeur = r.operations.find((o) => o.libelle.includes("PRIMEUR"));
  assert.equal(primeur.date, "2025-12-31");        // date d'achat lue dans le libellé (année précédente)
  assert.equal(primeur.dateValeur, "2026-01-02");
  assert.equal(primeur.commercant, "Primeur Du Coin");
  assert.equal(r.operations.find((o) => o.type === "Retrait DAB").date, "2026-01-14");
  assert.equal(r.operations[0].libelle, "VIR.PERMANENT DUPONT");  // libellé des crédits dans la 6e colonne
});

test("Revolut : comptes séparés, frais déduits, lignes en attente ignorées", () => {
  const r = lire(REVOLUT, "revolut.csv");
  assert.equal(r.profil, "revolut");
  assert.equal(r.operations.length, 7);
  assert.deepEqual(r.ignorees, { "RENVOYÉ": 1, "EN ATTENTE": 1 });
  assert.equal(r.operations.find((o) => o.libelle.includes("Metal")).montant, -999);
  assert.equal(r.operations.filter((o) => o.compte === "revolut-epargne").length, 2);
  assert.ok(r.operations.some((o) => o.libelle.includes("Compte d'épargne le Jan")));  // entité HTML décodée
  assert.deepEqual(r.soldes.find((s) => s.compte === "revolut-courant"), { compte: "revolut-courant", date: "2026-01-15", montant: 12502 });
  assert.deepEqual(r.soldes.find((s) => s.compte === "revolut-epargne"), { compte: "revolut-epargne", date: "2026-01-20", montant: 5001 });
});

test("doublons : réimport sans effet, opérations identiques le même jour conservées", () => {
  const etat = M.etatVide();
  const r1 = importer(etat, lire(LCL));
  assert.equal(r1.ids.length, 13);
  assert.equal(parCommercant(etat, "cafe du parc").length, 2);
  const r2 = importer(etat, lire(LCL));
  assert.equal(r2.ids.length, 0);
  assert.equal(r2.doublons, 13);
  // Fichier qui chevauche : une seule ligne nouvelle
  const plus = LCL.replace("31/01/2026;431,00;;01234 567890A", "01/02/2026;-5;Carte;;CB  CAFE DU PARC     31/01/26;;0;Divers\n01/02/2026;426,00;;01234 567890A");
  assert.equal(importer(etat, lire(plus)).ids.length, 1);
  assert.equal(M.solde(etat, "lcl-courant", "2026-02-02").montant, 42600);
});

test("virements internes : LCL ↔ Revolut et courant ↔ épargne, jamais un retrait d'espèces", () => {
  const etat = M.etatVide();
  importer(etat, lire(LCL));
  importer(etat, lire(REVOLUT));
  const vers = parCommercant(etat, "monrevolut")[0];
  const recu = parCommercant(etat, "paiement envoye par")[0];
  assert.equal(vers.lien, recu.id);
  assert.equal(vers.categorie, M.ID_CATEGORIE.virement);
  assert.equal(vers.nature, "interne");
  const epargne = Object.values(etat.operations).filter((o) => M.normaliser(o.libelle).includes("compte d epargne") && o.montant !== 1);
  assert.ok(epargne.filter((o) => o.type === "Virement").every((o) => o.categorie === M.ID_CATEGORIE.versement && o.lien));
  for (const o of Object.values(etat.operations).filter((x) => /retrait/i.test(x.type + x.libelle) && x.montant === -5000)) assert.notEqual(o.nature, "interne");
  const t = M.totaux(etat, Object.values(etat.operations));
  assert.equal(t.epargne, 5001);  // 50 € versés + 1 centime d'intérêts
});

test("règles de base : le plus précis l'emporte, le sens compte", () => {
  const etat = M.etatVide();
  importer(etat, lire(LCL)); importer(etat, lire(REVOLUT));
  const cat = (mot) => parCommercant(etat, mot)[0].categorie;
  assert.equal(cat("uber eats"), "alimentation-livraison-de-repas");
  assert.equal(cat("uber trip"), "transport-taxi-vtc");
  assert.equal(cat("boulangerie max"), "alimentation-boulangerie");
  assert.equal(cat("cb boulanger 0"), "shopping-electronique");
  assert.equal(cat("mutuelle"), "sante-consultations-medicales");  // contrat T8 : remboursement déduit de la santé
  assert.equal(cat("retrait du"), M.ID_CATEGORIE.especes);
  assert.equal(cat("netflix"), "abonnements-streaming-video");
  assert.equal(cat("frais d abonnement"), "finances-frais-bancaires");
  assert.equal(cat("interets nets"), M.ID_CATEGORIE.interets);
  assert.equal(parCommercant(etat, "employeur")[0].categorie, null);
  assert.ok(parCommercant(etat, "employeur")[0].aValider);
});

test("correction manuelle, règle créée depuis la correction, application aux opérations existantes", () => {
  const etat = M.etatVide();
  importer(etat, lire(LCL));
  const cafes = parCommercant(etat, "cafe du parc");
  M.appliquer(etat, { type: "categoriser", ids: [cafes[0].id], categorie: "alimentation-cafes-et-boissons", id: "c1" });
  assert.equal(etat.operations[cafes[0].id].source, "manuel");
  const regle = M.proposerRegle(etat.operations[cafes[0].id], "alimentation-snacks");
  assert.deepEqual(regle.conditions[0], { champ: "commercant", op: "contient", valeur: "cafe du parc" });
  assert.equal(M.operationsCibles(etat, regle).length, 1, "la correction manuelle n'est pas une cible");
  const r = M.appliquer(etat, { type: "regle", regle, appliquer: true, id: "r1" });
  assert.equal(r.ids.length, 1);
  assert.equal(etat.operations[cafes[0].id].categorie, "alimentation-cafes-et-boissons");
  assert.equal(etat.operations[cafes[1].id].categorie, "alimentation-snacks");
  M.appliquer(etat, { type: "reclasser", id: "r2" });
  assert.equal(etat.operations[cafes[0].id].categorie, "alimentation-cafes-et-boissons");
  assert.equal(etat.journal.length, 4);
});

test("supprimer un import retire ses opérations et délie les virements", () => {
  const etat = M.etatVide();
  importer(etat, lire(LCL));
  const idRevolut = "imp" + (n + 1);
  importer(etat, lire(REVOLUT));
  const vers = parCommercant(etat, "monrevolut")[0];
  assert.ok(vers.lien);
  M.appliquer(etat, { type: "supprimer-import", importId: idRevolut, id: "s1" });
  assert.equal(Object.values(etat.operations).filter((o) => o.compte.startsWith("revolut")).length, 0);
  assert.equal(etat.operations[vers.id].lien, null);
  assert.notEqual(etat.operations[vers.id].nature, "interne");
  assert.equal(etat.config.soldes.filter((s) => s.compte.startsWith("revolut")).length, 0);
});

test("catégories : création, renommage sans toucher aux opérations, fusion", () => {
  const etat = M.etatVide();
  importer(etat, lire(LCL));
  M.appliquer(etat, { type: "categorie", categorie: { id: "alimentation-primeur", groupe: "alimentation", nom: "Primeur" }, id: "k1" });
  const p = parCommercant(etat, "primeur")[0];
  M.appliquer(etat, { type: "categoriser", ids: [p.id], categorie: "alimentation-primeur", id: "k2" });
  M.appliquer(etat, { type: "categorie", categorie: { id: "alimentation-primeur", nom: "Fruits et légumes" }, id: "k3" });
  assert.equal(M.categorie(etat, etat.operations[p.id].categorie).nom, "Fruits et légumes");
  M.appliquer(etat, { type: "fusionner", source: "alimentation-primeur", cible: "alimentation-courses-alimentaires", id: "k4" });
  assert.equal(etat.operations[p.id].categorie, "alimentation-courses-alimentaires");
  assert.ok(M.categorie(etat, "alimentation-primeur").archivee);
  assert.ok(M.chercherCategories(etat, "cafe").some((g) => g.categories.some((c) => c.nom === "Cafés et boissons")));
  assert.ok(M.chercherCategories(etat, "transp")[0].categories.length >= 9, "le nom du groupe montre tout le groupe");
});

test("recherche globale", () => {
  const etat = M.etatVide();
  importer(etat, lire(LCL)); importer(etat, lire(REVOLUT));
  const ops = Object.values(etat.operations);
  const q = (t) => ops.filter(M.compilerRecherche(etat, t));
  assert.equal(q("netflix").length, 1);
  assert.equal(q("14,99").length, 1);
  assert.ok(q(">250").every((o) => Math.abs(o.montant) > 25000));
  assert.equal(q("revolut netflix").length, 1);
  assert.equal(q("lcl netflix").length, 0);
  assert.ok(q("boulangerie").length >= 1);
  assert.ok(q("à valider").every((o) => o.aValider));
  assert.ok(q("31/01").length >= 2);
});

test("soldes : vérifié puis estimé après une saisie", () => {
  const etat = M.etatVide();
  importer(etat, lire(LCL));
  let s = M.solde(etat, "lcl-courant", "2026-02-15");
  assert.equal(s.montant, 43100);
  assert.equal(s.mouvementsDepuis, 0);
  assert.equal(s.statut, "ancien");  // contrat C17 : plus de 3 jours sans information
  assert.ok(s.ancien);
  M.appliquer(etat, { type: "solde", compte: "revolut-epargne", date: "2026-01-01", montant: 1000, id: "x" });
  assert.equal(M.solde(etat, "revolut-epargne", "2026-01-02").montant, 1000);
});

test("fichiers du coffre : aller-retour sans perte", () => {
  const etat = M.etatVide();
  importer(etat, lire(LCL)); importer(etat, lire(REVOLUT));
  const f = JSON.parse(JSON.stringify(M.versFichiers(etat)));
  assert.deepEqual(Object.keys(f).sort(), ["config.json", "imports.json", "journal.json", "operations-2025.json", "operations-2026.json"]);
  const retour = M.depuisFichiers(f);
  assert.deepEqual(retour.operations, JSON.parse(JSON.stringify(etat.operations)));
  assert.equal(retour.imports.length, 2);
  assert.match(M.exporterCsv(retour, Object.values(retour.operations)), /Netflix/);
});

/* ---------------------------------------------------------------- Coffre */
const memoire = () => { const m = new Map(); return { lire: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null), ecrire: async (k, v) => { m.set(k, structuredClone(v)); }, effacer: async (k) => { m.delete(k); }, m }; };
/** Faux GitHub : contents + git/blobs, avec contrôle du sha comme le vrai. */
function fauxGithub() {
  const fichiers = new Map(); let compteur = 0; const appels = [];
  const rep = (statut, corps) => ({ ok: statut < 300, status: statut, json: async () => corps });
  const f = async (url, o = {}) => {
    const chemin = url.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+/, "");
    appels.push((o.method || "GET") + " " + chemin);
    if (chemin === "/contents/") {  // comme le vrai : la racine liste les dossiers comme « dir »
      const racine = [...fichiers].map(([name, v]) => (name.includes("/") ? { name: name.split("/")[0], type: "dir" } : { name, sha: v.sha, type: "file" }));
      return fichiers.size ? rep(200, racine) : rep(404, { message: "This repository is empty." });
    }
    let m;
    if ((m = chemin.match(/^\/git\/blobs\/(.+)$/))) { const v = [...fichiers.values()].find((x) => x.sha === m[1]); return rep(200, { content: v.contenu, encoding: "base64" }); }
    if ((m = chemin.match(/^\/contents\/(.+)$/))) {
      const nom = m[1], corps = JSON.parse(o.body), actuel = fichiers.get(nom);
      if (actuel && !corps.sha && o.method !== "DELETE") return rep(422, { message: "sha wasn't supplied" });
      if (actuel && corps.sha !== actuel.sha) return rep(409, { message: "sha mismatch" });
      if (o.method === "DELETE") { fichiers.delete(nom); return rep(200, {}); }
      const sha = "sha" + ++compteur;
      fichiers.set(nom, { sha, contenu: corps.content });
      return rep(200, { content: { sha } });
    }
    return rep(404, {});
  };
  return { fetch: f, fichiers, appels };
}

test("coffre local : chiffré, rechargé à l'identique, mauvaise clé détectée", async () => {
  const cle = await deriverCle("phrase de test du coffre", 1000);
  const env = await sceller(cle, "bonjour");
  assert.ok(!JSON.stringify(env).includes("bonjour"));
  assert.equal(await ouvrirEnveloppe(cle, env), "bonjour");
  const stockage = memoire();
  const c = new Coffre({ cle, stockage });
  await c.charger();
  await c.faire(M.actionImport(lire(LCL, "lcl.csv"), "i1"));
  assert.ok(![...stockage.m.values()].some((v) => JSON.stringify(v).includes("UBER")), "rien en clair sur l'appareil");
  const c2 = new Coffre({ cle, stockage });
  await c2.charger();
  assert.equal(Object.keys(c2.etat.operations).length, 13);
  const autre = new Coffre({ cle: await deriverCle("une autre phrase", 1000), stockage });
  await assert.rejects(autre.charger(), (e) => e.code === "cle");
});

test("coffre synchronisé : deux appareils, modifications fusionnées, conflit rejoué", async () => {
  const cle = await deriverCle("phrase de test du coffre", 1000);
  const gh = fauxGithub();
  const distant = { jeton: "x", depot: "moi/coffre" };
  const pc = new Coffre({ cle, stockage: memoire(), distant, appareil: "pc", fetch: gh.fetch });
  const tel = new Coffre({ cle, stockage: memoire(), distant, appareil: "tel", fetch: gh.fetch });
  await pc.charger(); await tel.charger();
  await pc.faire(M.actionImport(lire(LCL, "lcl.csv"), "i1"));
  clearTimeout(pc.minuteur);
  assert.equal((await pc.synchroniser()).etat, "pret");
  assert.ok(gh.fichiers.has("operations-2026.json"));
  assert.ok(![...gh.fichiers.values()].some((v) => Buffer.from(v.contenu, "base64").toString().includes("UBER")), "rien en clair sur GitHub");
  // Le téléphone récupère, puis les deux modifient chacun de leur côté avant de synchroniser.
  await tel.synchroniser();
  assert.equal(Object.keys(tel.etat.operations).length, 13);
  const idCafe = parCommercant(tel.etat, "cafe du parc")[0].id;
  await tel.faire({ type: "categoriser", ids: [idCafe], categorie: "alimentation-cafes-et-boissons" });
  await pc.faire(M.actionImport(lire(REVOLUT, "revolut.csv"), "i2"));
  clearTimeout(tel.minuteur); clearTimeout(pc.minuteur);
  await tel.synchroniser();
  const s = await pc.synchroniser();  // conflit sur les fichiers : le PC recharge et rejoue son import
  assert.equal(s.etat, "pret");
  await tel.synchroniser();
  for (const c of [pc, tel]) {
    assert.equal(Object.keys(c.etat.operations).length, 20);
    assert.equal(c.etat.operations[idCafe].categorie, "alimentation-cafes-et-boissons");
    assert.ok(parCommercant(c.etat, "monrevolut")[0].lien);
  }
  assert.ok(gh.appels.some((a) => a.startsWith("PUT")));
});

test("coffre : premier contact avec un dépôt déjà rempli", async () => {
  const cle = await deriverCle("phrase de test du coffre", 1000);
  const gh = fauxGithub();
  const distant = { jeton: "x", depot: "moi/coffre" };
  const a = new Coffre({ cle, stockage: memoire(), distant, fetch: gh.fetch });
  await a.charger(); await a.faire(M.actionImport(lire(LCL), "i1")); clearTimeout(a.minuteur); await a.synchroniser();
  // Un appareil resté hors ligne avec ses propres données
  const b = new Coffre({ cle, stockage: memoire(), distant: null });
  await b.charger(); await b.faire(M.actionImport(lire(REVOLUT), "i2"));
  const b2 = new Coffre({ cle, stockage: b.stockage, distant, fetch: gh.fetch });
  await b2.charger();
  assert.equal((await b2.synchroniser()).etat, "conflit-initial");
  await b2.resoudreConflitInitial("en-ligne");
  assert.equal(Object.keys(b2.etat.operations).length, 13);
});

test("coffre : migration 1 → 2 avec copie de sauvegarde de la version 1 dans le dépôt", async () => {
  const cle = await deriverCle("phrase de test du coffre", 1000);
  const gh = fauxGithub();
  const distant = { jeton: "x", depot: "moi/coffre" };
  // Un coffre écrit par l'ancienne version (1)
  const ancien = M.etatVide();
  M.appliquer(ancien, { ...M.actionImport(lire(LCL), "i1"), id: "a1", t: "2026-02-01T10:00:00Z" });
  const v1 = {};
  for (const [nom, obj] of Object.entries(M.versFichiers(ancien))) {
    obj.version = 1;
    for (const o of obj.operations || []) delete o.imports;
    const env = await sceller(cle, JSON.stringify(obj));
    v1[nom] = env;
    gh.fichiers.set(nom, { sha: "v1-" + nom, contenu: Buffer.from(JSON.stringify(env)).toString("base64") });
  }
  const c = new Coffre({ cle, stockage: memoire(), distant, fetch: gh.fetch });
  await c.charger();
  await c.synchroniser();
  assert.ok(Object.values(c.etat.operations).every((o) => Array.isArray(o.imports)), "migration en mémoire");
  await c.faire({ type: "note", idOp: Object.keys(c.etat.operations)[0], note: "test" });
  clearTimeout(c.minuteur);
  assert.equal((await c.synchroniser()).etat, "pret");
  for (const nom of Object.keys(v1)) {
    const copie = gh.fichiers.get("sauvegarde-v1/" + nom);
    assert.ok(copie, "copie de " + nom);
    assert.deepEqual(JSON.parse(Buffer.from(copie.contenu, "base64").toString()), v1[nom], "copie identique, toujours chiffrée");
  }
  const config = JSON.parse(await ouvrirEnveloppe(cle, JSON.parse(Buffer.from(gh.fichiers.get("config.json").contenu, "base64").toString())));
  assert.equal(config.version, 2);
  // Deuxième synchro : pas de nouvelle copie, rien d'écrasé
  const nb = gh.fichiers.size;
  await c.faire({ type: "note", idOp: Object.keys(c.etat.operations)[0], note: "encore" }); clearTimeout(c.minuteur);
  await c.synchroniser();
  assert.equal(gh.fichiers.size, nb);
});

test("classement par l'IA : seulement les non classées, règles créées pour les réponses sûres", () => {
  const etat = M.etatVide();
  importer(etat, lire(LCL));
  const libres = Object.values(etat.operations).filter((o) => !o.categorie);
  assert.ok(libres.length >= 2);
  const [a, b] = libres;
  const deja = Object.values(etat.operations).find((o) => o.categorie && !o.lien);
  const regle = { ...M.proposerRegle(a, "loisirs-bars"), id: "ia_1", origine: "ia" };
  const res = M.appliquer(etat, { type: "classer-ia", id: "ia", regles: [regle], resultats: [
    { id: a.id, categorie: "loisirs-bars", sur: true },
    { id: b.id, categorie: "divers-depenses-non-classees", sur: false },
    { id: deja.id, categorie: "loisirs-bars", sur: true },     // déjà classée : on n'y touche pas
    { id: "inconnue", categorie: "loisirs-bars", sur: true },
  ] });
  assert.deepEqual(res.ids.sort(), [a.id, b.id].sort());
  assert.equal(etat.operations[a.id].source, "ia");
  assert.equal(etat.operations[a.id].aValider, false);
  assert.equal(etat.operations[b.id].aValider, true);
  assert.notEqual(etat.operations[deja.id].categorie, "loisirs-bars");
  assert.ok(etat.config.regles.some((r) => r.id === "ia_1" && r.origine === "ia"));
  // Reclasser ne défait pas le travail de l'IA
  M.appliquer(etat, { type: "reclasser", id: "rc" });
  assert.equal(etat.operations[b.id].categorie, "divers-depenses-non-classees");
});
