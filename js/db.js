// =====================================================================
// Brandix QMS — Data service
// Thin wrapper around Firebase RTDB. EVERYTHING is scoped to AAAQMS/
// via qmsRef(), so this app cannot touch other data in the project.
// =====================================================================

import {
    onValue, get, set, update, remove, push, child, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { qmsRef } from "./firebase-config.js";
import { uid, todayKey } from "./utils.js";

// ---- Generic collection helpers -------------------------------------
export function watch(path, cb) {
    return onValue(qmsRef(path), (snap) => cb(snap.val()));
}

export async function readOnce(path) {
    const snap = await get(qmsRef(path));
    return snap.val();
}

/** Read a collection object into an array of records with `id`. */
export function toList(obj) {
    if (!obj) return [];
    return Object.entries(obj).map(([id, v]) => ({ id, ...v }));
}

export async function createIn(collection, data) {
    const id = uid();
    await set(qmsRef(`${collection}/${id}`), { ...data, createdAt: Date.now() });
    return id;
}

export async function updateIn(collection, id, data) {
    await update(qmsRef(`${collection}/${id}`), { ...data, updatedAt: Date.now() });
}

export async function removeIn(collection, id) {
    await remove(qmsRef(`${collection}/${id}`));
}

// ---- Users ----------------------------------------------------------
export async function getUser(uidKey) {
    return readOnce(`users/${uidKey}`);
}
export async function setUser(uidKey, data) {
    await update(qmsRef(`users/${uidKey}`), data);
}

// ---- Hourly entries -------------------------------------------------
// Path: hourlyEntries/{date}/{lineId}/{hour}/{stage}
//
// A whole hour is submitted together (one row per required stage). Saving
// REPLACES the entire hour node, so re-submitting an already-completed
// hour overwrites the previous data for that hour rather than layering
// on top of it — there is never stale/duplicate data for the same hour.
export async function getHourEntry(date, lineId, hour) {
    return readOnce(`hourlyEntries/${date}/${lineId}/hour${hour}`);
}

export async function saveHourEntries(date, lineId, hour, stagePayloads) {
    const now = Date.now();
    const node = {};
    let checked = 0, defects = 0, rejected = 0;
    for (const [stage, payload] of Object.entries(stagePayloads)) {
        node[stage] = { ...payload, savedAt: now };
        checked += Number(payload.checkedQty) || 0;
        defects += Number(payload.totalDefects) || 0;
        rejected += Number(payload.rejectedQty) || 0;
    }
    node.calculations = {
        checkedQty: checked, totalDefects: defects, rejectedQty: rejected,
        dhu: checked ? Math.round((defects / checked) * 10000) / 100 : 0,
        updatedAt: now
    };
    await set(qmsRef(`hourlyEntries/${date}/${lineId}/hour${hour}`), node);
}

export async function getDayEntries(date) {
    return readOnce(`hourlyEntries/${date}`);
}

/** Flatten a day's tree into a list of stage-level entry records. */
export function flattenDay(date, dayObj) {
    const out = [];
    if (!dayObj) return out;
    for (const [lineId, hours] of Object.entries(dayObj)) {
        for (const [hourKey, stages] of Object.entries(hours || {})) {
            const hour = Number(String(hourKey).replace("hour", "")) || 0;
            for (const [stage, rec] of Object.entries(stages || {})) {
                if (stage === "calculations") continue;
                out.push({ date, lineId, hour, stage, ...rec });
            }
        }
    }
    return out;
}

// ---- Notifications --------------------------------------------------
export async function pushNotification(n) {
    const r = push(qmsRef("notifications"));
    await set(r, { ...n, ts: Date.now(), read: false });
}

// ---- Audit log ------------------------------------------------------
export async function audit(action, detail, actor) {
    const r = push(qmsRef("logs"));
    await set(r, {
        action, detail: detail || "",
        actor: actor || "system",
        ts: Date.now()
    });
}

export { serverTimestamp, todayKey };
