/* PLOUTOS : le coffre. Les données sont chiffrées (AES-256-GCM, après compression) avant de quitter la mémoire :
   sur l'appareil (IndexedDB) comme sur GitHub (dépôt privé). Toute modification est une « action » rejouable :
   si un autre appareil a enregistré entre-temps, on repart de sa version et on rejoue les actions en attente.
   Fonctionne dans le navigateur (window.PloutosCoffre) et sous Node pour les tests. */
(function (racine) {
"use strict";
// Le moteur est lu au moment de l'usage : les deux scripts peuvent se charger dans n'importe quel ordre.
let moteur = null;
const M = new Proxy({}, { get: (_, k) => (moteur ||= racine.PloutosMoteur || (typeof require === "function" ? require("./ploutos-moteur.js") : null))[k] });
const subtle = (racine.crypto || (typeof require === "function" ? require("crypto").webcrypto : null)).subtle;
const ITERATIONS = 600000;

/* ---------------------------------------------------------------- Chiffrement */
function enBase64(octets) {
  let s = "";
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  return btoa(s);
}
const depuisBase64 = (b64) => Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
async function flux(octets, transformation) {
  const r = new Response(new Blob([octets]).stream().pipeThrough(transformation));
  return new Uint8Array(await r.arrayBuffer());
}
const compressionDispo = typeof CompressionStream === "function";

/** Clé du coffre : tirée de la phrase secrète NEXUS, avec un sel propre à PLOUTOS. Non exportable. */
async function deriverCle(motDePasse, iterations = ITERATIONS) {
  const sel = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode("ploutos-coffre|" + motDePasse))).slice(0, 16);
  const brut = await subtle.importKey("raw", new TextEncoder().encode(motDePasse), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: sel, iterations }, brut, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function sceller(cle, texte) {
  let octets = new TextEncoder().encode(texte);
  const z = compressionDispo;
  if (z) octets = await flux(octets, new CompressionStream("gzip"));
  const iv = (racine.crypto || require("crypto").webcrypto).getRandomValues(new Uint8Array(12));
  const chiffre = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, cle, octets));
  return { v: 1, z, iv: enBase64(iv), donnees: enBase64(chiffre) };
}
async function ouvrirEnveloppe(cle, env) {
  let octets = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: depuisBase64(env.iv) }, cle, depuisBase64(env.donnees)));
  if (env.z) octets = await flux(octets, new DecompressionStream("gzip"));
  return new TextDecoder().decode(octets);
}

/* ---------------------------------------------------------------- GitHub (dépôt privé du coffre) */
class ErreurGithub extends Error {
  constructor(message, statut) { super(message); this.statut = statut; }
}
function github({ jeton, depot }, fetchFn) {
  const base = `https://api.github.com/repos/${depot}`;
  const appel = async (chemin, options = {}) => {
    let r;
    try {
      r = await fetchFn(base + chemin, { ...options, headers: { authorization: "Bearer " + jeton, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(options.body ? { "content-type": "application/json" } : {}) } });
    } catch { throw new ErreurGithub("Pas de connexion.", 0); }
    if (r.ok) return r.status === 204 ? null : r.json();
    let message = "";
    try { message = (await r.json()).message || ""; } catch {}
    if (r.status === 404 && /empty/i.test(message)) return null;
    throw new ErreurGithub(message || "GitHub a répondu " + r.status, r.status);
  };
  return {
    async lister() {
      const r = await appel("/contents/");
      const res = {};
      for (const f of r || []) if (f.type === "file" && f.name.endsWith(".json")) res[f.name] = f.sha;
      return res;
    },
    async lire(sha) { const r = await appel("/git/blobs/" + sha); return new TextDecoder().decode(depuisBase64(r.content)); },
    async ecrire(nom, texte, sha, message) {
      const r = await appel("/contents/" + nom, { method: "PUT", body: JSON.stringify({ message, content: btoa(texte), ...(sha ? { sha } : {}) }) });
      return r.content.sha;
    },
    async supprimer(nom, sha, message) { await appel("/contents/" + nom, { method: "DELETE", body: JSON.stringify({ message, sha }) }); },
  };
}

