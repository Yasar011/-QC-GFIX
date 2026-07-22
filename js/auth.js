// =====================================================================
// Brandix QMS — Authentication & role resolution
// =====================================================================

import {
    signInWithEmailAndPassword, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth, app } from "./firebase-config.js";
import { getUser, setUser, readOnce, audit } from "./db.js";

export function onAuth(cb) {
    return onAuthStateChanged(auth, cb);
}

export async function login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
}

export async function logout() {
    await signOut(auth);
}

/**
 * Load the QMS profile for a signed-in user. If no users exist yet, the
 * first person to sign in is promoted to admin (bootstrap) so the system
 * can be configured.
 */
export async function resolveProfile(user) {
    let profile = await getUser(user.uid);
    if (!profile) {
        const allUsers = await readOnce("users");
        const isFirst = !allUsers || Object.keys(allUsers).length === 0;
        profile = {
            name: user.displayName || user.email.split("@")[0],
            email: user.email,
            role: isFirst ? "admin" : "worker",
            active: true,
            createdAt: Date.now()
        };
        await setUser(user.uid, profile);
        await audit(isFirst ? "bootstrap_admin" : "auto_provision_worker",
            `Profile created for ${user.email}`, user.email);
    }
    return { uid: user.uid, ...profile };
}

/**
 * Create a new auth user WITHOUT disturbing the current admin session, by
 * using a temporary secondary Firebase app instance. Returns the new uid.
 */
export async function createAuthUser(email, password) {
    const secondary = initializeApp(app.options, "secondary-" + Date.now());
    try {
        const secAuth = getAuth(secondary);
        const cred = await createUserWithEmailAndPassword(secAuth, email, password);
        await signOut(secAuth);
        return cred.user.uid;
    } finally {
        await deleteApp(secondary);
    }
}
