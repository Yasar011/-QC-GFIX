// =====================================================================
// Brandix QMS — Shift & Team rotation engine
// ---------------------------------------------------------------------
// Two shifts (A: 06:00–14:00, B: 14:00–22:00) and two teams that rotate
// on a fixed cadence (default every 2 weeks). Shift, team and the
// rotation schedule are stored separately so the mapping stays flexible.
// Admins can also manually override the current mapping.
// =====================================================================

export const DEFAULT_ROTATION = {
    // Anchor date the rotation counting starts from (a Monday).
    anchorDate: "2026-01-05",
    // Weeks per rotation block.
    weeksPerBlock: 2,
    shifts: {
        A: { name: "Shift A", start: "06:00", end: "14:00" },
        B: { name: "Shift B", start: "14:00", end: "22:00" }
    },
    teams: { A: "Team A", B: "Team B" },
    // manual override: { enabled, shiftA_team, shiftB_team }
    override: { enabled: false, shiftA_team: "A", shiftB_team: "B" }
};

function weeksSince(anchorISO, now) {
    const anchor = new Date(anchorISO + "T00:00:00");
    const ms = now - anchor;
    return Math.floor(ms / (7 * 24 * 3600 * 1000));
}

/**
 * Resolve the active shift + the team assigned to each shift right now.
 * @returns {{ shiftKey, shift, teams:{A:teamKey,B:teamKey}, currentTeamKey, currentTeamName, blockIndex }}
 */
export function resolveShiftTeam(rotation = DEFAULT_ROTATION, now = new Date()) {
    const rot = { ...DEFAULT_ROTATION, ...rotation };
    const mins = now.getHours() * 60 + now.getMinutes();

    const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const inShift = (s) => {
        const a = toMin(s.start), b = toMin(s.end);
        return a <= b ? (mins >= a && mins < b) : (mins >= a || mins < b);
    };

    let shiftKey = "A";
    if (inShift(rot.shifts.B)) shiftKey = "B";
    else if (inShift(rot.shifts.A)) shiftKey = "A";
    else shiftKey = mins < toMin(rot.shifts.A.start) ? "B" : "A"; // off-hours fallback

    // Which team is on which shift?
    let teams;
    if (rot.override?.enabled) {
        teams = { A: rot.override.shiftA_team, B: rot.override.shiftB_team };
    } else {
        const block = weeksSince(rot.anchorDate, now);
        const blockIdx = Math.floor(block / rot.weeksPerBlock);
        // Even block: Shift A->Team A, Shift B->Team B. Odd block: swap.
        teams = (blockIdx % 2 === 0)
            ? { A: "A", B: "B" }
            : { A: "B", B: "A" };
    }

    const currentTeamKey = teams[shiftKey];
    return {
        shiftKey,
        shift: rot.shifts[shiftKey],
        teams,
        currentTeamKey,
        currentTeamName: rot.teams[currentTeamKey] || currentTeamKey,
        blockIndex: rot.override?.enabled ? null : Math.floor(weeksSince(rot.anchorDate, now) / rot.weeksPerBlock)
    };
}
