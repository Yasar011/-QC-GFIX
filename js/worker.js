// =====================================================================
// Brandix QMS — Worker interface
// Extremely simple, tablet-friendly hourly quality entry.
// Shows ONLY the current task, its required stages and its relevant
// defects. The worker never calculates anything.
// =====================================================================

import { readOnce, toList, saveEntry, getDayEntries, flattenDay, pushNotification, audit } from "./db.js";
import { STAGES, calcMetrics, todayKey, currentHourIndex, DEFAULT_HOURS,
         toast, escapeHtml, dhuClass, confirmDialog } from "./utils.js";
import { resolveShiftTeam } from "./shift.js";
import { logout } from "./auth.js";

let ref = {};        // reference collections
let profile, task, lineId, shiftInfo;
let entryState = { hour: 1, stage: null, checkedQty: "", defectQty: "", defects: {} };

export async function mountWorker(root, prof) {
    profile = prof;
    await loadReference();
    resolveContext();
    render(root);
}

async function loadReference() {
    const [users, lines, modules, buyers, styles, tasks, templates, defects, settings] =
        await Promise.all([
            readOnce("users"), readOnce("productionLines"), readOnce("modules"),
            readOnce("buyers"), readOnce("styles"), readOnce("tasks"),
            readOnce("inspectionTemplates"), readOnce("defects"), readOnce("settings")
        ]);
    ref = {
        users: users || {}, lines: lines || {}, modules: modules || {},
        buyers: buyers || {}, styles: styles || {}, tasks: tasks || {},
        templates: templates || {}, defects: defects || {}, settings: settings || {}
    };
}

function resolveContext() {
    shiftInfo = resolveShiftTeam(ref.settings.rotation);
    lineId = profile.assignedLine || null;

    const activeTasks = toList(ref.tasks).filter((t) => t.active !== false);
    if (lineId) {
        task = activeTasks.find((t) => t.lineId === lineId) || null;
    } else {
        task = activeTasks[0] || null;
        lineId = task?.lineId || null;
    }
    entryState.hour = currentHourIndex(shiftInfo.shift);
}

// ---- Task-derived stage & defect lists ------------------------------
function taskStages() {
    if (!task) return [];
    let stages = task.stages;
    if ((!stages || !stages.length) && task.templateId) {
        stages = ref.templates[task.templateId]?.stages;
    }
    return (stages || []).filter((s) => STAGES[s]);
}
function taskDefects() {
    if (!task) return [];
    let ids = task.defectIds;
    if ((!ids || !ids.length) && task.templateId) {
        ids = ref.templates[task.templateId]?.defectIds;
    }
    return (ids || []).map((id) => ({ id, ...(ref.defects[id] || {}) })).filter((d) => d.name);
}

// ---------------------------------------------------------------------
function render(root) {
    const b = ref.buyers[task?.buyerId]?.name || "—";
    const st = ref.styles[task?.styleId]?.name || "—";
    const ln = ref.lines[lineId]?.name || "—";
    const md = ref.modules[task?.moduleId]?.name || "—";
    const initials = (profile.name || "W").slice(0, 2).toUpperCase();

    root.innerHTML = `
    <div class="worker-shell">
      <div class="worker-top">
        <div class="avatar">${initials}</div>
        <div>
          <div style="font-weight:700">${escapeHtml(profile.name)}</div>
          <div class="faint" style="font-size:12px">QC Inspector</div>
        </div>
        <div class="right row">
          <button class="iconbtn" id="w-theme" title="Toggle theme">◐</button>
          <button class="btn btn-ghost btn-sm" id="w-logout">Sign out</button>
        </div>
      </div>
      <div class="worker-body">
        ${task ? "" : `<div class="card empty">No active task is assigned to your line yet.<br>Please contact your Admin.</div>`}
        ${task ? `
        <div class="card" style="margin-bottom:16px">
          <div class="card-head"><div class="card-title">Today's Task</div>
            <span class="badge blue">${escapeHtml(todayKey())}</span></div>
          <div class="task-grid">
            ${cell("Buyer", b)} ${cell("Style", st)} ${cell("Task ID", task.taskCode || task.id)}
            ${cell("Production Line", ln)} ${cell("Module", md)}
            ${cell("Shift", shiftInfo.shift.name)} ${cell("Team", shiftInfo.currentTeamName)}
            ${cell("Current Hour", "Hour " + entryState.hour)}
          </div>
        </div>
        <button class="btn btn-primary btn-lg btn-block" id="w-start" style="margin-bottom:20px">
          ▶ START HOURLY ENTRY
        </button>
        <div id="w-entry"></div>
        <div class="card" style="margin-top:20px">
          <div class="card-head"><div class="card-title">My Recent Entries</div></div>
          <div id="w-history"><div class="empty">Loading…</div></div>
        </div>` : ""}
      </div>
    </div>`;

    root.querySelector("#w-logout").onclick = () => logout();
    root.querySelector("#w-theme").onclick = toggleTheme;
    if (task) {
        root.querySelector("#w-start").onclick = () => { entryState.stage = taskStages()[0]; renderEntry(); };
        loadHistory();
    }
}

