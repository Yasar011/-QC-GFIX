// =====================================================================
// Brandix QMS — Firebase Configuration
// ---------------------------------------------------------------------
// Dedicated Firebase project for this app (qc-g-fi). All data still
// lives under the AAAQMS/ root as a clean namespace/convention.
// Use the qmsRef() helper below instead of ref(db, ...) directly.
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyBASpaiX5SXEQhHtxS1y-DbR0zh05fTEgI",
    authDomain: "qc-g-fi.firebaseapp.com",
    databaseURL: "https://qc-g-fi-default-rtdb.firebaseio.com",
    projectId: "qc-g-fi",
    storageBucket: "qc-g-fi.firebasestorage.app",
    messagingSenderId: "520607851516",
    appId: "1:520607851516:web:a4e5a905033d423c5e4879",
    measurementId: "G-M6BN5PSJZZ"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const storage = getStorage(app);

// The single, mandatory root for ALL QMS data.
export const QMS_ROOT = "AAAQMS";

/**
 * Build a database reference guaranteed to live under AAAQMS/.
 * @param {string} [path] path relative to the QMS root, e.g. "users/uid".
 */
export function qmsRef(path = "") {
    const clean = String(path).replace(/^\/+|\/+$/g, "");
    return ref(db, clean ? `${QMS_ROOT}/${clean}` : QMS_ROOT);
}
