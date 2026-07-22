// =====================================================================
// Brandix QMS — Application entry point & router
// Renders login, then mounts the Worker or Admin experience by role.
// =====================================================================

import { onAuth, login, resolveProfile } from "./auth.js";
import { mountWorker } from "./worker.js";
import { mountAdmin } from "./admin.js";
import { toast, setLoading, escapeHtml } from "./utils.js";

// Restore theme preference.
const savedTheme = localStorage.getItem("qms-theme") || "light";
document.documentElement.setAttribute("data-theme", savedTheme);

const root = document.getElementById("app");
let booted = false;

function renderLogin(errMsg = "") {
    root.innerHTML = `
      <div class="login-wrap">
        <div class="card login-card">
          <div class="logo-lg">Q</div>
          <h1 style="font-size:22px">Brandix QMS</h1>
          <p class="faint" style="margin:4px 0 22px">Real-time Quality Management System</p>
          <form id="login-form">
            <div class="field"><label>Email</label><input type="email" id="li-email" required autocomplete="username" placeholder="you@brandix.com"></div>
            <div class="field"><label>Password</label><input type="password" id="li-pass" required autocomplete="current-password" placeholder="••••••••"></div>
            ${errMsg ? `<p class="text-bad" style="font-size:13px;margin:0 0 12px">${escapeHtml(errMsg)}</p>` : ""}
            <button class="btn btn-primary btn-block" type="submit" id="li-btn">Sign in</button>
          </form>
          <p class="faint" style="font-size:12px;margin-top:18px;text-align:center">
            First account to sign in becomes the Admin.</p>
        </div>
      </div>`;
    document.getElementById("login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("li-btn");
        btn.disabled = true; btn.textContent = "Signing in…";
        try {
            await login(document.getElementById("li-email").value.trim(),
                        document.getElementById("li-pass").value);
            // onAuth handles the rest.
        } catch (err) {
            btn.disabled = false; btn.textContent = "Sign in";
            renderLogin(mapAuthError(err));
        }
    });
}

function mapAuthError(err) {
    const c = err?.code || "";
    if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
        return "Invalid email or password.";
    if (c.includes("too-many-requests")) return "Too many attempts. Try again later.";
    if (c.includes("network")) return "Network error. Check your connection.";
    return err?.message || "Sign-in failed.";
}

onAuth(async (user) => {
    if (!user) { renderLogin(); return; }
    setLoading(true);
    try {
        const profile = await resolveProfile(user);
        setLoading(false);
        if (profile.active === false) {
            toast("Your account is disabled. Contact an admin.", "error");
            const { logout } = await import("./auth.js");
            await logout();
            return;
        }
        if (profile.role === "admin") await mountAdmin(root, profile);
        else await mountWorker(root, profile);
        booted = true;
    } catch (e) {
        setLoading(false);
        console.error(e);
        renderLogin("Could not load profile: " + e.message);
    }
});

// Fallback: if auth never fires quickly, show login.
setTimeout(() => { if (!booted && !document.getElementById("login-form")) renderLogin(); }, 2500);
