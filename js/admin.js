// =====================================================================
// Brandix QMS — Admin console
// Live dashboard, schema-driven management CRUD, filters, reports,
// exports, shift/team rotation, notifications and audit logs.
// =====================================================================

import {
    watch, readOnce, toList, createIn, updateIn, removeIn,
    setUser, getDayEntries, flattenDay, audit
} from "./db.js";
import {
    STAGES, calcMetrics, todayKey, escapeHtml, dhuClass, fmtDateTime,
    toast, confirmDialog, setLoading, downloadFile, toCSV, round2
} from "./utils.js";
import { render as chart, PALETTE } from "./charts.js";
import { resolveShiftTeam, DEFAULT_ROTATION } from "./shift.js";
import { logout, createUserAccount, resetPassword } from "./auth.js";

let profile;
const store = {};           // cached collections
let todayEntries = [];       // flattened entries for the selected report scope
let liveUnsub = null;

// ---- Management schema ----------------------------------------------
const COLLECTIONS = {
    productionLines: {
        title: "Production Lines", singular: "Line",
        cols: [["name", "Name"], ["code", "Code"], ["active", "Status"]],
        fields: [
            { k: "name", label: "Line Name", req: true },
            { k: "code", label: "Code" },
            { k: "active", label: "Active", type: "check", def: true }
        ]
    },
    buyers: {
        title: "Buyers", singular: "Buyer",
        cols: [["name", "Name"], ["code", "Code"], ["active", "Status"]],
        fields: [
            { k: "name", label: "Buyer Name", req: true },
            { k: "code", label: "Code" },
            { k: "active", label: "Active", type: "check", def: true }
        ]
    },
    styles: {
        title: "Styles", singular: "Style",
        cols: [["name", "Style"], ["code", "Code"], ["buyerId", "Buyer", "buyers"]],
        fields: [
            { k: "name", label: "Style Name / No.", req: true },
            { k: "code", label: "Code" },
            { k: "buyerId", label: "Buyer", type: "ref", ref: "buyers" }
        ]
    },
    defects: {
        title: "Defects", singular: "Defect",
        cols: [["name", "Defect"], ["category", "Category"]],
        fields: [
            { k: "name", label: "Defect Name", req: true },
            { k: "category", label: "Category", type: "select",
              opts: ["Stitching", "Measurement", "Fabric", "Finishing", "Cutting", "Print/Embroidery", "Packing", "Other"] }
        ]
    },
    tasks: {
        title: "Tasks", singular: "Task",
        cols: [["taskCode", "Task ID"], ["buyerId", "Buyer", "buyers"], ["styleId", "Style", "styles"],
               ["lineId", "Line", "productionLines"], ["active", "Status"]],
        fields: [
            { k: "taskCode", label: "Task ID", req: true },
            { k: "buyerId", label: "Buyer", type: "ref", ref: "buyers" },
            { k: "styleId", label: "Style", type: "ref", ref: "styles" },
            { k: "lineId", label: "Production Line", type: "ref", ref: "productionLines" },
            { k: "stages", label: "Inspection Stages", type: "stages" },
            { k: "defectIds", label: "Defects", type: "defects" },
            { k: "active", label: "Active", type: "check", def: true }
        ]
    },
    teams: {
        title: "Teams", singular: "Team",
        cols: [["name", "Team"]],
        fields: [{ k: "name", label: "Team Name", req: true }]
    }
};

const NAV = [
    { g: "Overview" },
    { id: "dashboard", ic: "▤", label: "Dashboard" },
    { id: "reports", ic: "▦", label: "Reports & Analytics" },
    { id: "notifications", ic: "◉", label: "Alerts" },
    { g: "Configuration" },
    { id: "users", ic: "◍", label: "Users" },
    { id: "productionLines", ic: "▥", label: "Production Lines" },
    { id: "buyers", ic: "◆", label: "Buyers" },
    { id: "styles", ic: "❖", label: "Styles" },
    { id: "defects", ic: "⚠", label: "Defects" },
    { id: "tasks", ic: "☑", label: "Tasks" },
    { id: "rotation", ic: "⟳", label: "Shifts & Teams" },
    { g: "System" },
    { id: "logs", ic: "≣", label: "Audit Logs" },
    { id: "settings", ic: "⚙", label: "Settings" }
];

// =====================================================================
export async function mountAdmin(root, prof) {
    profile = prof;
    setLoading(true);
    await loadAll();
    setLoading(false);
    renderShell(root);
    go("dashboard");
    subscribeLive();
}

async function loadAll() {
    const keys = ["users", "productionLines", "buyers", "styles",
                  "defects", "tasks", "teams",
                  "notifications", "logs", "settings"];
    const vals = await Promise.all(keys.map((k) => readOnce(k)));
    keys.forEach((k, i) => store[k] = vals[i] || {});
    if (!store.settings.rotation) store.settings.rotation = DEFAULT_ROTATION;
}

const list = (k) => toList(store[k]);
const nameOf = (k, id) => store[k]?.[id]?.name || store[k]?.[id]?.taskCode || "—";

// ---- Shell ----------------------------------------------------------
function renderShell(root) {
    root.innerHTML = `
    <div class="app">
      <aside class="sidebar" id="admin-side">
        <div class="brand">
          <div class="logo">Q</div>
          <div><h1>Brandix QMS</h1><small>Quality Management</small></div>
        </div>
        <nav class="nav">
          ${NAV.map((n) => n.g
            ? `<div class="nav-group">${n.g}</div>`
            : `<div class="nav-item" data-nav="${n.id}"><span class="ic">${n.ic}</span>${n.label}<span class="right" data-badge="${n.id}"></span></div>`
          ).join("")}
        </nav>
        <div class="userbox">
          <div class="avatar">${(profile.name || "A").slice(0, 2).toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(profile.name)}</div>
            <div class="faint" style="font-size:11px">Administrator</div>
          </div>
          <button class="iconbtn" id="a-logout" title="Sign out">⏻</button>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <button class="iconbtn menu-toggle" id="a-menu">☰</button>
          <h2 id="a-title">Dashboard</h2>
          <span class="right"></span>
          <span class="badge blue" id="a-shift"></span>
          <button class="iconbtn" id="a-theme" title="Toggle theme">◐</button>
        </div>
        <div class="content"><div class="content-inner" id="a-view"></div></div>
      </div>
    </div>`;

    root.querySelectorAll("[data-nav]").forEach((el) =>
        el.onclick = () => { go(el.dataset.nav); document.getElementById("admin-side").classList.remove("open"); });
    root.querySelector("#a-logout").onclick = () => logout();
    root.querySelector("#a-theme").onclick = toggleTheme;
    root.querySelector("#a-menu").onclick = () => document.getElementById("admin-side").classList.toggle("open");
    updateShiftBadge();
    refreshBadges();
}

