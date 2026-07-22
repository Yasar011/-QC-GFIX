// =====================================================================
// Brandix QMS — Optional sample data seeder
// ---------------------------------------------------------------------
// Populates the AAAQMS/ root with example lines, modules, buyers,
// styles, defects, an inspection template and a task so you can try the
// worker flow immediately.
//
// HOW TO RUN (no build step required):
//   1. Deploy / serve the app and sign in as the Admin.
//   2. Open the browser DevTools console on the app page.
//   3. Paste:  import('./seed.js').then(m => m.seed())
//
// Safe to run once. Re-running creates duplicate sample records.
// =====================================================================

import { createIn, readOnce } from "./js/db.js";
import { DEFAULT_ROTATION } from "./js/shift.js";
import { qmsRef } from "./js/firebase-config.js";
import { update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export async function seed() {
    console.log("[QMS seed] starting…");

    // Teams & rotation
    await createIn("teams", { name: "Team A" });
    await createIn("teams", { name: "Team B" });
    await update(qmsRef("settings"), {
        rotation: DEFAULT_ROTATION, dhuAlert: 10, workHours: 8, company: "Brandix"
    });

    // Lines & modules
    const line1 = await createIn("productionLines", { name: "Line 01", code: "L01", active: true });
    const line2 = await createIn("productionLines", { name: "Line 02", code: "L02", active: true });
    const modA = await createIn("modules", { name: "Module A", lineId: line1, active: true });
    await createIn("modules", { name: "Module B", lineId: line2, active: true });

    // Buyers & styles
    const buyer = await createIn("buyers", { name: "Nike", code: "NK", active: true });
    const style = await createIn("styles", { name: "Polo Tee 2210", code: "PT2210", buyerId: buyer });

    // Defects
    const defectNames = [
        ["Open Seam", "Stitching"], ["Broken Stitch", "Stitching"], ["Skip Stitch", "Stitching"],
        ["Oil Stain", "Fabric"], ["Measurement", "Measurement"], ["Shade", "Fabric"],
        ["Wrong Label", "Finishing"], ["Puckering", "Stitching"]
    ];
    const defectIds = [];
    for (const [name, category] of defectNames) defectIds.push(await createIn("defects", { name, category }));

    // Inspection template
    const template = await createIn("inspectionTemplates", {
        name: "Standard Sewing Line",
        stages: ["inline", "endline", "thirdParty"],
        defectIds: defectIds.slice(0, 4)
    });

    // Task assigned to Line 01
    await createIn("tasks", {
        taskCode: "TASK-A-001", buyerId: buyer, styleId: style,
        lineId: line1, moduleId: modA, templateId: template,
        stages: [], defectIds: [], active: true
    });

    console.log("[QMS seed] done. Assign a worker to Line 01 and start entering data.");
    return "seeded";
}

// Convenience for console: window.qmsSeed()
if (typeof window !== "undefined") window.qmsSeed = seed;
