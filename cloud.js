/* Sincronización en la nube con Firebase (solo en la app de GitHub).
   Inicio de sesión con correo y contraseña; el progreso se guarda en
   Firestore en users/{uid}/procop/progress y se fusiona con el del dispositivo. */
(function () {
  const P = window.__procop; if (!P) return;
  const cfg = window.FIREBASE_CONFIG || {};
  const V = "10.12.2", SDK = "https://www.gstatic.com/firebasejs/" + V + "/";
  const css = document.createElement("style");
  css.textContent = `
  .cloudbtn{margin-left:auto;background:rgba(255,255,255,.16);color:var(--red-ink);border:1px solid rgba(255,255,255,.4);border-radius:999px;padding:3px 10px;font:600 .8rem var(--f-body);cursor:pointer;max-width:55vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cloudbtn:focus-visible{outline:2px solid var(--hivis);outline-offset:2px}
  .cl-back{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;display:flex;align-items:flex-start;justify-content:center;padding:calc(60px + env(safe-area-inset-top,0px)) 16px 16px}
  .cl-box{background:var(--panel);color:var(--fg);border-radius:8px;padding:18px;width:100%;max-width:380px;display:flex;flex-direction:column;gap:10px;box-shadow:0 10px 40px rgba(0,0,0,.3)}
  .cl-box input{background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:10px;min-height:44px;font-size:16px;color:var(--fg)}
  .cl-err{color:var(--bad);font-size:.9rem;min-height:1.2em}
  .cl-link{background:none;border:0;color:var(--muted);text-decoration:underline;cursor:pointer;padding:0;font-size:.85rem;align-self:flex-start}`;
  document.head.appendChild(css);
  const brand = document.querySelector(".brand");
  const btn = document.createElement("button"); btn.className = "cloudbtn"; btn.type = "button";
  brand.appendChild(btn);
  const short = e => (e || "").split("@")[0];
  let user = null, ready = false, pushT = null, auth = null, db = null;

  function modal(html, bind) {
    const back = document.createElement("div"); back.className = "cl-back";
    back.innerHTML = `<div class="cl-box" role="dialog" aria-modal="true">${html}</div>`;
    back.addEventListener("click", e => { if (e.target === back) back.remove(); });
    document.body.appendChild(back); bind(back.firstChild, () => back.remove());
    const f = back.querySelector("input,button"); if (f) f.focus();
  }
  const MSG = {
    "auth/invalid-credential": "Correo o contraseña incorrectos.", "auth/wrong-password": "Contraseña incorrecta.",
    "auth/user-not-found": "No hay ninguna cuenta con ese correo. Pulsa \"Crear cuenta\".",
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Pulsa \"Entrar\".",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.", "auth/invalid-email": "El correo no es válido.",
    "auth/network-request-failed": "Sin conexión. Inténtalo cuando tengas internet.", "auth/too-many-requests": "Demasiados intentos. Espera un poco."
  };
  const say = e => MSG[e && e.code] || ("No se ha podido: " + ((e && e.message) || e));

  function draw() {
    if (!cfg.apiKey) { btn.textContent = "☁ Sin configurar"; return; }
    btn.textContent = user ? "☁ " + short(user.email) : "☁ Entrar";
  }
  btn.onclick = () => {
    if (!cfg.apiKey) return modal(`<h3 style="margin:0">Nube sin configurar</h3><p style="margin:0">Falta pegar la configuración de Firebase en <b>firebase-config.js</b> (lo explica el LEEME). Mientras tanto, el progreso se guarda solo en este dispositivo.</p><button class="btn primary" data-x>Entendido</button>`, (b, close) => b.querySelector("[data-x]").onclick = close);
    if (!auth) return;
    if (user) return modal(`<h3 style="margin:0">Tu cuenta</h3><p style="margin:0" class="muted">${user.email}<br>Tu progreso se guarda en la nube y es el mismo en todos tus dispositivos.</p>
      <button class="btn primary" data-s>Sincronizar ahora</button><button class="btn" data-o>Cerrar sesión</button><div class="cl-err"></div>`, (b, close) => {
        b.querySelector("[data-s]").onclick = async () => { await pull(); await push(); close(); };
        b.querySelector("[data-o]").onclick = async () => { await push(); await auth.signOut(); close(); };
      });
    modal(`<h3 style="margin:0">Guardar tu progreso en la nube</h3>
      <p style="margin:0" class="muted">Entra con el mismo correo en el móvil y en el ordenador y tendrás el mismo progreso en los dos.</p>
      <input type="email" id="clE" autocomplete="username" placeholder="Correo">
      <input type="password" id="clP" autocomplete="current-password" placeholder="Contraseña (mínimo 6)">
      <div class="row"><button class="btn primary" data-in>Entrar</button><button class="btn" data-up>Crear cuenta</button></div>
      <button class="cl-link" data-rs>He olvidado la contraseña</button><div class="cl-err"></div>`, (b, close) => {
        const E = b.querySelector("#clE"), Pw = b.querySelector("#clP"), err = b.querySelector(".cl-err");
        const go = fn => async () => { err.textContent = ""; try { await fn(E.value.trim(), Pw.value); close(); } catch (e) { err.textContent = say(e); } };
        b.querySelector("[data-in]").onclick = go((e, p) => auth.signInWithEmailAndPassword(e, p));
        b.querySelector("[data-up]").onclick = go((e, p) => auth.createUserWithEmailAndPassword(e, p));
        Pw.onkeydown = e => { if (e.key === "Enter") b.querySelector("[data-in]").click(); };
        b.querySelector("[data-rs]").onclick = async () => { err.textContent = ""; if (!E.value.trim()) { err.textContent = "Escribe tu correo arriba."; return; }
          try { await auth.sendPasswordResetEmail(E.value.trim()); err.style.color = "var(--ok)"; err.textContent = "Te hemos enviado un correo para cambiarla."; } catch (e) { err.textContent = say(e); } };
      });
  };

  const ref = () => db.doc("users/" + user.uid + "/procop/progress");
  async function pull() {
    if (!user) return;
    try { const s = await ref().get(); if (s.exists) { const d = s.data(); P.merge(JSON.parse(d.json || "{}")); } P.setSync("sincronizado"); }
    catch (e) { P.setSync("sin conexión: guardado en este dispositivo"); }
  }
  async function push() {
    if (!user || !ready) return;
    try { await ref().set({ json: JSON.stringify(P.get()), email: user.email, t: firebase.firestore.FieldValue.serverTimestamp() }); P.setSync("guardado en la nube"); }
    catch (e) { P.setSync("pendiente de subir (sin conexión)"); }
  }
  window.__procopCloud = { onSave() { if (!user || !ready) return; clearTimeout(pushT); pushT = setTimeout(push, 2000); } };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && user && ready) pull(); else if (document.visibilityState === "hidden" && user && ready) push(); });
  window.addEventListener("online", () => { if (user && ready) push(); });

  draw();
  if (!cfg.apiKey) return;
  const load = src => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = SDK + src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  load("firebase-app-compat.js").then(() => Promise.all([load("firebase-auth-compat.js"), load("firebase-firestore-compat.js")])).then(() => {
    firebase.initializeApp(cfg); auth = firebase.auth(); db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    auth.onAuthStateChanged(async u => {
      user = u; ready = false; draw();
      if (!u) { P.setSync("solo en este dispositivo"); return; }
      P.setSync("conectando…"); await pull(); ready = true; await push();
    });
  }).catch(() => { btn.textContent = "☁ Sin conexión"; P.setSync("sin conexión: guardado en este dispositivo"); });
})();