function updateShiftBadge() {
    const s = resolveShiftTeam(store.settings.rotation);
    document.getElementById("a-shift").textContent = `${s.shift.name} · ${s.currentTeamName}`;
}

function refreshBadges() {
    const unread = list("notifications").filter((n) => !n.read).length;
    const el = document.querySelector('[data-badge="notifications"]');
    if (el) el.innerHTML = unread ? `<span class="badge bad">${unread}</span>` : "";
}

let current = "dashboard";
function go(id) {
    current = id;
    document.querySelectorAll("[data-nav]").forEach((el) =>
        el.classList.toggle("active", el.dataset.nav === id));
    const titles = { dashboard: "Dashboard", reports: "Reports & Analytics", notifications: "Alerts",
        users: "Users", rotation: "Shifts & Teams", logs: "Audit Logs", settings: "Settings" };
    document.getElementById("a-title").textContent = titles[id] || COLLECTIONS[id]?.title || id;
    const v = document.getElementById("a-view");
    if (id === "dashboard") renderDashboard(v);
    else if (id === "reports") renderReports(v);
    else if (id === "notifications") renderNotifications(v);
    else if (id === "users") renderUsers(v);
    else if (id === "rotation") renderRotation(v);
    else if (id === "logs") renderLogs(v);
    else if (id === "settings") renderSettings(v);
    else if (COLLECTIONS[id]) renderCollection(v, id);
}

// ---- Live subscription ----------------------------------------------
function subscribeLive() {
    if (liveUnsub) liveUnsub();
    liveUnsub = watch(`hourlyEntries/${todayKey()}`, (day) => {
        todayEntries = flattenDay(todayKey(), day);
        if (current === "dashboard") renderDashboard(document.getElementById("a-view"));
    });
    watch("notifications", (n) => { store.notifications = n || {}; refreshBadges(); if (current === "notifications") renderNotifications(document.getElementById("a-view")); });
}

// =====================================================================
// DASHBOARD
// =====================================================================
function aggregate(entries) {
    let checked = 0, defects = 0, rejected = 0, passed = 0;
    const byHour = {}, byDefect = {}, byLine = {}, byTeam = {}, byShift = {}, byStage = {};
    const workers = new Set(), tasks = new Set(), lines = new Set();
    entries.forEach((e) => {
        checked += +e.checkedQty || 0; defects += +e.totalDefects || 0;
        rejected += +e.rejectedQty || 0; passed += +e.passedQty || 0;
        if (e.workerId) workers.add(e.workerId);
        if (e.taskId) tasks.add(e.taskId);
        if (e.lineId) lines.add(e.lineId);
        agg(byHour, "H" + e.hour, e); agg(byLine, e.lineId, e);
        agg(byTeam, e.teamName || e.team, e); agg(byShift, e.shiftName || e.shift, e);
        agg(byStage, e.stage, e);
        Object.entries(e.defects || {}).forEach(([d, c]) => byDefect[d] = (byDefect[d] || 0) + (+c || 0));
    });
    return { checked, defects, rejected, passed,
        dhu: checked ? round2(defects / checked * 100) : 0,
        passPct: checked ? round2(passed / checked * 100) : 0,
        rejectPct: checked ? round2(rejected / checked * 100) : 0,
        byHour, byDefect, byLine, byTeam, byShift, byStage,
        workers, tasks, lines, count: entries.length };
}
function agg(map, key, e) {
    if (!key) return;
    const m = map[key] || (map[key] = { checked: 0, defects: 0, rejected: 0, passed: 0 });
    m.checked += +e.checkedQty || 0; m.defects += +e.totalDefects || 0;
    m.rejected += +e.rejectedQty || 0; m.passed += +e.passedQty || 0;
}
const dhuOf = (m) => m.checked ? round2(m.defects / m.checked * 100) : 0;
const passPctOf = (m) => m.checked ? round2(m.passed / m.checked * 100) : 0;

let dashLineId = "";

