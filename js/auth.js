// =====================================================================
// Brandix QMS — Authentication (username + password stored in the DB)
// ---------------------------------------------------------------------
// Workers and admins do NOT need email accounts. The Admin creates each
// user with a username + password; credentials live under AAAQMS/users
// as a salt + SHA-256 hash (never plaintext).
//
// A Firebase *anonymous* sign-in is used only to open the database
// connection so the data is not fully public — the actual identity /
// role is resolved from the DB record. The signed-in QMS user is kept
// in localStorage so a refresh stays logged in.
// =====================================================================

import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth } from "./firebase-config.js";
import { readOnce, createIn, updateIn, audit } from "./db.js";
import { hashPassword, randSalt } from "./utils.js";

const SESSION_KEY = "qms-session";

/**
 * Try to open an anonymous Firebase session. If Anonymous sign-in is
 * disabled in the project, we simply continue — the database rules are
 * open (.read/.write = true) so unauthenticated access still works.
 * Never throws, so app startup can't be blocked by auth settings.
 */
export async function ensureConnection() {
    try {
        if (!auth.currentUser) await signInAnonymously(auth);
    } catch (e) {
        console.warn("[QMS] Anonymous auth unavailable; relying on open DB rules.", e?.code || e?.message || e);
    }
}

export function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); }
    catch { return null; }
}
function setSession(profile) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(profile));
}
export function logout() {
    localStorage.removeItem(SESSION_KEY);
    location.reload();
}

/** True once at least one user exists (used to decide first-admin setup). */
export async function anyUsersExist() {
    const u = await readOnce("users");
    return !!(u && Object.keys(u).length);
}

function findByUsername(users, username) {
    const uname = String(username).trim().toLowerCase();
    const hit = Object.entries(users || {}).find(
        ([, u]) => String(u.username || "").toLowerCase() === uname);
    return hit ? { id: hit[0], ...hit[1] } : null;
}

/** Verify a username + password against the DB and start a session. */
export async function login(username, password) {
    const users = await readOnce("users") || {};
    const u = findByUsername(users, username);
    if (!u) throw new Error("Invalid username or password");
    if (u.active === false) throw new Error("Your account is disabled. Contact an admin.");
    const hash = await hashPassword(password, u.salt || "");
    if (hash !== u.passwordHash) throw new Error("Invalid username or password");

    const profile = {
        id: u.id, name: u.name, username: u.username, role: u.role,
        assignedLine: u.assignedLine || null, assignedModule: u.assignedModule || null,
        assignedTeam: u.assignedTeam || null
    };
    setSession(profile);
    await audit("login", `${u.name} (${u.username})`, u.username);
    return profile;
}

/** Bootstrap the very first Admin from the setup screen. */
export async function createFirstAdmin(name, username, password) {
    const salt = randSalt();
    const passwordHash = await hashPassword(password, salt);
    await createIn("users", {
        name, username: String(username).trim().toLowerCase(),
        role: "admin", active: true, passwordHash, salt
    });
    await audit("bootstrap_admin", `${name} (${username})`, username);
    return login(username, password);
}

/** Admin creates a worker/admin account (credentials stored in the DB). */
export async function createUserAccount(data) {
    const users = await readOnce("users") || {};
    if (findByUsername(users, data.username)) throw new Error("Username already exists");
    const salt = randSalt();
    const passwordHash = await hashPassword(data.password, salt);
    return createIn("users", {
        name: data.name,
        username: String(data.username).trim().toLowerCase(),
        role: data.role || "worker",
        active: data.active !== false,
        assignedLine: data.assignedLine || null,
        assignedModule: data.assignedModule || null,
        assignedTeam: data.assignedTeam || null,
        passwordHash, salt
    });
}

/** Admin resets a user's password. */
export async function resetPassword(id, password) {
    const salt = randSalt();
    const passwordHash = await hashPassword(password, salt);
    await updateIn("users", id, { passwordHash, salt });
}
