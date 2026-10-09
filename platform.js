/* PlayerScore · capa de plataforma de la versión web.
   Da a la app lo que antes daba claude.ai, con la misma interfaz que ya usaba
   (collection().onSnapshot, doc().get/set/delete/onSnapshot/acquire):
   - Con config.js rellenado: cuentas de usuario (Supabase Auth) y datos en la nube (tabla "docs"),
     cada usuario con los suyos; los cambios llegan en directo a sus otros dispositivos.
   - Sin config: datos solo en este navegador (IndexedDB), sin cuentas.
   - "downloads": descarga normal de archivos (PDF, Excel, copia de seguridad).
   - "sample" (preguntas con IA): no disponible en la versión web; la app ya lo indica. */
(function () {
  "use strict";
  const CFG = window.PLAYERSCORE_CONFIG || {};
  const CLOUD = !!(CFG.url && CFG.anonKey);
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const colOf = path => path.split("/")[0];
  const err = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };

  /* ---------- avisos de cambios (común) ---------- */
  function makeHub(readCol, readDoc) {
    const colSubs = {}, docSubs = {};
    function emit(path) {
      const col = colOf(path);
      (colSubs[col] || []).forEach(s => Promise.resolve(readCol(col)).then(s.cb, s.err));
      (docSubs[path] || []).forEach(s => Promise.resolve(readDoc(path)).then(s.cb, s.err));
    }
    function emitAll() {
      Object.keys(colSubs).forEach(col => (colSubs[col] || []).forEach(s => Promise.resolve(readCol(col)).then(s.cb, s.err)));
      Object.keys(docSubs).forEach(p => (docSubs[p] || []).forEach(s => Promise.resolve(readDoc(p)).then(s.cb, s.err)));
    }
    function subCol(col, cb, e) {
      const s = { cb, err: e || (() => {}) };
      (colSubs[col] = colSubs[col] || []).push(s);
      Promise.resolve(readCol(col)).then(cb, s.err);
      return () => { colSubs[col] = (colSubs[col] || []).filter(x => x !== s); };
    }
    function subDoc(path, cb, e) {
      const s = { cb, err: e || (() => {}) };
      (docSubs[path] = docSubs[path] || []).push(s);
      Promise.resolve(readDoc(path)).then(cb, s.err);
      return () => { docSubs[path] = (docSubs[path] || []).filter(x => x !== s); };
    }
    return { emit, emitAll, subCol, subDoc };
  }
  function makeDb(hub, ops) {
    function docRef(path) {
      return {
        get: () => ops.get(path),
        set: data => ops.set(path, data),
        delete: () => ops.del(path),
        onSnapshot: (cb, e) => hub.subDoc(path, cb, e),
        /* bloqueo corto que usa el guardado de acciones: el guardado ya relee el servidor antes de escribir */
        acquire: () => Promise.resolve({ acquired: true }),
        release: () => Promise.resolve()
      };
    }
    return {
      doc: docRef,
      collection: col => ({
        doc: id => docRef(col + "/" + id),
        get: () => ops.readCol(col),
        onSnapshot: (cb, e) => hub.subCol(col, cb, e)
      })
    };
  }
  const snapDoc = (path, v) => ({ id: path.split("/").slice(1).join("/"), exists: v !== undefined, data: () => (v === undefined ? undefined : clone(v)) });

  /* =====================================================================
     MODO LOCAL (sin config): IndexedDB en este navegador
     ===================================================================== */
  function localDb() {
    const DB_NAME = "playerscore", STORE = "docs";
    let dbp = null;
    const idb = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
    const quota = e => (e && e.name === "QuotaExceededError") ? err("quota_exceeded") : (e || new Error("db"));
    const tx = (mode, fn) => idb().then(db => new Promise((res, rej) => {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE); let out; const q = fn(st);
      if (q) q.onsuccess = () => { out = q.result; };
      t.oncomplete = () => res(out); t.onerror = () => rej(quota(t.error)); t.onabort = () => rej(quota(t.error));
    }));
    const readCol = col => idb().then(db => new Promise((res, rej) => {
      const t = db.transaction(STORE, "readonly"), st = t.objectStore(STORE), docs = [];
      const c = st.openCursor(IDBKeyRange.bound(col + "/", col + "/￿"));
      c.onsuccess = () => { const cur = c.result; if (!cur) return; docs.push(snapDoc(String(cur.key), cur.value)); cur.continue(); };
      t.oncomplete = () => res({ docs, size: docs.length, empty: !docs.length }); t.onerror = () => rej(t.error);
    }));
    const readDoc = path => tx("readonly", st => st.get(path)).then(v => snapDoc(path, v));
    const hub = makeHub(readCol, readDoc);
    const bc = ("BroadcastChannel" in window) ? new BroadcastChannel("playerscore-db") : null;
    if (bc) bc.onmessage = e => { if (e.data && e.data.path) hub.emit(e.data.path); };
    const changed = path => { hub.emit(path); if (bc) bc.postMessage({ path }); };
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    return idb().then(() => makeDb(hub, {
      get: readDoc, readCol,
      set: (path, data) => tx("readwrite", st => st.put(clone(data), path)).then(() => changed(path)),
      del: path => tx("readwrite", st => st.delete(path)).then(() => changed(path))
    }));
  }

  /* =====================================================================
     MODO NUBE: Supabase (cuentas + tabla docs)
     ===================================================================== */
  let sb = null, user = null;
  const T = "docs";
  const netErr = e => {
    const m = String((e && (e.message || e.details)) || "");
    if (!e || /fetch|network|timeout|Load failed|NetworkError/i.test(m) || e.status === 0) return err("unavailable", m);
    if (/disk|quota|exceed|too large|payload/i.test(m)) return err("quota_exceeded", m);
    return err("error", m);
  };

  function cloudDb() {
    const cache = new Map();             // path -> data (todo lo del usuario)
    const recent = {};                   // path -> [{j, t}] lo que acabamos de escribir (para ignorar su eco en directo)
    const mark = (path, j) => { const now = Date.now(); recent[path] = (recent[path] || []).filter(x => now - x.t < 15000); recent[path].push({ j, t: now }); };
    const isEcho = (path, j) => (recent[path] || []).some(x => x.j === j && Date.now() - x.t < 15000);
    const readCol = col => {
      const docs = []; const pre = col + "/";
      cache.forEach((v, k) => { if (k.startsWith(pre)) docs.push(snapDoc(k, v)); });
      return { docs, size: docs.length, empty: !docs.length };
    };
    const readDoc = path => snapDoc(path, cache.has(path) ? cache.get(path) : undefined);
    const hub = makeHub(readCol, readDoc);

    async function loadAll() {
      const all = new Map(); const N = 1000;
      for (let from = 0; ; from += N) {
        const { data, error } = await sb.from(T).select("path,data").order("path").range(from, from + N - 1);
        if (error) throw netErr(error);
        (data || []).forEach(r => all.set(r.path, r.data));
        if (!data || data.length < N) break;
      }
      return all;
    }
    async function refresh() {
      try { const all = await loadAll(); cache.clear(); all.forEach((v, k) => cache.set(k, v)); hub.emitAll(); } catch (e) {}
    }

    function live() {
      sb.channel("docs-" + user.id)
        .on("postgres_changes", { event: "*", schema: "public", table: T, filter: "user_id=eq." + user.id }, p => {
          if (p.eventType === "DELETE") {
            const path = p.old && p.old.path; if (!path) return;
            if (isEcho(path, "null")) return;
            if (cache.has(path)) { cache.delete(path); hub.emit(path); }
          } else {
            const r = p.new || {}; if (!r.path) return;
            const j = JSON.stringify(r.data);
            if (isEcho(r.path, j) || JSON.stringify(cache.get(r.path)) === j) return;
            cache.set(r.path, r.data); hub.emit(r.path);
          }
        })
        .subscribe(st => { if (st === "SUBSCRIBED" && live.started) refresh(); live.started = true; });
      /* al volver a la pestaña o recuperar la conexión, se recarga todo por si se perdió algún cambio */
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
      window.addEventListener("online", refresh);
    }

    async function retry(fn) {
      try { return await fn(); }
      catch (e) { if (e && e.code === "unavailable") { await new Promise(r => setTimeout(r, 800)); return fn(); } throw e; }
    }
    const ops = {
      readCol,
      get: path => retry(async () => {
        const { data, error } = await sb.from(T).select("data").eq("path", path).maybeSingle();
        if (error) throw netErr(error);
        const v = data ? data.data : undefined;
        if (v === undefined) cache.delete(path); else cache.set(path, v);
        return snapDoc(path, v);
      }),
      set: async (path, data) => {
        const v = clone(data); const j = JSON.stringify(v);
        mark(path, j); cache.set(path, v); hub.emit(path);
        const { error } = await sb.from(T).upsert({ user_id: user.id, path, data: v }, { onConflict: "user_id,path" });
        if (error) throw netErr(error);
      },
      del: async path => {
        mark(path, "null"); cache.delete(path); hub.emit(path);
        const { error } = await sb.from(T).delete().eq("user_id", user.id).eq("path", path);
        if (error) throw netErr(error);
      }
    };
    return loadAll().then(all => { all.forEach((v, k) => cache.set(k, v)); live(); return makeDb(hub, ops); });
  }

  /* ---------- pantalla de cuenta ---------- */
  const CSS = `
  .ps-auth{position:fixed;inset:0;z-index:100;background:var(--bg,#EEF2EE);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}
  .ps-auth .box{width:min(400px,100%);background:var(--surface,#fff);border:1px solid var(--line,#D3DCD5);border-radius:14px;padding:22px 20px;display:flex;flex-direction:column;gap:12px;color:var(--ink,#15201A)}
  .ps-auth h1{font-family:var(--display,system-ui);font-size:34px;font-weight:700;margin:0;line-height:1}
  .ps-auth p{margin:0}
  .ps-auth .sub{color:var(--muted,#58675D);font-size:14px}
  .ps-auth label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:var(--muted,#58675D)}
  .ps-auth input{font:inherit;font-size:16px;color:var(--ink,#15201A);background:var(--surface,#fff);border:1px solid var(--line,#D3DCD5);border-radius:8px;padding:9px 10px}
  .ps-auth .go{font:inherit;font-weight:600;font-size:16px;background:var(--accent,#1D6A42);color:var(--accent-ink,#fff);border:0;border-radius:8px;padding:10px;cursor:pointer}
  .ps-auth .go[disabled]{opacity:.6;cursor:default}
  .ps-auth .lnk{background:none;border:0;padding:0;font:inherit;font-size:14px;color:var(--accent,#1D6A42);cursor:pointer;text-decoration:underline;text-underline-offset:3px;align-self:flex-start}
  .ps-auth .msg{font-size:14px;border-radius:8px;padding:8px 10px;background:var(--warn-soft,#F7ECD3);color:var(--warn,#9A6A0B)}
  .ps-auth .ok{background:var(--accent-soft,#DDEEE3);color:var(--ink,#15201A)}
  .ps-acct{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted,#58675D);min-width:0}
  .ps-acct span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
  .ps-acct button{font:inherit;font-size:13px;border:1px solid var(--line,#D3DCD5);background:var(--surface,#fff);color:var(--ink,#15201A);border-radius:8px;padding:4px 9px;cursor:pointer}`;
  function addCss() { if (document.getElementById("ps-css")) return; const s = document.createElement("style"); s.id = "ps-css"; s.textContent = CSS; document.head.appendChild(s); }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const here = () => location.origin + location.pathname;
  const authMsg = e => {
    const m = String((e && e.message) || "");
    if (/invalid login/i.test(m)) return "Correo o contraseña incorrectos.";
    if (/not confirmed/i.test(m)) return "Tienes que confirmar la cuenta con el correo que te enviamos.";
    if (/already registered|already been registered/i.test(m)) return "Ya hay una cuenta con ese correo. Entra con tu contraseña.";
    if (/password.*(at least|short)/i.test(m)) return "La contraseña es demasiado corta (mínimo 6 caracteres).";
    if (/rate limit|too many/i.test(m)) return "Demasiados intentos. Espera unos minutos y vuelve a probar.";
    if (/not authorized|email address/i.test(m)) return "No se ha podido enviar el correo a esa dirección.";
    if (/fetch|network/i.test(m)) return "No hay conexión. Revisa internet y vuelve a probar.";
    return "No se ha podido completar. Vuelve a intentarlo.";
  };

  let overlay = null;
  function showAuth(mode, note) {
    addCss();
    if (!overlay) { overlay = document.createElement("div"); overlay.className = "ps-auth"; document.body.appendChild(overlay); }
    const T2 = {
      in: ["Entra en tu cuenta", "Entrar"], up: ["Crea tu cuenta", "Crear cuenta"],
      forgot: ["Recuperar contraseña", "Enviar enlace"], reset: ["Nueva contraseña", "Guardar contraseña"]
    }[mode];
    overlay.innerHTML = `<form class="box" novalidate>
      <h1>PlayerScore</h1><p class="sub">${T2[0]}</p>
      ${note ? `<p class="msg ${note.ok ? "ok" : ""}" role="status">${esc(note.t)}</p>` : ""}
      ${mode !== "reset" ? `<label>Correo<input type="email" name="email" autocomplete="email" required></label>` : ""}
      ${mode !== "forgot" ? `<label>${mode === "reset" ? "Nueva contraseña" : "Contraseña"}<input type="password" name="pw" minlength="6" autocomplete="${mode === "in" ? "current-password" : "new-password"}" required></label>` : ""}
      <button class="go" type="submit">${T2[1]}</button>
      ${mode === "in" ? `<button class="lnk" type="button" data-m="up">¿No tienes cuenta? Crear una</button><button class="lnk" type="button" data-m="forgot">¿Has olvidado la contraseña?</button>` : ""}
      ${mode === "up" || mode === "forgot" ? `<button class="lnk" type="button" data-m="in">Ya tengo cuenta: entrar</button>` : ""}
    </form>`;
    const f = overlay.querySelector("form");
    overlay.querySelectorAll("[data-m]").forEach(b => b.onclick = () => showAuth(b.dataset.m));
    const first = f.querySelector("input"); if (first) first.focus();
    f.onsubmit = async ev => {
      ev.preventDefault();
      const email = (f.email && f.email.value.trim()) || "", pw = (f.pw && f.pw.value) || "";
      if (mode !== "reset" && !/^\S+@\S+\.\S+$/.test(email)) return showAuth(mode, { t: "Escribe un correo válido." });
      if (mode !== "forgot" && pw.length < 6) return showAuth(mode, { t: "La contraseña tiene que tener al menos 6 caracteres." });
      const go = f.querySelector(".go"); go.disabled = true;
      try {
        if (mode === "in") { const { error } = await sb.auth.signInWithPassword({ email, password: pw }); if (error) throw error; }
        else if (mode === "up") {
          const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: here() } });
          if (error) throw error;
          if (data && data.user && Array.isArray(data.user.identities) && !data.user.identities.length) return showAuth("in", { t: "Ya hay una cuenta con ese correo. Entra con tu contraseña." });
          if (!data.session) return showAuth("in", { ok: true, t: "Cuenta creada. Te hemos enviado un correo para confirmarla; después entra aquí." });
        }
        else if (mode === "forgot") {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here() }); if (error) throw error;
          return showAuth("in", { ok: true, t: "Si hay una cuenta con ese correo, te llegará un enlace para poner una contraseña nueva." });
        }
        else if (mode === "reset") {
          const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error;
          recovering = false; history.replaceState(null, "", here());
          if (authWait) authWait(); else hideAuth();
        }
      } catch (e) { showAuth(mode, { t: authMsg(e) }); }
    };
  }
  function hideAuth() { if (overlay) { overlay.remove(); overlay = null; } }
  function showLoading(t, retryFn) {
    addCss();
    if (!overlay) { overlay = document.createElement("div"); overlay.className = "ps-auth"; document.body.appendChild(overlay); }
    overlay.innerHTML = `<div class="box"><h1>PlayerScore</h1><p class="sub">${esc(t)}</p>${retryFn ? `<button class="go" type="button">Reintentar</button><button class="lnk" type="button" data-out>Salir de la cuenta</button>` : ""}</div>`;
    if (retryFn) { overlay.querySelector(".go").onclick = retryFn; overlay.querySelector("[data-out]").onclick = signOut; }
  }
  function signOut() { sb.auth.signOut().finally(() => location.replace(here())); }
  function accountBar() {
    addCss();
    const put = () => {
      const h = document.querySelector("header.top"); if (!h || document.getElementById("ps-acct")) return;
      const d = document.createElement("div"); d.id = "ps-acct"; d.className = "ps-acct";
      d.innerHTML = `<span title="${esc(user.email || "")}">${esc(user.email || "")}</span><button type="button">Salir</button>`;
      d.querySelector("button").onclick = signOut; h.appendChild(d);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", put); else put();
  }

  let recovering = /type=recovery/.test(location.hash + location.search), authWait = null;
  function waitForUser() {
    return new Promise(resolve => {
      const done = s => { if (s && s.user && !recovering) { user = s.user; authWait = null; hideAuth(); resolve(); } };
      authWait = () => sb.auth.getSession().then(r => done(r.data.session));
      sb.auth.onAuthStateChange((ev, s) => {
        if (ev === "PASSWORD_RECOVERY") { recovering = true; showAuth("reset"); return; }
        if (ev === "SIGNED_OUT" && user) { location.replace(here()); return; }
        if (s && s.user && user && s.user.id !== user.id) { location.replace(here()); return; } // otra cuenta en otra pestaña
        if (!user) done(s);
      });
      sb.auth.getSession().then(r => {
        const s = r.data.session;
        if (recovering && s) showAuth("reset");
        else if (s) done(s);
        else if (/error_description=/.test(location.hash + location.search)) { history.replaceState(null, "", here()); showAuth("in", { t: "El enlace del correo no es válido o ha caducado. Vuelve a pedirlo." }); }
        else if (!/access_token|code=/.test(location.hash + location.search)) showAuth("in");
      }).catch(() => showAuth("in", { t: "No hay conexión. Revisa internet y vuelve a probar." }));
    });
  }

  let cloudP = null;
  function cloud() {
    if (cloudP) return cloudP;
    cloudP = new Promise(resolve => {
      const start = async () => {
        if (!window.supabase || !window.supabase.createClient) { showLoading("No se ha podido cargar la conexión con el servidor.", () => location.reload()); return; }
        sb = sb || window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
        await waitForUser();
        const load = async () => {
          showLoading("Cargando tus datos…");
          try { const db = await cloudDb(); hideAuth(); accountBar(); resolve(db); }
          catch (e) { showLoading("No se han podido cargar tus datos. Revisa la conexión.", load); }
        };
        load();
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
    });
    return cloudP;
  }

  /* ---------- descargas ---------- */
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

  window.PlayerScorePlatform = {
    mode: CLOUD ? "cloud" : "local",
    use(name) {
      if (name === "db") {
        if (CLOUD) return cloud();
        return ("indexedDB" in window) ? localDb().catch(() => null) : Promise.resolve(null);
      }
      if (name === "downloads") return Promise.resolve(downloads);
      return Promise.resolve(null);
    }
  };
  /* en modo nube, la pantalla de entrada sale nada más abrir la web */
  if (CLOUD) cloud();
})();