/* ---------------------------------------------------------------- Le coffre */
const versionDe = (clair) => { try { return JSON.parse(clair).version || 1; } catch { return 1; } };
const ORDRE = (nom) => (nom.startsWith("operations-") ? 0 : nom === "config.json" ? 1 : nom === "imports.json" ? 2 : 3);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

class Coffre {
  /**
   * @param {object} o
   * @param {CryptoKey} o.cle clé du coffre
   * @param {{lire:Function, ecrire:Function, effacer:Function}} o.stockage stockage local (IndexedDB dans le navigateur)
   * @param {{jeton:string, depot:string}|null} o.distant dépôt GitHub privé, ou null (coffre local seulement)
   */
  constructor({ cle, stockage, distant = null, appareil = "appareil", fetch: fetchFn = (racine.fetch || null) && racine.fetch.bind(racine) }) {
    this.cle = cle; this.stockage = stockage; this.appareil = appareil;
    this.gh = distant ? github(distant, fetchFn) : null;
    this.base = {};       // nom → { sha, clair, env } : dernière version connue du dépôt (ou version locale sans dépôt)
    this.attente = [];    // actions pas encore envoyées
    this.etat = null;
    this.statut = { etat: "ferme", derniere: null, erreur: null };
    this.ecouteurs = new Set();
    this.synchroEnCours = null;
  }
  get local() { return !this.gh; }
  surChangement(f) { this.ecouteurs.add(f); return () => this.ecouteurs.delete(f); }
  signaler() { for (const f of this.ecouteurs) { try { f(this); } catch (e) { console.error(e); } } }

  async charger() {
    const base = (await this.stockage.lire("base")) || {};
    this.base = {};
    const fichiers = {};
    try {
      for (const [nom, f] of Object.entries(base)) {
        if (!f.env) continue;
        const clair = await ouvrirEnveloppe(this.cle, f.env);
        this.base[nom] = { sha: f.sha || null, clair, env: f.env };
        fichiers[nom] = JSON.parse(clair);
      }
      const att = await this.stockage.lire("attente");
      this.attente = att ? JSON.parse(await ouvrirEnveloppe(this.cle, att)) : [];
    } catch (e) {
      const err = new Error("Le coffre de cet appareil a été chiffré avec une autre phrase secrète.");
      err.code = "cle"; throw err;
    }
    this.jamaisSynchro = (await this.stockage.lire("jamaisSynchro")) ?? true;
    this.etat = M.depuisFichiers(fichiers);
    for (const a of this.attente) M.appliquer(this.etat, a);
    this.statut = { ...this.statut, etat: this.local ? "local" : "pret", derniere: (await this.stockage.lire("derniereSynchro")) || null };
    return this.etat;
  }

  /** Applique une action, la garde en attente (chiffrée) et lance l'envoi. */
  async faire(action) {
    const a = { id: uid(), t: new Date().toISOString(), appareil: this.appareil, ...action };
    const res = M.appliquer(this.etat, a);
    this.attente.push(a);
    if (this.local) await this.compacter(); else await this.garderAttente();
    this.signaler();
    if (!this.local) this.planifier();
    return res;
  }
  async garderAttente() { await this.stockage.ecrire("attente", await sceller(this.cle, JSON.stringify(this.attente))); }

  /** Sans dépôt : l'état courant devient la base locale (pas d'historique à rejouer). */
  async compacter() {
    // Coffre local d'une version antérieure : copie intégrale gardée sur l'appareil avant la première réécriture.
    if (Object.values(this.base).some((f) => f.clair && versionDe(f.clair) < M.VERSION) && !(await this.stockage.lire("sauvegardeLocale"))) {
      const brut = {};
      for (const [nom, f] of Object.entries(this.base)) if (f.env) brut[nom] = { sha: f.sha, env: f.env };
      await this.stockage.ecrire("sauvegardeLocale", { t: new Date().toISOString(), base: brut });
    }
    const nouveaux = M.versFichiers(this.etat);
    const base = {};
    for (const [nom, obj] of Object.entries(nouveaux)) {
      const clair = JSON.stringify(obj);
      const ancien = this.base[nom];
      base[nom] = ancien && ancien.clair === clair ? ancien : { sha: ancien?.sha || null, clair, env: await sceller(this.cle, clair) };
    }
    this.base = base; this.attente = [];
    await this.garderBase(); await this.garderAttente();
  }
  async garderBase() {
    const brut = {};
    for (const [nom, f] of Object.entries(this.base)) if (f.env) brut[nom] = { sha: f.sha, env: f.env };
    await this.stockage.ecrire("base", brut);
  }

