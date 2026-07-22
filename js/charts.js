// =====================================================================
// Brandix QMS — Chart.js helpers (theme-aware)
// =====================================================================

const registry = new Map();

function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
        grid: cs.getPropertyValue("--border").trim(),
        text: cs.getPropertyValue("--text-muted").trim(),
        primary: cs.getPropertyValue("--primary").trim()
    };
}

export const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

function base() {
    const c = themeColors();
    Chart.defaults.color = c.text;
    Chart.defaults.font.family = "Inter, sans-serif";
    return {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } } },
        scales: {
            x: { grid: { color: c.grid, drawBorder: false }, ticks: { color: c.text } },
            y: { grid: { color: c.grid, drawBorder: false }, ticks: { color: c.text }, beginAtZero: true }
        }
    };
}

/** Create or update a chart bound to a canvas id. */
export function render(id, type, data, extraOpts = {}) {
    const el = document.getElementById(id);
    if (!el) return null;
    const opts = deepMerge(base(), extraOpts);
    if (registry.has(id)) {
        const ch = registry.get(id);
        ch.data = data;
        ch.options = opts;
        ch.update();
        return ch;
    }
    const ch = new Chart(el.getContext("2d"), { type, data, options: opts });
    registry.set(id, ch);
    return ch;
}

export function destroyAll() {
    registry.forEach((c) => c.destroy());
    registry.clear();
}

function deepMerge(a, b) {
    const out = Array.isArray(a) ? [...a] : { ...a };
    for (const k in b) {
        if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) {
            out[k] = deepMerge(a[k] || {}, b[k]);
        } else out[k] = b[k];
    }
    return out;
}