function renderDashboard(v) {
    const entries = dashLineId ? todayEntries.filter((e) => e.lineId === dashLineId) : todayEntries;
    const a = aggregate(entries);
    const activeTasks = list("tasks").filter((t) => t.active !== false && (!dashLineId || t.lineId === dashLineId));
    const expected = expectedSlots(activeTasks);
    const pending = Math.max(0, expected - a.count);
    const lineOpts = list("productionLines").map((l) =>
        `<option value="${l.id}" ${dashLineId === l.id ? "selected" : ""}>${escapeHtml(l.name)}</option>`).join("");

    v.innerHTML = `
      <div class="filterbar row" style="margin-bottom:16px;position:static">
        <label style="margin:0"><span class="faint" style="font-size:11px;display:block;margin-bottom:4px">Production Line</span>
          <select id="d-line" style="width:200px"><option value="">All Lines</option>${lineOpts}</select></label>
        <span class="right"></span>
        <button class="btn btn-ghost btn-sm" id="d-pdf" ${dashLineId ? "" : "disabled"} title="${dashLineId ? "Download this line's data as PDF" : "Select a single line to enable"}">⬇ Download Line PDF</button>
      </div>

      <div class="stats" style="margin-bottom:16px">
        ${stat("Workers Online", a.workers.size, "◍", "Submitting today")}
        ${stat("Active Lines", a.lines.size + " / " + list("productionLines").length, "▥", "Reporting today")}
        ${stat("Active Tasks", activeTasks.length, "☑", a.tasks.size + " in use")}
        ${stat("Today's DHU", a.dhu.toFixed(2) + "%", "⚠", "", dhuClass(a.dhu))}
      </div>
      <div class="stats" style="margin-bottom:24px">
        ${stat("Pass %", a.passPct.toFixed(2) + "%", "✓", "", "good")}
        ${stat("Reject %", a.rejectPct.toFixed(2) + "%", "✕", "", a.rejectPct > 5 ? "bad" : "")}
        ${stat("Completed Entries", a.count, "≣", "Stage entries today")}
        ${stat("Pending Entries", pending, "◷", "Expected " + expected, pending > 0 ? "warn" : "good")}
      </div>

      <div class="section-label">Inspection Stage Breakdown</div>
      <div class="card" style="margin-bottom:16px;padding:0">${stageTable(a)}</div>

      <div class="grid-cards" style="margin-bottom:16px">
        <div class="card"><div class="card-head"><div class="card-title">DHU Trend by Hour</div></div><div class="chart-box"><canvas id="c-hour"></canvas></div></div>
        <div class="card"><div class="card-head"><div class="card-title">DHU by Stage</div></div><div class="chart-box"><canvas id="c-stage"></canvas></div></div>
        <div class="card"><div class="card-head"><div class="card-title">Pass vs Reject</div></div><div class="chart-box"><canvas id="c-pr"></canvas></div></div>
        <div class="card"><div class="card-head"><div class="card-title">Top Defects</div></div><div class="chart-box"><canvas id="c-def"></canvas></div></div>
        ${dashLineId ? "" : `<div class="card"><div class="card-head"><div class="card-title">Line Performance (DHU%)</div></div><div class="chart-box"><canvas id="c-line"></canvas></div></div>`}
        <div class="card"><div class="card-head"><div class="card-title">Team Performance</div></div><div class="chart-box"><canvas id="c-team"></canvas></div></div>
        <div class="card"><div class="card-head"><div class="card-title">Shift Performance</div></div><div class="chart-box"><canvas id="c-shift"></canvas></div></div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">Recent Submissions</div>
          <span class="badge blue">Live</span></div>
        <div id="d-recent"></div>
      </div>`;

    drawDashCharts(a);
    const recent = [...entries].sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0)).slice(0, 10);
    document.getElementById("d-recent").innerHTML = recent.length ? `
      <div class="table-wrap"><table><thead><tr>
        <th>Time</th><th>Worker</th><th>Line</th><th>Hour</th><th>Stage</th><th>Checked</th><th>DHU</th></tr></thead><tbody>
        ${recent.map((r) => `<tr>
          <td class="mono">${new Date(r.savedAt || 0).toLocaleTimeString("en-US", { hour12: false })}</td>
          <td>${escapeHtml(r.workerName || "—")}</td><td>${escapeHtml(nameOf("productionLines", r.lineId))}</td>
          <td>Hour ${r.hour}</td><td>${STAGES[r.stage] || r.stage}</td><td>${r.checkedQty}</td>
          <td><span class="badge ${dhuClass(r.dhu)}">${(r.dhu ?? 0)}%</span></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No submissions yet today.</div>`;

    v.querySelector("#d-line").onchange = (e) => { dashLineId = e.target.value; renderDashboard(v); };
    v.querySelector("#d-pdf").onclick = exportDashboardPDF;
    updateShiftBadge();
}

function stageTable(a) {
    const rows = Object.entries(STAGES).filter(([k]) => a.byStage[k]);
    if (!rows.length) return `<div class="empty">No stage entries yet today.</div>`;
    return `<div class="table-wrap"><table><thead><tr>
        <th>Stage</th><th>Checked</th><th>Total Defects</th><th>Passed</th><th>Rejected</th><th>DHU%</th><th>Pass%</th></tr></thead><tbody>
        ${rows.map(([k, label]) => {
            const m = a.byStage[k];
            const dhu = dhuOf(m);
            return `<tr>
              <td style="font-weight:700">${label}</td><td>${m.checked}</td><td>${m.defects}</td>
              <td class="text-good">${m.passed}</td><td class="text-bad">${m.rejected}</td>
              <td><span class="badge ${dhuClass(dhu)}">${dhu.toFixed(2)}</span></td>
              <td>${passPctOf(m).toFixed(2)}</td></tr>`;
        }).join("")}
      </tbody></table></div>`;
}

function expectedSlots(activeTasks) {
    const s = resolveShiftTeam(store.settings.rotation);
    const now = new Date();
    const [sh, sm] = s.shift.start.split(":").map(Number);
    const start = new Date(now); start.setHours(sh, sm, 0, 0);
    const hoursIn = Math.min(8, Math.max(0, Math.floor((now - start) / 3600000)));
    return activeTasks.reduce((sum, t) => {
        const stages = t.stages || [];
        return sum + hoursIn * stages.length;
    }, 0);
}

function drawDashCharts(a) {
    const hours = Array.from({ length: 8 }, (_, i) => "H" + (i + 1));
    chart("c-hour", "line", { labels: hours.map((h) => "Hour " + h.slice(1)),
        datasets: [{ label: "DHU %", data: hours.map((h) => dhuOf(a.byHour[h] || { checked: 0, defects: 0 })),
            borderColor: PALETTE[0], backgroundColor: "transparent", tension: .3, fill: false, pointRadius: 3 }] });

    chart("c-pr", "doughnut", { labels: ["Pass", "Reject"],
        datasets: [{ data: [a.passed, a.rejected], backgroundColor: [PALETTE[1], PALETTE[3]], borderWidth: 0 }] },
        { cutout: "62%", scales: {} });

    const defs = Object.entries(a.byDefect).map(([id, c]) => [nameOf("defects", id), c])
        .sort((x, y) => y[1] - x[1]).slice(0, 7);
    chart("c-def", "bar", { labels: defs.map((d) => d[0]),
        datasets: [{ label: "Count", data: defs.map((d) => d[1]), backgroundColor: PALETTE[4], borderRadius: 5 }] },
        { indexAxis: "y" });

    barByGroup("c-line", a.byLine, (id) => nameOf("productionLines", id), PALETTE[0]);
    barByGroup("c-team", a.byTeam, (k) => k, PALETTE[2]);
    barByGroup("c-shift", a.byShift, (k) => k, PALETTE[5]);
    barByGroup("c-stage", a.byStage, (k) => STAGES[k] || k, PALETTE[6]);
}
function barByGroup(id, map, label, color) {
    const rows = Object.entries(map).filter(([k]) => k && k !== "undefined");
    chart(id, "bar", { labels: rows.map(([k]) => label(k)),
        datasets: [{ label: "DHU %", data: rows.map(([, m]) => dhuOf(m)), backgroundColor: color, borderRadius: 5 }] });
}

const stat = (k, v, ic, sub = "", cls = "") => `
  <div class="stat"><div class="ico">${ic}</div>
    <div class="k">${k}</div><div class="v ${cls ? "text-" + cls : ""}">${v}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;