  planifier(delai = 1200) {
    clearTimeout(this.minuteur);
    this.minuteur = setTimeout(() => this.synchroniser().catch(() => {}), delai);
  }

  /** Récupère les nouveautés du dépôt, rejoue les actions en attente, envoie le résultat. */
  synchroniser() {
    if (!this.gh) return Promise.resolve(this.statut);
    if (this.synchroEnCours) return this.synchroEnCours.then(() => (this.attente.length ? this.synchroniser() : this.statut));
    this.synchroEnCours = this._synchroniser().finally(() => { this.synchroEnCours = null; this.signaler(); });
    return this.synchroEnCours;
  }
  async _synchroniser() {
    this.statut = { ...this.statut, etat: "synchro", erreur: null }; this.signaler();
    try {
      for (let essai = 0; essai < 4; essai++) {
        const distant = await this.gh.lister();
        // Premier contact : cet appareil a des données jamais envoyées et le dépôt n'est pas vide → Louis choisit.
        const localNonVide = Object.keys(this.etat.operations).length > 0 && Object.values(this.base).every((f) => !f.sha);
        if (this.jamaisSynchro && localNonVide && Object.keys(distant).length) {
          this.statut = { ...this.statut, etat: "conflit-initial" };
          return this.statut;
        }
        let change = false;
        for (const [nom, sha] of Object.entries(distant)) {
          if (this.base[nom]?.sha === sha) continue;
          const envTexte = await this.gh.lire(sha);
          const env = JSON.parse(envTexte);
          const clair = await ouvrirEnveloppe(this.cle, env).catch(() => { const e = new Error("Le coffre en ligne est chiffré avec une autre phrase secrète."); e.code = "cle"; throw e; });
          this.base[nom] = { sha, clair, env };
          change = true;
        }
        for (const nom of Object.keys(this.base)) if (this.base[nom].sha && !(nom in distant)) { delete this.base[nom]; change = true; }
        if (change) {
          const fichiers = {};
          for (const [nom, f] of Object.entries(this.base)) fichiers[nom] = JSON.parse(f.clair);
          this.etat = M.depuisFichiers(fichiers);
          for (const a of this.attente) M.appliquer(this.etat, a);
          await this.garderBase();
        }
        const nouveaux = Object.fromEntries(Object.entries(M.versFichiers(this.etat)).map(([n, o]) => [n, JSON.stringify(o)]));
        const aEnvoyer = Object.keys(nouveaux).filter((n) => !this.base[n] || !this.base[n].sha || this.base[n].clair !== nouveaux[n]).sort((a, b) => ORDRE(a) - ORDRE(b));
        const aRetirer = Object.keys(this.base).filter((n) => this.base[n].sha && !(n in nouveaux));
        const message = `PLOUTOS : mise à jour du coffre (${this.appareil})`;
        if (aEnvoyer.length) await this.sauvegarderAnciennes(distant);
        try {
          for (const nom of aEnvoyer) {
            const env = await sceller(this.cle, nouveaux[nom]);
            const sha = await this.gh.ecrire(nom, JSON.stringify(env), distant[nom] || undefined, message);
            this.base[nom] = { sha, clair: nouveaux[nom], env };
            await this.garderBase();
          }
          for (const nom of aRetirer) { await this.gh.supprimer(nom, this.base[nom].sha, message); delete this.base[nom]; await this.garderBase(); }
        } catch (e) {
          if (e.statut === 409 || e.statut === 422) continue;  // quelqu'un a écrit entre-temps : on recommence
          throw e;
        }
        this.attente = []; this.jamaisSynchro = false;
        await this.garderAttente(); await this.stockage.ecrire("jamaisSynchro", false);
        const derniere = new Date().toISOString();
        await this.stockage.ecrire("derniereSynchro", derniere);
        this.statut = { etat: "pret", derniere, erreur: null, envoyes: aEnvoyer.length, recus: change };
        return this.statut;
      }
      throw new ErreurGithub("Le coffre change trop souvent sur un autre appareil. Réessaie dans un instant.", 409);
    } catch (e) {
      const horsLigne = e.statut === 0;
      this.statut = { ...this.statut, etat: horsLigne ? "hors-ligne" : "erreur", erreur: e.code === "cle" ? e.message
        : e.statut === 401 || e.statut === 403 || e.statut === 404 ? "GitHub refuse l'accès au coffre : vérifie le jeton PLOUTOS_TOKEN et le dépôt ploutos-coffre." : e.message, code: e.code };
      return this.statut;
    }
  }

