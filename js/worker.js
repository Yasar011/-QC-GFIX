// =====================================================================
// Brandix QMS — Worker interface
// Extremely simple, tablet-friendly hourly quality entry.
// Shows ONLY the current task, its required stages and its relevant
// defects. The worker never calculates anything.
//
// One hour = one form. Every required stage (Inline / End Line / Third
// Party / ...) is entered together and submitted in a single action.
// Resubmitting an already-completed hour overwrites it — there's never
// stale or duplicate data for that hour.
// =====================================================================

import { readOnce, toList, saveHourEntries, getHourEntry, getDayEntries, flattenDay,
         pushNotification, audit } from "./db.js";
import { STAGES, calcMetrics, todayKey, currentHourIndex, DEFAULT_HOURS,
         toast, escapeHtml, dhuClass, confirmDialog } from "./utils.js";
import { resolveShiftTeam } from "./shift.js";
import { logout } from "./auth.js";

let ref = {};        // reference collections
let profile, task, lineId, shiftInfo;
let entryState = { hour: 1, stages: {} };   // stages: { [stageKey]: { checkedQty, defectQty, defects:{} } }
let existingHour = null;                     // previously saved data for the selected hour, if any

export async function mountWorker(root, prof) {
    profile = prof;
    await loadReference();
    resolveContext();
    render(root);
}

async function loadReference() {
    const [users, lines, buyers, styles, tasks, defects, settings] =
        await Promise.all([
            readOnce("users"), readOnce("productionLines"),
            readOnce("buyers"), readOnce("styles"), readOnce("tasks"),
            readOnce("defects"), readOnce("settings")
        ]);
    ref = {
        users: users || {}, lines: lines || {},
        buyers: buyers || {}, styles: styles || {}, tasks: tasks || {},
        defects: defects || {}, settings: settings || {}
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
    return (task.stages || []).filter((s) => STAGES[s]);
}
function taskDefects() {
    if (!task) return [];
    return (task.defectIds || []).map((id) => ({ id, ...(ref.defects[id] || {}) })).filter((d) => d.name);
}

// ---------------------------------------------------------------------
function render(root) {
    const b = ref.buyers[task?.buyerId]?.name || "—";
    const st = ref.styles[task?.styleId]?.name || "—";
    const ln = ref.lines[lineId]?.name || "—";
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
            ${cell("Production Line", ln)}
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
        root.querySelector("#w-start").onclick = () => openHour(entryState.hour);
        loadHistory();
    }
}

const cell = (k, v) => `<div class="task-cell"><div class="k">${k}</div><div class="v">${escapeHtml(v)}</div></div>`;

async function openHour(hour) {
    entryState.hour = hour;
    const stages = taskStages();
    existingHour = await getHourEntry(todayKey(), lineId, hour);

    entryState.stages = {};
    stages.forEach((s) => {
        const prev = existingHour?.[s];
        entryState.stages[s] = {
            checkedQty: prev?.checkedQty ?? "",
            defectQty: prev?.defectQty ?? "",
            defects: { ...(prev?.defects || {}) }
        };
    });
    renderEntry();
}