// =====================================================================
// REPORTS & ANALYTICS
// =====================================================================
const reportState = { range: "today", from: todayKey(), to: todayKey(), filters: {}, rows: [] };

function renderReports(v) {
    const F = reportState.filters;
    const sel = (id, coll, valKey = "id", labelKey = "name") =>
        `<select data-f="${id}"><option value="">All</option>${list(coll)
            .map((r) => `<option value="${r[valKey]}" ${F[id] === r[valKey] ? "selected" : ""}>${escapeHtml(r[labelKey] || r.taskCode || r.id)}</option>`).join("")}</select>`;

    v.innerHTML = `
      <div class="filterbar">
        <div class="chips">
          ${["today", "week", "month", "custom"].map((r) =>
            `<div class="chip ${reportState.range === r ? "active" : ""}" data-range="${r}">${
              { today: "Today", week: "This Week", month: "This Month", custom: "Custom" }[r]}</div>`).join("")}
          <div class="right"></div>
          <input type="date" data-d="from" value="${reportState.from}" style="width:auto" class="${reportState.range === "custom" ? "" : "hidden"}">
          <input type="date" data-d="to" value="${reportState.to}" style="width:auto" class="${reportState.range === "custom" ? "" : "hidden"}">
        </div>
        <div class="f-grid">
          <div><label>Line</label>${sel("lineId", "productionLines")}</div>
          <div><label>Buyer</label>${sel("buyerId", "buyers")}</div>
          <div><label>Style</label>${sel("styleId", "styles")}</div>
          <div><label>Task</label>${sel("taskId", "tasks", "id", "taskCode")}</div>
          <div><label>Stage</label><select data-f="stage"><option value="">All</option>${
            Object.entries(STAGES).map(([k, l]) => `<option value="${k}" ${F.stage === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
          <div><label>Defect</label>${sel("defectId", "defects")}</div>
          <div><label>Team</label>${sel("teamKey", "teams", "name", "name")}</div>
          <div><label>Search</label><input type="text" data-f="q" value="${F.q || ""}" placeholder="Worker, task…"></div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn btn-ghost btn-sm" id="r-reset">Reset All</button>
          <span class="right"></span>
          <button class="btn btn-ghost btn-sm" id="r-csv">CSV</button>
          <button class="btn btn-ghost btn-sm" id="r-xls">Excel</button>
          <button class="btn btn-ghost btn-sm" id="r-pdf">PDF</button>
          <button class="btn btn-ghost btn-sm" id="r-print">Print</button>
        </div>
      </div>
      <div id="r-summary" class="stats" style="margin-bottom:16px"></div>
      <div class="grid-cards" style="margin-bottom:16px">
        <div class="card"><div class="card-title" style="margin-bottom:12px">DHU by Line</div><div class="chart-box"><canvas id="rc-line"></canvas></div></div>
        <div class="card"><div class="card-title" style="margin-bottom:12px">Top Defects</div><div class="chart-box"><canvas id="rc-def"></canvas></div></div>
      </div>
      <div class="card"><div class="card-head"><div class="card-title">Detailed Entries</div><span class="badge blue" id="r-count"></span></div>
        <div id="r-table"></div></div>`;

    v.querySelectorAll("[data-range]").forEach((c) => c.onclick = () => { setRange(c.dataset.range); renderReports(v); });
    v.querySelectorAll("[data-d]").forEach((i) => i.onchange = () => { reportState[i.dataset.d] = i.value; runReport(); });
    v.querySelectorAll("[data-f]").forEach((i) => i.oninput = () => { F[i.dataset.f] = i.value; runReport(); });
    v.querySelector("#r-reset").onclick = () => { reportState.filters = {}; setRange("today"); renderReports(v); };
    v.querySelector("#r-csv").onclick = exportCSV;
    v.querySelector("#r-xls").onclick = exportXLS;
    v.querySelector("#r-pdf").onclick = exportPDF;
    v.querySelector("#r-print").onclick = () => window.print();
    runReport();
}

function setRange(r) {
    reportState.range = r;
    const now = new Date();
    if (r === "today") reportState.from = reportState.to = todayKey();
    else if (r === "week") { const d = new Date(now); d.setDate(d.getDate() - 6); reportState.from = todayKey(d); reportState.to = todayKey(); }
    else if (r === "month") { const d = new Date(now); d.setDate(1); reportState.from = todayKey(d); reportState.to = todayKey(); }
}

async function runReport() {
    setLoading(true);
    const dates = dateRange(reportState.from, reportState.to);
    const days = await Promise.all(dates.map((d) => getDayEntries(d)));
    let rows = [];
    dates.forEach((d, i) => rows.push(...flattenDay(d, days[i])));
    const F = reportState.filters;
    rows = rows.filter((e) => {
        if (F.lineId && e.lineId !== F.lineId) return false;
        if (F.buyerId && e.buyerId !== F.buyerId) return false;
        if (F.styleId && e.styleId !== F.styleId) return false;
        if (F.taskId && e.taskId !== F.taskId) return false;
        if (F.stage && e.stage !== F.stage) return false;
        if (F.teamKey && (e.teamName !== F.teamKey && e.team !== F.teamKey)) return false;
        if (F.defectId && !(e.defects && e.defects[F.defectId] > 0)) return false;
        if (F.q) { const q = F.q.toLowerCase(); if (!`${e.workerName} ${e.taskCode}`.toLowerCase().includes(q)) return false; }
        return true;
    });
    reportState.rows = rows;
    setLoading(false);
    paintReport();
}

function paintReport() {
    const rows = reportState.rows;
    const a = aggregate(rows);
    document.getElementById("r-summary").innerHTML =
        stat("Checked", a.checked, "▤") + stat("Total Defects", a.defects, "⚠") +
        stat("DHU %", a.dhu.toFixed(2), "◆", "", dhuClass(a.dhu)) + stat("Pass %", a.passPct.toFixed(2), "✓", "", "good");
    document.getElementById("r-count").textContent = rows.length + " rows";

    barByGroup("rc-line", a.byLine, (id) => nameOf("productionLines", id), PALETTE[0]);
    const defs = Object.entries(a.byDefect).map(([id, c]) => [nameOf("defects", id), c]).sort((x, y) => y[1] - x[1]).slice(0, 8);
    chart("rc-def", "bar", { labels: defs.map((d) => d[0]),
        datasets: [{ label: "Count", data: defs.map((d) => d[1]), backgroundColor: PALETTE[3], borderRadius: 5 }] }, { indexAxis: "y" });

    const tbl = document.getElementById("r-table");
    if (!rows.length) { tbl.innerHTML = `<div class="empty">No entries match the current filters.</div>`; return; }
    const view = [...rows].sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0)).slice(0, 300);
    tbl.innerHTML = `<div class="table-wrap"><table><thead><tr>
        <th>Date</th><th>Line</th><th>Hour</th><th>Stage</th><th>Task</th><th>Worker</th>
        <th>Checked</th><th>Defects</th><th>DHU%</th><th>Pass%</th><th>Reject%</th></tr></thead><tbody>
        ${view.map((r) => `<tr>
          <td class="mono">${r.date}</td><td>${escapeHtml(nameOf("productionLines", r.lineId))}</td>
          <td>Hour ${r.hour}</td><td>${STAGES[r.stage] || r.stage}</td>
          <td>${escapeHtml(r.taskCode || "—")}</td><td>${escapeHtml(r.workerName || "—")}</td>
          <td>${r.checkedQty}</td><td>${r.totalDefects}</td>
          <td><span class="badge ${dhuClass(r.dhu)}">${r.dhu}</span></td>
          <td>${r.passPct}</td><td>${r.rejectPct}</td></tr>`).join("")}
      </tbody></table></div>${rows.length > 300 ? `<div class="faint" style="padding:10px">Showing first 300 of ${rows.length}. Export for full data.</div>` : ""}`;
}

function exportRows(entries) {
    const headers = ["Date", "Line", "Hour", "Stage", "Task", "Buyer", "Style", "Worker", "Shift", "Team", "Checked", "TotalDefects", "Passed", "Rejected", "DHU%", "Pass%", "Reject%"];
    const rows = entries.map((r) => [
        r.date, nameOf("productionLines", r.lineId), "Hour " + r.hour,
        STAGES[r.stage] || r.stage, r.taskCode || "", nameOf("buyers", r.buyerId), nameOf("styles", r.styleId),
        r.workerName || "", r.shiftName || r.shift || "", r.teamName || r.team || "",
        r.checkedQty, r.totalDefects, r.passedQty, r.rejectedQty, r.dhu, r.passPct, r.rejectPct]);
    return { headers, rows };
}
function exportCSV() {
    const { headers, rows } = exportRows(reportState.rows);
    downloadFile(`qms-report-${todayKey()}.csv`, toCSV(headers, rows), "text/csv");
    toast("CSV exported", "success");
}
function exportXLS() {
    const { headers, rows } = exportRows(reportState.rows);
    if (window.XLSX) {
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "QMS Report");
        XLSX.writeFile(wb, `qms-report-${todayKey()}.xlsx`);
    } else {
        downloadFile(`qms-report-${todayKey()}.xls`, toCSV(headers, rows), "application/vnd.ms-excel");
    }
    toast("Excel exported", "success");
}
function exportPDF() {
    generatePDF(reportState.rows, {
        subtitle: `Range: ${reportState.from} to ${reportState.to}   ·   Generated: ${new Date().toLocaleString()}`,
        filename: `qms-report-${todayKey()}.pdf`
    });
}

/** Shared PDF builder used by both the Reports export and the Dashboard's line-only export. */
function generatePDF(entries, { title = "Brandix QMS — Quality Report", subtitle = "", filename } = {}) {
    if (!entries.length) return toast("No data to export", "warn");
    const { headers, rows } = exportRows(entries);
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) return toast("PDF library not loaded", "error");
    const doc = new jsPDF("l", "mm", "a4");
    doc.setFillColor(37, 99, 235); doc.rect(0, 0, 297, 22, "F");
    doc.setTextColor(255); doc.setFontSize(16); doc.text(title, 12, 14);
    doc.setTextColor(30); doc.setFontSize(9);
    doc.text(subtitle || `Generated: ${new Date().toLocaleString()}`, 12, 30);
    doc.autoTable({ startY: 34, head: [headers], body: rows, styles: { fontSize: 7 },
        headStyles: { fillColor: [37, 99, 235] }, theme: "striped" });
    doc.save(filename || `qms-report-${todayKey()}.pdf`);
    toast("PDF exported", "success");
}

/** Dashboard: download today's data for the currently selected single line only. */
function exportDashboardPDF() {
    if (!dashLineId) return toast("Select a single production line first", "warn");
    const entries = todayEntries.filter((e) => e.lineId === dashLineId);
    const lineName = nameOf("productionLines", dashLineId);
    generatePDF(entries, {
        title: `Brandix QMS — ${lineName} Daily Report`,
        subtitle: `Date: ${todayKey()}   ·   Generated: ${new Date().toLocaleString()}`,
        filename: `qms-${lineName.replace(/\s+/g, "-").toLowerCase()}-${todayKey()}.pdf`
    });
}

const dateRange = (from, to) => {
    const out = []; let d = new Date(from + "T00:00:00"); const end = new Date(to + "T00:00:00");
    while (d <= end) { out.push(todayKey(d)); d.setDate(d.getDate() + 1); }
    return out.length ? out : [from];
};

// =====================================================================
// GENERIC COLLECTION CRUD
// =====================================================================
function renderCollection(v, key) {
    const cfg = COLLECTIONS[key];
    const rows = list(key);
    v.innerHTML = `
      <div class="card-head" style="margin-bottom:16px">
        <div><div class="card-title" style="font-size:18px">${cfg.title}</div>
          <div class="faint">${rows.length} record${rows.length === 1 ? "" : "s"}</div></div>
        <button class="btn btn-primary" id="c-add">＋ Add ${cfg.singular}</button>
      </div>
      <div class="card" style="padding:0">
        <div class="table-wrap"><table><thead><tr>
          ${cfg.cols.map((c) => `<th>${c[1]}</th>`).join("")}<th style="text-align:right">Actions</th></tr></thead><tbody>
          ${rows.length ? rows.map((r) => `<tr>
            ${cfg.cols.map((c) => `<td>${cellVal(r, c)}</td>`).join("")}
            <td style="text-align:right;white-space:nowrap">
              <button class="iconbtn" data-edit="${r.id}">✎</button>
              <button class="iconbtn text-bad" data-del="${r.id}">🗑</button></td></tr>`).join("")
          : `<tr><td colspan="${cfg.cols.length + 1}"><div class="empty">No ${cfg.title.toLowerCase()} yet.</div></td></tr>`}
        </tbody></table></div>
      </div>`;
    v.querySelector("#c-add").onclick = () => openForm(key);
    v.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openForm(key, store[key][b.dataset.edit], b.dataset.edit));
    v.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => delRecord(key, b.dataset.del));
}

function cellVal(r, col) {
    const [k, , ref] = col;
    let val = r[k];
    if (ref) return escapeHtml(nameOf(ref, val));
    if (k === "active") return val === false ? `<span class="badge">Inactive</span>` : `<span class="badge good">Active</span>`;
    if (k === "stages") return (val || []).map((s) => `<span class="badge">${STAGES[s] || s}</span>`).join(" ") || "—";
    if (k === "defectIds") return `<span class="badge blue">${(val || []).length} defects</span>`;
    return escapeHtml(val ?? "—");
}

function openForm(key, record = null, id = null) {
    const cfg = COLLECTIONS[key];
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `
      <div class="modal"><div class="modal-head">${record ? "Edit" : "Add"} ${cfg.singular}</div>
        <div class="modal-body">${cfg.fields.map((f) => fieldHtml(f, record)).join("")}</div>
        <div class="modal-foot"><button class="btn btn-ghost" data-x>Cancel</button>
          <button class="btn btn-primary" data-save>Save</button></div></div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("click", (e) => { if (e.target === back || e.target.hasAttribute("data-x")) close(); });
    back.querySelector("[data-save]").onclick = async () => {
        const data = {};
        for (const f of cfg.fields) {
            const el = back.querySelector(`[name="${f.k}"]`);
            if (f.type === "check") data[f.k] = el.checked;
            else if (f.type === "stages" || f.type === "defects")
                data[f.k] = [...back.querySelectorAll(`[data-multi="${f.k}"]:checked`)].map((c) => c.value);
            else if (f.type === "number") data[f.k] = +el.value || 0;
            else data[f.k] = el.value.trim();
            if (f.req && !data[f.k]) return toast(f.label + " is required", "warn");
        }
        try {
            if (id) { await updateIn(key, id, data); await audit("update_" + key, `${cfg.singular}: ${data.name || data.taskCode || id}`, profile.username); }
            else { const nid = await createIn(key, data); await audit("create_" + key, `${cfg.singular}: ${data.name || data.taskCode || nid}`, profile.username); }
            store[key] = await readOnce(key) || {};
            close(); go(key);
            toast(cfg.singular + " saved", "success");
        } catch (e) { toast("Save failed: " + e.message, "error"); }
    };
}

function fieldHtml(f, record) {
    const val = record ? record[f.k] : f.def;
    if (f.type === "check")
        return `<div class="field"><label style="display:flex;gap:8px;align-items:center;cursor:pointer">
            <input type="checkbox" name="${f.k}" ${val !== false ? "checked" : ""} style="width:auto">${f.label}</label></div>`;
    if (f.type === "ref") {
        const opts = list(f.ref).map((r) => `<option value="${r.id}" ${val === r.id ? "selected" : ""}>${escapeHtml(r.name || r.taskCode || r.id)}</option>`).join("");
        return `<div class="field"><label>${f.label}</label><select name="${f.k}"><option value="">— none —</option>${opts}</select></div>`;
    }
    if (f.type === "select")
        return `<div class="field"><label>${f.label}</label><select name="${f.k}">${f.opts.map((o) => `<option ${val === o ? "selected" : ""}>${o}</option>`).join("")}</select></div>`;
    if (f.type === "stages") {
        const arr = val || [];
        return `<div class="field"><label>${f.label}</label><div class="row wrap">${Object.entries(STAGES).map(([k, l]) =>
            `<label class="chip" style="cursor:pointer"><input type="checkbox" data-multi="${f.k}" value="${k}" ${arr.includes(k) ? "checked" : ""} style="width:auto;margin-right:6px">${l}</label>`).join("")}</div></div>`;
    }
    if (f.type === "defects") {
        const arr = val || [];
        return `<div class="field"><label>${f.label}</label><div class="row wrap" style="max-height:180px;overflow:auto">${list("defects").map((d) =>
            `<label class="chip" style="cursor:pointer"><input type="checkbox" data-multi="${f.k}" value="${d.id}" ${arr.includes(d.id) ? "checked" : ""} style="width:auto;margin-right:6px">${escapeHtml(d.name)}</label>`).join("") || '<span class="faint">Create defects first</span>'}</div></div>`;
    }
    return `<div class="field"><label>${f.label}${f.req ? " *" : ""}</label><input type="${f.type || "text"}" name="${f.k}" value="${escapeHtml(val ?? "")}"></div>`;
}

async function delRecord(key, id) {
    const cfg = COLLECTIONS[key];
    const name = store[key][id]?.name || store[key][id]?.taskCode || id;
    if (!await confirmDialog(`Delete ${cfg.singular.toLowerCase()} “${name}”? This cannot be undone.`, { danger: true, okText: "Delete" })) return;
    await removeIn(key, id);
    await audit("delete_" + key, `${cfg.singular}: ${name}`, profile.username);
    store[key] = await readOnce(key) || {};
    go(key);
    toast(cfg.singular + " deleted", "success");
}

// =====================================================================
// USERS
// =====================================================================
function renderUsers(v) {
    const users = list("users");
    v.innerHTML = `
      <div class="card-head" style="margin-bottom:16px">
        <div><div class="card-title" style="font-size:18px">Users</div><div class="faint">${users.length} accounts</div></div>
        <button class="btn btn-primary" id="u-add">＋ Add User</button>
      </div>
      <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Username</th><th>Role</th><th>Line</th><th>Team</th><th>Status</th><th style="text-align:right">Actions</th></tr></thead><tbody>
        ${users.map((u) => `<tr>
          <td>${escapeHtml(u.name)}</td><td class="mono">${escapeHtml(u.username || "—")}</td>
          <td><span class="badge ${u.role === "admin" ? "blue" : ""}">${u.role}</span></td>
          <td>${escapeHtml(nameOf("productionLines", u.assignedLine))}</td>
          <td>${escapeHtml(u.assignedTeam || "—")}</td>
          <td>${u.active === false ? `<span class="badge">Disabled</span>` : `<span class="badge good">Active</span>`}</td>
          <td style="text-align:right"><button class="iconbtn" data-eu="${u.id}">✎</button></td></tr>`).join("")}
      </tbody></table></div></div>`;
    v.querySelector("#u-add").onclick = () => userForm();
    v.querySelectorAll("[data-eu]").forEach((b) => b.onclick = () => userForm(store.users[b.dataset.eu], b.dataset.eu));
}

function userForm(record = null, id = null) {
    const back = document.createElement("div");
    back.className = "modal-back";
    const lineOpts = list("productionLines").map((l) => `<option value="${l.id}" ${record?.assignedLine === l.id ? "selected" : ""}>${escapeHtml(l.name)}</option>`).join("");
    const teamOpts = list("teams").map((t) => `<option value="${t.name}" ${record?.assignedTeam === t.name ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("");
    back.innerHTML = `
      <div class="modal"><div class="modal-head">${record ? "Edit" : "Create"} User</div>
        <div class="modal-body">
          <div class="field"><label>Full Name *</label><input name="name" value="${escapeHtml(record?.name || "")}"></div>
          <div class="field"><label>Username *</label><input name="username" value="${escapeHtml(record?.username || "")}" ${record ? "disabled" : ""} placeholder="e.g. jshan"></div>
          <div class="field"><label>${record ? "New Password (leave blank to keep current)" : "Password *"}</label><input name="password" type="text" placeholder="min 6 characters"></div>
          <div class="grid-2">
            <div class="field"><label>Role</label><select name="role">
              <option value="worker" ${record?.role === "worker" ? "selected" : ""}>Worker / QC Inspector</option>
              <option value="admin" ${record?.role === "admin" ? "selected" : ""}>Admin</option></select></div>
            <div class="field"><label>Status</label><select name="active">
              <option value="true" ${record?.active !== false ? "selected" : ""}>Active</option>
              <option value="false" ${record?.active === false ? "selected" : ""}>Disabled</option></select></div>
          </div>
          <div class="grid-2">
            <div class="field"><label>Line</label><select name="assignedLine"><option value="">—</option>${lineOpts}</select></div>
            <div class="field"><label>Team</label><select name="assignedTeam"><option value="">—</option>${teamOpts}</select></div>
          </div>
          <p class="faint" style="font-size:12px">Credentials are stored in the database (password is salted + hashed). Share the username + password with the worker.</p>
        </div>
        <div class="modal-foot"><button class="btn btn-ghost" data-x>Cancel</button><button class="btn btn-primary" data-save>Save</button></div>
      </div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("click", (e) => { if (e.target === back || e.target.hasAttribute("data-x")) close(); });
    back.querySelector("[data-save]").onclick = async () => {
        const g = (n) => back.querySelector(`[name="${n}"]`).value.trim();
        const data = {
            name: g("name"), role: g("role"), active: g("active") === "true",
            assignedLine: g("assignedLine") || null,
            assignedTeam: g("assignedTeam") || null
        };
        if (!data.name) return toast("Name is required", "warn");
        const pw = g("password");
        try {
            setLoading(true);
            if (id) {
                await setUser(id, data);
                if (pw) {
                    if (pw.length < 6) { setLoading(false); return toast("Password must be 6+ characters", "warn"); }
                    await resetPassword(id, pw);
                }
                await audit("update_user", data.name, profile.username);
            } else {
                const username = g("username");
                if (!username || pw.length < 6) { setLoading(false); return toast("Username and 6+ char password required", "warn"); }
                await createUserAccount({ ...data, username, password: pw });
                await audit("create_user", `${data.name} (${username})`, profile.username);
            }
            store.users = await readOnce("users") || {};
            setLoading(false); close(); go("users");
            toast("User saved", "success");
        } catch (e) { setLoading(false); toast(e.message, "error"); }
    };
}

// =====================================================================
// SHIFT & TEAM ROTATION
// =====================================================================
function renderRotation(v) {
    const rot = { ...DEFAULT_ROTATION, ...store.settings.rotation };
    const now = resolveShiftTeam(rot);
    v.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-title" style="margin-bottom:12px">Current Assignment</div>
        <div class="stats">
          ${stat("Active Shift", now.shift.name, "◷", `${now.shift.start}–${now.shift.end}`)}
          ${stat("On Duty Team", now.currentTeamName, "◍")}
          ${stat("Shift A Team", rot.teams[now.teams.A], "▤")}
          ${stat("Shift B Team", rot.teams[now.teams.B], "▤")}
        </div>
      </div>
      <div class="grid-cards">
        <div class="card">
          <div class="card-title" style="margin-bottom:12px">Shift Timings</div>
          <div class="grid-2">
            <div class="field"><label>Shift A Start</label><input type="time" id="sa-start" value="${rot.shifts.A.start}"></div>
            <div class="field"><label>Shift A End</label><input type="time" id="sa-end" value="${rot.shifts.A.end}"></div>
            <div class="field"><label>Shift B Start</label><input type="time" id="sb-start" value="${rot.shifts.B.start}"></div>
            <div class="field"><label>Shift B End</label><input type="time" id="sb-end" value="${rot.shifts.B.end}"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-title" style="margin-bottom:12px">Rotation Schedule</div>
          <div class="field"><label>Anchor Date (rotation start)</label><input type="date" id="rot-anchor" value="${rot.anchorDate}"></div>
          <div class="field"><label>Weeks per rotation block</label><input type="number" id="rot-weeks" min="1" value="${rot.weeksPerBlock}"></div>
          <div class="field"><label style="display:flex;gap:8px;align-items:center;cursor:pointer">
            <input type="checkbox" id="rot-override" ${rot.override.enabled ? "checked" : ""} style="width:auto"> Manual override</label></div>
          <div class="grid-2" id="override-box" style="${rot.override.enabled ? "" : "opacity:.5"}">
            <div class="field"><label>Shift A → Team</label><select id="ov-a">
              <option value="A" ${rot.override.shiftA_team === "A" ? "selected" : ""}>${rot.teams.A}</option>
              <option value="B" ${rot.override.shiftA_team === "B" ? "selected" : ""}>${rot.teams.B}</option></select></div>
            <div class="field"><label>Shift B → Team</label><select id="ov-b">
              <option value="A" ${rot.override.shiftB_team === "A" ? "selected" : ""}>${rot.teams.A}</option>
              <option value="B" ${rot.override.shiftB_team === "B" ? "selected" : ""}>${rot.teams.B}</option></select></div>
          </div>
        </div>
      </div>
      <div class="row" style="margin-top:16px"><span class="right"></span><button class="btn btn-primary" id="rot-save">Save Rotation</button></div>`;

    v.querySelector("#rot-override").onchange = (e) =>
        v.querySelector("#override-box").style.opacity = e.target.checked ? "1" : ".5";
    v.querySelector("#rot-save").onclick = async () => {
        const val = (id) => v.querySelector("#" + id).value;
        const rotation = {
            anchorDate: val("rot-anchor"), weeksPerBlock: +val("rot-weeks") || 2,
            shifts: { A: { name: "Shift A", start: val("sa-start"), end: val("sa-end") },
                      B: { name: "Shift B", start: val("sb-start"), end: val("sb-end") } },
            teams: rot.teams,
            override: { enabled: v.querySelector("#rot-override").checked, shiftA_team: val("ov-a"), shiftB_team: val("ov-b") }
        };
        await updateIn("settings", "rotation", rotation).catch(async () => {
            // settings is a flat node, write directly
            const { qmsRef } = await import("./firebase-config.js");
            const { set } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
            await set(qmsRef("settings/rotation"), rotation);
        });
        store.settings.rotation = rotation;
        await audit("update_rotation", "Shift/team rotation updated", profile.username);
        updateShiftBadge(); go("rotation");
        toast("Rotation saved", "success");
    };
}

// =====================================================================
// NOTIFICATIONS / ALERTS
// =====================================================================
function renderNotifications(v) {
    const items = list("notifications").sort((a, b) => (b.ts || 0) - (a.ts || 0));
    v.innerHTML = `
      <div class="card-head" style="margin-bottom:16px">
        <div class="card-title" style="font-size:18px">Alerts & Notifications</div>
        <button class="btn btn-ghost btn-sm" id="n-clear">Mark all read</button></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr>
        <th></th><th>Time</th><th>Type</th><th>Message</th></tr></thead><tbody>
        ${items.length ? items.map((n) => `<tr>
          <td><span class="dot ${n.read ? "off" : "on"}"></span></td>
          <td class="mono">${fmtDateTime(n.ts)}</td>
          <td><span class="badge ${n.severity === "high" ? "bad" : "warn"}">${(n.type || "alert").replace(/_/g, " ")}</span></td>
          <td>${escapeHtml(n.text)}</td></tr>`).join("")
        : `<tr><td colspan="4"><div class="empty">No alerts.</div></td></tr>`}
      </tbody></table></div></div>`;
    v.querySelector("#n-clear").onclick = async () => {
        const { qmsRef } = await import("./firebase-config.js");
        const { update } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
        const patch = {}; items.forEach((n) => patch[`${n.id}/read`] = true);
        await update(qmsRef("notifications"), patch);
        store.notifications = await readOnce("notifications") || {};
        refreshBadges(); go("notifications");
    };
}

// =====================================================================
// AUDIT LOGS
// =====================================================================
function renderLogs(v) {
    const logs = list("logs").sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 300);
    v.innerHTML = `
      <div class="card-head" style="margin-bottom:16px"><div class="card-title" style="font-size:18px">Audit Logs</div>
        <input type="text" id="log-q" placeholder="Filter…" style="width:220px"></div>
      <div class="card" style="padding:0"><div class="table-wrap"><table><thead><tr>
        <th>Time</th><th>Action</th><th>Detail</th><th>Actor</th></tr></thead><tbody id="log-body">
        ${logRows(logs)}
      </tbody></table></div></div>`;
    v.querySelector("#log-q").oninput = (e) => {
        const q = e.target.value.toLowerCase();
        document.getElementById("log-body").innerHTML = logRows(
            logs.filter((l) => `${l.action} ${l.detail} ${l.actor}`.toLowerCase().includes(q)));
    };
}
const logRows = (logs) => logs.length ? logs.map((l) => `<tr>
    <td class="mono">${fmtDateTime(l.ts)}</td>
    <td><span class="badge">${escapeHtml(l.action)}</span></td>
    <td>${escapeHtml(l.detail)}</td><td class="faint">${escapeHtml(l.actor)}</td></tr>`).join("")
    : `<tr><td colspan="4"><div class="empty">No audit records.</div></td></tr>`;

// =====================================================================
// SETTINGS
// =====================================================================
function renderSettings(v) {
    const s = store.settings || {};
    v.innerHTML = `
      <div class="card" style="max-width:640px">
        <div class="card-title" style="margin-bottom:16px">System Settings</div>
        <div class="field"><label>High-DHU alert threshold (%)</label>
          <input type="number" id="s-dhu" value="${s.dhuAlert ?? 10}"></div>
        <div class="field"><label>Working hours per shift</label>
          <input type="number" id="s-hours" value="${s.workHours ?? 8}"></div>
        <div class="field"><label>Company / Factory Name</label>
          <input type="text" id="s-name" value="${escapeHtml(s.company || "Brandix")}"></div>
        <div class="row" style="margin-top:16px"><span class="right"></span>
          <button class="btn btn-primary" id="s-save">Save Settings</button></div>
        <p class="faint" style="font-size:12px;margin-top:20px">
          All QMS data is stored under the <b>AAAQMS/</b> database root, isolated from other apps in this Firebase project.</p>
      </div>`;
    v.querySelector("#s-save").onclick = async () => {
        const { qmsRef } = await import("./firebase-config.js");
        const { update } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
        const data = { dhuAlert: +v.querySelector("#s-dhu").value || 10,
            workHours: +v.querySelector("#s-hours").value || 8,
            company: v.querySelector("#s-name").value.trim() };
        await update(qmsRef("settings"), data);
        store.settings = { ...store.settings, ...data };
        await audit("update_settings", "System settings updated", profile.username);
        toast("Settings saved", "success");
    };
}

function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("qms-theme", next);
    if (current === "dashboard") renderDashboard(document.getElementById("a-view"));
}
