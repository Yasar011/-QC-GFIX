// =====================================================================
// Brandix QMS — Application entry point & router
// Username/password login (credentials stored in the DB). Mounts the
// Worker or Admin experience by role.
// =====================================================================

import { ensureConnection, getSession, login, anyUsersExist, createFirstAdmin } from "./auth.js";
import { mountWorker } from "./worker.js";
import { mountAdmin } from "./admin.js";
import { toast, setLoading, escapeHtml } from "./utils.js";

// Restore theme preference.
document.documentElement.setAttribute("data-theme", localStorage.getItem("qms-theme") || "light");

const root = document.getElementById("app");

boot();
async function boot() {
    setLoading(true);
    try {
        await ensureConnection();
    } catch (e) {
        setLoading(false);
        root.innerHTML = errorCard("Cannot reach the database. Check your connection and that Anonymous sign-in is enabled in Firebase.");
        return;
    }
    setLoading(false);

    const session = getSession();
    if (session && session.id) return mountByRole(session);

    if (await anyUsersExist()) renderLogin();
    else renderFirstAdmin();
}

async function mountByRole(profile) {
    if (profile.role === "admin") await mountAdmin(root, profile);
    else await mountWorker(root, profile);
}

// ---- Login screen ---------------------------------------------------
function renderLogin(errMsg = "") {
    root.innerHTML = `
      <div class="login-wrap"><div class="card login-card">
        <div class="logo-lg">Q</div>
        <h1 style="font-size:22px">Brandix QMS</h1>
        <p class="faint" style="margin:4px 0 22px">Real-time Quality Management System</p>
        <form id="login-form">
          <div class="field"><label>Username</label>
            <input id="li-user" required autocomplete="username" placeholder="e.g. jshan or admin"></div>
          <div class="field"><label>Password</label>
            <input id="li-pass" type="password" required autocomplete="current-password" placeholder="••••••••"></div>
          ${errMsg ? `<p class="text-bad" style="font-size:13px;margin:0 0 12px">${escapeHtml(errMsg)}</p>` : ""}
          <button class="btn btn-primary btn-block" type="submit" id="li-btn">Sign in</button>
        </form>
      </div></div>`;
    document.getElementById("login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("li-btn");
        btn.disabled = true; btn.textContent = "Signing in…";
        try {
            const profile = await login(
                document.getElementById("li-user").value,
                document.getElementById("li-pass").value);
            await mountByRole(profile);
        } catch (err) {
            btn.disabled = false; btn.textContent = "Sign in";
            renderLogin(err.message || "Sign-in failed.");
        }
    });
}

// ---- First-admin setup (only when no users exist yet) ---------------
function renderFirstAdmin(errMsg = "") {
    root.innerHTML = `
      <div class="login-wrap"><div class="card login-card">
        <div class="logo-lg">Q</div>
        <h1 style="font-size:22px">Welcome to Brandix QMS</h1>
        <p class="faint" style="margin:4px 0 22px">No accounts exist yet. Create the first <b>Admin</b> account to get started.</p>
        <form id="fa-form">
          <div class="field"><label>Full Name</label><input id="fa-name" required placeholder="Your name"></div>
          <div class="field"><label>Username</label><input id="fa-user" required placeholder="admin"></div>
          <div class="field"><label>Password</label><input id="fa-pass" type="password" required placeholder="min 6 characters"></div>
          <div class="field"><label>Confirm Password</label><input id="fa-pass2" type="password" required placeholder="repeat password"></div>
          ${errMsg ? `<p class="text-bad" style="font-size:13px;margin:0 0 12px">${escapeHtml(errMsg)}</p>` : ""}
          <button class="btn btn-primary btn-block" type="submit" id="fa-btn">Create Admin & Continue</button>
        </form>
      </div></div>`;
    document.getElementById("fa-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("fa-name").value.trim();
        const user = document.getElementById("fa-user").value.trim();
        const pass = document.getElementById("fa-pass").value;
        const pass2 = document.getElementById("fa-pass2").value;
        if (pass.length < 6) return renderFirstAdmin("Password must be at least 6 characters.");
        if (pass !== pass2) return renderFirstAdmin("Passwords do not match.");
        const btn = document.getElementById("fa-btn");
        btn.disabled = true; btn.textContent = "Creating…";
        try {
            const profile = await createFirstAdmin(name, user, pass);
            toast("Admin account created", "success");
            await mountByRole(profile);
        } catch (err) {
            renderFirstAdmin(err.message || "Could not create admin.");
        }
    });
}

function errorCard(msg) {
    return `<div class="login-wrap"><div class="card login-card">
      <div class="logo-lg">Q</div><h1 style="font-size:20px">Connection problem</h1>
      <p class="faint" style="margin-top:8px">${escapeHtml(msg)}</p>
      <button class="btn btn-primary btn-block" style="margin-top:16px" onclick="location.reload()">Retry</button>
    </div></div>`;
}
