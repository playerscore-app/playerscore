/* PlayerScore · capa de plataforma para la versión web.
   Sustituye a lo que daba claude.ai (base de datos, descargas) con lo que tiene el propio navegador:
   - "db": base de datos local (IndexedDB) con la misma interfaz que usaba la app
     (collection().onSnapshot, doc().get/set/delete/onSnapshot/acquire).
     Los datos se quedan en este navegador; las pestañas abiertas se sincronizan entre sí.
   - "downloads": descarga de archivos (PDF, Excel, copia de seguridad) con un enlace normal.
   - "sample" (preguntas con IA): no disponible en la versión web; la app ya lo indica.
   No usa servicios externos. */
(function () {
  "use strict";
  const DB_NAME = "playerscore", STORE = "docs";
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function tx(mode, fn) {
    return idb().then(db => new Promise((res, rej) => {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
      let out; const q = fn(st);
      if (q) q.onsuccess = () => { out = q.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(quota(t.error));
      t.onabort = () => rej(quota(t.error));
    }));
  }
  function quota(e) {
    if (e && e.name === "QuotaExceededError") { const x = new Error("quota"); x.code = "quota_exceeded"; return x; }
    return e || new Error("db");
  }
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const colOf = path => path.split("/")[0];

  /* lectura de una colección entera: claves "col/id" */
  function readCol(col) {
    return idb().then(db => new Promise((res, rej) => {
      const t = db.transaction(STORE, "readonly"), st = t.objectStore(STORE);
      const range = IDBKeyRange.bound(col + "/", col + "/￿");
      const docs = [];
      const c = st.openCursor(range);
      c.onsuccess = () => { const cur = c.result; if (!cur) return;
        const v = cur.value, id = String(cur.key).slice(col.length + 1);
        docs.push({ id, exists: true, data: () => clone(v) }); cur.continue(); };
      t.oncomplete = () => res({ docs, size: docs.length, empty: !docs.length });
      t.onerror = () => rej(t.error);
    }));
  }
  function readDoc(path) {
    return tx("readonly", st => st.get(path)).then(v => ({
      id: path.split("/").slice(1).join("/"), exists: v !== undefined, data: () => (v === undefined ? undefined : clone(v))
    }));
  }

  /* avisos de cambios: en esta pestaña y en las demás */
  const colSubs = {}, docSubs = {};
  const bc = ("BroadcastChannel" in window) ? new BroadcastChannel("playerscore-db") : null;
  function emit(path) {
    const col = colOf(path);
    (colSubs[col] || []).forEach(s => readCol(col).then(s.cb, s.err));
    (docSubs[path] || []).forEach(s => readDoc(path).then(s.cb, s.err));
  }
  if (bc) bc.onmessage = e => { if (e.data && e.data.path) emit(e.data.path); };
  function changed(path) { emit(path); if (bc) bc.postMessage({ path }); }

  function docRef(path) {
    return {
      get: () => readDoc(path),
      set: data => tx("readwrite", st => st.put(clone(data), path)).then(() => changed(path)),
      delete: () => tx("readwrite", st => st.delete(path)).then(() => changed(path)),
      onSnapshot(cb, err) {
        const s = { cb, err: err || (() => {}) };
        (docSubs[path] = docSubs[path] || []).push(s);
        readDoc(path).then(cb, s.err);
        return () => { docSubs[path] = (docSubs[path] || []).filter(x => x !== s); };
      },
      /* bloqueo corto (lo usa el guardado de acciones). Con un solo navegador basta con concederlo. */
      acquire: () => Promise.resolve({ acquired: true }),
      release: () => Promise.resolve()
    };
  }
  const db = {
    doc: docRef,
    collection(col) {
      return {
        doc: id => docRef(col + "/" + id),
        get: () => readCol(col),
        onSnapshot(cb, err) {
          const s = { cb, err: err || (() => {}) };
          (colSubs[col] = colSubs[col] || []).push(s);
          readCol(col).then(cb, s.err);
          return () => { colSubs[col] = (colSubs[col] || []).filter(x => x !== s); };
        }
      };
    }
  };

  const downloads = {
    save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename || "archivo"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return Promise.resolve();
    }
  };

  /* pide al navegador que no borre los datos por falta de espacio */
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  window.PlayerScorePlatform = {
    use(name) {
      if (name === "db") return ("indexedDB" in window) ? idb().then(() => db).catch(() => null) : Promise.resolve(null);
      if (name === "downloads") return Promise.resolve(downloads);
      return Promise.resolve(null);
    }
  };
})();