  /** Avant le premier envoi au format actuel, les fichiers d'une version antérieure sont copiés tels quels
   *  (toujours chiffrés) dans « sauvegarde-v<N>/ » du dépôt : la migration n'écrase jamais rien sans copie. */
  async sauvegarderAnciennes(distant) {
    const anciens = Object.entries(this.base).filter(([nom, f]) => f.sha && f.env && f.clair && versionDe(f.clair) < M.VERSION && distant[nom]);
    if (!anciens.length) return;
    const fait = new Set((await this.stockage.lire("sauvegardes")) || []);
    for (const [nom, f] of anciens) {
      const cible = `sauvegarde-v${versionDe(f.clair)}/${nom}`;
      if (fait.has(cible)) continue;
      try { await this.gh.ecrire(cible, JSON.stringify(f.env), undefined, `PLOUTOS : copie de sauvegarde avant migration (${nom})`); }
      catch (e) { if (e.statut !== 422) throw e; }  // 422 : la copie existe déjà (faite depuis un autre appareil)
      fait.add(cible);
      await this.stockage.ecrire("sauvegardes", [...fait]);
    }
  }

  /** Premier contact avec un dépôt déjà rempli : garder la version en ligne, ou la remplacer par cet appareil. */
  async resoudreConflitInitial(choix) {
    if (choix === "en-ligne") { this.base = {}; this.attente = []; this.etat = M.etatVide(); }
    else {  // cet appareil gagne : on adopte les sha distants pour pouvoir écraser
      const distant = await this.gh.lister();
      for (const [nom, sha] of Object.entries(distant)) this.base[nom] = { sha, clair: null, env: null };
    }
    this.jamaisSynchro = false;
    await this.stockage.ecrire("jamaisSynchro", false);
    if (choix === "en-ligne") await this.garderBase();
    return this.synchroniser();
  }

  /** Change la clé (phrase secrète modifiée) : tout est rechiffré avec la nouvelle clé puis renvoyé. */
  async rechiffrer(nouvelleCle) {
    this.cle = nouvelleCle;
    for (const f of Object.values(this.base)) { f.env = await sceller(this.cle, f.clair); f.sha = f.sha || null; }
    for (const f of Object.values(this.base)) f.clair = f.clair + " ";  // force l'envoi de chaque fichier
    await this.garderBase(); await this.garderAttente();
    if (this.local) await this.compacter();
    else await this.synchroniser();
  }

  /** Sauvegarde complète en clair, pour l'export. */
  exporter() {
    const { _index, _v, ...etat } = this.etat;
    return { format: "ploutos", version: M.VERSION, exporte: new Date().toISOString(), ...etat, operations: Object.values(etat.operations) };
  }
}

const API = { Coffre, deriverCle, sceller, ouvrirEnveloppe, ErreurGithub, ITERATIONS };
if (typeof module !== "undefined" && module.exports) module.exports = API;
else racine.PloutosCoffre = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