const cell = (k, v) => `<div class="task-cell"><div class="k">${k}</div><div class="v">${escapeHtml(v)}</div></div>`;

function renderEntry() {
    const host = document.getElementById("w-entry");
    const stages = taskStages();
    const defects = taskDefects();
    const hours = Array.from({ length: DEFAULT_HOURS }, (_, i) => i + 1);

    host.innerHTML = `
    <div class="card">
      <label>Inspection Hour</label>
      <select id="e-hour" style="margin-bottom:14px">
        ${hours.map((h) => `<option value="${h}" ${h === entryState.hour ? "selected" : ""}>Hour ${h}</option>`).join("")}
      </select>

      <label>Inspection Stage</label>
      <div class="row wrap" style="margin-bottom:16px" id="e-stages">
        ${stages.map((s) => `<div class="stage-tab ${s === entryState.stage ? "active" : ""}" data-s="${s}">${STAGES[s]}</div>`).join("")}
      </div>

      <div class="grid-2">
        <div class="field"><label>Checked Quantity</label>
          <input type="number" inputmode="numeric" min="0" id="e-checked" class="num-input" value="${entryState.checkedQty}" placeholder="0"></div>
        <div class="field"><label>Defect Quantity (defective pieces)</label>
          <input type="number" inputmode="numeric" min="0" id="e-defect" class="num-input" value="${entryState.defectQty}" placeholder="0"></div>
      </div>

      ${defects.length ? `
      <label style="margin-top:8px">Defects (${STAGES[entryState.stage] || ""})</label>
      <div id="e-defects" style="margin-bottom:16px">
        ${defects.map((d) => `
          <div class="defect-row">
            <div class="name">${escapeHtml(d.name)}${d.category ? ` <span class="faint">· ${escapeHtml(d.category)}</span>` : ""}</div>
            <div class="stepper">
              <button data-dec="${d.id}">−</button>
              <input type="number" min="0" data-def="${d.id}" value="${entryState.defects[d.id] || 0}">
              <button data-inc="${d.id}">+</button>
            </div>
          </div>`).join("")}
      </div>` : ""}

      <div class="section-label">Auto-calculated</div>
      <div class="grid-3" id="e-calc"></div>

      <div class="row" style="margin-top:18px">
        <button class="btn btn-ghost" id="e-cancel">Cancel</button>
        <button class="btn btn-primary right" id="e-submit">✓ Submit Entry</button>
      </div>
    </div>`;

    const rec = () => {
        entryState.hour = Number(host.querySelector("#e-hour").value);
        entryState.checkedQty = host.querySelector("#e-checked").value;
        entryState.defectQty = host.querySelector("#e-defect").value;
    };
    host.querySelector("#e-hour").onchange = rec;
    host.querySelector("#e-checked").oninput = () => { rec(); updateCalc(); };
    host.querySelector("#e-defect").oninput = () => { rec(); updateCalc(); };
    host.querySelectorAll("#e-stages .stage-tab").forEach((t) =>
        t.onclick = () => { rec(); entryState.stage = t.dataset.s; renderEntry(); });
    host.querySelectorAll("[data-def]").forEach((inp) =>
        inp.oninput = () => { entryState.defects[inp.dataset.def] = Math.max(0, +inp.value || 0); updateCalc(); });
    host.querySelectorAll("[data-inc]").forEach((btn) =>
        btn.onclick = () => step(btn.dataset.inc, 1));
    host.querySelectorAll("[data-dec]").forEach((btn) =>
        btn.onclick = () => step(btn.dataset.dec, -1));
    host.querySelector("#e-cancel").onclick = () => { host.innerHTML = ""; };
    host.querySelector("#e-submit").onclick = submitEntry;
    updateCalc();
}

