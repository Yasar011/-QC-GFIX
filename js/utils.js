// =====================================================================
// Brandix QMS — Shared utilities: calculations, formatting, UI helpers
// =====================================================================

// ---- Inspection stages (canonical keys -> labels) -------------------
export const STAGES = {
    inline:        "Inline",
    endline:       "End Line",
    thirdParty:    "Third Party",
    roving:        "Roving",
    cpa:           "CPA",
    finalAudit:    "Final Audit",
    packingAudit:  "Packing Audit"
};

export const DEFAULT_HOURS = 8;

// ---------------------------------------------------------------------
// Core quality calculations. The worker never computes anything — this
// is the single source of truth for DHU / Pass / Reject.
// ---------------------------------------------------------------------
/**
 * @param {number} checkedQty  garments inspected
 * @param {number} defectQty   garments found defective (rejected pieces)
 * @param {Object<string,number>} [defectCounts] per-defect instance counts
 * @returns {{checkedQty,defectQty,totalDefects,passedQty,rejectedQty,dhu,passPct,rejectPct}}
 */
export function calcMetrics(checkedQty, defectQty, defectCounts = {}) {
    checkedQty = Math.max(0, Number(checkedQty) || 0);
    defectQty = Math.max(0, Number(defectQty) || 0);
    if (defectQty > checkedQty) defectQty = checkedQty;

    const totalDefects = Object.values(defectCounts)
        .reduce((s, n) => s + (Math.max(0, Number(n) || 0)), 0);

    const passedQty = checkedQty - defectQty;
    const rejectedQty = defectQty;

    const dhu = checkedQty ? (totalDefects / checkedQty) * 100 : 0;
    const passPct = checkedQty ? (passedQty / checkedQty) * 100 : 0;
    const rejectPct = checkedQty ? (rejectedQty / checkedQty) * 100 : 0;

    return {
        checkedQty, defectQty, totalDefects, passedQty, rejectedQty,
        dhu: round2(dhu), passPct: round2(passPct), rejectPct: round2(rejectPct)
    };
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---- Date / time ----------------------------------------------------
export function todayKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

export function currentHourIndex(shift, now = new Date()) {
    // Returns 1..N based on hours elapsed since the shift start.
    if (!shift || !shift.start) return 1;
    const [sh, sm] = shift.start.split(":").map(Number);
    const start = new Date(now); start.setHours(sh, sm, 0, 0);
    const diffH = Math.floor((now - start) / 3600000) + 1;
    return Math.min(Math.max(diffH, 1), DEFAULT_HOURS + 4);
}

export function fmtDateTime(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("en-US", {
        year: "numeric", month: "short", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
    });
}

// ---- Small helpers --------------------------------------------------
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

export function dhuClass(dhu) {
    if (dhu >= 10) return "bad";
    if (dhu >= 5) return "warn";
    return "good";
}

// ---- Toast notifications --------------------------------------------
let toastHost;
export function toast(msg, type = "info", ms = 3200) {
    if (!toastHost) {
        toastHost = document.createElement("div");
        toastHost.className = "toast-host";
        document.body.appendChild(toastHost);
    }
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    const icon = { success: "✓", error: "✕", warn: "!", info: "i" }[type] || "i";
    el.innerHTML = `<span class="toast-ico">${icon}</span><span>${escapeHtml(msg)}</span>`;
    toastHost.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 250);
    }, ms);
}

// ---- Confirmation dialog (promise) ----------------------------------
export function confirmDialog(message, { danger = false, okText = "Confirm" } = {}) {
    return new Promise((resolve) => {
        const back = document.createElement("div");
        back.className = "modal-back";
        back.innerHTML = `
            <div class="modal modal-sm" role="dialog" aria-modal="true">
                <div class="modal-body"><p style="margin:0">${escapeHtml(message)}</p></div>
                <div class="modal-foot">
                    <button class="btn btn-ghost" data-act="cancel">Cancel</button>
                    <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${escapeHtml(okText)}</button>
                </div>
            </div>`;
        document.body.appendChild(back);
        const done = (v) => { back.remove(); resolve(v); };
        back.addEventListener("click", (e) => {
            if (e.target === back) done(false);
            const act = e.target.closest("[data-act]")?.dataset.act;
            if (act === "ok") done(true);
            if (act === "cancel") done(false);
        });
    });
}

// ---- Loading overlay ------------------------------------------------
export function setLoading(on) {
    let el = document.getElementById("global-loader");
    if (on) {
        if (!el) {
            el = document.createElement("div");
            el.id = "global-loader";
            el.className = "loader-back";
            el.innerHTML = `<div class="spinner"></div>`;
            document.body.appendChild(el);
        }
    } else if (el) {
        el.remove();
    }
}

// ---- CSV / download helpers -----------------------------------------
export function downloadFile(filename, content, mime = "text/plain") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCSV(headers, rows) {
    const esc = (v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

// ---- Password hashing (client-side, salted SHA-256) -----------------
// Workers/admins are stored in the DB with a salt + hash, never plaintext.
export function randSalt() {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password, salt) {
    const data = new TextEncoder().encode(`${salt}::${password}`);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
