# Brandix Quality Management System (QMS)

A real-time, browser-based digital quality management platform that replaces
manual, paper-based hourly quality inspection. QC workers enter hourly
inspection data on a simple tablet-friendly screen; Admins get a live
dashboard, dynamic task configuration, filtering, analytics and exports.

Built with **vanilla HTML5 + CSS3 + ES6 modules** (no framework), **Firebase**
(Auth + Realtime Database + Hosting) and **Chart.js**. All QMS data lives
exclusively under the `AAAQMS/` database root, isolated from anything else in
the Firebase project.

> The previous IoT machine-sensor monitor that used to be `index.html` is
> preserved unchanged at **`machine-monitor.html`**.

---

## Features

**Worker (QC Inspector)**
- Login, then a single simple screen showing today's task (buyer, style, task
  ID, line, module, shift, team, current hour).
- One big **START HOURLY ENTRY** button.
- Enters only **Checked Quantity** and **Defect Quantity** (plus per-defect
  counts). The system auto-calculates Total Defects, Passed, Rejected,
  DHU %, Pass % and Reject % — the worker never calculates anything.
- Sees **only** the inspection stages and defects assigned to the current task.
- Views their own recent entries.

**Admin**
- Live dashboard: workers online, active lines/tasks, today's DHU, pass/reject,
  pending vs completed entries, DHU trend, top defects, line/team/shift
  performance, recent submissions — updates in real time.
- Full management (CRUD) of users, production lines, modules, buyers, styles,
  defects, inspection templates, tasks, teams.
- Dynamic **task system**: each task defines its own stages and defect list
  (directly or via an inspection template).
- Shift & team rotation engine (2 shifts, 2 teams, configurable cadence, manual
  override).
- Reports & analytics with a sticky **filter bar** (Today/Week/Month/Custom +
  line, module, buyer, style, task, stage, defect, team, search) and **Reset
  All**.
- Export to **CSV, Excel (.xlsx), PDF** and **Print**.
- Alerts (e.g. high DHU) and an **audit log** of key actions.
- Light / dark mode, toast notifications, confirm dialogs, loading indicators.

---

## Project structure

```
index.html            App shell (loads login → Worker/Admin by role)
machine-monitor.html  Preserved legacy IoT monitor (unrelated to QMS)
css/styles.css        ERP design system (light + dark)
js/
  firebase-config.js  Firebase init + qmsRef() — enforces the AAAQMS/ root
  db.js               Data service (all reads/writes scoped to AAAQMS/)
  auth.js             Auth, role resolution, secondary-app user creation
  utils.js            Calculations (DHU/pass/reject), toast, modal, CSV…
  shift.js            Shift & team rotation engine
  charts.js           Chart.js theme-aware helpers
  worker.js           Worker (tablet) experience
  admin.js            Admin console (dashboard, CRUD, reports, exports)
  app.js              Entry point & router
database.rules.json   Realtime Database security rules (AAAQMS scoped)
firebase.json         Hosting + database rules config
seed.js               Optional sample-data seeder
```

## Data model (`AAAQMS/`)

```
AAAQMS/
├── users/{uid}                 name, email, role, assignedLine/Module/Team, active
├── productionLines/{id}        name, code, active
├── modules/{id}                name, lineId, active
├── buyers/{id}                 name, code, active
├── styles/{id}                 name, code, buyerId
├── defects/{id}                name, category
├── inspectionTemplates/{id}    name, stages[], defectIds[]
├── tasks/{id}                  taskCode, buyerId, styleId, lineId, moduleId,
│                               templateId, stages[], defectIds[], active
├── teams/{id}                  name
├── settings                    rotation{...}, dhuAlert, workHours, company
├── hourlyEntries/{YYYY-MM-DD}/{lineId}/hour{N}/{stage}
│        → checkedQty, defectQty, defects{}, totalDefects, passedQty,
│          rejectedQty, dhu, passPct, rejectPct, worker/task/shift/team, savedAt
│        + calculations (per-hour rollup)
├── notifications/{id}          type, severity, text, ts, read
└── logs/{id}                   action, detail, actor, ts   (audit trail)
```

## Calculations

For each stage entry, given `checkedQty`, `defectQty` (defective pieces) and
per-defect instance counts:

```
totalDefects = Σ per-defect counts
passedQty    = checkedQty − defectQty
rejectedQty  = defectQty
DHU %        = totalDefects / checkedQty × 100
Pass %       = passedQty   / checkedQty × 100
Reject %     = rejectedQty / checkedQty × 100
```

---

## Setup & deploy

1. **Firebase project** — this app reuses the existing project in
   `js/firebase-config.js`. Enable **Email/Password** sign-in in
   Firebase Authentication.

2. **Security rules** — the rules in `database.rules.json` lock down the
   `AAAQMS/` subtree (workers can submit but not delete entries; only admins can
   edit configuration). They also keep `machine_1` (the legacy monitor)
   readable/writable by authenticated users.
   ⚠️ **Reconcile with any existing rules** before deploying — deploying
   replaces the whole database ruleset. If your project has other apps with
   their own paths, merge their rules into this file first.

3. **First admin** — the **first account to sign in** is automatically promoted
   to Admin (bootstrap). Create that user in the Firebase Auth console (or just
   sign in with a new email/password), then use the Admin **Users** screen to
   create workers and assign them to lines/modules/teams.

4. **Run locally**
   ```bash
   npx serve .        # or: python3 -m http.server
   ```
   Open the served URL (ES modules require http://, not file://).

5. **Deploy**
   ```bash
   firebase deploy --only hosting,database
   ```

6. **Sample data (optional)** — sign in as Admin, open the browser console and run:
   ```js
   import('./seed.js').then(m => m.seed())
   ```
   Then assign a worker to **Line 01** to try the hourly-entry flow.

---

## Notes / roadmap

- Real-time is powered by Firebase RTDB listeners; the dashboard and alerts
  update without a page refresh.
- Worker auto-provisioning: a signed-in auth user with no profile is created as
  a worker (or admin if they are the very first user).
- Possible extensions: Firebase Storage for defect photos, scheduled
  server-side "missing hourly entry" alerts (Cloud Functions), and per-buyer
  AQL thresholds.
