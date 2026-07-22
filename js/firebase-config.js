// =====================================================================
// Brandix QMS — Firebase Configuration
// ---------------------------------------------------------------------
// IMPORTANT: This project shares a Firebase project with other apps.
// EVERY read/write for the QMS MUST be scoped under the AAAQMS/ root so
// this application can never interfere with existing data.
// Use the qmsRef() helper below instead of ref(db, ...) directly.
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// Existing project config (data isolated under AAAQMS/).
const firebaseConfig = {
    apiKey: "AIzaSyAn5nAY-bczuJXlCbWazEz9UapTIcbdXHg",
    authDomain: "fir-arduino-a8ce7.firebaseapp.com",
    databaseURL: "https://fir-arduino-a8ce7-default-rtdb.firebaseio.com",
    projectId: "fir-arduino-a8ce7",
    storageBucket: "fir-arduino-a8ce7.firebasestorage.app",
    messagingSenderId: "678375654106",
    appId: "1:678375654106:web:9c91366032ecb5af04dbe3",
    measurementId: "G-NPGMS5MXXH"
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