function renderEntry() {
    const host = document.getElementById("w-entry");
    const stages = taskStages();
    const defects = taskDefects();
    const hours = Array.from({ length: DEFAULT_HOURS }, (_, i) => i + 1);
    const isUpdate = !!existingHour;

    host.innerHTML = `
    <div class="card">
      <div class="row" style="margin-bottom:14px">
        <label style="margin:0;flex:1">
          Inspection Hour
          <select id="e-hour">
            ${hours.map((h) => `<option value="${h}" ${h === entryState.hour ? "selected" : ""}>Hour ${h}</option>`).join("")}
          </select>
        </label>
        ${isUpdate ? `<span class="badge warn" style="margin-top:18px">Already submitted — editing will overwrite</span>` : ""}
      </div>

      ${stages.length ? stages.map((s) => stageBlock(s, defects)).join("") : `<div class="empty">This task has no inspection stages configured.</div>`}

      <div class="section-label">Hour Total (auto-calculated)</div>
      <div class="grid-3" id="e-calc"></div>

      <div class="row" style="margin-top:18px">
        <button class="btn btn-ghost" id="e-cancel">Cancel</button>
        <button class="btn btn-primary right" id="e-submit">${isUpdate ? "✓ Update Entry" : "✓ Submit Entry"}</button>
      </div>
    </div>`;

    host.querySelector("#e-hour").onchange = (e) => openHour(Number(e.target.value));
    host.querySelectorAll("[data-checked]").forEach((inp) =>
        inp.oninput = () => { entryState.stages[inp.dataset.checked].checkedQty = inp.value; updateCalc(); });
    host.querySelectorAll("[data-defectqty]").forEach((inp) =>
        inp.oninput = () => { entryState.stages[inp.dataset.defectqty].defectQty = inp.value; updateCalc(); });
    host.querySelectorAll("[data-def]").forEach((inp) =>
        inp.oninput = () => {
            const [stage, defId] = inp.dataset.def.split("::");
            entryState.stages[stage].defects[defId] = Math.max(0, +inp.value || 0);
            updateCalc();
        });
    host.querySelectorAll("[data-inc]").forEach((btn) => btn.onclick = () => step(btn.dataset.inc, 1));
    host.querySelectorAll("[data-dec]").forEach((btn) => btn.onclick = () => step(btn.dataset.dec, -1));
    host.querySelectorAll("[data-toggle-defects]").forEach((btn) =>
        btn.onclick = () => {
            const box = host.querySelector(`[data-defects-box="${btn.dataset.toggleDefects}"]`);
            box.classList.toggle("hidden");
        });
    host.querySelector("#e-cancel").onclick = () => { host.innerHTML = ""; };
    host.querySelector("#e-submit").onclick = submitHour;
    updateCalc();
}

function stageBlock(stage, defects) {
    const st = entryState.stages[stage];
    return `
    <div class="task-cell" style="margin-bottom:14px">
      <div class="row" style="margin-bottom:10px">
        <div class="v" style="font-size:15px">${STAGES[stage]}</div>
        ${defects.length ? `<button class="iconbtn right" data-toggle-defects="${stage}" type="button">Defect breakdown ▾</button>` : ""}
      </div>
      <div class="grid-2">
        <div class="field"><label>Checked Qty</label>
          <input type="number" inputmode="numeric" min="0" class="num-input" data-checked="${stage}" value="${st.checkedQty}" placeholder="0"></div>
        <div class="field"><label>Defect Qty</label>
          <input type="number" inputmode="numeric" min="0" class="num-input" data-defectqty="${stage}" value="${st.defectQty}" placeholder="0"></div>
      </div>
      ${defects.length ? `
      <div data-defects-box="${stage}" class="hidden">
        ${defects.map((d) => `
          <div class="defect-row">
            <div class="name">${escapeHtml(d.name)}${d.category ? ` <span class="faint">· ${escapeHtml(d.category)}</span>` : ""}</div>
            <div class="stepper">
              <button type="button" data-dec="${stage}::${d.id}">−</button>
              <input type="number" min="0" data-def="${stage}::${d.id}" value="${st.defects[d.id] || 0}">
              <button type="button" data-inc="${stage}::${d.id}">+</button>
            </div>
          </div>`).join("")}
      </div>` : ""}
    </div>`;
}

function step(key, delta) {
    const [stage, defId] = key.split("::");
    const inp = document.querySelector(`[data-def="${stage}::${defId}"]`);
    const v = Math.max(0, (+inp.value || 0) + delta);
    inp.value = v; entryState.stages[stage].defects[defId] = v; updateCalc();
}