function step(id, delta) {
    const inp = document.querySelector(`[data-def="${id}"]`);
    const v = Math.max(0, (+inp.value || 0) + delta);
    inp.value = v; entryState.defects[id] = v; updateCalc();
}

function updateCalc() {
    const m = calcMetrics(entryState.checkedQty, entryState.defectQty, entryState.defects);
    const box = document.getElementById("e-calc");
    if (!box) return;
    box.innerHTML = `
      ${metric("Total Defects", m.totalDefects)}
      ${metric("Passed Qty", m.passedQty, "text-good")}
      ${metric("Rejected Qty", m.rejectedQty, "text-bad")}
      ${metric("DHU %", m.dhu.toFixed(2), "text-" + dhuClass(m.dhu))}
      ${metric("Pass %", m.passPct.toFixed(2), "text-good")}
      ${metric("Reject %", m.rejectPct.toFixed(2), "text-bad")}`;
}
const metric = (k, v, cls = "") => `<div class="big-metric"><div class="v ${cls}">${v}</div><div class="k">${k}</div></div>`;

async function submitEntry() {
    if (!entryState.stage) return toast("Select an inspection stage", "warn");
    const checked = +entryState.checkedQty || 0;
    if (checked <= 0) return toast("Enter a checked quantity", "warn");

    const m = calcMetrics(entryState.checkedQty, entryState.defectQty, entryState.defects);
    const payload = {
        ...m,
        defects: { ...entryState.defects },
        workerId: profile.uid, workerName: profile.name,
        taskId: task.id, taskCode: task.taskCode || task.id,
        buyerId: task.buyerId, styleId: task.styleId, moduleId: task.moduleId,
        shift: shiftInfo.shiftKey, shiftName: shiftInfo.shift.name,
        team: shiftInfo.currentTeamKey, teamName: shiftInfo.currentTeamName,
        stage: entryState.stage
    };

    try {
        await saveEntry(todayKey(), lineId, entryState.hour, entryState.stage, payload);
        await audit("hourly_entry", `${STAGES[entryState.stage]} · Hour ${entryState.hour} · Line ${lineId} · DHU ${m.dhu}%`, profile.email);
        if (m.dhu >= (ref.settings.dhuAlert || 10)) {
            await pushNotification({ type: "high_dhu", severity: "high",
                text: `High DHU ${m.dhu}% on ${ref.lines[lineId]?.name || lineId} (Hour ${entryState.hour}, ${STAGES[entryState.stage]})`,
                lineId, hour: entryState.hour });
        }
        toast("Entry submitted ✓", "success");
        entryState = { hour: Math.min(entryState.hour + 1, DEFAULT_HOURS), stage: taskStages()[0], checkedQty: "", defectQty: "", defects: {} };
        document.getElementById("w-entry").innerHTML = "";
        loadHistory();
    } catch (e) {
        console.error(e);
        toast("Save failed: " + e.message, "error");
    }
}

async function loadHistory() {
    const day = await getDayEntries(todayKey());
    const rows = flattenDay(todayKey(), day)
        .filter((r) => r.workerId === profile.uid)
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
        .slice(0, 12);
    const host = document.getElementById("w-history");
    if (!host) return;
    if (!rows.length) { host.innerHTML = `<div class="empty">No entries yet today.</div>`; return; }
    host.innerHTML = `<div class="table-wrap"><table><thead><tr>
        <th>Hour</th><th>Stage</th><th>Checked</th><th>Defects</th><th>DHU%</th><th>Pass%</th></tr></thead><tbody>
        ${rows.map((r) => `<tr>
          <td>Hour ${r.hour}</td><td>${STAGES[r.stage] || r.stage}</td>
          <td>${r.checkedQty}</td><td>${r.totalDefects}</td>
          <td><span class="badge ${dhuClass(r.dhu)}">${(r.dhu ?? 0).toFixed?.(2) ?? r.dhu}</span></td>
          <td>${(r.passPct ?? 0)}%</td></tr>`).join("")}
        </tbody></table></div>`;
}

function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("qms-theme", next);
}