function updateCalc() {
    const box = document.getElementById("e-calc");
    if (!box) return;
    let checked = 0, totalDefects = 0, rejected = 0;
    Object.values(entryState.stages).forEach((st) => {
        const m = calcMetrics(st.checkedQty, st.defectQty, st.defects);
        checked += m.checkedQty; totalDefects += m.totalDefects; rejected += m.rejectedQty;
    });
    const passed = checked - rejected;
    const dhu = checked ? Math.round((totalDefects / checked) * 10000) / 100 : 0;
    const passPct = checked ? Math.round((passed / checked) * 10000) / 100 : 0;
    const rejectPct = checked ? Math.round((rejected / checked) * 10000) / 100 : 0;

    box.innerHTML = `
      ${metric("Checked", checked)}
      ${metric("Total Defects", totalDefects)}
      ${metric("Passed", passed, "text-good")}
      ${metric("Rejected", rejected, "text-bad")}
      ${metric("DHU %", dhu.toFixed(2), "text-" + dhuClass(dhu))}
      ${metric("Pass %", passPct.toFixed(2), "text-good")}`;
}
const metric = (k, v, cls = "") => `<div class="big-metric"><div class="v ${cls}">${v}</div><div class="k">${k}</div></div>`;

async function submitHour() {
    const stages = taskStages();
    if (!stages.length) return toast("No inspection stages configured for this task", "warn");

    const anyChecked = stages.some((s) => (+entryState.stages[s].checkedQty || 0) > 0);
    if (!anyChecked) return toast("Enter a checked quantity for at least one stage", "warn");

    const payloads = {};
    let worstDhu = 0;
    for (const s of stages) {
        const st = entryState.stages[s];
        const m = calcMetrics(st.checkedQty, st.defectQty, st.defects);
        if (m.checkedQty <= 0) continue; // skip stages left empty
        payloads[s] = {
            ...m,
            defects: { ...st.defects },
            workerId: profile.id, workerName: profile.name,
            taskId: task.id, taskCode: task.taskCode || task.id,
            buyerId: task.buyerId, styleId: task.styleId,
            shift: shiftInfo.shiftKey, shiftName: shiftInfo.shift.name,
            team: shiftInfo.currentTeamKey, teamName: shiftInfo.currentTeamName,
            stage: s
        };
        worstDhu = Math.max(worstDhu, m.dhu);
    }

    try {
        await saveHourEntries(todayKey(), lineId, entryState.hour, payloads);
        await audit("hourly_entry", `Hour ${entryState.hour} · Line ${lineId} · ${Object.keys(payloads).length} stage(s) · Worst DHU ${worstDhu}%`, profile.username);
        if (worstDhu >= (ref.settings.dhuAlert || 10)) {
            await pushNotification({ type: "high_dhu", severity: "high",
                text: `High DHU ${worstDhu}% on ${ref.lines[lineId]?.name || lineId} (Hour ${entryState.hour})`,
                lineId, hour: entryState.hour });
        }
        toast(existingHour ? "Hour updated ✓" : "Entry submitted ✓", "success");
        document.getElementById("w-entry").innerHTML = "";
        existingHour = null;
        loadHistory();
    } catch (e) {
        console.error(e);
        toast("Save failed: " + e.message, "error");
    }
}

async function loadHistory() {
    const day = await getDayEntries(todayKey());
    const rows = flattenDay(todayKey(), day)
        .filter((r) => r.workerId === profile.id)
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
        .slice(0, 12);
    const host = document.getElementById("w-history");
    if (!host) return;
    if (!rows.length) { host.innerHTML = `<div class="empty">No entries yet today.</div>`; return; }
    host.innerHTML = `<div class="table-wrap"><table><thead><tr>
        <th>Hour</th><th>Stage</th><th>Checked</th><th>Defects</th><th>DHU%</th><th>Pass%</th></tr></thead><tbody>
        ${rows.map((r) => `<tr>
          <td><a href="#" data-open-hour="${r.hour}">Hour ${r.hour}</a></td><td>${STAGES[r.stage] || r.stage}</td>
          <td>${r.checkedQty}</td><td>${r.totalDefects}</td>
          <td><span class="badge ${dhuClass(r.dhu)}">${(r.dhu ?? 0).toFixed?.(2) ?? r.dhu}</span></td>
          <td>${(r.passPct ?? 0)}%</td></tr>`).join("")}
        </tbody></table></div>`;
    host.querySelectorAll("[data-open-hour]").forEach((a) => a.onclick = (e) => {
        e.preventDefault(); openHour(Number(a.dataset.openHour));
        document.getElementById("w-entry").scrollIntoView({ behavior: "smooth" });
    });
}

function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("qms-theme", next);
}
