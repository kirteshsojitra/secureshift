import { useState, useEffect, useRef } from "react";
import {
  fetchPatients, createPatient, updatePatient, deletePatient as apiDeletePatient,
  fetchGuards, createGuard, updateGuard, deleteGuard as apiDeleteGuard,
  fetchAssignments, createAssignment, deleteAssignment,
} from "./api";


// ─────────────────────────────────────────────────────────────────────────────
// Shift definitions
// Mon–Fri: AM (07–15, 8h), PM (15–23, 8h), NIGHT (23–07, 8h)
// Sat–Sun: DAY12 (07–19, 12h), NIGHT12 (19–07, 12h)
// ─────────────────────────────────────────────────────────────────────────────
const SITES = [
  { id: 1, name: "Lakehead Manor", color: "#8b5cf6" },
  { id: 2, name: "Pinewood", color: "#10b981" },
  { id: 3, name: "Roseview", color: "#3b82f6" },
];

const SHIFTS = {
  AM: { label: "07–15", time: "07:00–15:00", hours: 8, bg: "#dbeafe", color: "#1e3a8a", weekend: false },
  PM: { label: "15–23", time: "15:00–23:00", hours: 8, bg: "#ede9fe", color: "#4f46e5", weekend: false },
  NIGHT: { label: "23–07", time: "23:00–07:00", hours: 8, bg: "#1e293b", color: "#94a3b8", weekend: false },
  DAY12: { label: "07–19", time: "07:00–19:00", hours: 12, bg: "#d1fae5", color: "#065f46", weekend: true },
  NIGHT12: { label: "19–07", time: "19:00–07:00", hours: 12, bg: "#312e81", color: "#a5b4fc", weekend: true },
};

// Which shifts are valid for a given day index (0=Mon…6=Sun)
function shiftsForDayIdx(dayIdx) {
  return (dayIdx === 5 || dayIdx === 6)
    ? ["DAY12", "NIGHT12"]
    : ["AM", "PM", "NIGHT"];
}
function isWeekendDay(dayIdx) { return dayIdx === 5 || dayIdx === 6; }

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // availability index order (unchanged)
const WATCH = { HIGH: { bg: "#fee2e2", c: "#991b1b" }, MEDIUM: { bg: "#fef3c7", c: "#92400e" }, LOW: { bg: "#dcfce7", c: "#14532d" } };
const AVC = ["#dbeafe:#1e3a8a", "#dcfce7:#14532d", "#ede9fe:#3730a3", "#fce7f3:#831843", "#d1fae5:#064e3b", "#fef3c7:#78350f", "#fee2e2:#991b1b", "#e0f2fe:#0c4a6e", "#fdf4ff:#7e22ce", "#fff7ed:#9a3412"];
const ini = n => n.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase();
const avCol = i => AVC[i % AVC.length].split(":");
const siteOf = id => SITES.find(s => s.id === id) || {};

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────
function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Week display: Sun → Sat  (7 days starting Sunday)
// Day indices (availability/logic): 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun  ← UNCHANGED
// Display order for columns: Sun(6) Mon(0) Tue(1) Wed(2) Thu(3) Fri(4) Sat(5)
const DISPLAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // dayIdx order for columns
const DISPLAY_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getWeekDates(weekOffset = 0) {
  const now = new Date();
  const js = now.getDay(); // 0=Sun…6=Sat
  // Find most recent Sunday
  const diffToSun = -js; // 0 if already Sunday, negative otherwise
  const sun = new Date(now);
  sun.setDate(now.getDate() + diffToSun + weekOffset * 7);
  sun.setHours(0, 0, 0, 0);
  // Return 7 days starting Sunday
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(sun); d.setDate(sun.getDate() + i); return d; });
}
function fmtDate(d) { return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }); }
function weekLabel(dates) { return `${fmtDate(dates[0])} – ${fmtDate(dates[6])}`; }
function dayIdxOfDate(dateKey) {
  const d = new Date(dateKey + "T00:00:00");
  const js = d.getDay(); // 0=Sun
  return js === 0 ? 6 : js - 1; // Mon=0…Sun=6  ← unchanged
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard availability seed  (Sat=5, Sun=6 use DAY12/NIGHT12)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Real schedule data extracted from PDFs (Lakehead Manor, Pinewood, Roseview)
// Week 1 reference: Sun 24 – Sat 30  |  Week 2 reference: Fri 22 – Sat 23
// Weekdays = AM(07–15) + PM(15–23) + NIGHT(23–07)
// Weekends = DAY12(07–19) + NIGHT12(19–07)
// ─────────────────────────────────────────────────────────────────────────────

// Guard record shape: { name, phone, email, site, role, employmentType, schedule }
// schedule: { dayIdx: [shifts] }  (0=Mon…6=Sun)
function makeGuard(name, days, shifts, info = {}) {
  const schedule = {};
  days.forEach(d => { schedule[d] = shifts; });
  // timeOff: array of { id, type:"day_off"|"vacation", start:"YYYY-MM-DD", end:"YYYY-MM-DD", note:"" }
  const defaultRate = info.role === "Shift Lead" ? 25 : info.role === "Senior Guard" ? 23 : info.role === "Floater" ? 24 : 20;
  return { name, phone: "", email: "", site: "", role: "Security Guard", employmentType: "Part-time", notes: "", timeOff: [], hourlyRate: defaultRate, ...info, schedule };
}
// Alias for backward compat
function makeAvail(name, days, shifts) { return makeGuard(name, days, shifts); }

const SEED_PATIENTS = [];

// ─────────────────────────────────────────────────────────────────────────────
// SEED ASSIGNMENTS — exact dates from PDFs (May 2026)
// Navigate to week of May 18 or May 25 to see the full schedule.
// Lakehead+Pinewood week of May 25:  Sun24 Mon25 Tue26 Wed27 Thu28 Fri29 Sat30
// Lakehead+Pinewood Fri22+Sat23:     from the 22-23 PDF
// Roseview week of May 18:           Sat23 Mon18 Tue19 Wed20 Thu21 Fri22 Sat23
// ─────────────────────────────────────────────────────────────────────────────
function buildSeedAssignments() { return []; }

// ─────────────────────────────────────────────────────────────────────────────
// GUARD AVAILABILITY — from PDFs + extra guards added to ensure full coverage
// New per-day schedule format: { dayIdx: [shifts] }  0=Mon…6=Sun
// ─────────────────────────────────────────────────────────────────────────────
const SEED_GUARD_AVAILABILITY = [];



// ─────────────────────────────────────────────────────────────────────────────
// Conflict rule — one shift per day per guard
// ─────────────────────────────────────────────────────────────────────────────
// A guard can only work ONE shift per day regardless of availability.
// Returns conflict object if any assignment exists on that date for that guard.
// type:"same" = exact duplicate (same shift, blocked)
// type:"diff" = already on a different shift (also blocked — one shift per day rule)
function guardConflict(staffName, shift, date, assignments, excludePid = null) {
  if (!staffName.trim()) return null;
  const n = staffName.toLowerCase().trim();
  // excludePid only applies to same-shift duplicate check (so editing an existing assignment doesn't self-conflict)
  const same = assignments.find(a => a.staff.toLowerCase().trim() === n && a.shift === shift && a.date === date && a.patientId !== excludePid);
  if (same) return { type: "same", shift, patientId: same.patientId };
  // One shift per day — check ALL patients including the current one
  const diff = assignments.find(a => a.staff.toLowerCase().trim() === n && a.shift !== shift && a.date === date);
  if (diff) return { type: "diff", shift: diff.shift, patientId: diff.patientId };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Availability check — also validates weekday/weekend shift type match
// ─────────────────────────────────────────────────────────────────────────────
// Per-day availability check using new schedule format
// avail.schedule = { dayIndex: [shifts], ... }
// Check if a date falls within a time-off entry
function isOnTimeOff(guard, dateKey) {
  if (!guard?.timeOff?.length) return null;
  for (const t of guard.timeOff) {
    if (dateKey >= t.start && dateKey <= t.end) {
      const isVacation = t.type === "vacation";
      const sameDay = t.start === t.end;
      if (isVacation && !sameDay)
        return `On vacation ${t.start} – ${t.end}${t.note ? ` (${t.note})` : ""}`;
      return `Day off on ${t.start}${t.note ? ` (${t.note})` : ""}`;
    }
  }
  return null;
}

function guardAvailabilityBlock(staffName, shift, dateKey, guardAvailability) {
  if (!staffName.trim()) return null;
  const n = staffName.toLowerCase().trim();
  const avail = guardAvailability.find(g => g.name.toLowerCase().trim() === n);
  if (!avail) return null;

  // Check time off first
  const offMsg = isOnTimeOff(avail, dateKey);
  if (offMsg) return offMsg;

  const d = new Date(dateKey + "T00:00:00");
  const jsDay = d.getDay();
  const dayIdx = jsDay === 0 ? 6 : jsDay - 1;

  const allowedShifts = avail.schedule[dayIdx];
  if (!allowedShifts || allowedShifts.length === 0)
    return `${staffName} is not available on ${DAYS[dayIdx]}s`;
  if (!allowedShifts.includes(shift))
    return `${staffName} is only available for ${allowedShifts.map(s => SHIFTS[s]?.label).join(" / ")} on ${DAYS[dayIdx]}s`;
  return null;
}

// Helper: get all unique shifts a guard is available for across all days
function guardAllShifts(avail) {
  if (!avail?.schedule) return [];
  return [...new Set(Object.values(avail.schedule).flat())];
}

// Helper: get all days a guard is available
function guardAllDays(avail) {
  if (!avail?.schedule) return [];
  return Object.keys(avail.schedule).map(Number).filter(d => avail.schedule[d]?.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Responsive hook
// ─────────────────────────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(typeof window !== "undefined" ? window.innerWidth <= 640 : false);
  useEffect(() => {
    const fn = () => setMobile(window.innerWidth <= 640);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return mobile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Style helpers
// ─────────────────────────────────────────────────────────────────────────────
const pill = (bg, c) => ({ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: bg, color: c, display: "inline-block", whiteSpace: "nowrap" });
const btnS = (primary, danger) => ({ padding: "6px 12px", borderRadius: 8, border: danger ? "1px solid #fecaca" : primary ? "none" : "1px solid #e2e8f0", background: danger ? "#fff" : primary ? "#3b82f6" : "#fff", color: danger ? "#ef4444" : primary ? "#fff" : "#374151", fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" });
const cardS = (extra = {}) => ({ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, ...extra });
const inpS = { width: "100%", padding: "9px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, color: "#1e293b", background: "#fff", outline: "none", fontFamily: "inherit" };
const selS = { ...inpS, background: "#fff" };

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const mobile = useIsMobile();
  const [page, setPage] = useState("schedule");
  const [sidebarOpen, setSidebar] = useState(false);
  const [patients, setPatients] = useState([]);
  const [assigns, setAssigns] = useState([]);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [siteFilter, setSF] = useState("ALL");
  const [weekOffset, setWO] = useState(1);
  const [nextId, setNextId] = useState(1);
  const [guards, setGuards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [payPeriods, setPayPeriods] = useState([]);
  // Derived: guardAvailability = guards (same shape, guards IS the availability list)
  const guardAvailability = guards;
  const setGA = setGuards;

  const weekDates = getWeekDates(weekOffset);

  // Prevent browser zoom via keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
      }
    };
    const handleWheel = (e) => {
      if (e.ctrlKey) e.preventDefault();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // ── Load all data from MongoDB on mount ──────────────────────────
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchPatients(),
      fetchGuards(),
      fetchAssignments(),
    ]).then(([pats, gds, asgns]) => {
      setPatients(pats.map(p => ({ ...p, id: p._id })));
      setGuards(gds.map(g => ({ ...g, id: g._id })));
      setAssigns(asgns.map(a => ({ ...a, id: a._id })));
    }).catch(err => {
      console.error("Failed to load data:", err);
      showToast("Could not connect to server — check your backend is running", "err");
    }).finally(() => setLoading(false));
  }, []);

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  const getAssign = (pid, sh, date) => assigns.find(a => a.patientId === pid && a.shift === sh && a.date === date);
  // Deduplicated assigns for display/calculation (removes any DB duplicate records)
  const dedupeAssigns = assigns.filter((a, idx, arr) =>
    idx === arr.findIndex(b => b.patientId === a.patientId && b.shift === a.shift && b.date === a.date)
  );

  // gaps across the whole week, respecting which shifts are valid per day
  const gaps = patients.filter(p => p.status === "ACTIVE").flatMap(p =>
    weekDates.flatMap((d) => {
      const dk = toDateKey(d);
      const validShifts = shiftsForDayIdx(dayIdxOfDate(dk));
      const needed = p.requiredShifts.filter(s => validShifts.includes(s));
      return needed.filter(s => !getAssign(p.id, s, dk)).map(s => ({ patient: p, shift: s, date: dk, dayLabel: fmtDate(d) }));
    })
  );

  // staff hours across displayed week
  function buildStaffMap() {
    const weekKeys = new Set(weekDates.map(toDateKey));
    const map = new Map();
    patients.forEach(pat => {
      const st = siteOf(pat.siteId);
      const seenKeys = new Set();
      assigns.filter(a => a.patientId === pat.id && weekKeys.has(a.date)).forEach(a => {
        const dupKey = `${a.patientId}-${a.shift}-${a.date}`;
        if (seenKeys.has(dupKey)) return; // skip DB duplicates
        seenKeys.add(dupKey);
        const k = a.staff.toLowerCase().trim();
        if (!map.has(k)) map.set(k, { name: a.staff, site: st.name, color: st.color, assignments: [], hours: 0 });
        map.get(k).assignments.push({ patient: pat.name, shift: a.shift, hours: SHIFTS[a.shift]?.hours || 0, date: a.date });
        map.get(k).hours += SHIFTS[a.shift]?.hours || 0;
      });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const staffMap = buildStaffMap();

  // doubles = guard working >1 shift on the same day
  const doublesSet = new Map();
  weekDates.forEach(d => {
    const dk = toDateKey(d);
    // Deduplicate assigns by patientId+shift+date first (removes DB duplicates)
    const seen = new Set();
    const uniqueAssigns = assigns.filter(a => {
      if (a.date !== dk) return false;
      const key = `${a.patientId}-${a.shift}-${a.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const dayMap = new Map();
    uniqueAssigns.forEach(a => {
      const k = a.staff.toLowerCase().trim();
      if (!dayMap.has(k)) dayMap.set(k, { name: a.staff, shifts: [], hours: 0 });
      dayMap.get(k).shifts.push(a.shift);
      dayMap.get(k).hours += SHIFTS[a.shift]?.hours || 0;
    });
    dayMap.forEach((v, k) => { if (v.hours > (isWeekendDay(dayIdxOfDate(dk)) ? 12 : 8)) { if (!doublesSet.has(k)) doublesSet.set(k, { name: v.name, days: [] }); doublesSet.get(k).days.push({ date: dk, shifts: v.shifts, hours: v.hours }); } });
  });
  const doubles = [...doublesSet.values()];
  const totalAlerts = gaps.length + doubles.length;

  const saveAssign = async (pid, shift, date, staffName) => {
    const avBlock = guardAvailabilityBlock(staffName, shift, date, guardAvailability);
    if (avBlock) { showToast(avBlock, "err"); return; }
    const c = guardConflict(staffName, shift, date, assigns, pid);
    if (c) { showToast(`Cannot assign — ${staffName} already on ${SHIFTS[c.shift]?.label} shift today (one shift per day)`, "err"); return; }
    const lim = guardHourLimit(staffName, guardAvailability);
    const empT = guardAvailability.find(g => g.name.toLowerCase().trim() === staffName.toLowerCase().trim())?.employmentType || "Full-time";
    const afterHrs = guardWeeklyHours(staffName, assigns, weekDates) + (SHIFTS[shift]?.hours || 0);
    // Remove existing assignment for same slot if any
    const existing = assigns.find(a => a.patientId === pid && a.shift === shift && a.date === date);
    if (existing?._id) await deleteAssignment(existing._id);
    try {
      const saved = await createAssignment({ patientId: pid, shift, date, staff: staffName.trim() });
      setAssigns(prev => [...prev.filter(a => !(a.patientId === pid && a.shift === shift && a.date === date)), { ...saved, id: saved._id }]);
      setModal(null);
      if (afterHrs > lim) showToast(`⚠ ${staffName} assigned — ${afterHrs}h exceeds ${lim}h ${empT} limit`, "warn");
      else showToast(`${staffName} → ${SHIFTS[shift]?.label} on ${date}`);
    } catch (err) { showToast("Failed to save assignment", "err"); }
  };
  const removeAssign = async (pid, shift, date) => {
    const a = getAssign(pid, shift, date);
    if (a?._id) await deleteAssignment(a._id);
    setAssigns(prev => prev.filter(x => !(x.patientId === pid && x.shift === shift && x.date === date)));
    setModal(null); showToast(`${a?.staff || "Staff"} removed`, "warn");
  };
  const savePatient = async (p) => {
    if (p._id || p.id) {
      const pid = p._id || p.id;
      const removed = Object.keys(SHIFTS).filter(s => !p.requiredShifts.includes(s));
      const freed = [...new Set(assigns.filter(a => a.patientId === pid && removed.includes(a.shift)).map(a => a.staff))];
      // Delete freed assignments from DB
      for (const a of assigns.filter(x => x.patientId === pid && removed.includes(x.shift))) {
        if (a._id) await deleteAssignment(a._id);
      }
      setAssigns(prev => prev.filter(a => !(a.patientId === pid && removed.includes(a.shift))));
      try {
        const updated = await updatePatient(pid, p);
        setPatients(prev => prev.map(x => (x._id === pid || x.id === pid) ? { ...updated, id: updated._id } : x));
        if (freed.length) showToast(`Saved — freed: ${freed.join(", ")}`, "warn");
        else showToast("Patient updated");
      } catch (err) { showToast("Failed to update patient", "err"); }
    } else {
      try {
        const created = await createPatient(p);
        setPatients(prev => [...prev, { ...created, id: created._id }]);
        showToast("Patient added");
      } catch (err) { showToast("Failed to add patient", "err"); }
    }
    setModal(null);
  };
  const deletePatient = async (id) => {
    try {
      await apiDeletePatient(id);
      // Also delete all assignments for this patient
      for (const a of assigns.filter(x => x.patientId === id)) {
        if (a._id) await deleteAssignment(a._id);
      }
      setPatients(prev => prev.filter(p => p._id !== id && p.id !== id));
      setAssigns(prev => prev.filter(a => a.patientId !== id));
      setModal(null); showToast("Patient removed", "warn");
    } catch (err) { showToast("Failed to delete patient", "err"); }
  };
  const navTo = (p) => { setPage(p); setSidebar(false); };

  const NAV = [
    ["schedule", "📅", "Schedule", "Main"], ["patients", "🏥", "Patients", "Main"],
    ["guards", "🪪", "Guard availability", "Main"], ["staff", "👮", "Staff hours", "Main"], ["sites", "📍", "Sites", "Main"],
    ["alerts", "🔔", totalAlerts > 0 ? `Alerts (${totalAlerts})` : "Alerts", "Reports"],
    ["payroll", "💰", "Payroll", "Reports"],
    ["suggestions", "🧠", "AI Suggestions", "Reports"],
  ];

  const sidebarStyle = mobile ? { position: "fixed", top: 0, left: 0, height: "100%", zIndex: 45, width: 210, background: "#0f172a", display: "flex", flexDirection: "column", transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform .25s ease", flexShrink: 0 } : { width: 215, background: "#0f172a", display: "flex", flexDirection: "column", flexShrink: 0 };

  return (
    <div id="secureshift-app" style={{ display: "flex", height: "100dvh", fontFamily: "'DM Sans',sans-serif", background: "#f1f5f9", overflow: "hidden", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {mobile && sidebarOpen && <div onClick={() => setSidebar(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", zIndex: 40 }} />}

      <aside style={sidebarStyle}>
        <div style={{ padding: "16px 14px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 3 }}>
            <div style={{ width: 30, height: 30, background: "#3b82f6", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🛡</div>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em" }}>SecureShift</span>
          </div>
          <p style={{ fontSize: 10, color: "#475569" }}>Southbridge Security</p>
        </div>
        {["Main", "Reports"].map(sec => (
          <div key={sec}>
            <div style={{ padding: "10px 14px 3px", fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{sec}</div>
            {NAV.filter(n => n[3] === sec).map(([p, ic, lbl]) => (
              <div key={p} onClick={() => navTo(p)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", margin: "1px 6px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: page === p ? 600 : 400, color: page === p ? "#f1f5f9" : "#94a3b8", background: page === p ? "rgba(59,130,246,.15)" : "transparent", borderLeft: page === p ? "2px solid #3b82f6" : "2px solid transparent" }}>
                <span style={{ fontSize: 13, width: 16, textAlign: "center" }}>{ic}</span>{lbl}
              </div>
            ))}
          </div>
        ))}
        <div style={{ marginTop: "auto", padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div onClick={() => setChatOpen(v => !v)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, cursor: "pointer", background: chatOpen ? "rgba(99,102,241,.2)" : "transparent", marginBottom: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>✦</div>
            <div><div style={{ fontSize: 11, fontWeight: 600, color: "#f1f5f9" }}>AI Assistant</div><div style={{ fontSize: 9, color: "#64748b" }}>Ask about your schedule</div></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#3b82f6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>AD</div>
            <div><div style={{ fontSize: 11, fontWeight: 600, color: "#f1f5f9" }}>Admin</div><div style={{ fontSize: 10, color: "#64748b" }}>Supervisor</div></div>
          </div>
        </div>
      </aside>

      <div id="secureshift-main" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: mobile ? "9px 12px" : "10px 18px", background: "#fff", borderBottom: "1px solid #e2e8f0", gap: 8, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
            {mobile && <button onClick={() => setSidebar(true)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "#374151", padding: "2px", lineHeight: 1, flexShrink: 0 }}>☰</button>}
            <span style={{ fontSize: mobile ? 13 : 15, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {page === "schedule" ? "Schedule" : page === "patients" ? "Patients" : page === "guards" ? "Guard availability" : page === "staff" ? "Staff hours" : page === "sites" ? "Sites" : page === "payroll" ? "Payroll" : page === "suggestions" ? "AI Suggestions" : "Alerts"}
            </span>
            {page === "schedule" && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <button onClick={() => setWO(w => w - 1)} style={{ ...btnS(false), padding: "3px 8px", fontSize: 13, lineHeight: 1 }}>‹</button>
                {!mobile && <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>{weekLabel(weekDates)}</span>}
                <button onClick={() => setWO(w => w + 1)} style={{ ...btnS(false), padding: "3px 8px", fontSize: 13, lineHeight: 1 }}>›</button>
                {weekOffset !== 0 && <button onClick={() => setWO(0)} style={{ ...btnS(false), padding: "3px 8px", fontSize: 11 }}>This week</button>}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            {page === "schedule" && <select style={{ ...selS, width: "auto", minWidth: mobile ? 90 : 140, fontSize: 12, padding: "4px 8px" }} value={siteFilter} onChange={e => setSF(e.target.value)}><option value="ALL">All sites</option>{SITES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
            {page === "schedule" && <button onClick={() => setModal({ type: "generate_schedule" })} style={{ ...btnS(false), padding: "5px 11px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, flexShrink: 0, background: "#10b981", color: "#fff", border: "none" }}><span>⚡</span>{!mobile && <span style={{ marginLeft: 4 }}>Auto Schedule</span>}</button>}
            {page === "schedule" && <button onClick={async () => {
              if (!window.confirm(`Clear ALL assignments for the week of ${weekLabel(weekDates)}?\n\nThis cannot be undone.`)) return;
              const weekKeys = new Set(weekDates.map(toDateKey));
              const weekAssigns = assigns.filter(a => weekKeys.has(a.date));
              if (!weekAssigns.length) { showToast("No assignments to clear", "warn"); return; }
              showToast(`Clearing ${weekAssigns.length} assignments…`, "warn");
              // Delete all in parallel — much faster than sequential
              await Promise.all(weekAssigns.map(a => a._id ? deleteAssignment(a._id) : Promise.resolve()));
              setAssigns(prev => prev.filter(a => !weekKeys.has(a.date)));
              showToast(`✓ Cleared ${weekAssigns.length} assignments`, "warn");
            }} style={{ ...btnS(false), padding: "5px 11px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, flexShrink: 0, background: "#fff", color: "#dc2626", border: "1px solid #fecaca" }}><span>🗑</span>{!mobile && <span style={{ marginLeft: 4 }}>Clear week</span>}</button>}
            {page === "schedule" && <button onClick={() => printSchedule(patients, assigns, weekDates, siteFilter)} style={{ ...btnS(false), padding: "5px 11px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, flexShrink: 0, background: "#0f172a", color: "#fff", border: "none" }}><span>🖨</span>{!mobile && <span style={{ marginLeft: 4 }}>Print / PDF</span>}</button>}
            {page === "patients" && <button style={{ ...btnS(true), padding: mobile ? "5px 10px" : "6px 13px", fontSize: 12 }} onClick={() => setModal({ type: "patient", data: { name: "", siteId: 1, room: "", watchLevel: "MEDIUM", status: "ACTIVE", notes: "", requiredShifts: [] } })}>+ Add patient</button>}
          </div>
        </div>
        {page === "schedule" && mobile && <div style={{ padding: "5px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 11, color: "#64748b", textAlign: "center" }}>{weekLabel(weekDates)}</div>}

        <div id="secureshift-content" style={{ flex: 1, overflow: "auto", padding: mobile ? "10px 12px" : "16px 18px", WebkitOverflowScrolling: "touch" }}>
          {page === "schedule" && <SchedulePage patients={patients} assigns={assigns} siteFilter={siteFilter} getAssign={getAssign} mobile={mobile} weekDates={weekDates} guardAvailability={guardAvailability} onAssign={(pid, sh, date) => setModal({ type: "assign", patientId: pid, shift: sh, date, current: getAssign(pid, sh, date)?.staff || "" })} />}
          {page === "patients" && <PatientsPage patients={patients} assigns={assigns} weekDates={weekDates} getAssign={getAssign} mobile={mobile} onEdit={p => setModal({ type: "patient", data: { ...p } })} onAssign={(pid, sh, date) => setModal({ type: "assign", patientId: pid, shift: sh, date, current: getAssign(pid, sh, date)?.staff || "" })} />}
          {page === "guards" && <GuardsPage guards={guards} mobile={mobile}
            onEdit={g => setModal({ type: "guard_modal", data: { ...g } })}
            onAdd={() => setModal({ type: "guard_modal", data: { name: "", phone: "", email: "", site: "", role: "Security Guard", employmentType: "Full-time", notes: "", schedule: {} } })}
          />}
          {page === "staff" && <StaffPage staffMap={staffMap} doubles={doubles} mobile={mobile} weekDates={weekDates} guards={guards} />}
          {page === "sites" && <SitesPage patients={patients} assigns={assigns} weekDates={weekDates} getAssign={getAssign} />}
          {page === "alerts" && <AlertsPage gaps={gaps} doubles={doubles} patients={patients} onFix={navTo} onAssign={(pid, sh, date) => setModal({ type: "assign", patientId: pid, shift: sh, date, current: getAssign(pid, sh, date)?.staff || "" })} />}
          {page === "suggestions" && <SuggestionsPage assigns={assigns} patients={patients} guards={guards} weekDates={weekDates} mobile={mobile} onAssign={(pid, sh, date) => setModal({ type: "assign", patientId: pid, shift: sh, date, current: getAssign(pid, sh, date)?.staff || "" })} />}
          {page === "payroll" && <PayrollPage guards={guards} assigns={assigns} setGuards={setGuards} mobile={mobile}
            onPaycheque={(g, period) => setModal({ type: "paycheque", guard: g, period })} />}
        </div>
      </div>

      {/* AI Chat Panel */}
      {chatOpen && <AIChatPanel
        patients={patients} assigns={assigns} guards={guards}
        weekDates={weekDates} gaps={gaps} staffMap={staffMap}
        doubles={doubles} mobile={mobile}
        onClose={() => setChatOpen(false)}
      />}

      {modal?.type === "generate_schedule" && <GenerateScheduleModal
        patients={patients} guards={guards} assigns={assigns}
        weekDates={weekDates} mobile={mobile}
        onGenerate={async newAssigns => {
          // Use functional setAssigns to get latest state and deduplicate properly
          setModal(null);
          setAssigns(prev => {
            const existing = new Set(prev.map(a => `${a.patientId}-${a.shift}-${a.date}`));
            const toAdd = newAssigns.filter(a => !existing.has(`${a.patientId}-${a.shift}-${a.date}`));
            if (!toAdd.length) { showToast("Nothing new to add", "warn"); return prev; }
            // Save to DB in background — do NOT update state again after (prevents double-count)
            toAdd.forEach(a => {
              createAssignment(a).then(saved => {
                // Update only the _id on the already-added record
                setAssigns(p => p.map(x =>
                  x.patientId === a.patientId && x.shift === a.shift && x.date === a.date && !x._id
                    ? { ...saved, id: saved._id }
                    : x
                ));
              }).catch(() => { });
            });
            showToast(`⚡ ${toAdd.length} shifts scheduled`, "ok");
            // Add to state immediately (without _id — _id filled in above when DB responds)
            return [...prev, ...toAdd];
          });
        }}
        onClose={() => setModal(null)}
      />}
      {modal?.type === "assign" && <AssignModal modal={modal} patients={patients} assigns={assigns} guardAvailability={guardAvailability} mobile={mobile} weekDates={weekDates} onSave={saveAssign} onRemove={removeAssign} onClose={() => setModal(null)} allAssigns={assigns} />}
      {modal?.type === "patient" && <PatientModal data={modal.data} assigns={assigns} mobile={mobile} onSave={savePatient} onDelete={modal.data.id ? () => deletePatient(modal.data.id) : null} onClose={() => setModal(null)} />}
      {modal?.type === "paycheque" && <PaychequeModal guard={modal.guard} period={modal.period} assigns={assigns} mobile={mobile} onClose={() => setModal(null)} />}
      {modal?.type === "guard_modal" && <GuardModal data={modal.data} mobile={mobile}
        onSave={async g => {
          try {
            if (g._id) {
              const updated = await updateGuard(g._id, g);
              setGA(prev => prev.map(x => x._id === g._id ? { ...updated, id: updated._id } : x));
            } else {
              const created = await createGuard(g);
              setGA(prev => [...prev, { ...created, id: created._id }]);
            }
            setModal(null); showToast(g.name + " saved");
          } catch (err) { showToast("Failed to save guard", "err"); }
        }}
        onDelete={async name => {
          const g = guards.find(x => x.name.toLowerCase() === name.toLowerCase());
          try {
            if (g?._id) await apiDeleteGuard(g._id);
            setGA(prev => prev.filter(x => x.name.toLowerCase() !== name.toLowerCase()));
            setModal(null); showToast("Guard removed", "warn");
          } catch (err) { showToast("Failed to delete guard", "err"); }
        }}
        onClose={() => setModal(null)}
      />}

      {toast && <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", background: toast.type === "ok" ? "#0f172a" : toast.type === "warn" ? "#d97706" : "#dc2626", color: "#fff", padding: "9px 18px", borderRadius: 10, fontSize: 12, fontWeight: 500, zIndex: 100, maxWidth: "90vw", textAlign: "center", whiteSpace: "nowrap" }}>{toast.type === "ok" ? "✓" : toast.type === "warn" ? "⚠" : "⛔"} {toast.msg}</div>}
      {loading && <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.65)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14 }}>
        <div style={{ width: 42, height: 42, border: "3px solid #334155", borderTop: "3px solid #3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}></div>
        <div style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 500 }}>Loading from database…</div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule Page — weekly grid, weekends show DAY12/NIGHT12 rows
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Print / PDF — builds a standalone HTML page from JS data and opens it
// ─────────────────────────────────────────────────────────────────────────────
function printSchedule(patients, assigns, weekDates, siteFilter) {
  const sites = siteFilter === "ALL" ? SITES : SITES.filter(s => s.id === parseInt(siteFilter));

  const SHIFT_COLORS = {
    AM: { bg: "#dbeafe", color: "#1e3a8a", label: "07–15 AM", time: "07:00–15:00", hours: 8 },
    PM: { bg: "#ede9fe", color: "#4f46e5", label: "15–23 PM", time: "15:00–23:00", hours: 8 },
    NIGHT: { bg: "#334155", color: "#e2e8f0", label: "23–07 Night", time: "23:00–07:00", hours: 8 },
    DAY12: { bg: "#d1fae5", color: "#065f46", label: "07–19 Day", time: "07:00–19:00", hours: 12 },
    NIGHT12: { bg: "#312e81", color: "#a5b4fc", label: "19–07 Night", time: "19:00–07:00", hours: 12 },
  };

  const dayName = dk => {
    const d = new Date(dk + "T00:00:00");
    return d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  };

  const getA = (pid, sh, date) => assigns.find(a => a.patientId === pid && a.shift === sh && a.date === date);

  const weekLabel = `${dayName(toDateKey(weekDates[0]))} – ${dayName(toDateKey(weekDates[6]))}`;

  // Build one table per site
  let tablesHTML = "";

  sites.forEach((site, si) => {
    const pts = patients.filter(p => p.siteId === site.id && p.status === "ACTIVE");
    if (!pts.length) return;

    // Column headers (dates in order)
    let headCols = weekDates.map(d => {
      const dk = toDateKey(d);
      const di = dayIdxOfDate(dk);
      const we = isWeekendDay(di);
      const dn = dayName(dk);
      return `<th style="background:${we ? "#f0fdf4" : "#f8fafc"};color:${we ? "#065f46" : "#374151"};padding:5px 4px;text-align:center;min-width:80px;border:1px solid #d1d5db;font-size:8pt">
        ${dn}<br><span style="font-size:7pt;font-weight:normal">${we ? "12h" : "8h"}</span>
      </th>`;
    }).join("");

    // Rows per patient
    let rowsHTML = "";
    pts.forEach(pat => {
      const wdShifts = pat.requiredShifts.filter(s => !SHIFTS[s]?.weekend);
      const weShifts = pat.requiredShifts.filter(s => SHIFTS[s]?.weekend);
      const allRows = [...new Set([...wdShifts, ...weShifts])];

      // Patient label row
      const wl = pat.watchLevel;
      const wColor = wl === "HIGH" ? "#dc2626" : wl === "MEDIUM" ? "#d97706" : "#16a34a";
      const wBg = wl === "HIGH" ? "#fee2e2" : wl === "MEDIUM" ? "#fef3c7" : "#dcfce7";
      rowsHTML += `<tr>
        <td colspan="${weekDates.length + 1}" style="background:#f1f5f9;padding:4px 8px;border:1px solid #d1d5db;border-top:2px solid #94a3b8">
          <strong style="font-size:9pt">${pat.name}</strong>
          <span style="margin-left:6px;padding:1px 6px;border-radius:10px;background:${wBg};color:${wColor};font-size:7pt;font-weight:700">${wl}</span>
          <span style="margin-left:4px;font-size:7pt;color:#64748b">Rm ${pat.room}</span>
        </td>
      </tr>`;

      allRows.forEach(sk => {
        const sh = SHIFT_COLORS[sk];
        if (!sh) return;
        let cells = weekDates.map(d => {
          const dk = toDateKey(d);
          const di = dayIdxOfDate(dk);
          const we = isWeekendDay(di);
          const applicable = SHIFTS[sk]?.weekend ? we : !we;
          if (!applicable) return `<td style="background:#f3f4f6;text-align:center;color:#d1d5db;border:1px solid #e2e8f0;font-size:7pt">—</td>`;
          const a = getA(pat.id, sk, dk);
          if (a) return `<td style="background:${sh.bg};color:${sh.color};padding:4px 5px;border:1px solid ${sh.color}30;font-size:8pt;font-weight:500">${a.staff}</td>`;
          return `<td style="background:#fef2f2;color:#dc2626;padding:4px 5px;border:1px solid #fecaca;font-size:7pt;font-weight:700">⚠ Unassigned</td>`;
        }).join("");

        rowsHTML += `<tr>
          <td style="background:${sh.bg};color:${sh.color};padding:4px 8px;border:1px solid ${sh.color}40;white-space:nowrap;font-size:7.5pt;font-weight:700">
            ${sh.label}<br><span style="font-weight:400;font-size:6.5pt">${sh.time} · ${sh.hours}h</span>
          </td>
          ${cells}
        </tr>`;
      });
    });

    const siteColors = { 1: "#8b5cf6", 2: "#10b981", 3: "#3b82f6" };
    const sc = siteColors[site.id] || "#64748b";

    tablesHTML += `
      <div style="margin-bottom:28px;${si > 0 ? "page-break-before:always" : ""}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <div style="width:10px;height:10px;border-radius:50%;background:${sc}"></div>
          <h2 style="margin:0;font-size:12pt;color:#0f172a">Southbridge ${site.name}</h2>
        </div>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
          <thead>
            <tr>
              <th style="background:#1e293b;color:#f1f5f9;padding:5px 8px;text-align:left;min-width:110px;border:1px solid #334155;font-size:8pt">Patient / Shift</th>
              ${headCols}
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>`;
  });

  // Legend HTML
  const legendHTML = Object.entries(SHIFT_COLORS).map(([k, v]) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:7pt">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${v.bg};border:1px solid ${v.color}"></span>
      ${v.label} (${v.hours}h)
    </span>`
  ).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>SecureShift Schedule — ${weekLabel}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 12mm; color: #1e293b; }
    @page { size: A3 landscape; margin: 10mm; }
    @media print {
      body { padding: 0; }
      button { display: none !important; }
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    table { border-collapse: collapse; }
    td, th { vertical-align: middle; }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #0f172a">
    <div>
      <div style="font-size:18pt;font-weight:700;color:#0f172a">🛡 Southbridge Security</div>
      <div style="font-size:11pt;color:#64748b;margin-top:2px">Weekly Schedule — ${weekLabel}</div>
    </div>
    <div style="text-align:right;font-size:8pt;color:#94a3b8">
      Printed: ${new Date().toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}<br>
      SecureShift v1.0
    </div>
  </div>

  <!-- Legend -->
  <div style="margin-bottom:12px;padding:6px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
    <span style="font-size:7pt;font-weight:700;color:#64748b;margin-right:8px">SHIFT LEGEND:</span>
    ${legendHTML}
    <span style="display:inline-flex;align-items:center;gap:4px;font-size:7pt">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#fef2f2;border:1px solid #fecaca"></span>
      Unassigned
    </span>
  </div>

  <!-- Schedule tables -->
  ${tablesHTML}

  <!-- Print button (screen only) -->
  <div style="text-align:center;margin-top:20px" class="no-print">
    <button onclick="window.print()" style="padding:10px 28px;background:#0f172a;color:#fff;border:none;border-radius:8px;font-size:12pt;cursor:pointer;font-family:inherit">
      🖨 Save as PDF / Print
    </button>
    <p style="margin-top:8px;font-size:9pt;color:#94a3b8">Use your browser's print dialog. Select "Save as PDF" to share with employees.</p>
  </div>
  <style>.no-print { } @media print { .no-print { display:none !important; } }</style>
</body>
</html>`;

  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) { alert("Please allow pop-ups for this site to use the print feature."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.onload = () => { win.print(); };
}

function isToday(d) { const t = new Date(); return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate(); }

function SchedulePage({ patients, assigns, siteFilter, getAssign, mobile, weekDates, guardAvailability, onAssign }) {
  const sites = siteFilter === "ALL" ? SITES : SITES.filter(s => s.id === parseInt(siteFilter));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "8px 12px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10 }}>
        <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>SHIFTS:</span>
        {Object.entries(SHIFTS).map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#64748b" }}>
            <div style={{ width: 9, height: 9, borderRadius: 2, background: v.bg, border: `1px solid ${v.color}50` }}></div>
            {v.label} {v.time} ({v.hours}h) {v.weekend ? "· Wknd" : "· Wkday"}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#64748b" }}>
          <div style={{ width: 9, height: 9, borderRadius: 2, background: "#fef2f2", border: "1px solid #fca5a5" }}></div>
          Unassigned
        </div>
      </div>

      {sites.map(site => {
        const pts = patients.filter(p => p.siteId === site.id && p.status === "ACTIVE");
        return (
          <div key={site.id} style={cardS({ overflow: "hidden" })}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: site.color, flexShrink: 0 }}></div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Southbridge {site.name}</span>
              <span style={{ ...pill(`${site.color}18`, site.color), marginLeft: "auto" }}>{pts.length} patients</span>
            </div>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 750 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ padding: "7px 10px", fontSize: 10, fontWeight: 600, color: "#64748b", textAlign: "left", borderBottom: "1px solid #e2e8f0", minWidth: 130, position: "sticky", left: 0, background: "#f8fafc", zIndex: 2 }}>Patient / Shift</th>
                    {weekDates.map((d, i) => {
                      const di = dayIdxOfDate(toDateKey(d)); // real day index: 0=Mon…6=Sun
                      const we = isWeekendDay(di);
                      return (
                        <th key={i} style={{ padding: "6px 6px", fontSize: 10, fontWeight: 600, color: isToday(d) ? "#3b82f6" : we ? "#065f46" : "#64748b", textAlign: "center", borderBottom: "1px solid #e2e8f0", minWidth: 90, background: isToday(d) ? "#eff6ff" : we ? "#f0fdf4" : "#f8fafc", borderLeft: "1px solid #e2e8f0" }}>
                          <div>{DAYS[di]}</div>
                          <div style={{ fontSize: 11, fontWeight: isToday(d) ? 700 : 400, marginTop: 1 }}>{fmtDate(d)}</div>
                          <div style={{ fontSize: 8, marginTop: 2, color: we ? "#065f46" : "#94a3b8", fontWeight: 600 }}>{we ? "12h" : "8h"}</div>
                          {isToday(d) && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#3b82f6", margin: "2px auto 0" }}></div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pts.map(pat => {
                    const w = WATCH[pat.watchLevel] || {};
                    // collect all shift types this patient needs, split by weekday vs weekend
                    const wdShifts = pat.requiredShifts.filter(s => !SHIFTS[s]?.weekend);
                    const weShifts = pat.requiredShifts.filter(s => SHIFTS[s]?.weekend);
                    // unique rows = union, shown conditionally per day
                    const allRows = [...new Set([...wdShifts, ...weShifts])];

                    return (
                      <>
                        {/* Patient label row */}
                        <tr key={`${pat.id}-lbl`}>
                          <td colSpan={8} style={{ padding: "5px 10px", background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", borderTop: "1px solid #e2e8f0" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{pat.name}</span>
                              <span style={pill(w.bg, w.c)}>{pat.watchLevel}</span>
                              <span style={{ fontSize: 10, color: "#94a3b8" }}>Rm {pat.room}</span>
                            </div>
                          </td>
                        </tr>
                        {/* Shift rows — only show a cell if that shift is valid for that day */}
                        {allRows.map(sk => {
                          const sh = SHIFTS[sk];
                          // weekday shift → only show in Mon–Fri columns, weekend shift → only Sat–Sun
                          return (
                            <tr key={`${pat.id}-${sk}`}>
                              <td style={{ padding: "5px 10px", background: sh.bg, position: "sticky", left: 0, zIndex: 1, borderBottom: "1px solid #f1f5f9", minWidth: 130 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: sh.color }}>{sh.label}</span>
                                <span style={{ fontSize: 9, color: sh.color, opacity: .7, marginLeft: 4 }}>{sh.time} · {sh.hours}h</span>
                              </td>
                              {weekDates.map((d, di) => {
                                const dk = toDateKey(d);
                                const realDi = dayIdxOfDate(dk); // 0=Mon…6=Sun
                                const we = isWeekendDay(realDi);
                                // if this shift doesn't apply to this column type, show a grey N/A cell
                                const applicable = sh.weekend ? we : !we;
                                if (!applicable) return (
                                  <td key={di} style={{ background: "#f3f4f6", borderBottom: "1px solid #f1f5f9", borderLeft: "1px solid #f1f5f9", textAlign: "center", color: "#d1d5db", fontSize: 9 }}>—</td>
                                );
                                const assign = getAssign(pat.id, sk, dk);
                                if (assign) return (
                                  <td key={di} onClick={() => onAssign(pat.id, sk, dk)} style={{ padding: "5px 6px", background: isToday(d) ? `${sh.bg}dd` : sh.bg, color: sh.color, fontSize: 11, fontWeight: 500, cursor: "pointer", borderBottom: "1px solid #f1f5f9", borderLeft: "1px solid #f1f5f9", verticalAlign: "middle" }}>
                                    {assign.staff}
                                  </td>
                                );
                                return (
                                  <td key={di} onClick={() => onAssign(pat.id, sk, dk)} style={{ padding: "5px 6px", background: isToday(d) ? "#fff7f7" : "#fef2f2", color: "#dc2626", fontSize: 10, fontWeight: 600, cursor: "pointer", borderBottom: "1px solid #f1f5f9", borderLeft: "1px solid #f1f5f9", verticalAlign: "middle" }}>
                                    ⚠ Assign
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Patients Page
// ─────────────────────────────────────────────────────────────────────────────
function PatientsPage({ patients, assigns, weekDates, getAssign, mobile, onEdit, onAssign }) {
  const todayKey = toDateKey(new Date());
  const todayDayIdx = dayIdxOfDate(todayKey); // 0=Mon…6=Sun
  const todayShifts = shiftsForDayIdx(todayDayIdx);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {patients.map(pat => {
        const st = siteOf(pat.siteId); const w = WATCH[pat.watchLevel] || {};
        const totalSlots = weekDates.reduce((n, d) => {
          const valid = shiftsForDayIdx(dayIdxOfDate(toDateKey(d)));
          return n + pat.requiredShifts.filter(s => valid.includes(s)).length;
        }, 0);
        const coveredSlots = weekDates.reduce((n, d) => {
          const dk = toDateKey(d); const valid = shiftsForDayIdx(dayIdxOfDate(dk));
          return n + pat.requiredShifts.filter(s => valid.includes(s) && getAssign(pat.id, s, dk)).length;
        }, 0);
        const allOk = coveredSlots === totalSlots;
        const todayNeeded = pat.requiredShifts.filter(s => todayShifts.includes(s));
        return (
          <div key={pat.id} style={cardS({ overflow: "hidden" })}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid #f1f5f9", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: `${st.color || "#94a3b8"}20`, color: st.color || "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{ini(pat.name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pat.name}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={pill(w.bg, w.c)}>{pat.watchLevel}</span>
                    <span style={{ fontSize: 9, color: st.color || "#64748b", fontWeight: 500 }}>{st.name || ""} · Rm {pat.room}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: allOk ? "#16a34a" : "#dc2626" }}>{coveredSlots}/{totalSlots}</span>
                <button style={{ ...btnS(false), padding: "4px 9px", fontSize: 11 }} onClick={() => onEdit(pat)}>Edit</button>
              </div>
            </div>
            <div style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6, fontWeight: 500 }}>Today ({fmtDate(new Date())}) — {isWeekendDay(todayDayIdx) ? "12h shifts" : "8h shifts"}:</div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
                {todayNeeded.map(sk => {
                  const sh = SHIFTS[sk]; const a = getAssign(pat.id, sk, todayKey);
                  if (a) return <div key={sk} onClick={() => onAssign(pat.id, sk, todayKey)} style={{ padding: "5px 9px", borderRadius: 7, background: sh.bg, color: sh.color, fontSize: 11, fontWeight: 500, cursor: "pointer" }}><div style={{ fontWeight: 700 }}>{sh.label}</div><div style={{ fontSize: 9, marginTop: 1 }}>👤 {a.staff}</div></div>;
                  return <div key={sk} onClick={() => onAssign(pat.id, sk, todayKey)} style={{ padding: "5px 9px", borderRadius: 7, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>⚠ {sh.label}</div>;
                })}
                {todayNeeded.length === 0 && <span style={{ fontSize: 11, color: "#94a3b8" }}>No shifts today</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Staff Hours Page
// ─────────────────────────────────────────────────────────────────────────────
function StaffPage({ staffMap, doubles, mobile, weekDates, guards }) {
  const over40 = staffMap.filter(s => s.hours > 40).length;
  const [selected, setSelected] = useState(null);
  const [emailStatus, setEmailStatus] = useState("idle"); // idle | sending | sent | error
  const selectedStaff = selected ? staffMap.find(s => s.name === selected) : null;
  const selectedGuard = selected ? guards.find(g => g.name.toLowerCase().trim() === selected.toLowerCase().trim()) : null;

  const sendEmail = async () => {
    if (!selectedGuard?.email) {
      alert(`No email on file for ${selected}.
Please add one in their Guard profile first.`);
      return;
    }
    setEmailStatus("sending");
    try {
      // Build schedule HTML table
      const rows = weekDates.map(d => {
        const dk = toDateKey(d);
        const dayName = d.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" });
        const dayAssigns = selectedStaff.assignments.filter(a => a.date === dk);
        if (!dayAssigns.length) return `
          <tr>
            <td style="padding:10px 14px;border:1px solid #e2e8f0;font-size:13px;color:#374151;font-weight:500">${dayName}</td>
            <td style="padding:10px 14px;border:1px solid #e2e8f0;text-align:center;color:#94a3b8" colspan="3">— Day off</td>
          </tr>`;
        return dayAssigns.map(a => {
          const sh = SHIFTS[a.shift];
          return `
          <tr>
            <td style="padding:10px 14px;border:1px solid #e2e8f0;font-size:13px;color:#374151;font-weight:500">${dayName}</td>
            <td style="padding:10px 14px;border:1px solid #e2e8f0;background:${sh?.bg};color:${sh?.color};font-weight:700;text-align:center;font-size:13px">${sh?.label || a.shift}</td>
            <td style="padding:10px 14px;border:1px solid #e2e8f0;font-size:13px;color:#374151;text-align:center">${sh?.time || ""}</td>
            <td style="padding:10px 14px;border:1px solid #e2e8f0;font-size:13px;color:#374151">${a.patient} · ${a.hours}h</td>
          </tr>`;
        }).join("");
      }).join("");

      const tableHtml = `
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#1e293b">
              <th style="padding:10px 14px;color:#f1f5f9;font-size:12px;text-align:left;border:1px solid #334155">Day</th>
              <th style="padding:10px 14px;color:#f1f5f9;font-size:12px;text-align:center;border:1px solid #334155">Shift</th>
              <th style="padding:10px 14px;color:#f1f5f9;font-size:12px;text-align:center;border:1px solid #334155">Time</th>
              <th style="padding:10px 14px;color:#f1f5f9;font-size:12px;text-align:left;border:1px solid #334155">Patient · Hours</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;

      const wLabel = `${fmtDate(weekDates[0])} – ${fmtDate(weekDates[6])}`;
      const BASE = "https://secureshift-lcro.onrender.com/api";
      const res = await fetch(`${BASE}/send-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: selectedGuard.email,
          guardName: selectedStaff.name,
          weekLabel: wLabel,
          html: tableHtml,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed");
      setEmailStatus("sent");
      setTimeout(() => setEmailStatus("idle"), 3000);
    } catch (err) {
      alert("Failed to send: " + err.message);
      setEmailStatus("error");
      setTimeout(() => setEmailStatus("idle"), 2000);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
        {[{ l: "Total staff", v: staffMap.length, bg: "#f8fafc", c: "#0f172a" },
        { l: "≤ 40h ✓", v: staffMap.filter(s => s.hours <= 40).length, bg: "#f0fdf4", c: "#16a34a" },
        { l: "Over 40h ⚠", v: over40, bg: over40 > 0 ? "#fef2f2" : "#f0fdf4", c: over40 > 0 ? "#dc2626" : "#16a34a" },
        { l: "Double shift ⛔", v: doubles.length, bg: doubles.length > 0 ? "#fef2f2" : "#f0fdf4", c: doubles.length > 0 ? "#dc2626" : "#16a34a" },
        ].map(x => (
          <div key={x.l} style={{ background: x.bg, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: x.c, marginBottom: 2, opacity: .8 }}>{x.l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: x.c }}>{x.v}</div>
          </div>
        ))}
      </div>

      {doubles.length > 0 && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#991b1b" }}>⛔ {doubles.length} guard{doubles.length > 1 ? "s" : ""} assigned to multiple shifts on the same day.</div>}
      {over40 > 0 && <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#92400e" }}>⚠ {over40} guard{over40 > 1 ? "s" : ""} exceed 40h this week.</div>}

      {/* Individual schedule modal */}
      {selectedStaff && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex", alignItems: mobile ? "flex-end" : "center", justifyContent: "center", zIndex: 50 }}
          onClick={() => setSelected(null)}>
          <div style={{ background: "#fff", borderRadius: mobile ? "14px 14px 0 0" : "14px", width: "100%", maxWidth: mobile ? "100%" : "540px", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column" }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, background: "#0f172a", borderRadius: mobile ? "14px 14px 0 0" : "14px 14px 0 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {(() => { const [bg, col] = avCol(staffMap.indexOf(selectedStaff)); return <div style={{ width: 36, height: 36, borderRadius: "50%", background: bg, color: col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700 }}>{ini(selectedStaff.name)}</div>; })()}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9" }}>{selectedStaff.name}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    {selectedStaff.site} · {selectedStaff.hours}h this week
                    {selectedGuard?.email && <span style={{ marginLeft: 6, color: "#64748b" }}>· {selectedGuard.email}</span>}
                    {!selectedGuard?.email && <span style={{ marginLeft: 6, color: "#ef4444" }}>· No email on file</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={sendEmail}
                  disabled={emailStatus === "sending"}
                  style={{
                    ...btnS(false), fontSize: 11, padding: "5px 12px",
                    background: emailStatus === "sent" ? "#f0fdf4" : emailStatus === "error" ? "#fef2f2" : "#fff",
                    color: emailStatus === "sent" ? "#16a34a" : emailStatus === "error" ? "#dc2626" : "#374151",
                    border: emailStatus === "sent" ? "1px solid #86efac" : emailStatus === "error" ? "1px solid #fecaca" : "1px solid #e2e8f0",
                    opacity: emailStatus === "sending" ? 0.7 : 1,
                  }}>
                  {emailStatus === "sending" ? "⏳ Sending…" : emailStatus === "sent" ? "✓ Sent!" : emailStatus === "error" ? "✗ Failed" : "📧 Send schedule"}
                </button>
                <button onClick={() => { setSelected(null); setEmailStatus("idle"); }} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
            </div>

            {/* Hours bar */}
            <div style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9" }}>
              {(() => {
                const over = selectedStaff.hours > 40;
                const pct = Math.min(100, Math.round(selectedStaff.hours / 40 * 100));
                return (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 11 }}>
                      <span style={{ color: "#64748b" }}>Weekly hours</span>
                      <span style={{ fontWeight: 700, color: over ? "#dc2626" : selectedStaff.hours === 40 ? "#16a34a" : "#d97706" }}>{selectedStaff.hours}/40h</span>
                    </div>
                    <div style={{ height: 7, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: over ? "#ef4444" : pct >= 80 ? "#22c55e" : "#f59e0b", borderRadius: 4 }}></div>
                    </div>
                    {over && <div style={{ fontSize: 10, color: "#dc2626", marginTop: 4 }}>⚠ Exceeds 40h limit by {selectedStaff.hours - 40}h</div>}
                  </div>
                );
              })()}
            </div>

            {/* Day-by-day schedule */}
            <div style={{ padding: "14px 18px", flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Week schedule</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {weekDates.map((d, i) => {
                  const dk = toDateKey(d);
                  const dayName = d.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" });
                  const todayMark = isToday(d);
                  const dayAssigns = selectedStaff.assignments.filter(a => a.date === dk);
                  const sh = dayAssigns[0] ? SHIFTS[dayAssigns[0].shift] : null;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, background: todayMark ? "#eff6ff" : "#f8fafc", border: `1px solid ${todayMark ? "#bfdbfe" : "#e2e8f0"}` }}>
                      {/* Day */}
                      <div style={{ minWidth: mobile ? 90 : 130, flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: todayMark ? 700 : 500, color: todayMark ? "#1e40af" : "#374151" }}>{dayName}</div>
                        {todayMark && <div style={{ fontSize: 9, color: "#3b82f6", fontWeight: 600 }}>TODAY</div>}
                      </div>
                      {/* Shift + patient */}
                      {dayAssigns.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                          {dayAssigns.map((a, ai) => {
                            const s = SHIFTS[a.shift];
                            return (
                              <div key={ai} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ ...pill(s?.bg, s?.color), fontSize: 10 }}>{s?.label} · {s?.time}</span>
                                <span style={{ fontSize: 11, color: "#374151" }}>→ {a.patient}</span>
                                <span style={{ fontSize: 10, color: "#94a3b8" }}>{a.hours}h</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>— Day off</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Shift summary */}
            <div style={{ padding: "12px 18px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 8 }}>Shift breakdown</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Object.entries(
                  selectedStaff.assignments.reduce((acc, a) => {
                    acc[a.shift] = (acc[a.shift] || 0) + a.hours;
                    return acc;
                  }, {})
                ).map(([sk, hrs]) => (
                  <div key={sk} style={{ padding: "5px 10px", borderRadius: 8, background: SHIFTS[sk]?.bg, color: SHIFTS[sk]?.color, fontSize: 11, fontWeight: 600 }}>
                    {SHIFTS[sk]?.label} · {hrs}h
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Staff cards */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${mobile ? 150 : 180}px,1fr))`, gap: 10 }}>
        {staffMap.map((s, i) => {
          const [bg, col] = avCol(i);
          const over = s.hours > 40;
          const pct = Math.min(100, Math.round(s.hours / 40 * 100));
          return (
            <div key={i} onClick={() => setSelected(s.name)}
              style={cardS({ padding: "10px 12px", borderColor: over ? "#fecaca" : "#e2e8f0", cursor: "pointer" })}
              onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
              onMouseLeave={e => e.currentTarget.style.background = "#fff"}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: bg, color: col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{ini(s.name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  <span style={pill(`${s.color}15`, s.color)}>{s.site}</span>
                </div>
              </div>
              <div style={{ height: 5, background: "#f1f5f9", borderRadius: 3, overflow: "hidden", marginBottom: 5 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: over ? "#ef4444" : pct >= 80 ? "#22c55e" : "#f59e0b", borderRadius: 3 }}></div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {[...new Set(s.assignments.map(a => a.shift))].map((sh, j) => <span key={j} style={pill(SHIFTS[sh]?.bg, SHIFTS[sh]?.color)}>{SHIFTS[sh]?.label}</span>)}
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: over ? "#dc2626" : s.hours === 40 ? "#16a34a" : "#d97706", flexShrink: 0, marginLeft: 4 }}>{s.hours}h</span>
              </div>
              <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 3 }}>{s.hours}/40h · tap to view schedule</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sites Page
// ─────────────────────────────────────────────────────────────────────────────
function SitesPage({ patients, assigns, weekDates, getAssign }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {SITES.map(st => {
        const pts = patients.filter(p => p.siteId === st.id);
        const active = pts.filter(p => p.status === "ACTIVE");
        const staffSet = new Set(); let gaps = 0;
        active.forEach(p => {
          weekDates.forEach((d) => {
            const dk = toDateKey(d); const valid = shiftsForDayIdx(dayIdxOfDate(dk));
            p.requiredShifts.filter(s => valid.includes(s)).forEach(sk => { if (!getAssign(p.id, sk, dk)) gaps++; });
          });
          assigns.filter(a => a.patientId === p.id).forEach(a => staffSet.add(a.staff));
        });
        return (
          <div key={st.id} style={cardS({ overflow: "hidden" })}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: `${st.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📍</div>
              <div><div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>Southbridge {st.name}</div><div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>{active.length} patients · {staffSet.size} staff</div></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
              {[{ l: "Patients", v: active.length, bg: "#f8fafc", c: "#0f172a" }, { l: "Staff", v: staffSet.size, bg: "#f8fafc", c: "#0f172a" }, { l: "Weekly gaps", v: gaps, bg: gaps > 0 ? "#fef2f2" : "#f0fdf4", c: gaps > 0 ? "#dc2626" : "#16a34a" }].map((x, i) => (
                <div key={i} style={{ padding: "12px 14px", borderRight: i < 2 ? "1px solid #f1f5f9" : "none", background: x.bg }}>
                  <div style={{ fontSize: 9, color: "#64748b", marginBottom: 3 }}>{x.l}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: x.c }}>{x.v}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: 5 }}>
              {pts.map(p => <span key={p.id} style={pill(`${st.color}15`, st.color)}>{p.name}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerts Page
// ─────────────────────────────────────────────────────────────────────────────
function AlertsPage({ gaps, doubles, patients, onFix, onAssign }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {doubles.map((s, i) => (
        <div key={i} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "11px 12px", display: "flex", alignItems: "flex-start", gap: 8 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>⛔</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#991b1b" }}>{s.name} — double shift on {s.days.length} day{s.days.length > 1 ? "s" : ""}</div>
            <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 2, wordBreak: "break-word" }}>{s.days.map(d => `${d.date}: ${d.shifts.join("+")} (${d.hours}h)`).join(" · ")}</div>
          </div>
          <button style={{ ...btnS(false), fontSize: 11, padding: "4px 8px", flexShrink: 0 }} onClick={() => onFix("staff")}>Fix</button>
        </div>
      ))}
      {gaps.map((g, i) => {
        const st = siteOf(g.patient.siteId); const sh = SHIFTS[g.shift];
        return (
          <div key={i} style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "11px 12px", display: "flex", alignItems: "flex-start", gap: 8 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#92400e", wordBreak: "break-word" }}>{g.patient.name} — {g.dayLabel} · {sh?.time}</div>
              <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}><span style={{ color: st.color, fontWeight: 500 }}>{st.name}</span> · {sh?.label} · Rm {g.patient.room}</div>
            </div>
            <button style={{ ...btnS(false), fontSize: 11, padding: "4px 8px", flexShrink: 0 }} onClick={() => onAssign(g.patient.id, g.shift, g.date)}>Fix</button>
          </div>
        );
      })}
      {!gaps.length && !doubles.length && (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "14px", display: "flex", alignItems: "center", gap: 10 }}>
          <span>✅</span><div style={{ fontSize: 13, fontWeight: 600, color: "#14532d" }}>All clear — no conflicts or gaps this week</div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for AssignModal dropdown
// ─────────────────────────────────────────────────────────────────────────────

// Compute weekly hours for a named guard across all assignments
function guardWeeklyHours(staffName, assigns, weekDates) {
  const n = staffName.toLowerCase().trim();
  const weekKeys = new Set(weekDates.map(toDateKey));
  // Deduplicate by patientId+shift+date to avoid counting DB duplicates twice
  const seen = new Set();
  return assigns
    .filter(a => {
      if (a.staff.toLowerCase().trim() !== n || !weekKeys.has(a.date)) return false;
      const key = `${a.patientId}-${a.shift}-${a.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .reduce((sum, a) => sum + (SHIFTS[a.shift]?.hours || 0), 0);
}

// Returns hour limit based on employment type
// Full-time: 40h  |  Part-time / Contract / Casual: 24h
function guardHourLimit(staffName, guardAvailability) {
  if (!staffName?.trim()) return 40;
  const n = staffName.toLowerCase().trim();
  const g = guardAvailability.find(x => x.name.toLowerCase().trim() === n);
  if (!g) return 40;
  return (g.employmentType === "Full-time") ? 40 : 24;
}

// Build the available-guard list for a given shift+date
// Returns array of { name, hoursThisWeek, hoursIfAssigned, reason? }
function buildAvailableGuards(shift, date, assigns, guardAvailability, excludePatientId, weekDates) {
  const dayIdx = dayIdxOfDate(date);
  const shiftHours = SHIFTS[shift]?.hours || 0;
  const available = [];
  const unavailable = [];

  guardAvailability.forEach(g => {
    const todayShifts = (g.schedule || {})[dayIdx] || [];
    const weekHrs = guardWeeklyHours(g.name, assigns, weekDates);
    const hoursAfter = weekHrs + shiftHours;
    const limit = guardHourLimit(g.name, guardAvailability);
    const empType = g.employmentType || "Full-time";

    // ── HARD blocks (cannot assign at all) ──
    const offMsg = isOnTimeOff(g, date);
    const notAvailDay = !todayShifts.length;
    const notAvailShift = todayShifts.length > 0 && !todayShifts.includes(shift);
    // Already assigned to the SAME shift slot (duplicate)
    const dupAssign = assigns.find(a =>
      a.staff.toLowerCase().trim() === g.name.toLowerCase().trim() &&
      a.shift === shift && a.date === date && a.patientId !== excludePatientId
    );

    // Already on a DIFFERENT shift that day — HARD block (one shift per day rule)
    // Check ALL patients — excludePatientId only exempts same-shift duplicate, not different-shift
    const otherShift = assigns.find(a =>
      a.staff.toLowerCase().trim() === g.name.toLowerCase().trim() &&
      a.shift !== shift && a.date === date
    );
    // Over weekly hour limit — SOFT warn (can still assign)
    const overLimit = hoursAfter > limit;

    if (offMsg) {
      unavailable.push({ name: g.name, weekHrs, hoursAfter, limit, empType, reason: `🏖 ${offMsg}`, hard: true });
    } else if (notAvailDay) {
      unavailable.push({ name: g.name, weekHrs, hoursAfter, limit, empType, reason: `Not available on ${DAYS[dayIdx]}s`, hard: true });
    } else if (notAvailShift) {
      unavailable.push({ name: g.name, weekHrs, hoursAfter, limit, empType, reason: `Only works ${todayShifts.map(s => SHIFTS[s]?.label).join("/")} on ${DAYS[dayIdx]}s`, hard: true });
    } else if (dupAssign) {
      unavailable.push({ name: g.name, weekHrs, hoursAfter, limit, empType, reason: `Already assigned to this exact shift today`, hard: true });
    } else if (otherShift) {
      // One shift per day rule — hard block
      unavailable.push({
        name: g.name, weekHrs, hoursAfter, limit, empType,
        reason: `Already working ${SHIFTS[otherShift.shift]?.label} (${SHIFTS[otherShift.shift]?.time}) today — one shift per day`, hard: true
      });
    } else if (overLimit) {
      // Over hour limit — warn but allow
      available.push({
        name: g.name, weekHrs, hoursAfter, limit, empType,
        warn: `Over ${limit}h ${empType} limit: ${weekHrs}h + ${shiftHours}h = ${hoursAfter}h`,
        warnType: "hours"
      });
    } else {
      available.push({ name: g.name, weekHrs, hoursAfter, limit, empType });
    }
  });

  // Sort available by hours ascending (least busy first)
  available.sort((a, b) => a.weekHrs - b.weekHrs);
  return { available, unavailable };
}

// ─────────────────────────────────────────────────────────────────────────────
// Assign Modal — smart dropdown of available guards
// ─────────────────────────────────────────────────────────────────────────────
function AssignModal({ modal, patients, assigns, guardAvailability, mobile, weekDates, onSave, onRemove, onClose, allAssigns }) {
  const [name, setName] = useState(modal.current || "");
  const [query, setQuery] = useState(modal.current || "");
  const [showDrop, setShowDrop] = useState(false);
  const [showUnavail, setShowUnavail] = useState(false);

  const pat = patients.find(p => p.id === modal.patientId) || { name: "Patient" };
  const sh = SHIFTS[modal.shift] || {};
  const dateDisplay = new Date(modal.date + "T00:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" });

  // Build guard lists
  const { available, unavailable } = buildAvailableGuards(
    modal.shift, modal.date, assigns, guardAvailability, modal.patientId, weekDates
  );

  // AI scoring — learn from all historical assignments
  const aiPatterns = (allAssigns?.length > 0) ? learnPatterns(allAssigns, patients, guardAvailability) : null;
  const aiScores = {};
  if (aiPatterns) {
    const aiSuggestions = getSuggestions(modal.patientId, modal.shift, modal.date, aiPatterns, guardAvailability, allAssigns, weekDates, 99);
    aiSuggestions.forEach((s, idx) => { aiScores[s.name] = { score: s.score, rank: idx, confidence: s.confidence, affinityCount: s.affinityCount, slotCount: s.slotCount }; });
  }

  // Sort available guards by AI score (highest first), fallback to hours
  const sortedAvail = [...available].sort((a, b) => {
    const sa = aiScores[a.name]?.score ?? -1;
    const sb = aiScores[b.name]?.score ?? -1;
    if (sb !== sa) return sb - sa;
    return a.weekHrs - b.weekHrs;
  });

  // Filter by search query
  const q = query.toLowerCase().trim();
  const filteredAvail = q ? sortedAvail.filter(g => g.name.toLowerCase().includes(q)) : sortedAvail;
  const filteredUnavail = q ? unavailable.filter(g => g.name.toLowerCase().includes(q)) : unavailable;

  // Validation for typed/selected name
  const avBlock = guardAvailabilityBlock(name, modal.shift, modal.date, guardAvailability);
  const conflict = !avBlock ? guardConflict(name, modal.shift, modal.date, assigns, modal.patientId) : null;
  const conflictPat = conflict ? patients.find(p => p.id === conflict.patientId) : null;
  const weekHrs = name.trim() ? guardWeeklyHours(name, assigns, weekDates) : 0;
  const limit = name.trim() ? guardHourLimit(name, guardAvailability) : 40;
  const empType = name.trim() ? (guardAvailability.find(g => g.name.toLowerCase().trim() === name.toLowerCase().trim())?.employmentType || "Full-time") : "Full-time";
  const hoursAfter = weekHrs + (sh.hours || 0);
  const overLimit = name.trim() && hoursAfter > limit;
  // Double shift = already on a DIFFERENT shift today (same shift = hard block via guardConflict type "same")
  // Hard block: availability rule OR ANY same-day conflict (one shift per day)
  const hardBlock = !!avBlock || !!conflict;
  const blocked = hardBlock;

  const selectGuard = (guardName) => {
    setName(guardName);
    setQuery(guardName);
    setShowDrop(false);
  };

  // Hour bar colour
  const barColor = (hrs) => hrs >= 40 ? "#ef4444" : hrs >= 32 ? "#f59e0b" : "#22c55e";

  const overlayStyle = { position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex", alignItems: mobile ? "flex-end" : "center", justifyContent: "center", zIndex: 50 };
  const modalStyle = { background: "#fff", borderRadius: mobile ? "14px 14px 0 0" : "14px", padding: "20px 18px", width: "100%", maxWidth: mobile ? "100%" : "500px", maxHeight: "90vh", overflowY: "auto" };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 3 }}>Assign staff</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{pat.name} · {dateDisplay}</div>
        <div style={{ padding: "9px 12px", borderRadius: 8, marginBottom: 16, background: sh.bg, color: sh.color, fontSize: 12, fontWeight: 500 }}>
          {sh.label} · {sh.time} · {sh.hours}h{sh.weekend ? " (Weekend)" : ""}
        </div>

        {/* Search + dropdown */}
        <div style={{ marginBottom: 14, position: "relative" }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>
            Select staff member
            <span style={{ fontSize: 10, fontWeight: 400, color: "#64748b", marginLeft: 6 }}>
              ({available.length} available, {unavailable.length} unavailable)
            </span>
          </label>

          {/* Input */}
          <div style={{ position: "relative" }}>
            <input
              style={{ ...inpS, paddingRight: 36 }}
              value={query}
              onChange={e => { setQuery(e.target.value); setName(e.target.value); setShowDrop(true); }}
              onFocus={() => setShowDrop(true)}
              placeholder="Search or type a name..."
              autoFocus
            />
            {/* Caret icon */}
            <div onClick={() => setShowDrop(v => !v)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", cursor: "pointer", color: "#94a3b8", fontSize: 14, userSelect: "none" }}>
              {showDrop ? "▲" : "▼"}
            </div>
          </div>

          {/* Dropdown */}
          {showDrop && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 10, maxHeight: 280, overflowY: "auto", marginTop: 4 }}>

              {/* Available guards */}
              {filteredAvail.length > 0 && (
                <div>
                  <div style={{ padding: "6px 12px", fontSize: 10, fontWeight: 700, color: "#16a34a", background: "#f0fdf4", borderBottom: "1px solid #dcfce7", textTransform: "uppercase", letterSpacing: "0.05em", position: "sticky", top: 0 }}>
                    ✓ Available — {filteredAvail.length} guard{filteredAvail.length !== 1 ? "s" : ""}{aiPatterns ? " · 🧠 AI ranked" : ""}
                  </div>
                  {filteredAvail.map((g, i) => {
                    const pct = Math.min(100, Math.round((g.weekHrs / (g.limit || 40)) * 100));
                    const hasWarn = !!g.warn;
                    const isTopAI = aiScores[g.name]?.rank === 0;
                    const rowBg = name === g.name ? (hasWarn ? "#fffbeb" : "#f0fdf4") : isTopAI ? "#fffbeb" : "#fff";
                    return (
                      <div key={i} onClick={() => selectGuard(g.name)}
                        style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #f8f9fb", background: rowBg, borderLeft: hasWarn ? "3px solid #f59e0b" : isTopAI ? "3px solid #f59e0b" : "3px solid transparent" }}
                        onMouseEnter={e => e.currentTarget.style.background = hasWarn ? "#fffbeb" : "#f8fafc"}
                        onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            {/* AI rank badge — top 3 */}
                            {aiScores[g.name] && aiScores[g.name].rank === 0 && (
                              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "#fef3c7", color: "#92400e", fontWeight: 700, border: "1px solid #fcd34d" }}>🧠 #1 AI pick</span>
                            )}
                            {aiScores[g.name] && aiScores[g.name].rank === 1 && (
                              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "#f0f9ff", color: "#0369a1", fontWeight: 600, border: "1px solid #bae6fd" }}>🧠 #2</span>
                            )}
                            {aiScores[g.name] && aiScores[g.name].rank === 2 && (
                              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "#f8fafc", color: "#64748b", fontWeight: 600, border: "1px solid #e2e8f0" }}>🧠 #3</span>
                            )}
                            <span style={{ fontSize: 12, fontWeight: 500, color: "#0f172a" }}>{g.name}</span>
                            {g.empType && g.empType !== "Full-time" && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 8, background: "#ede9fe", color: "#4f46e5", fontWeight: 600 }}>{g.empType}</span>}
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: g.hoursAfter > (g.limit || 40) ? "#d97706" : barColor(g.hoursAfter) }}>{g.weekHrs}h → {g.hoursAfter}h <span style={{ fontSize: 9, fontWeight: 400, color: "#94a3b8" }}>/ {g.limit || 40}h</span></span>
                        </div>
                        {/* Hours bar */}
                        <div style={{ height: 4, background: "#f1f5f9", borderRadius: 2, overflow: "hidden", marginBottom: hasWarn ? 4 : 2 }}>
                          <div style={{ display: "flex", height: "100%" }}>
                            <div style={{ width: `${pct}%`, background: barColor(g.weekHrs), borderRadius: 2 }}></div>
                            <div style={{ width: `${Math.min(100 - pct, Math.round((sh.hours / (g.limit || 40)) * 100))}%`, background: `${g.hoursAfter > (g.limit || 40) ? "#f59e0b" : "#22c55e"}60`, borderRadius: 2 }}></div>
                          </div>
                        </div>
                        {hasWarn
                          ? <div style={{ fontSize: 9, color: "#d97706", fontWeight: 500 }}>⚠ {g.warn}</div>
                          : <div style={{ display: "flex", gap: 8, fontSize: 9, color: "#94a3b8" }}>
                            <span>{g.weekHrs}/{g.limit || 40}h this week · +{sh.hours}h if assigned</span>
                            {aiScores[g.name]?.affinityCount > 0 && (
                              <span style={{ color: "#16a34a" }}>🔁 assigned here {aiScores[g.name].affinityCount}× before</span>
                            )}
                          </div>
                        }
                      </div>
                    );
                  })}
                </div>
              )}

              {/* No available match */}
              {filteredAvail.length === 0 && q && (
                <div style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
                  No available guard matches "{q}"
                </div>
              )}
              {filteredAvail.length === 0 && !q && available.length === 0 && (
                <div style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
                  No guards available for this shift
                </div>
              )}

              {/* Unavailable section — collapsible */}
              {filteredUnavail.length > 0 && (
                <div>
                  <div onClick={() => setShowUnavail(v => !v)}
                    style={{ padding: "6px 12px", fontSize: 10, fontWeight: 700, color: "#dc2626", background: "#fef2f2", borderTop: "1px solid #fecaca", textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0 }}>
                    <span>⛔ Unavailable — {filteredUnavail.length} guard{filteredUnavail.length !== 1 ? "s" : ""}</span>
                    <span>{showUnavail ? "▲" : "▼"}</span>
                  </div>
                  {showUnavail && filteredUnavail.map((g, i) => (
                    <div key={i} style={{ padding: "8px 12px", borderBottom: "1px solid #f8f9fb", background: "#fff", opacity: 0.7 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, color: "#374151" }}>{g.name}</span>
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>{g.weekHrs}h/wk</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#dc2626", marginTop: 2 }}>⛔ {g.reason}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Validation feedback for typed/selected name */}
        {name.trim() && (
          avBlock ? (
            <div style={{ background: avBlock.startsWith("On vacation") || avBlock.startsWith("Day off") ? "#fffbeb" : "#fef2f2", border: `1px solid ${avBlock.startsWith("On vacation") || avBlock.startsWith("Day off") ? "#fcd34d" : "#fecaca"}`, borderRadius: 8, padding: "9px 12px", marginBottom: 12, fontSize: 11, color: avBlock.startsWith("On vacation") || avBlock.startsWith("Day off") ? "#92400e" : "#991b1b" }}>
              {avBlock.startsWith("On vacation") || avBlock.startsWith("Day off") ? "🏖" : "⛔"} <strong>{avBlock.startsWith("On vacation") || avBlock.startsWith("Day off") ? "Time off" : "Not available"}</strong> — {avBlock}
            </div>
          ) : conflict ? (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "9px 12px", marginBottom: 12, fontSize: 11, color: "#991b1b" }}>
              ⛔ <strong>One shift per day</strong> — {name} is already on the <strong>{SHIFTS[conflict.shift]?.label} ({SHIFTS[conflict.shift]?.time})</strong> shift today
              {conflictPat && <span> for <strong>{conflictPat.name}</strong></span>}. A guard can only be assigned one shift per day.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {/* Over-limit warning */}
              {overLimit && (
                <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "9px 12px", fontSize: 11, color: "#92400e" }}>
                  ⚠ <strong>Over {empType} limit</strong> — {name} will be at <strong>{hoursAfter}h</strong> this week, exceeding the {limit}h {empType} limit. You can still assign.
                </div>
              )}
              {/* All clear */}
              {!overLimit && (
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "#14532d" }}>
                  ✓ {name} — {weekHrs}h this week → {hoursAfter}h after ({empType}, {limit}h limit)
                </div>
              )}
            </div>
          )
        )}

        {/* Others already on this shift */}
        {assigns.filter(a => a.shift === modal.shift && a.date === modal.date && a.patientId !== modal.patientId).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Others on {sh.label} today</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {assigns.filter(a => a.shift === modal.shift && a.date === modal.date && a.patientId !== modal.patientId).map((a, i) => {
                const p = patients.find(pt => pt.id === a.patientId);
                return <span key={i} style={pill(sh.bg, sh.color)}>{a.staff} → {p?.name?.split("/")[0].trim()}</span>;
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {modal.current && <button style={{ ...btnS(false, true), marginRight: "auto" }} onClick={() => onRemove(modal.patientId, modal.shift, modal.date)}>Remove</button>}
          <button style={btnS(false)} onClick={onClose}>Cancel</button>
          <button
            style={{
              ...btnS(true),
              opacity: (!name.trim() || hardBlock) ? 0.4 : 1,
              background: hardBlock ? "#94a3b8" : overLimit ? "#d97706" : "#3b82f6",
              color: "#fff",
              cursor: (!name.trim() || hardBlock) ? "not-allowed" : "pointer"
            }}
            disabled={!name.trim() || hardBlock}
            onClick={() => { if (!hardBlock && name.trim()) onSave(modal.patientId, modal.shift, modal.date, name); }}>
            {overLimit && !hardBlock ? "⚠ Assign anyway" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Patient Modal — shift picker includes all 5 shift types
// ─────────────────────────────────────────────────────────────────────────────
function PatientModal({ data, assigns, mobile, onSave, onDelete, onClose }) {
  const [f, setF] = useState(data);
  const [selShifts, setSelShifts] = useState(new Set(data.requiredShifts));
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const toggleShift = (key) => {
    const next = new Set(selShifts);
    if (key === "WEEKDAY_ALL") { const all = ["AM", "PM", "NIGHT"].every(s => next.has(s)); if (all) { next.delete("AM"); next.delete("PM"); next.delete("NIGHT"); } else { next.add("AM"); next.add("PM"); next.add("NIGHT"); } }
    else if (key === "WEEKEND_ALL") { const all = ["DAY12", "NIGHT12"].every(s => next.has(s)); if (all) { next.delete("DAY12"); next.delete("NIGHT12"); } else { next.add("DAY12"); next.add("NIGHT12"); } }
    else { next.has(key) ? next.delete(key) : next.add(key); }
    setSelShifts(next);
  };
  const WEEKDAY_OPTS = [{ key: "AM", label: "07–15", bg: "#dbeafe", c: "#1e3a8a", d: "8h" }, { key: "PM", label: "15–23", bg: "#ede9fe", c: "#4f46e5", d: "8h" }, { key: "NIGHT", label: "23–07", bg: "#1e293b", c: "#94a3b8", d: "8h" }];
  const WEEKEND_OPTS = [{ key: "DAY12", label: "07–19", bg: "#d1fae5", c: "#065f46", d: "12h" }, { key: "NIGHT12", label: "19–07", bg: "#312e81", c: "#a5b4fc", d: "12h" }];
  const allWD = ["AM", "PM", "NIGHT"].every(s => selShifts.has(s));
  const allWE = ["DAY12", "NIGHT12"].every(s => selShifts.has(s));
  const overlayStyle = { position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex", alignItems: mobile ? "flex-end" : "center", justifyContent: "center", zIndex: 50 };
  const modalStyle = { background: "#fff", borderRadius: mobile ? "14px 14px 0 0" : "14px", padding: "20px 18px", width: "100%", maxWidth: mobile ? "100%" : "480px", maxHeight: "90vh", overflowY: "auto" };
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 14 }}>{f.id ? "Edit patient" : "Add patient"}</div>
        <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Name</label><input style={inpS} value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. John Smith" /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 0 }}>
          <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Site</label><select style={selS} value={f.siteId} onChange={e => set("siteId", parseInt(e.target.value))}>{SITES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Room</label><input style={inpS} value={f.room} onChange={e => set("room", e.target.value)} placeholder="101" /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 0 }}>
          <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Watch level</label><select style={selS} value={f.watchLevel} onChange={e => set("watchLevel", e.target.value)}>{["HIGH", "MEDIUM", "LOW"].map(w => <option key={w}>{w}</option>)}</select></div>
          <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Status</label><select style={selS} value={f.status} onChange={e => set("status", e.target.value)}><option value="ACTIVE">Active</option><option value="DISCHARGED">Discharged</option></select></div>
        </div>
        {/* Weekday shifts */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>Weekday shifts (Mon–Fri · 8h)</label>
            <button onClick={() => toggleShift("WEEKDAY_ALL")} style={{ ...btnS(false), fontSize: 10, padding: "2px 8px" }}>{allWD ? "Clear" : "All"}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7 }}>
            {WEEKDAY_OPTS.map(o => {
              const sel = selShifts.has(o.key); return (
                <div key={o.key} onClick={() => toggleShift(o.key)} style={{ padding: "8px 4px", borderRadius: 8, border: `2px solid ${sel ? o.c : "#e2e8f0"}`, background: sel ? o.bg : "#fff", cursor: "pointer", textAlign: "center", touchAction: "manipulation" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: sel ? o.c : "#374151" }}>{o.label}</div>
                  <div style={{ fontSize: 9, color: sel ? o.c : "#94a3b8", marginTop: 1 }}>{o.d}</div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Weekend shifts */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>Weekend shifts (Sat–Sun · 12h)</label>
            <button onClick={() => toggleShift("WEEKEND_ALL")} style={{ ...btnS(false), fontSize: 10, padding: "2px 8px" }}>{allWE ? "Clear" : "All"}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            {WEEKEND_OPTS.map(o => {
              const sel = selShifts.has(o.key); return (
                <div key={o.key} onClick={() => toggleShift(o.key)} style={{ padding: "8px 4px", borderRadius: 8, border: `2px solid ${sel ? o.c : "#e2e8f0"}`, background: sel ? o.bg : "#fff", cursor: "pointer", textAlign: "center", touchAction: "manipulation" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: sel ? o.c : "#374151" }}>{o.label}</div>
                  <div style={{ fontSize: 9, color: sel ? o.c : "#94a3b8", marginTop: 1 }}>{o.d} shift</div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 12 }}>Selected: {[...selShifts].join(", ") || "None"}</div>
        <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Notes</label><textarea style={{ ...inpS, minHeight: 52, resize: "vertical" }} value={f.notes} onChange={e => set("notes", e.target.value)} placeholder="Risk flags..." /></div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {onDelete && <button style={{ ...btnS(false, true), marginRight: "auto" }} onClick={onDelete}>Delete</button>}
          <button style={btnS(false)} onClick={onClose}>Cancel</button>
          <button style={btnS(true)} onClick={() => { if (f.name.trim()) onSave({ ...f, requiredShifts: [...selShifts] }); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Guards Availability Page
// ─────────────────────────────────────────────────────────────────────────────
// GUARDS PAGE — unified employee directory + availability
// ─────────────────────────────────────────────────────────────────────────────
function GuardsPage({ guards, mobile, onEdit, onAdd }) {
  const [search, setSearch] = useState("");
  const [filterSite, setFilterSite] = useState("ALL");

  const filtered = guards.filter(g => {
    const q = search.toLowerCase();
    const matchQ = !q || g.name.toLowerCase().includes(q) ||
      (g.role || "").toLowerCase().includes(q) ||
      (g.email || "").toLowerCase().includes(q) ||
      (g.phone || "").includes(q);
    const matchSite = filterSite === "ALL" || (g.site || "") === filterSite;
    return matchQ && matchSite;
  });
  const guardSites = [...new Set(guards.map(g => g.site || "").filter(Boolean))];

  const empBadge = t => {
    const map = { "Full-time": ["#dbeafe", "#1e3a8a"], "Part-time": ["#ede9fe", "#4f46e5"], "Contract": ["#fef3c7", "#92400e"], "Casual": ["#dcfce7", "#14532d"] };
    const [bg, c] = map[t] || ["#f1f5f9", "#64748b"];
    return <span style={pill(bg, c)}>{t || "—"}</span>;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input style={{ ...inpS, flex: 1, minWidth: 160, fontSize: 13 }} value={search}
          onChange={e => setSearch(e.target.value)} placeholder="Search name, role, email, phone…" />
        <select style={{ ...selS, width: "auto", minWidth: 130, fontSize: 12 }} value={filterSite} onChange={e => setFilterSite(e.target.value)}>
          <option value="ALL">All sites</option>
          {guardSites.map(s => <option key={s}>{s}</option>)}
        </select>
        <button style={{ ...btnS(true), flexShrink: 0 }} onClick={onAdd}>+ Add guard</button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
        {[{ l: "Total", v: guards.length, bg: "#f8fafc", c: "#0f172a" },
        { l: "Full-time", v: guards.filter(g => g.employmentType === "Full-time").length, bg: "#eff6ff", c: "#1e40af" },
        { l: "Part-time", v: guards.filter(g => g.employmentType === "Part-time").length, bg: "#f5f3ff", c: "#4f46e5" },
        { l: "Showing", v: filtered.length, bg: "#f0fdf4", c: "#15803d" },
        ].map(x => (
          <div key={x.l} style={{ background: x.bg, borderRadius: 10, padding: "9px 12px" }}>
            <div style={{ fontSize: 9, color: x.c, opacity: .7, marginBottom: 1 }}>{x.l}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: x.c }}>{x.v}</div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ background: "#f8fafc", border: "1px dashed #e2e8f0", borderRadius: 12, padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
          {guards.length === 0 ? "No guards added yet — click + Add guard to get started." : "No guards match your search."}
        </div>
      )}

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${mobile ? 280 : 310}px,1fr))`, gap: 12 }}>
        {filtered.map((g, i) => {
          const [bg, col] = avCol(i);
          const activeDays = Object.keys(g.schedule || {}).map(Number).filter(d => (g.schedule[d] || []).length > 0);
          const allShifts = [...new Set(Object.values(g.schedule || {}).flat())];
          const totalHrs = Object.values(g.schedule || {}).flat().reduce((s, sk) => s + (SHIFTS[sk]?.hours || 0), 0);
          const hrColor = totalHrs > 40 ? "#dc2626" : totalHrs === 40 ? "#16a34a" : "#d97706";
          return (
            <div key={i} style={cardS({ overflow: "hidden" })}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid #f1f5f9", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: bg, color: col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{ini(g.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>{g.role || "Security Guard"}</div>
                    <div style={{ marginTop: 3 }}>{empBadge(g.employmentType)}</div>
                  </div>
                </div>
                <button style={{ ...btnS(false), fontSize: 11, padding: "4px 10px", flexShrink: 0 }} onClick={() => onEdit(g)}>Edit</button>
              </div>
              {/* Contact */}
              <div style={{ padding: "9px 14px", borderBottom: "1px solid #f8f9fb", display: "flex", flexDirection: "column", gap: 3 }}>
                {g.site && <div style={{ fontSize: 11, color: "#374151", display: "flex", gap: 5, alignItems: "center" }}><span>📍</span>{g.site}</div>}
                {g.phone && (
                  <a href={`tel:${g.phone.replace(/\s/g, "")}`}
                    style={{ fontSize: 11, color: "#374151", display: "flex", gap: 5, alignItems: "center", textDecoration: "none", padding: "3px 8px", borderRadius: 6, background: "#f0fdf4", border: "0.5px solid #86efac", width: "fit-content", cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#dcfce7"}
                    onMouseLeave={e => e.currentTarget.style.background = "#f0fdf4"}>
                    <span>📞</span>
                    <span style={{ color: "#15803d", fontWeight: 500 }}>{g.phone}</span>
                    <span style={{ fontSize: 9, color: "#16a34a", marginLeft: 2 }}>Call</span>
                  </a>
                )}
                {g.email && <div style={{ fontSize: 11, color: "#374151", display: "flex", gap: 5, alignItems: "center" }}><span>✉</span>{g.email}</div>}
                {!g.site && !g.phone && !g.email && <div style={{ fontSize: 10, color: "#94a3b8" }}>No contact info</div>}
              </div>
              {/* Availability */}
              <div style={{ padding: "9px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Availability</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: hrColor }}>{totalHrs}h/wk</span>
                </div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 5 }}>
                  {DAYS.map((d, idx) => {
                    const shifts = (g.schedule || {})[idx] || []; const active = shifts.length > 0; const we = idx >= 5; return (
                      <div key={d} title={active ? shifts.map(s => SHIFTS[s]?.label).join(", ") : "Not available"}
                        style={{ padding: "2px 5px", borderRadius: 5, fontSize: 9, fontWeight: 700, background: active ? (we ? "#d1fae5" : "#dcfce7") : "#f3f4f6", color: active ? (we ? "#065f46" : "#14532d") : "#9ca3af" }}>{d}</div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {Object.entries(SHIFTS).map(([k, v]) => {
                    const on = allShifts.includes(k); return (
                      <div key={k} style={{ padding: "2px 6px", borderRadius: 6, fontSize: 9, fontWeight: 600, background: on ? v.bg : "#f3f4f6", color: on ? v.color : "#9ca3af" }}>{v.label}{on ? " ✓" : " ✗"}</div>
                    );
                  })}
                </div>
                {activeDays.length === 0 && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>No restrictions — available all shifts</div>}
                {g.notes && <div style={{ marginTop: 5, fontSize: 10, color: "#64748b", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>"{g.notes}"</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD MODAL — add/edit info + availability in one tabbed modal
// ─────────────────────────────────────────────────────────────────────────────
function GuardModal({ data, mobile, onSave, onDelete, onClose }) {
  const isNew = !data.name || data.name === "";
  const [tab, setTab] = useState("info");
  const [f, setF] = useState({ name: "", phone: "", email: "", site: "", role: "Security Guard", employmentType: "Full-time", notes: "", ...data });
  const [schedule, setSchedule] = useState(() => {
    if (data.schedule) return { ...data.schedule };
    const s = {}; (data.availableDays || []).forEach(d => { s[d] = [...(data.availableShifts || [])]; });
    return s;
  });
  const [selDay, setSelDay] = useState(() => { const days = Object.keys(data.schedule || {}).map(Number); return days.length > 0 ? days[0] : 0; });
  const [timeOff, setTimeOff] = useState(data.timeOff || []);
  const [toForm, setToForm] = useState({ type: "day_off", start: "", end: "", note: "" });
  const [toError, setToError] = useState("");
  const nextToId = () => Date.now().toString(36);

  const addTimeOff = () => {
    setToError("");
    if (!toForm.start) { setToError("Start date is required"); return; }
    if (toForm.type === "vacation" && toForm.end && toForm.end < toForm.start) {
      setToError("End date must be on or after start date"); return;
    }
    const entry = {
      id: nextToId(),
      type: toForm.type,
      start: toForm.start,
      end: toForm.type === "vacation" && toForm.end ? toForm.end : toForm.start,
      note: toForm.note.trim(),
    };
    setTimeOff(prev => [...prev, entry].sort((a, b) => a.start.localeCompare(b.start)));
    setToForm({ type: "day_off", start: "", end: "", note: "" });
  };
  const removeTimeOff = id => setTimeOff(prev => prev.filter(t => t.id !== id));

  // Upcoming / active time off (from today onward)
  const today = toDateKey(new Date());
  const upcomingOff = timeOff.filter(t => t.end >= today);
  const pastOff = timeOff.filter(t => t.end < today);

  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const activeDays = Object.keys(schedule).map(Number).filter(d => (schedule[d] || []).length > 0);
  const totalHrs = Object.values(schedule).flat().reduce((s, sk) => s + (SHIFTS[sk]?.hours || 0), 0);
  const hrColor = totalHrs > 40 ? "#991b1b" : totalHrs === 40 ? "#14532d" : "#0369a1";
  const hrBg = totalHrs > 40 ? "#fef2f2" : totalHrs === 40 ? "#f0fdf4" : "#f0f9ff";
  const hrBorder = totalHrs > 40 ? "#fecaca" : totalHrs === 40 ? "#86efac" : "#bae6fd";

  const toggleDay = idx => {
    const next = { ...schedule };
    if (next[idx]) { delete next[idx]; } else { next[idx] = idx >= 5 ? ["DAY12", "NIGHT12"] : ["AM"]; }
    setSchedule(next); setSelDay(idx);
  };
  const toggleShift = (dayIdx, sk) => {
    const cur = schedule[dayIdx] || [];
    setSchedule(p => ({ ...p, [dayIdx]: cur.includes(sk) ? cur.filter(s => s !== sk) : [...cur, sk] }));
  };
  const setPreset = preset => {
    const s = {};
    if (preset === "weekday") { [0, 1, 2, 3, 4].forEach(d => { s[d] = schedule[d] || ["AM"]; }); setSelDay(0); }
    else if (preset === "weekend") { [5, 6].forEach(d => { s[d] = schedule[d] || ["DAY12", "NIGHT12"]; }); setSelDay(5); }
    else { [0, 1, 2, 3, 4, 5, 6].forEach(d => { s[d] = schedule[d] || (d >= 5 ? ["DAY12", "NIGHT12"] : ["AM"]); }); }
    setSchedule(s);
  };

  const overlayStyle = { position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex", alignItems: mobile ? "flex-end" : "center", justifyContent: "center", zIndex: 50 };
  const modalStyle = { background: "#fff", borderRadius: mobile ? "14px 14px 0 0" : "14px", width: "100%", maxWidth: mobile ? "100%" : "540px", maxHeight: "92vh", display: "flex", flexDirection: "column" };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>

        {/* Header + tabs */}
        <div style={{ padding: "16px 20px 0", flexShrink: 0, borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{isNew ? "Add guard" : "Edit guard"}</div>
              {!isNew && <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>{data.name}</div>}
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 0 }}>
            {[["info", "👤  Info"], ["availability", "🗓  Availability"], ["timeoff", "🏖  Time Off"]].map(([key, lbl]) => (
              <div key={key} onClick={() => setTab(key)} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer", color: tab === key ? "#3b82f6" : "#64748b", borderBottom: tab === key ? "2px solid #3b82f6" : "2px solid transparent", marginBottom: -1, userSelect: "none" }}>
                {lbl}
                {key === "availability" && activeDays.length > 0 && <span style={{ marginLeft: 5, padding: "1px 5px", borderRadius: 10, background: "#dbeafe", color: "#1e40af", fontSize: 9, fontWeight: 700 }}>{totalHrs}h</span>}
                {key === "timeoff" && upcomingOff.length > 0 && <span style={{ marginLeft: 5, padding: "1px 5px", borderRadius: 10, background: "#fef3c7", color: "#92400e", fontSize: 9, fontWeight: 700 }}>{upcomingOff.length}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* ── TAB: INFO ── */}
        {tab === "info" && (
          <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Full name *</label>
              <input style={{ ...inpS, background: !isNew ? "#f8fafc" : "#fff", color: !isNew ? "#64748b" : "#1e293b" }}
                value={f.name} onChange={e => set("name", e.target.value)}
                placeholder="e.g. Kirtesh Singh" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Phone</label>
                <input style={inpS} value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="705-555-0100" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Email</label>
                <input style={inpS} value={f.email} onChange={e => set("email", e.target.value)} placeholder="name@sbsecurity.ca" type="email" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Primary site</label>
                <select style={selS} value={f.site} onChange={e => set("site", e.target.value)}>
                  <option value="">— Select —</option>
                  {SITES.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  <option value="Multiple">Multiple sites</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Role</label>
                <select style={selS} value={f.role} onChange={e => set("role", e.target.value)}>
                  {["Security Guard", "Senior Guard", "Shift Lead", "Supervisor", "Floater"].map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 6, display: "block" }}>Employment type</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["Full-time", "Part-time", "Contract", "Casual"].map(t => (
                  <div key={t} onClick={() => set("employmentType", t)}
                    style={{ padding: "7px 14px", borderRadius: 8, border: `2px solid ${f.employmentType === t ? "#3b82f6" : "#e2e8f0"}`, background: f.employmentType === t ? "#eff6ff" : "#fff", cursor: "pointer", fontSize: 12, fontWeight: 500, color: f.employmentType === t ? "#1e40af" : "#374151", touchAction: "manipulation" }}>
                    {t}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Notes</label>
              <textarea style={{ ...inpS, minHeight: 56, resize: "vertical" }} value={f.notes} onChange={e => set("notes", e.target.value)} placeholder="e.g. Trained in de-escalation, prefers night shifts…" />
            </div>
            {/* Availability teaser */}
            <div onClick={() => setTab("availability")} style={{ padding: "10px 12px", background: activeDays.length > 0 ? "#f0f9ff" : "#fffbeb", border: `1px solid ${activeDays.length > 0 ? "#bae6fd" : "#fcd34d"}`, borderRadius: 8, fontSize: 11, cursor: "pointer", color: activeDays.length > 0 ? "#0369a1" : "#92400e" }}>
              {activeDays.length > 0
                ? <>🗓 Availability: <strong>{activeDays.map(d => DAYS[d]).join(", ")}</strong> · <strong>{totalHrs}h/week</strong> · <span style={{ textDecoration: "underline" }}>Edit →</span></>
                : <>⚠ No availability set — <span style={{ textDecoration: "underline" }}>Set availability →</span></>}
            </div>
          </div>
        )}

        {/* ── TAB: AVAILABILITY ── */}
        {tab === "availability" && (
          <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>
            {/* Day selector */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>① Select available days</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {[["Mon–Fri", () => setPreset("weekday")], ["Sat–Sun", () => setPreset("weekend")], ["All", () => setPreset("all")], ["Clear", () => setSchedule({})]].map(([lbl, fn]) => (
                    <button key={lbl} onClick={fn} style={{ ...btnS(false), fontSize: 9, padding: "2px 6px" }}>{lbl}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
                {DAYS.map((d, idx) => {
                  const active = !!(schedule[idx]?.length); const sel = selDay === idx; const we = idx >= 5;
                  return (
                    <div key={d} style={{ textAlign: "center" }}>
                      <div onClick={() => toggleDay(idx)} style={{ padding: "7px 2px", borderRadius: "8px 8px 0 0", border: `2px solid ${active ? (we ? "#065f46" : "#16a34a") : "#e2e8f0"}`, borderBottom: "none", background: active ? (we ? "#d1fae5" : "#dcfce7") : "#f8fafc", cursor: "pointer", touchAction: "manipulation" }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: active ? (we ? "#065f46" : "#14532d") : "#9ca3af" }}>{d}</div>
                        <div style={{ fontSize: 7, color: active ? (we ? "#065f46" : "#16a34a") : "#d1d5db", marginTop: 1 }}>{active ? (schedule[idx] || []).length + "s" : "off"}</div>
                      </div>
                      <div onClick={() => active && setSelDay(idx)} style={{ height: 4, borderRadius: "0 0 6px 6px", background: sel ? "#3b82f6" : "transparent", border: `0 solid ${active ? (we ? "#065f46" : "#16a34a") : "#e2e8f0"}`, borderWidth: "0 2px 2px 2px", cursor: active ? "pointer" : "default" }}></div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>Active: {activeDays.length === 0 ? "None" : activeDays.map(d => DAYS[d]).join(", ")}</div>
            </div>

            {/* Shift picker */}
            {activeDays.length > 0 && (
              <div style={{ marginBottom: 14, background: "#f8fafc", borderRadius: 10, padding: "12px 14px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>
                    ② Shifts for <span style={{ color: selDay >= 5 ? "#065f46" : "#3b82f6" }}>{DAYS[selDay]}</span>
                    <span style={{ fontSize: 10, fontWeight: 400, color: "#64748b", marginLeft: 5 }}>({selDay >= 5 ? "12h weekend" : "8h weekday"})</span>
                  </label>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setSchedule(p => ({ ...p, [selDay]: selDay >= 5 ? ["DAY12", "NIGHT12"] : ["AM", "PM", "NIGHT"] }))} style={{ ...btnS(false), fontSize: 9, padding: "2px 6px" }}>All</button>
                    <button onClick={() => setSchedule(p => ({ ...p, [selDay]: [] }))} style={{ ...btnS(false), fontSize: 9, padding: "2px 6px" }}>None</button>
                  </div>
                </div>
                {/* Day tabs */}
                <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
                  {activeDays.sort((a, b) => a - b).map(d => (
                    <div key={d} onClick={() => setSelDay(d)} style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: "pointer", background: selDay === d ? "#0f172a" : "#e2e8f0", color: selDay === d ? "#fff" : "#374151" }}>{DAYS[d]}</div>
                  ))}
                </div>
                {/* Shift cards */}
                <div style={{ display: "grid", gridTemplateColumns: selDay >= 5 ? "1fr 1fr" : "repeat(3,1fr)", gap: 8 }}>
                  {(selDay >= 5 ? ["DAY12", "NIGHT12"] : ["AM", "PM", "NIGHT"]).map(sk => {
                    const sh = SHIFTS[sk]; const on = (schedule[selDay] || []).includes(sk);
                    return (
                      <div key={sk} onClick={() => toggleShift(selDay, sk)} style={{ padding: "10px 6px", borderRadius: 9, border: `2px solid ${on ? sh.color : "#e2e8f0"}`, background: on ? sh.bg : "#fff", cursor: "pointer", textAlign: "center", touchAction: "manipulation" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: on ? sh.color : "#374151" }}>{sh.label}</div>
                        <div style={{ fontSize: 9, color: on ? sh.color : "#94a3b8", marginTop: 2 }}>{sh.time}</div>
                        <div style={{ fontSize: 9, color: on ? sh.color : "#94a3b8", marginTop: 1 }}>{sh.hours}h {on ? "✓" : "—"}</div>
                      </div>
                    );
                  })}
                </div>
                {!(schedule[selDay]?.length > 0) && <div style={{ marginTop: 8, fontSize: 11, color: "#dc2626" }}>⚠ No shifts selected for this day</div>}
              </div>
            )}

            {/* Hours summary */}
            {activeDays.length > 0 && (
              <div style={{ padding: "10px 12px", background: hrBg, border: `1px solid ${hrBorder}`, borderRadius: 8, fontSize: 12, color: hrColor }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Weekly hours preview</div>
                {activeDays.sort((a, b) => a - b).map(d => {
                  const shifts = schedule[d] || []; const hrs = shifts.reduce((s, sk) => s + (SHIFTS[sk]?.hours || 0), 0);
                  return shifts.length > 0 ? (
                    <div key={d} style={{ fontSize: 11, marginTop: 3, display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ minWidth: 28, fontWeight: 600 }}>{DAYS[d]}:</span>
                      {shifts.map(sk => <span key={sk} style={{ padding: "1px 6px", borderRadius: 10, background: SHIFTS[sk]?.bg, color: SHIFTS[sk]?.color, fontSize: 10, fontWeight: 600 }}>{SHIFTS[sk]?.label}</span>)}
                      <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto" }}>{hrs}h</span>
                    </div>
                  ) : null;
                })}
                <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(0,0,0,0.1)", fontWeight: 700 }}>
                  Total: {totalHrs}h/week {totalHrs > 40 ? "⚠ over 40h" : totalHrs === 40 ? "✓ exactly 40h" : "✓ under 40h"}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: TIME OFF ── */}
        {tab === "timeoff" && (
          <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>
            {/* Add form */}
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 10 }}>Add day off or vacation</div>
              {/* Type toggle */}
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                {[["day_off", "☀️ Day off"], ["vacation", "🏖 Vacation"]].map(([t, lbl]) => (
                  <div key={t} onClick={() => setToForm(x => ({ ...x, type: t, end: "" }))}
                    style={{ flex: 1, padding: "8px", borderRadius: 8, border: `2px solid ${toForm.type === t ? "#3b82f6" : "#e2e8f0"}`, background: toForm.type === t ? "#eff6ff" : "#fff", cursor: "pointer", textAlign: "center", fontSize: 12, fontWeight: 500, color: toForm.type === t ? "#1e40af" : "#374151", touchAction: "manipulation" }}>
                    {lbl}
                  </div>
                ))}
              </div>
              {/* Date fields */}
              <div style={{ display: "grid", gridTemplateColumns: toForm.type === "vacation" ? "1fr 1fr" : "1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>
                    {toForm.type === "vacation" ? "Start date" : "Date"}
                  </label>
                  <input type="date" style={inpS} value={toForm.start}
                    onChange={e => setToForm(x => ({ ...x, start: e.target.value }))} />
                </div>
                {toForm.type === "vacation" && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>End date</label>
                    <input type="date" style={inpS} value={toForm.end} min={toForm.start}
                      onChange={e => setToForm(x => ({ ...x, end: e.target.value }))} />
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" }}>Reason / note <span style={{ fontWeight: 400, color: "#94a3b8" }}>(optional)</span></label>
                <input style={inpS} value={toForm.note} onChange={e => setToForm(x => ({ ...x, note: e.target.value }))} placeholder="e.g. Family event, medical leave…" />
              </div>
              {toError && <div style={{ fontSize: 11, color: "#dc2626", marginBottom: 8 }}>⚠ {toError}</div>}
              {/* Preview */}
              {toForm.start && (
                <div style={{ fontSize: 11, color: "#0369a1", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 7, padding: "7px 10px", marginBottom: 10 }}>
                  {toForm.type === "day_off"
                    ? <>📅 Day off: <strong>{toForm.start}</strong></>
                    : <>🏖 Vacation: <strong>{toForm.start}</strong> → <strong>{toForm.end || toForm.start}</strong>
                      {toForm.start && toForm.end && toForm.end > toForm.start
                        ? <span style={{ marginLeft: 6, color: "#64748b" }}>({Math.round((new Date(toForm.end) - new Date(toForm.start)) / (864e5)) + 1} days)</span>
                        : null}
                    </>
                  }
                  {toForm.note && <span style={{ marginLeft: 6, color: "#64748b" }}>— {toForm.note}</span>}
                </div>
              )}
              <button style={{ ...btnS(true), width: "100%", justifyContent: "center" }} onClick={addTimeOff}>+ Add</button>
            </div>

            {/* Upcoming / active */}
            {upcomingOff.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Upcoming & current</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {upcomingOff.map(t => {
                    const isVac = t.type === "vacation" && t.start !== t.end;
                    const days = isVac ? Math.round((new Date(t.end) - new Date(t.start)) / (864e5)) + 1 : 1;
                    const isActive = today >= t.start && today <= t.end;
                    return (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: isActive ? "#fffbeb" : "#fff", border: `1px solid ${isActive ? "#fcd34d" : "#e2e8f0"}`, borderRadius: 9 }}>
                        <span style={{ fontSize: 16, flexShrink: 0 }}>{isVac ? "🏖" : "☀️"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: "#0f172a" }}>
                            {isVac ? `Vacation: ${t.start} – ${t.end}` : `Day off: ${t.start}`}
                            {isActive && <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 10, background: "#fef3c7", color: "#92400e", fontSize: 9, fontWeight: 700 }}>ACTIVE</span>}
                          </div>
                          {isVac && <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>{days} day{days !== 1 ? "s" : ""}</div>}
                          {t.note && <div style={{ fontSize: 10, color: "#64748b", marginTop: 1, fontStyle: "italic" }}>{t.note}</div>}
                        </div>
                        <button onClick={() => removeTimeOff(t.id)} style={{ ...btnS(false, true), fontSize: 11, padding: "3px 8px", flexShrink: 0 }}>Remove</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Past */}
            {pastOff.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Past</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {pastOff.map(t => {
                    const isVac = t.type === "vacation" && t.start !== t.end;
                    return (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 9, opacity: 0.7 }}>
                        <span style={{ fontSize: 14 }}>{isVac ? "🏖" : "☀️"}</span>
                        <div style={{ flex: 1, fontSize: 11, color: "#64748b" }}>
                          {isVac ? `${t.start} – ${t.end}` : `${t.start}`}{t.note ? ` — ${t.note}` : ""}
                        </div>
                        <button onClick={() => removeTimeOff(t.id)} style={{ ...btnS(false), fontSize: 10, padding: "2px 7px", flexShrink: 0 }}>×</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {timeOff.length === 0 && (
              <div style={{ textAlign: "center", padding: "28px", color: "#94a3b8", fontSize: 13, background: "#f8fafc", borderRadius: 10, border: "1px dashed #e2e8f0" }}>
                No time off recorded yet.<br />
                <span style={{ fontSize: 11 }}>Add a day off or vacation range above.</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", flexShrink: 0 }}>
          {!isNew && <button style={{ ...btnS(false, true), marginRight: "auto" }} onClick={() => onDelete(data.name)}>Delete guard</button>}
          <button style={btnS(false)} onClick={onClose}>Cancel</button>
          <button style={btnS(true)} onClick={() => { if (!f.name.trim()) { alert("Enter guard name"); return; } onSave({ ...f, schedule, timeOff }); }}>
            {isNew ? "Add guard" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT PANEL — uses Anthropic API with live app data as context
// ─────────────────────────────────────────────────────────────────────────────
function AIChatPanel({ patients, assigns, guards, weekDates, gaps, staffMap, doubles, mobile, onClose }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm your scheduling assistant. I have full access to your current schedule, patients, guards, availability, and hours. Ask me anything — like \"Who is available for the night shift on Wednesday?\" or \"Which patients have coverage gaps?\"" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Build a rich context snapshot from live app data
  function buildContext() {
    const today = toDateKey(new Date());

    // Patients summary
    const patientLines = patients.map(p => {
      const st = SITES.find(s => s.id === p.siteId)?.name || "";
      const todayDi = dayIdxOfDate(today);
      const todayShifts = shiftsForDayIdx(todayDi);
      const covered = weekDates.reduce((n, d) => {
        const dk = toDateKey(d), di = dayIdxOfDate(dk);
        return n + p.requiredShifts.filter(s => shiftsForDayIdx(di).includes(s) && assigns.find(a => a.patientId === p.id && a.shift === s && a.date === dk)).length;
      }, 0);
      const total = weekDates.reduce((n, d, di) => n + p.requiredShifts.filter(s => shiftsForDayIdx(dayIdxOfDate(toDateKey(d))).includes(s)).length, 0);
      return `  - ${p.name} | ${st} Rm ${p.room} | ${p.watchLevel} watch | ${covered}/${total} slots filled this week | Required: ${p.requiredShifts.join(",")}`;
    }).join("\n");

    // Guards summary
    const guardLines = guards.map(g => {
      const activeDays = Object.keys(g.schedule || {}).map(Number).filter(d => (g.schedule[d] || []).length > 0);
      const allShifts = [...new Set(Object.values(g.schedule || {}).flat())];
      const wkHrs = staffMap.find(s => s.name.toLowerCase() === g.name.toLowerCase())?.hours || 0;
      const limit = g.employmentType === "Full-time" ? 40 : 24;
      const timeOffNote = (g.timeOff || []).filter(t => t.end >= today).map(t => `off ${t.start}–${t.end}`).join(", ");
      return `  - ${g.name} | ${g.role || "Guard"} | ${g.employmentType || "Full-time"} (limit:${limit}h) | ${g.site || "—"} | Available: ${activeDays.map(d => DAYS[d]).join(",") || "any"} for ${allShifts.map(s => SHIFTS[s]?.label || s).join(",") || "any shift"} | This week: ${wkHrs}h${timeOffNote ? ` | Time off: ${timeOffNote}` : ""}`;
    }).join("\n");

    // This week's assignments
    const assignLines = weekDates.map(d => {
      const dk = toDateKey(d);
      const di = dayIdxOfDate(dk);
      const dayAssigns = assigns.filter(a => a.date === dk);
      if (!dayAssigns.length) return `  ${DAYS[di]} ${dk}: No assignments`;
      return `  ${DAYS[di]} ${dk}:\n` + dayAssigns.map(a => {
        const pat = patients.find(p => p.id === a.patientId)?.name || "?";
        return `    • ${a.staff} → ${SHIFTS[a.shift]?.label || a.shift} for ${pat}`;
      }).join("\n");
    }).join("\n");

    // Coverage gaps
    const gapLines = gaps.length === 0 ? "  No gaps — all shifts covered this week!" :
      gaps.map(g => `  - ${g.patient.name} needs ${SHIFTS[g.shift]?.label || g.shift} on ${g.dayLabel} (${g.date})`).join("\n");

    // Staff hours
    const hoursLines = staffMap.length === 0 ? "  No assignments yet" :
      staffMap.map(s => {
        const g = guards.find(x => x.name.toLowerCase() === s.name.toLowerCase());
        const limit = g?.employmentType === "Full-time" ? 40 : 24;
        return `  - ${s.name}: ${s.hours}h/${limit}h this week`;
      }).join("\n");

    return `You are an AI scheduling assistant for Southbridge Security. You have access to live scheduling data below. Answer questions accurately based only on this data. Be concise and helpful.

TODAY: ${today}
WEEK: ${weekDates[0] ? toDateKey(weekDates[0]) : ""} to ${weekDates[6] ? toDateKey(weekDates[6]) : ""}

SHIFT TYPES:
- AM: 07:00–15:00 (8h, weekdays)
- PM: 15:00–23:00 (8h, weekdays)
- NIGHT: 23:00–07:00 (8h, weekdays)
- DAY12: 07:00–19:00 (12h, weekends)
- NIGHT12: 19:00–07:00 (12h, weekends)

PATIENTS (${patients.length} total):
${patientLines || "  No patients added yet"}

GUARDS (${guards.length} total):
${guardLines || "  No guards added yet"}

THIS WEEK'S SCHEDULE:
${assignLines || "  No assignments this week"}

COVERAGE GAPS THIS WEEK:
${gapLines}

STAFF HOURS THIS WEEK:
${hoursLines}

DOUBLE SHIFTS:
${doubles.length === 0 ? "  None" : doubles.map(s => `  - ${s.name}: double shift on ${s.days?.map(d => d.date).join(", ")}`).join("\n")}`;
  }

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const systemPrompt = buildContext();
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: systemPrompt,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        })
      });
      const data = await response.json();
      const text = data.content?.find(b => b.type === "text")?.text || "Sorry, I couldn't get a response.";
      setMessages(prev => [...prev, { role: "assistant", content: text }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "⚠ Error connecting to AI. Please try again." }]);
    }
    setLoading(false);
  };

  const panelStyle = mobile ? {
    position: "fixed", inset: 0, zIndex: 48, background: "#fff", display: "flex", flexDirection: "column"
  } : {
    position: "fixed", right: 0, top: 0, bottom: 0, width: 380, zIndex: 48,
    background: "#fff", borderLeft: "1px solid #e2e8f0", display: "flex", flexDirection: "column",
    boxShadow: "-4px 0 24px rgba(0,0,0,0.08)"
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, background: "linear-gradient(135deg,#0f172a,#1e1b4b)" }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>✦</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>AI Scheduling Assistant</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>Powered by Claude · Live schedule data</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, background: "#f8fafc" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
            {/* Avatar */}
            <div style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
              background: m.role === "user" ? "#3b82f6" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff"
            }}>
              {m.role === "user" ? "A" : "✦"}
            </div>
            {/* Bubble */}
            <div style={{
              maxWidth: "82%", padding: "10px 13px", borderRadius: m.role === "user" ? "14px 4px 14px 14px" : "4px 14px 14px 14px",
              background: m.role === "user" ? "#3b82f6" : "#fff", color: m.role === "user" ? "#fff" : "#1e293b",
              fontSize: 12, lineHeight: 1.6, border: m.role === "user" ? "none" : "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)", whiteSpace: "pre-wrap", wordBreak: "break-word"
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff", flexShrink: 0 }}>✦</div>
            <div style={{ padding: "10px 14px", background: "#fff", borderRadius: "4px 14px 14px 14px", border: "1px solid #e2e8f0", display: "flex", gap: 4, alignItems: "center" }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1", animation: `bounce 1s ease-in-out ${i * 0.15}s infinite` }}></div>)}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggested prompts */}
      {messages.length === 1 && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 6, flexWrap: "wrap", background: "#fff" }}>
          {["Who is available tonight?", "Which patients have gaps?", "Show staff hours this week", "Who is over their limit?", "Guards on time off?"].map(q => (
            <div key={q} onClick={() => setInput(q)}
              style={{ padding: "5px 10px", borderRadius: 20, border: "1px solid #e2e8f0", fontSize: 11, color: "#374151", cursor: "pointer", background: "#f8fafc", whiteSpace: "nowrap" }}>
              {q}
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: "12px 14px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, background: "#fff", flexShrink: 0 }}>
        <input
          style={{ flex: 1, padding: "9px 12px", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 13, outline: "none", fontFamily: "inherit", color: "#1e293b" }}
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Ask about your schedule…"
          disabled={loading}
        />
        <button onClick={send} disabled={loading || !input.trim()}
          style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: loading || !input.trim() ? "#e2e8f0" : "linear-gradient(135deg,#6366f1,#8b5cf6)", color: loading || !input.trim() ? "#94a3b8" : "#fff", cursor: loading || !input.trim() ? "not-allowed" : "pointer", fontSize: 14, flexShrink: 0 }}>
          ➤
        </button>
      </div>

      <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CANADIAN PAYROLL ENGINE  (2024 rates — Ontario)
// ─────────────────────────────────────────────────────────────────────────────

// Canada Pension Plan (CPP) 2024
const CPP_RATE = 0.0595;   // 5.95%
const CPP_BASIC_EXEMPTION = 3500; // annual basic exemption
const CPP_MAX_EARNINGS = 68500;   // annual max pensionable earnings
const CPP_MAX_CONTRIBUTION = (CPP_MAX_EARNINGS - CPP_BASIC_EXEMPTION) * CPP_RATE; // ~3867.50

// Employment Insurance (EI) 2024
const EI_RATE = 0.01066;  // 1.066% employee rate
const EI_MAX_INSURABLE = 63200;   // annual max insurable earnings
const EI_MAX_PREMIUM = EI_MAX_INSURABLE * EI_RATE; // ~673.77

// Ontario Provincial Tax 2024 brackets (annual)
const ON_BRACKETS = [
  { min: 0, max: 51446, rate: 0.0505 },
  { min: 51446, max: 102894, rate: 0.0915 },
  { min: 102894, max: 150000, rate: 0.1116 },
  { min: 150000, max: 220000, rate: 0.1216 },
  { min: 220000, max: Infinity, rate: 0.1316 },
];
const ON_SURTAX_1 = { threshold: 5554, rate: 0.20 };
const ON_SURTAX_2 = { threshold: 7108, rate: 0.36 };

// Federal Tax 2024 brackets (annual)
const FED_BRACKETS = [
  { min: 0, max: 55867, rate: 0.15 },
  { min: 55867, max: 111733, rate: 0.205 },
  { min: 111733, max: 154906, rate: 0.26 },
  { min: 154906, max: 220000, rate: 0.29 },
  { min: 220000, max: Infinity, rate: 0.33 },
];
const BPA_2024 = 15705; // Basic Personal Amount (federal)
const ON_BPA_2024 = 11865; // Ontario basic personal amount

function calcBracketTax(income, brackets) {
  let tax = 0;
  for (const b of brackets) {
    if (income <= b.min) break;
    tax += (Math.min(income, b.max) - b.min) * b.rate;
  }
  return tax;
}

function calcOntarioSurtax(provincialTax) {
  let surtax = 0;
  if (provincialTax > ON_SURTAX_2.threshold) {
    surtax += (provincialTax - ON_SURTAX_2.threshold) * ON_SURTAX_2.rate;
    surtax += (ON_SURTAX_2.threshold - ON_SURTAX_1.threshold) * ON_SURTAX_1.rate;
  } else if (provincialTax > ON_SURTAX_1.threshold) {
    surtax += (provincialTax - ON_SURTAX_1.threshold) * ON_SURTAX_1.rate;
  }
  return surtax;
}

// Calculate all deductions for a biweekly pay period
function calcPaycheque(grossBiweekly, hourlyRate, hoursWorked) {
  const PAY_PERIODS = 26; // biweekly = 26 periods/year

  // Annualise
  const annualGross = grossBiweekly * PAY_PERIODS;

  // ── CPP ──────────────────────────────────────────────────────────────────
  // CPP is pro-rated; biweekly exemption = 3500/26 = ~134.62
  const biweeklyExemption = CPP_BASIC_EXEMPTION / PAY_PERIODS;
  const cppable = Math.max(0, grossBiweekly - biweeklyExemption);
  const cppBiweekly = Math.min(cppable * CPP_RATE, CPP_MAX_CONTRIBUTION / PAY_PERIODS);

  // ── EI ───────────────────────────────────────────────────────────────────
  const eiBiweekly = Math.min(grossBiweekly * EI_RATE, EI_MAX_PREMIUM / PAY_PERIODS);

  // ── Federal Income Tax ────────────────────────────────────────────────────
  const fedTaxableAnnual = Math.max(0, annualGross - BPA_2024);
  const fedTaxAnnual = calcBracketTax(fedTaxableAnnual, FED_BRACKETS);
  // Federal CPP & EI credits
  const fedCPPCredit = Math.min(CPP_MAX_CONTRIBUTION, cppBiweekly * PAY_PERIODS) * 0.15;
  const fedEICredit = Math.min(EI_MAX_PREMIUM, eiBiweekly * PAY_PERIODS) * 0.15;
  const fedTaxAfterCredits = Math.max(0, fedTaxAnnual - fedCPPCredit - fedEICredit);
  const fedTaxBiweekly = fedTaxAfterCredits / PAY_PERIODS;

  // ── Ontario Provincial Tax ────────────────────────────────────────────────
  const onTaxableAnnual = Math.max(0, annualGross - ON_BPA_2024);
  const onTaxAnnual = calcBracketTax(onTaxableAnnual, ON_BRACKETS);
  const onSurtax = calcOntarioSurtax(onTaxAnnual);
  // Ontario tax reduction (low-income)
  const onReduction = Math.max(0, 274 - 0.02 * Math.max(0, annualGross - 15714));
  const onTotalAnnual = Math.max(0, onTaxAnnual + onSurtax - onReduction);
  const onTaxBiweekly = onTotalAnnual / PAY_PERIODS;

  const totalDeductions = cppBiweekly + eiBiweekly + fedTaxBiweekly + onTaxBiweekly;
  const netPay = grossBiweekly - totalDeductions;

  return {
    grossPay: +grossBiweekly.toFixed(2),
    hoursWorked: +hoursWorked.toFixed(2),
    hourlyRate: +hourlyRate.toFixed(2),
    cpp: +cppBiweekly.toFixed(2),
    ei: +eiBiweekly.toFixed(2),
    fedTax: +fedTaxBiweekly.toFixed(2),
    provTax: +onTaxBiweekly.toFixed(2),
    totalDeductions: +totalDeductions.toFixed(2),
    netPay: +netPay.toFixed(2),
    ytdGross: +(annualGross / 2).toFixed(2), // assume mid-year
    ytdCPP: +(cppBiweekly * 13).toFixed(2),
    ytdEI: +(eiBiweekly * 13).toFixed(2),
    ytdFedTax: +(fedTaxBiweekly * 13).toFixed(2),
    ytdProvTax: +(onTaxBiweekly * 13).toFixed(2),
  };
}

const fmt = n => `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Get all assignments for a guard in a date range (biweekly)
function guardAssignmentsInRange(guardName, assigns, startDate, endDate) {
  const n = guardName.toLowerCase().trim();
  return assigns.filter(a =>
    a.staff.toLowerCase().trim() === n &&
    a.date >= startDate && a.date <= endDate
  );
}

function addDays(dateKey, days) {
  const d = new Date(dateKey + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL PAGE
// ─────────────────────────────────────────────────────────────────────────────
function PayrollPage({ guards, assigns, setGuards, mobile, onPaycheque }) {
  const [search, setSearch] = useState("");
  const [editRate, setEditRate] = useState(null);
  const [periodStart, setPeriodStart] = useState("2026-05-11");
  const [tab, setTab] = useState("summary");

  const periodEnd = addDays(periodStart, 13);

  const filteredGuards = guards.filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase())
  );

  const saveRate = () => {
    if (!editRate) return;
    const rate = parseFloat(editRate.rate);
    if (isNaN(rate) || rate <= 0) { alert("Enter a valid hourly rate"); return; }
    const gFound = guards.find(x => x.name === editRate.name);
    const updatedG = { ...gFound, hourlyRate: rate };
    if (gFound?._id) { updateGuard(gFound._id, updatedG).catch(() => { }); }
    setGuards(prev => prev.map(x => x.name === editRate.name ? updatedG : x));
    setEditRate(null);
  };

  // Period stats
  const allWithHours = guards.map(g => {
    const hrs = guardAssignmentsInRange(g.name, assigns, periodStart, periodEnd).reduce((s, a) => s + (SHIFTS[a.shift]?.hours || 0), 0);
    const gross = hrs * (g.hourlyRate || 20);
    return { ...g, periodHours: hrs, periodGross: gross };
  }).filter(g => g.periodHours > 0);
  const totalGross = allWithHours.reduce((s, g) => s + g.periodGross, 0);
  const totalHrs = allWithHours.reduce((s, g) => s + g.periodHours, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Period selector */}
      <div style={cardS({ padding: "12px 14px" })}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "nowrap" }}>
          <span style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0, whiteSpace: "nowrap" }}>Period</span>
          <input type="date" style={{ border: "0.5px solid #e2e8f0", borderRadius: 8, fontSize: 12, padding: "5px 8px", color: "#0f172a", background: "#fff", outline: "none", fontFamily: "inherit", flexShrink: 0, width: 138 }}
            value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
          <span style={{ fontSize: 12, color: "#94a3b8", flexShrink: 0 }}>→</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: "#0f172a", flexShrink: 0, whiteSpace: "nowrap" }}>{periodEnd}</span>
          <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0, whiteSpace: "nowrap" }}>(14 days)</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[{ l: "Guards paid", v: allWithHours.length, c: "#1e40af", bg: "#eff6ff" },
          { l: "Total hours", v: totalHrs + "h", c: "#7e22ce", bg: "#fdf4ff" },
          { l: "Gross payroll", v: fmt(totalGross), c: "#14532d", bg: "#f0fdf4" }
          ].map(x => (
            <div key={x.l} style={{ background: x.bg, borderRadius: 8, padding: "4px 10px", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 9, color: x.c, opacity: .7 }}>{x.l}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: x.c }}>{x.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "0.5px solid #e2e8f0", gap: 0 }}>
        {[["summary", "Pay summary"], ["rates", "Hourly rates"]].map(([key, lbl]) => (
          <div key={key} onClick={() => setTab(key)}
            style={{
              padding: "8px 16px", fontSize: 12, fontWeight: 500, cursor: "pointer",
              color: tab === key ? "#3b82f6" : "#64748b",
              borderBottom: tab === key ? "2px solid #3b82f6" : "2px solid transparent",
              marginBottom: -1, userSelect: "none"
            }}>
            {lbl}
          </div>
        ))}
      </div>

      {/* Search */}
      <input style={{ ...inpS, fontSize: 13 }} value={search}
        onChange={e => setSearch(e.target.value)} placeholder="Search guards…" />

      {/* ── Pay summary ── */}
      {tab === "summary" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filteredGuards.map((g, i) => {
            const [bg, col] = avCol(i);
            const periodAssigns = guardAssignmentsInRange(g.name, assigns, periodStart, periodEnd);
            const hours = periodAssigns.reduce((s, a) => s + (SHIFTS[a.shift]?.hours || 0), 0);
            const rate = g.hourlyRate || 20;
            const gross = hours * rate;
            const calc = hours > 0 ? calcPaycheque(gross, rate, hours) : null;
            return (
              <div key={i} style={cardS({ overflow: "hidden", opacity: hours === 0 ? 0.5 : 1 })}>
                {/* Guard row */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px" }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: bg, color: col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{ini(g.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>{g.role || "Guard"} · {g.employmentType} · {fmt(rate)}/hr</div>
                  </div>
                  {hours > 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {/* Inline deductions */}
                      {calc && !mobile && (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {[["CPP", calc.cpp], ["EI", calc.ei], ["Fed", calc.fedTax], ["ON", calc.provTax]].map(([l, v]) => (
                            <div key={l} style={{ textAlign: "center", minWidth: 40 }}>
                              <div style={{ fontSize: 9, color: "#94a3b8" }}>{l}</div>
                              <div style={{ fontSize: 10, fontWeight: 500, color: "#dc2626" }}>{fmt(v)}</div>
                            </div>
                          ))}
                          <div style={{ width: 1, height: 28, background: "#e2e8f0", margin: "0 4px" }}></div>
                        </div>
                      )}
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: "#94a3b8" }}>{hours}h · Gross {fmt(gross)}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#16a34a" }}>Net {calc ? fmt(calc.netPay) : "—"}</div>
                      </div>
                      <button onClick={() => onPaycheque(g, { start: periodStart, end: periodEnd, hours, gross, calc })}
                        style={{ ...btnS(true), fontSize: 11, padding: "5px 12px", flexShrink: 0 }}>
                        Paycheque
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }}>No shifts this period</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Hourly rates ── */}
      {tab === "rates" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, color: "#64748b", padding: "2px 0" }}>
            Set each guard's hourly rate. Changes apply immediately to all paycheque calculations.
          </div>
          {filteredGuards.map((g, i) => {
            const [bg, col] = avCol(i);
            const isEditing = editRate?.name === g.name;
            return (
              <div key={i} style={cardS({ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 })}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: bg, color: col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{ini(g.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{g.role || "Guard"} · {g.employmentType}</div>
                </div>
                {isEditing ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: "#374151" }}>$</span>
                    <input type="number" min="0" step="0.25" autoFocus
                      style={{ ...inpS, width: 76, fontSize: 13, padding: "5px 8px" }}
                      value={editRate.rate}
                      onChange={e => setEditRate(x => ({ ...x, rate: e.target.value }))}
                      onKeyDown={e => { if (e.key === "Enter") saveRate(); if (e.key === "Escape") setEditRate(null); }} />
                    <span style={{ fontSize: 11, color: "#64748b" }}>/hr</span>
                    <button onClick={saveRate} style={{ ...btnS(true), fontSize: 11, padding: "4px 10px" }}>Save</button>
                    <button onClick={() => setEditRate(null)} style={{ ...btnS(false), fontSize: 11, padding: "4px 8px" }}>×</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>{fmt(g.hourlyRate || 20)}<span style={{ fontSize: 10, fontWeight: 400, color: "#64748b" }}>/hr</span></span>
                    <button onClick={() => setEditRate({ name: g.name, rate: String(g.hourlyRate || 20) })}
                      style={{ ...btnS(false), fontSize: 11, padding: "4px 10px" }}>Edit</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYCHEQUE MODAL — clean Canadian format
// ─────────────────────────────────────────────────────────────────────────────
function PaychequeModal({ guard, period, assigns, mobile, onClose }) {
  const { calc, hours, gross, start, end } = period;
  const rate = guard.hourlyRate || 20;
  const ref = useRef(null);

  const periodAssigns = guardAssignmentsInRange(guard.name, assigns, start, end);
  const shiftBreakdown = Object.entries(
    periodAssigns.reduce((acc, a) => {
      const k = a.shift;
      if (!acc[k]) acc[k] = { hours: 0, count: 0 };
      acc[k].hours += SHIFTS[k]?.hours || 0; acc[k].count++;
      return acc;
    }, {})
  ).map(([k, v]) => ({ shift: k, hours: v.hours, count: v.count, amount: v.hours * rate }));

  const printPaycheque = () => {
    const win = window.open("", "_blank", "width=800,height=650");
    if (!win) { alert("Please allow pop-ups for this site, then click Print / PDF again."); return; }
    const rows = shiftBreakdown.map(s => `
      <tr><td>${SHIFTS[s.shift]?.label || s.shift} shift (${SHIFTS[s.shift]?.time || ""}) × ${s.count}</td>
          <td class="r">${s.hours.toFixed(0)} h</td><td class="r">${fmt(rate)}</td><td class="r">${fmt(s.amount)}</td></tr>`).join("");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Paycheque · ${guard.name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#111;background:#fff;padding:18mm}
  @page{size:letter portrait;margin:12mm}
  @media print{body{padding:0}.no-print{display:none}}
  h1{font-size:14pt;font-weight:bold;margin:0}
  .co{font-size:8pt;color:#555;margin-top:2px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;border-bottom:1.5px solid #111;margin-bottom:12px}
  .tag{font-size:8pt;font-weight:bold;border:1px solid #111;padding:3px 8px;text-transform:uppercase;letter-spacing:.06em}
  .info{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #ccc;margin-bottom:12px}
  .info-cell{padding:5px 10px;border-right:1px solid #ccc;border-bottom:1px solid #ccc}
  .info-cell:nth-child(even){border-right:none}
  .info-cell:nth-last-child(-n+2){border-bottom:none}
  .label{font-size:7.5pt;color:#777;text-transform:uppercase;letter-spacing:.04em}
  .val{font-size:10pt;font-weight:bold;margin-top:1px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{background:#f0f0f0;font-size:8.5pt;padding:5px 8px;text-align:left;border:1px solid #ccc}
  td{font-size:9.5pt;padding:5px 8px;border:1px solid #ddd}
  .r{text-align:right}
  .sec{font-size:8pt;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;background:#e8e8e8;padding:4px 8px;margin-bottom:0}
  .total td{font-weight:bold;background:#f8f8f8;border-top:1.5px solid #999}
  .net-box{border:1.5px solid #111;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
  .net-label{font-size:8.5pt;text-transform:uppercase;letter-spacing:.05em;color:#444}
  .net-amount{font-size:22pt;font-weight:bold}
  .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid #ccc;margin-bottom:12px}
  .sum-cell{padding:6px 10px;text-align:center;border-right:1px solid #ccc}
  .sum-cell:last-child{border-right:none}
  .sum-label{font-size:7.5pt;color:#777;text-transform:uppercase;letter-spacing:.04em}
  .sum-val{font-size:11pt;font-weight:bold;margin-top:2px}
  .footer{font-size:7.5pt;color:#888;line-height:1.5;border-top:1px solid #ccc;padding-top:8px}
  .detach{text-align:center;font-size:8pt;color:#999;padding:8px 0;border-top:1.5px dashed #ccc;margin-top:12px;letter-spacing:.05em}
  .print-btn{margin-top:14px;padding:9px 24px;font-size:10pt;cursor:pointer;background:#111;color:#fff;border:none;border-radius:4px}
</style></head><body>

<div class="top">
  <div>
    <h1>Southbridge Security Inc.</h1>
    <div class="co">123 Corporate Drive, Thunder Bay, ON P7B 1A1 &nbsp;|&nbsp; BN: 123456789 RT0001 &nbsp;|&nbsp; (807) 555-0100</div>
  </div>
  <div class="tag">Statement of Earnings</div>
</div>

<div class="info">
  <div class="info-cell"><div class="label">Employee</div><div class="val">${guard.name}</div></div>
  <div class="info-cell"><div class="label">Position</div><div class="val">${guard.role || "Security Guard"}</div></div>
  <div class="info-cell"><div class="label">Pay period</div><div class="val">${start} to ${end}</div></div>
  <div class="info-cell"><div class="label">Employment type</div><div class="val">${guard.employmentType || "Full-time"}</div></div>
  <div class="info-cell"><div class="label">Site</div><div class="val">${guard.site || "—"}</div></div>
  <div class="info-cell"><div class="label">Pay date</div><div class="val">${end}</div></div>
</div>

<div class="sec">Earnings</div>
<table>
  <tr><th>Description</th><th>Hours</th><th>Rate</th><th class="r">Amount</th></tr>
  ${rows}
  <tr class="total"><td colspan="2"><strong>Total earnings</strong></td><td class="r"><strong>${hours.toFixed(0)} h</strong></td><td class="r"><strong>${fmt(gross)}</strong></td></tr>
</table>

<div class="sec">Statutory Deductions</div>
<table>
  <tr><th>Code</th><th>Description</th><th class="r">This period</th><th class="r">YTD (est.)</th></tr>
  <tr><td>CPP</td><td>Canada Pension Plan (5.95%)</td><td class="r">${fmt(calc.cpp)}</td><td class="r">${fmt(calc.ytdCPP)}</td></tr>
  <tr><td>EI</td><td>Employment Insurance (1.066%)</td><td class="r">${fmt(calc.ei)}</td><td class="r">${fmt(calc.ytdEI)}</td></tr>
  <tr><td>FED</td><td>Federal income tax — CRA</td><td class="r">${fmt(calc.fedTax)}</td><td class="r">${fmt(calc.ytdFedTax)}</td></tr>
  <tr><td>ON</td><td>Ontario provincial income tax</td><td class="r">${fmt(calc.provTax)}</td><td class="r">${fmt(calc.ytdProvTax)}</td></tr>
  <tr class="total"><td colspan="2"><strong>Total deductions</strong></td><td class="r"><strong>${fmt(calc.totalDeductions)}</strong></td><td class="r"><strong>${fmt(calc.ytdCPP + calc.ytdEI + calc.ytdFedTax + calc.ytdProvTax)}</strong></td></tr>
</table>

<div class="net-box">
  <div><div class="net-label">Net pay &mdash; direct deposit</div><div style="font-size:8pt;color:#666;margin-top:2px">Effective ${end} &nbsp;|&nbsp; ${hours.toFixed(0)} hrs @ ${fmt(rate)}/hr</div></div>
  <div class="net-amount">${fmt(calc.netPay)}</div>
</div>

<div class="summary">
  <div class="sum-cell"><div class="sum-label">Gross pay</div><div class="sum-val">${fmt(gross)}</div></div>
  <div class="sum-cell"><div class="sum-label">Deductions</div><div class="sum-val">${fmt(calc.totalDeductions)}</div></div>
  <div class="sum-cell"><div class="sum-label">Net pay</div><div class="sum-val">${fmt(calc.netPay)}</div></div>
  <div class="sum-cell"><div class="sum-label">Rate</div><div class="sum-val">${fmt(rate)}/hr</div></div>
</div>

<div class="footer">Deductions per CRA 2024 guidelines (Ontario). CPP at 5.95% of pensionable earnings; EI at 1.066% of insurable earnings. Federal tax uses 2024 brackets with BPA $15,705; Ontario tax uses 2024 brackets with BPA $11,865. YTD figures are estimates. This is not a T4 slip &mdash; retain for your records.</div>
<div class="detach">&#x2702; &mdash; &mdash; &mdash; DETACH AND RETAIN THIS STUB &mdash; &mdash; &mdash;</div>

<div class="no-print" style="text-align:center;margin-top:16px">
  <button class="print-btn" onclick="window.print()">&#x1F5A8; Save as PDF / Print</button>
</div>
</body></html>`);
    win.document.close();
    win.focus();
    win.onload = () => { win.print(); };
  };

  const overlayStyle = { position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "flex", alignItems: mobile ? "flex-end" : "center", justifyContent: "center", zIndex: 60 };
  const modalStyle = { background: "#fff", borderRadius: mobile ? "14px 14px 0 0" : "14px", width: "100%", maxWidth: mobile ? "100%" : "560px", maxHeight: "92vh", overflowY: "auto", display: "flex", flexDirection: "column" };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>

        {/* Modal header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderBottom: "0.5px solid #e2e8f0", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{guard.name}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{guard.role || "Security Guard"} · {start} to {end}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={printPaycheque} style={{ ...btnS(true), fontSize: 11, padding: "5px 12px" }}>🖨 Print / PDF</button>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 2 }}>×</button>
          </div>
        </div>

        {/* Stub preview */}
        <div style={{ padding: "16px 18px", flex: 1, overflowY: "auto" }} ref={ref}>

          {/* Company header */}
          <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>Southbridge Security Inc.</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>123 Corporate Drive, Thunder Bay, ON P7B 1A1 · BN: 123456789 RT0001</div>
          </div>

          {/* Employee info — 3 inline rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14, padding: "10px 12px", background: "#f8fafc", borderRadius: 8, border: "0.5px solid #e2e8f0" }}>
            {[["Employee / Position", `${guard.name} · ${guard.role || "Security Guard"}`],
            ["Pay period / Pay date", `${start} to ${end} · Paid ${end}`],
            ["Employment / Site", `${guard.employmentType || "Full-time"} · ${guard.site || "—"} · ${fmt(rate)}/hr`],
            ].map(([l, v]) => (
              <div key={l} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontSize: 10, color: "#94a3b8", minWidth: mobile ? 110 : 150, flexShrink: 0 }}>{l}</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: "#0f172a" }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Earnings */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Earnings</div>
            {shiftBreakdown.map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "0.5px solid #f1f5f9" }}>
                <span style={{ fontSize: 11, color: "#374151" }}>{SHIFTS[s.shift]?.label || s.shift} shift ({SHIFTS[s.shift]?.time || ""}) × {s.count} shifts · {s.hours}h @ {fmt(rate)}</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: "#0f172a", flexShrink: 0, marginLeft: 8 }}>{fmt(s.amount)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #e2e8f0", marginTop: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#0f172a" }}>Total earnings ({hours}h)</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{fmt(gross)}</span>
            </div>
          </div>

          {/* Deductions */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Statutory deductions</div>
            {[["CPP", "Canada Pension Plan (5.95%)", calc.cpp, calc.ytdCPP],
            ["EI", "Employment Insurance (1.066%)", calc.ei, calc.ytdEI],
            ["Fed Tax", "Federal income tax", calc.fedTax, calc.ytdFedTax],
            ["ON Tax", "Ontario provincial tax", calc.provTax, calc.ytdProvTax],
            ].map(([code, desc, val, ytd]) => (
              <div key={code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "0.5px solid #f1f5f9" }}>
                <span style={{ fontSize: 11, color: "#374151" }}><strong>{code}</strong> · {desc}</span>
                <div style={{ display: "flex", gap: 14, flexShrink: 0, marginLeft: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "#dc2626" }}>–{fmt(val)}</span>
                  <span style={{ fontSize: 10, color: "#94a3b8", minWidth: 58, textAlign: "right" }}>YTD {fmt(ytd)}</span>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #e2e8f0", marginTop: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#dc2626" }}>Total deductions</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#dc2626" }}>–{fmt(calc.totalDeductions)}</span>
            </div>
          </div>

          {/* Net pay */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#0f172a", borderRadius: 8, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Net pay · direct deposit · {end}</div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Gross {fmt(gross)} – Deductions {fmt(calc.totalDeductions)}</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#4ade80" }}>{fmt(calc.netPay)}</div>
          </div>

          {/* Legal note */}
          <div style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.6, borderTop: "0.5px solid #f1f5f9", paddingTop: 8 }}>
            Deductions per CRA 2024 guidelines (Ontario). CPP 5.95%, EI 1.066%, federal BPA $15,705, Ontario BPA $11,865. YTD figures are estimates based on mid-year. This is not a T4 slip — retain for your records.
          </div>
        </div>
      </div>
    </div>
  );
}

// CANADIAN PAYROLL ENGINE  (2024 rates — Ontario)
// ─────────────────────────────────────────────────────────────────────────────

// Canada Pension Plan (CPP) 2024
// ─────────────────────────────────────────────────────────────────────────────
// AUTO SCHEDULE GENERATOR
// Respects: availability schedule, time off, book-off, one shift/day, hour limits
// Skips guards who are unavailable — leaves those slots empty for manual fixing
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Check if a guard is valid for a given shift/date (all rules)
// ─────────────────────────────────────────────────────────────────────────────
function isGuardAvailable(g, shift, dk, dayIdx, hoursFor, assignedToday) {
  if (isOnTimeOff(g, dk)) return { ok: false, reason: "time_off" };
  const todayShifts = (g.schedule || {})[dayIdx] || [];
  if (!todayShifts.length) return { ok: false, reason: "no_avail_day" };
  if (!todayShifts.includes(shift)) return { ok: false, reason: "wrong_shift" };
  if (assignedToday(g.name, dk)) return { ok: false, reason: "busy" };
  const limit = g.employmentType === "Full-time" ? 40 : 24;
  if (hoursFor(g.name) + (SHIFTS[shift]?.hours || 0) > limit) return { ok: false, reason: "over_limit" };
  return { ok: true };
}

function generateSchedule(patients, guards, assigns, weekDates) {
  const results = [];  // new assignments to add
  const warnings = [];  // skipped — guard unavailable, leave empty for manual fix
  const runHours = {};  // hours assigned this run per guard
  const runDays = {};  // one shift per day tracking

  const weekKeys = new Set(weekDates.map(toDateKey));

  // Previous week dates (7 days before each current day)
  const prevWeekKeys = weekDates.map(d => {
    const prev = new Date(d);
    prev.setDate(prev.getDate() - 7);
    return toDateKey(prev);
  });

  // Build prev week map: patientId-shift-dayPosition -> staffName
  const prevMap = {};
  assigns.forEach(a => {
    const idx = prevWeekKeys.indexOf(a.date);
    if (idx !== -1) prevMap[`${a.patientId}-${a.shift}-${idx}`] = a.staff;
  });

  const hoursFor = (name) => {
    const existing = assigns
      .filter(a => a.staff.toLowerCase().trim() === name.toLowerCase().trim() && weekKeys.has(a.date))
      .reduce((s, a) => s + (SHIFTS[a.shift]?.hours || 0), 0);
    return existing + (runHours[name] || 0);
  };

  const assignedToday = (name, date) => {
    if (runDays[`${name.toLowerCase().trim()}-${date}`]) return true;
    return assigns.some(a => a.staff.toLowerCase().trim() === name.toLowerCase().trim() && a.date === date);
  };

  const watchOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const sortedPatients = [...patients]
    .filter(p => p.status === 'ACTIVE')
    .sort((a, b) => (watchOrder[a.watchLevel] ?? 2) - (watchOrder[b.watchLevel] ?? 2));

  weekDates.forEach((d, dayPos) => {
    const dk = toDateKey(d);
    const dayIdx = dayIdxOfDate(dk);
    const validShifts = shiftsForDayIdx(dayIdx);

    sortedPatients.forEach(pat => {
      const needed = pat.requiredShifts.filter(s => validShifts.includes(s));
      needed.forEach(shift => {
        // Skip if already assigned
        const alreadyDone =
          assigns.some(a => a.patientId === pat.id && a.shift === shift && a.date === dk) ||
          results.some(a => a.patientId === pat.id && a.shift === shift && a.date === dk);
        if (alreadyDone) return;

        // Look up who did this shift last week
        const prevStaff = prevMap[`${pat.id}-${shift}-${dayPos}`];

        if (!prevStaff) {
          // No previous assignment — skip, let scheduler fill manually
          warnings.push({
            patient: pat.name, shift, date: dk, dayLabel: fmtDate(d),
            reason: 'No previous assignment — assign manually',
          });
          return;
        }

        // Find the guard record
        const guard = guards.find(g => g.name.toLowerCase().trim() === prevStaff.toLowerCase().trim());

        if (!guard) {
          warnings.push({
            patient: pat.name, shift, date: dk, dayLabel: fmtDate(d),
            reason: `${prevStaff} no longer in system`,
          });
          return;
        }

        // Check all availability rules — if ANY fail, leave slot empty
        const limit = guard.employmentType === 'Full-time' ? 40 : 24;
        const todayShifts = (guard.schedule || {})[dayIdx] || [];

        if (isOnTimeOff(guard, dk)) {
          warnings.push({ patient: pat.name, shift, date: dk, dayLabel: fmtDate(d), reason: `${prevStaff} — on time off / book-off` }); return;
        }
        if (!todayShifts.length) {
          warnings.push({ patient: pat.name, shift, date: dk, dayLabel: fmtDate(d), reason: `${prevStaff} — availability changed (no longer works ${DAYS[dayIdx]}s)` }); return;
        }
        if (!todayShifts.includes(shift)) {
          warnings.push({ patient: pat.name, shift, date: dk, dayLabel: fmtDate(d), reason: `${prevStaff} — no longer available for ${SHIFTS[shift]?.label} on ${DAYS[dayIdx]}s` }); return;
        }
        if (assignedToday(guard.name, dk)) {
          warnings.push({ patient: pat.name, shift, date: dk, dayLabel: fmtDate(d), reason: `${prevStaff} — already assigned to another shift today` }); return;
        }
        if (hoursFor(guard.name) + (SHIFTS[shift]?.hours || 0) > limit) {
          warnings.push({ patient: pat.name, shift, date: dk, dayLabel: fmtDate(d), reason: `${prevStaff} — would exceed ${limit}h ${guard.employmentType} limit` }); return;
        }

        // All checks passed — assign same guard as last week
        runHours[guard.name] = (runHours[guard.name] || 0) + (SHIFTS[shift]?.hours || 0);
        runDays[`${guard.name.toLowerCase().trim()}-${dk}`] = true;
        results.push({ patientId: pat.id, shift, date: dk, staff: guard.name });
      });
    });
  });

  return { results, warnings, replaced: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE SCHEDULE MODAL
// ─────────────────────────────────────────────────────────────────────────────
function GenerateScheduleModal({ patients, guards, assigns, weekDates, mobile, onGenerate, onClose }) {
  const [preview, setPreview] = useState(null);  // { results, warnings }
  const [generated, setGenerated] = useState(false);

  const run = () => {
    const result = generateSchedule(patients, guards, assigns, weekDates);
    setPreview(result);
    setGenerated(true);
  };

  const overlayStyle = { position: "fixed", inset: 0, background: "rgba(15,23,42,.6)", display: "flex", alignItems: mobile ? "flex-end" : "center", justifyContent: "center", zIndex: 50 };
  const modalStyle = { background: "#fff", borderRadius: mobile ? "14px 14px 0 0" : "14px", width: "100%", maxWidth: mobile ? "100%" : "560px", maxHeight: "92vh", display: "flex", flexDirection: "column" };

  const filled = preview?.results?.length || 0;
  const skipped = preview?.warnings?.length || 0;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>⚡ Auto Schedule Generator</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Automatically fills open shifts based on guard availability, time off and hour limits.
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "16px 20px", flex: 1, overflowY: "auto" }}>

          {!generated ? (
            /* Pre-run info */
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#14532d" }}>
                ✓ <strong>What this does:</strong> Copies last week's schedule exactly — same guard, same shift, same patient:
                <ul style={{ marginTop: 6, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                  <li><strong>Same guard as last week</strong> — no substitutions</li>
                  <li>If guard is on time off, book-off, or availability changed → slot left <strong>empty</strong> for manual fix</li>
                  <li>One shift per day rule enforced</li>
                  <li>40h full-time / 24h part-time limit respected</li>
                  <li>HIGH watch patients filled first</li>
                  <li>Won't overwrite existing assignments</li>
                </ul>
              </div>
              <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#92400e" }}>
                ⚠ <strong>Will not overwrite</strong> existing assignments — only fills empty slots. You can review before applying.
              </div>
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", fontSize: 12, color: "#374151" }}>
                📋 Week: <strong>{fmtDate(weekDates[0])} – {fmtDate(weekDates[6])}</strong><br />
                Patients: <strong>{patients.filter(p => p.status === "ACTIVE").length}</strong> active · Guards: <strong>{guards.length}</strong>
              </div>
            </div>
          ) : (
            /* Preview results */
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Summary */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a" }}>{filled}</div>
                  <div style={{ fontSize: 10, color: "#14532d" }}>Shifts to assign</div>
                </div>
                <div style={{ background: (preview?.replaced?.length || 0) > 0 ? "#fffbeb" : "#f0fdf4", border: `1px solid ${(preview?.replaced?.length || 0) > 0 ? "#fcd34d" : "#86efac"}`, borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: (preview?.replaced?.length || 0) > 0 ? "#d97706" : "#16a34a" }}>{preview?.replaced?.length || 0}</div>
                  <div style={{ fontSize: 10, color: (preview?.replaced?.length || 0) > 0 ? "#92400e" : "#14532d" }}>Replacements</div>
                </div>
                <div style={{ background: skipped > 0 ? "#fef2f2" : "#f0fdf4", border: `1px solid ${skipped > 0 ? "#fecaca" : "#86efac"}`, borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: skipped > 0 ? "#dc2626" : "#16a34a" }}>{skipped}</div>
                  <div style={{ fontSize: 10, color: skipped > 0 ? "#991b1b" : "#14532d" }}>Skipped</div>
                </div>
              </div>

              {/* Summary stats */}
              {preview.replaced?.length > 0 && (
                <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#92400e" }}>
                  ⚠ <strong>{preview.replaced.length}</strong> slot{preview.replaced.length !== 1 ? "s" : ""} needed a replacement guard (prev guard unavailable)
                </div>
              )}

              {/* Assignments preview */}
              {filled > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Will assign ({filled})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 200, overflowY: "auto" }}>
                    {preview.results.map((a, i) => {
                      const pat = patients.find(p => p.id === a.patientId);
                      const sh = SHIFTS[a.shift];
                      const isReplaced = preview.replaced?.some(r => r.patient === pat?.name && r.shift === a.shift && r.date === a.date);
                      const replInfo = preview.replaced?.find(r => r.patient === pat?.name && r.shift === a.shift && r.date === a.date);
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: isReplaced ? "#fffbeb" : "#f8fafc", borderRadius: 8, border: `1px solid ${isReplaced ? "#fcd34d" : "#e2e8f0"}`, fontSize: 11 }}>
                          <span style={{ ...pill(sh?.bg, sh?.color), fontSize: 9 }}>{sh?.label}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ color: "#374151", fontWeight: 500 }}>{a.staff}</span>
                              {isReplaced && <span style={{ fontSize: 9, color: "#92400e" }}>↩ replaces {replInfo?.prevStaff}</span>}
                            </div>
                            <div style={{ fontSize: 9, color: "#94a3b8" }}>{pat?.name} · {a.date}</div>
                          </div>
                          {isReplaced && <span style={{ fontSize: 9, color: "#d97706" }}>⚠ sub</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Replacements detail */}
              {preview.replaced?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Replacements ({preview.replaced.length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 140, overflowY: "auto" }}>
                    {preview.replaced.map((r, i) => (
                      <div key={i} style={{ padding: "7px 10px", background: "#fffbeb", borderRadius: 8, border: "1px solid #fcd34d", fontSize: 11 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                          <span style={{ ...pill(SHIFTS[r.shift]?.bg, SHIFTS[r.shift]?.color), fontSize: 9 }}>{SHIFTS[r.shift]?.label}</span>
                          <span style={{ color: "#374151" }}>{r.patient} · {r.dayLabel}</span>
                        </div>
                        <div style={{ color: "#92400e", fontSize: 10 }}>
                          <span style={{ textDecoration: "line-through", color: "#b45309" }}>{r.prevStaff}</span>
                          <span style={{ margin: "0 4px" }}>→</span>
                          <strong>{r.newStaff}</strong>
                          <span style={{ color: "#b45309", marginLeft: 6 }}>({r.reason})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {skipped > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Skipped — fix manually ({skipped})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 180, overflowY: "auto" }}>
                    {preview.warnings.map((w, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 10px", background: "#fffbeb", borderRadius: 8, border: "1px solid #fcd34d", fontSize: 11 }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>⚠</span>
                        <div>
                          <div style={{ fontWeight: 500, color: "#92400e" }}>{w.patient} · {SHIFTS[w.shift]?.label} · {w.dayLabel}</div>
                          <div style={{ color: "#b45309", marginTop: 1 }}>{w.reason}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filled === 0 && skipped === 0 && (
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "14px", textAlign: "center", fontSize: 13, color: "#14532d" }}>
                  ✅ All shifts are already assigned — nothing to do!
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8, justifyContent: "flex-end", flexShrink: 0 }}>
          <button style={btnS(false)} onClick={onClose}>Cancel</button>
          {!generated ? (
            <button style={{ ...btnS(true), background: "#10b981" }} onClick={run}>
              ⚡ Preview schedule
            </button>
          ) : (
            <>
              <button style={{ ...btnS(false) }} onClick={() => { setGenerated(false); setPreview(null); }}>
                ← Re-run
              </button>
              {filled > 0 && (
                <button style={{ ...btnS(true), background: "#10b981" }} onClick={() => onGenerate(preview.results)}>
                  ✓ Apply {filled} assignments
                </button>
              )}
              {filled === 0 && (
                <button style={btnS(false)} onClick={onClose}>Close</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN LEARNING ENGINE
// Learns from ALL historical assignment data — no external API needed
// ─────────────────────────────────────────────────────────────────────────────

function learnPatterns(assigns, patients, guards) {
  // ── 1. Guard → Patient affinity ───────────────────────────────────────────
  // How many times has guard G been assigned to patient P on shift S?
  const affinity = {}; // `guardName-patientId-shift` -> count
  assigns.forEach(a => {
    const key = `${a.staff.toLowerCase().trim()}-${a.patientId}-${a.shift}`;
    affinity[key] = (affinity[key] || 0) + 1;
  });

  // ── 2. Guard → Day-of-week reliability ────────────────────────────────────
  // How consistent is guard G on day D?
  const dayReliability = {}; // guardName-dayIdx -> count
  assigns.forEach(a => {
    const di = dayIdxOfDate(a.date);
    const key = `${a.staff.toLowerCase().trim()}-${di}`;
    dayReliability[key] = (dayReliability[key] || 0) + 1;
  });

  // ── 3. Shift preference ────────────────────────────────────────────────────
  const shiftPref = {}; // guardName-shift -> count
  assigns.forEach(a => {
    const key = `${a.staff.toLowerCase().trim()}-${a.shift}`;
    shiftPref[key] = (shiftPref[key] || 0) + 1;
  });

  // ── 4. Most common guard per patient+shift slot ────────────────────────────
  const slotBest = {}; // patientId-shift -> [{guard,count}]
  assigns.forEach(a => {
    const key = `${a.patientId}-${a.shift}`;
    if (!slotBest[key]) slotBest[key] = {};
    const n = a.staff.toLowerCase().trim();
    slotBest[key][n] = (slotBest[key][n] || 0) + 1;
  });

  // ── 5. Guard workload trend (last 4 weeks) ────────────────────────────────
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const recentKey = toDateKey(fourWeeksAgo);
  const recentHours = {}; // guardName -> hours in last 4 weeks
  assigns.filter(a => a.date >= recentKey).forEach(a => {
    const n = a.staff.toLowerCase().trim();
    recentHours[n] = (recentHours[n] || 0) + (SHIFTS[a.shift]?.hours || 0);
  });

  // ── 6. Coverage consistency ────────────────────────────────────────────────
  // For each patient+shift, how often was it covered vs missed?
  const coverageRate = {}; // patientId-shift -> {covered, total}
  // (we compute this from actual data — if assigned = covered)
  assigns.forEach(a => {
    const key = `${a.patientId}-${a.shift}`;
    if (!coverageRate[key]) coverageRate[key] = { covered: 0 };
    coverageRate[key].covered++;
  });

  return { affinity, dayReliability, shiftPref, slotBest, recentHours };
}

// Get top N suggestions for a patient+shift slot
function getSuggestions(patientId, shift, dateKey, patterns, guards, assigns, weekDates, topN = 5) {
  const dayIdx = dayIdxOfDate(dateKey);
  const weekKeys = new Set(weekDates.map(toDateKey));

  return guards.map(g => {
    const n = g.name.toLowerCase().trim();

    // Hard blocks — same as scheduler
    if (isOnTimeOff(g, dateKey)) return null;
    const todayShifts = (g.schedule || {})[dayIdx] || [];
    if (!todayShifts.length || !todayShifts.includes(shift)) return null;
    const alreadyToday = assigns.some(a => a.staff.toLowerCase().trim() === n && a.date === dateKey);
    if (alreadyToday) return null;

    // ── Score calculation ──────────────────────────────────────────────────
    let score = 0;

    // Affinity with this patient+shift (highest weight)
    const affinityScore = patterns.affinity[`${n}-${patientId}-${shift}`] || 0;
    score += affinityScore * 10;

    // Day-of-week reliability
    const dayScore = patterns.dayReliability[`${n}-${dayIdx}`] || 0;
    score += dayScore * 3;

    // Shift preference
    const shiftScore = patterns.shiftPref[`${n}-${shift}`] || 0;
    score += shiftScore * 4;

    // Prefer guards with fewer recent hours (less fatigued)
    const recentH = patterns.recentHours[n] || 0;
    score += Math.max(0, 160 - recentH); // 160h = max 4 weeks full-time

    // Current week hours (prefer least-loaded)
    const weekHrs = assigns
      .filter(a => a.staff.toLowerCase().trim() === n && weekKeys.has(a.date))
      .reduce((s, a) => s + (SHIFTS[a.shift]?.hours || 0), 0);
    const limit = g.employmentType === "Full-time" ? 40 : 24;
    const remaining = limit - weekHrs;
    if (remaining < (SHIFTS[shift]?.hours || 0)) score -= 200; // over limit — penalise but don't block

    // Most common for this slot
    const slotCounts = patterns.slotBest[`${patientId}-${shift}`] || {};
    const slotRank = slotCounts[n] || 0;
    score += slotRank * 8;

    const hoursAfter = weekHrs + (SHIFTS[shift]?.hours || 0);
    const overLimit = hoursAfter > limit;

    return {
      name: g.name,
      score,
      affinityCount: affinityScore,
      slotCount: slotRank,
      weekHrs,
      hoursAfter,
      limit,
      empType: g.employmentType || "Full-time",
      overLimit,
      recentHours: recentH,
      confidence: affinityScore > 5 ? "high" : affinityScore > 2 ? "medium" : "low",
    };
  })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// Detect scheduling insights from historical data
function detectInsights(assigns, patients, guards, weekDates) {
  const insights = [];
  const weekKeys = new Set(weekDates.map(toDateKey));

  // ── Overloaded guards (this week) ─────────────────────────────────────────
  const guardHrs = {};
  assigns.filter(a => weekKeys.has(a.date)).forEach(a => {
    guardHrs[a.staff] = (guardHrs[a.staff] || 0) + (SHIFTS[a.shift]?.hours || 0);
  });
  Object.entries(guardHrs).forEach(([name, hrs]) => {
    const g = guards.find(x => x.name === name);
    const limit = g?.employmentType === "Full-time" ? 40 : 24;
    if (hrs > limit) {
      insights.push({ type: "warning", icon: "⚠️", title: `${name} is over limit`, body: `${hrs}h this week — exceeds ${limit}h ${g?.employmentType || ""} limit`, action: null });
    }
  });

  // ── Guards not used this week but available ───────────────────────────────
  const usedThisWeek = new Set(assigns.filter(a => weekKeys.has(a.date)).map(a => a.staff.toLowerCase().trim()));
  const unusedAvail = guards.filter(g => {
    if (usedThisWeek.has(g.name.toLowerCase().trim())) return false;
    const hasAvail = weekDates.some(d => {
      const di = dayIdxOfDate(toDateKey(d));
      return (g.schedule?.[di]?.length || 0) > 0 && !isOnTimeOff(g, toDateKey(d));
    });
    return hasAvail;
  });
  if (unusedAvail.length > 0) {
    insights.push({ type: "info", icon: "💡", title: `${unusedAvail.length} available guard${unusedAvail.length > 1 ? "s" : ""} not scheduled`, body: unusedAvail.slice(0, 3).map(g => g.name).join(", ") + (unusedAvail.length > 3 ? ` +${unusedAvail.length - 3} more` : ""), action: null });
  }

  // ── Guards on time off this week ──────────────────────────────────────────
  const onTimeOff = guards.filter(g => weekDates.some(d => isOnTimeOff(g, toDateKey(d))));
  if (onTimeOff.length > 0) {
    insights.push({ type: "info", icon: "🏖", title: `${onTimeOff.length} guard${onTimeOff.length > 1 ? "s" : ""} on time off this week`, body: onTimeOff.map(g => g.name).join(", "), action: null });
  }

  // ── Most reliable guard (highest assignment count overall) ────────────────
  const allCounts = {};
  assigns.forEach(a => { allCounts[a.staff] = (allCounts[a.staff] || 0) + 1; });
  const topGuard = Object.entries(allCounts).sort((a, b) => b[1] - a[1])[0];
  if (topGuard) {
    insights.push({ type: "success", icon: "⭐", title: `Most scheduled: ${topGuard[0]}`, body: `${topGuard[1]} total shift assignments in history`, action: null });
  }

  // ── Patient with most coverage gaps historically ───────────────────────────
  const patGaps = {};
  patients.filter(p => p.status === "ACTIVE").forEach(p => {
    const covered = assigns.filter(a => a.patientId === p.id).length;
    patGaps[p.name] = covered;
  });
  const leastCovered = Object.entries(patGaps).sort((a, b) => a[1] - b[1])[0];
  if (leastCovered) {
    insights.push({ type: leastCovered[1] < 5 ? "warning" : "info", icon: "🏥", title: `${leastCovered[0]} has fewest assignments`, body: `${leastCovered[1]} total shifts assigned historically — may need attention`, action: null });
  }

  return insights;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTIONS PAGE
// ─────────────────────────────────────────────────────────────────────────────
function SuggestionsPage({ assigns, patients, guards, weekDates, mobile, onAssign }) {
  const [selPatient, setSelPatient] = useState(null);
  const [selShift, setSelShift] = useState(null);
  const [selDate, setSelDate] = useState(null);
  const [tab, setTab] = useState("suggestions"); // suggestions | insights | patterns

  const hasHistory = assigns.length > 0;
  const patterns = hasHistory ? learnPatterns(assigns, patients, guards) : null;
  const insights = hasHistory ? detectInsights(assigns, patients, guards, weekDates) : [];

  // Gaps this week — unassigned slots
  const gaps = patients.filter(p => p.status === "ACTIVE").flatMap(p =>
    weekDates.flatMap(d => {
      const dk = toDateKey(d);
      const di = dayIdxOfDate(dk);
      return p.requiredShifts
        .filter(s => shiftsForDayIdx(di).includes(s))
        .filter(s => !assigns.find(a => a.patientId === p.id && a.shift === s && a.date === dk))
        .map(s => ({ patient: p, shift: s, date: dk, day: fmtDate(d) }));
    })
  );

  const suggestions = selPatient && selShift && selDate && patterns
    ? getSuggestions(selPatient.id, selShift, selDate, patterns, guards, assigns, weekDates)
    : [];

  // Confidence colour
  const confColor = c => c === "high" ? "#16a34a" : c === "medium" ? "#d97706" : "#64748b";
  const confBg = c => c === "high" ? "#f0fdf4" : c === "medium" ? "#fffbeb" : "#f8fafc";
  const confBorder = c => c === "high" ? "#86efac" : c === "medium" ? "#fcd34d" : "#e2e8f0";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Header stat */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
        {[
          { l: "Historical shifts", v: assigns.length, bg: "#f0f9ff", c: "#0369a1" },
          { l: "Open gaps this week", v: gaps.length, bg: gaps.length > 0 ? "#fef2f2" : "#f0fdf4", c: gaps.length > 0 ? "#dc2626" : "#16a34a" },
          { l: "Guards tracked", v: guards.length, bg: "#f5f3ff", c: "#7e22ce" },
        ].map(x => (
          <div key={x.l} style={{ background: x.bg, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: x.c, opacity: .7, marginBottom: 1 }}>{x.l}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: x.c }}>{x.v}</div>
          </div>
        ))}
      </div>

      {!hasHistory && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "20px", textAlign: "center", color: "#92400e", fontSize: 13 }}>
          ⚠ Not enough data yet. The AI learns from your assignment history — add some shifts first and come back!
        </div>
      )}

      {hasHistory && (
        <>
          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "0.5px solid #e2e8f0" }}>
            {[["suggestions", "🎯 Suggestions"], ["insights", "💡 Insights"], ["patterns", "📊 Patterns"]].map(([key, lbl]) => (
              <div key={key} onClick={() => setTab(key)}
                style={{
                  padding: "8px 16px", fontSize: 12, fontWeight: 500, cursor: "pointer",
                  color: tab === key ? "#3b82f6" : "#64748b",
                  borderBottom: tab === key ? "2px solid #3b82f6" : "2px solid transparent",
                  marginBottom: -1, userSelect: "none"
                }}>
                {lbl}
              </div>
            ))}
          </div>

          {/* ── TAB: SUGGESTIONS ── */}
          {tab === "suggestions" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                Select an open shift below — the AI will suggest the best guard based on historical patterns.
              </div>

              {/* Gap list */}
              {gaps.length === 0 ? (
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "14px", textAlign: "center", fontSize: 13, color: "#14532d" }}>
                  ✅ All shifts covered this week — no open slots!
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {gaps.map((g, i) => {
                    const sh = SHIFTS[g.shift];
                    const sel = selPatient?.id === g.patient.id && selShift === g.shift && selDate === g.date;
                    return (
                      <div key={i} onClick={() => { setSelPatient(g.patient); setSelShift(g.shift); setSelDate(g.date); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9,
                          border: `1px solid ${sel ? "#3b82f6" : "#e2e8f0"}`, background: sel ? "#eff6ff" : "#fff", cursor: "pointer"
                        }}>
                        <span style={{ ...pill(sh?.bg, sh?.color), fontSize: 10 }}>{sh?.label}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: "#0f172a" }}>{g.patient.name}</div>
                          <div style={{ fontSize: 10, color: "#64748b" }}>{g.day} · {sh?.time}</div>
                        </div>
                        <span style={{ fontSize: 10, color: sel ? "#3b82f6" : "#94a3b8", flexShrink: 0 }}>{sel ? "▾ Showing suggestions" : "tap for suggestions"}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Suggestions for selected slot */}
              {selPatient && selShift && selDate && (
                <div style={{ background: "#f8fafc", borderRadius: 12, padding: "14px", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    🧠 AI Suggestions — {selPatient.name} · {SHIFTS[selShift]?.label} · {selDate}
                  </div>
                  {suggestions.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: "12px 0" }}>
                      No available guards match this slot.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {suggestions.map((s, i) => (
                        <div key={i} style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9,
                          background: confBg(s.confidence), border: `1px solid ${confBorder(s.confidence)}`
                        }}>
                          {/* Rank */}
                          <div style={{
                            width: 24, height: 24, borderRadius: "50%", background: i === 0 ? "#3b82f6" : i === 1 ? "#64748b" : "#e2e8f0",
                            color: i < 2 ? "#fff" : "#64748b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0
                          }}>
                            {i + 1}
                          </div>
                          {/* Guard info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{s.name}</span>
                              <span style={{ ...pill(confBg(s.confidence), confColor(s.confidence)), fontSize: 9, border: `1px solid ${confBorder(s.confidence)}` }}>
                                {s.confidence === "high" ? "✓ Best match" : s.confidence === "medium" ? "Good match" : "Possible"}
                              </span>
                              {s.overLimit && <span style={{ fontSize: 9, color: "#dc2626" }}>⚠ over limit</span>}
                            </div>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              {s.affinityCount > 0 && <span style={{ fontSize: 9, color: "#64748b" }}>🔁 Assigned here {s.affinityCount}× before</span>}
                              <span style={{ fontSize: 9, color: "#64748b" }}>⏱ {s.weekHrs}h this week → {s.hoursAfter}h / {s.limit}h</span>
                              {s.recentHours > 0 && <span style={{ fontSize: 9, color: "#64748b" }}>📅 {s.recentHours}h last 4 weeks</span>}
                            </div>
                          </div>
                          {/* Assign button */}
                          <button onClick={() => { onAssign(selPatient.id, selShift, selDate); }}
                            style={{ ...btnS(true), fontSize: 11, padding: "5px 12px", flexShrink: 0, background: i === 0 ? "#3b82f6" : "#64748b" }}>
                            Assign
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── TAB: INSIGHTS ── */}
          {tab === "insights" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Patterns and anomalies detected from your scheduling history.</div>
              {insights.length === 0 ? (
                <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No insights yet — add more schedule data.</div>
              ) : insights.map((ins, i) => {
                const bg = ins.type === "warning" ? "#fffbeb" : ins.type === "success" ? "#f0fdf4" : "#f0f9ff";
                const border = ins.type === "warning" ? "#fcd34d" : ins.type === "success" ? "#86efac" : "#bae6fd";
                const color = ins.type === "warning" ? "#92400e" : ins.type === "success" ? "#14532d" : "#0369a1";
                return (
                  <div key={i} style={{ padding: "12px 14px", borderRadius: 10, background: bg, border: `1px solid ${border}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{ins.icon}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color }}>{ins.title}</div>
                      <div style={{ fontSize: 11, color, opacity: .8, marginTop: 2 }}>{ins.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── TAB: PATTERNS ── */}
          {tab === "patterns" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>What the model has learned from your {assigns.length} historical assignments.</div>

              {/* Top guard per patient+shift */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Most frequent guard per slot</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {patients.filter(p => p.status === "ACTIVE").flatMap(p =>
                    p.requiredShifts.map(shift => {
                      const slotCounts = patterns.slotBest[`${p.id}-${shift}`] || {};
                      const entries = Object.entries(slotCounts).sort((a, b) => b[1] - a[1]);
                      if (!entries.length) return null;
                      const [top, count] = entries[0];
                      const sh = SHIFTS[shift];
                      return (
                        <div key={`${p.id}-${shift}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 11 }}>
                          <span style={{ ...pill(sh?.bg, sh?.color), fontSize: 9 }}>{sh?.label}</span>
                          <span style={{ color: "#374151", flex: 1 }}>{p.name}</span>
                          <span style={{ color: "#0f172a", fontWeight: 600 }}>{top.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")}</span>
                          <span style={{ color: "#94a3b8", fontSize: 9 }}>{count}×</span>
                        </div>
                      );
                    }).filter(Boolean)
                  )}
                </div>
              </div>

              {/* Guard shift preferences */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Guard shift preferences (by frequency)</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {guards.filter(g => {
                    return Object.keys(patterns.shiftPref).some(k => k.startsWith(g.name.toLowerCase().trim() + "-"));
                  }).map((g, i) => {
                    const n = g.name.toLowerCase().trim();
                    const prefs = Object.entries(patterns.shiftPref)
                      .filter(([k]) => k.startsWith(n + "-"))
                      .map(([k, v]) => ({ shift: k.replace(n + "-", ""), count: v }))
                      .sort((a, b) => b.count - a.count);
                    if (!prefs.length) return null;
                    const [bg, col] = avCol(i);
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: bg, color: col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{ini(g.name)}</div>
                        <span style={{ fontSize: 11, fontWeight: 500, color: "#0f172a", minWidth: mobile ? 80 : 130, flexShrink: 0 }}>{g.name}</span>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
                          {prefs.slice(0, 3).map(p => (
                            <div key={p.shift} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                              <span style={{ ...pill(SHIFTS[p.shift]?.bg, SHIFTS[p.shift]?.color), fontSize: 9 }}>{SHIFTS[p.shift]?.label || p.shift}</span>
                              <span style={{ fontSize: 9, color: "#94a3b8" }}>{p.count}×</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }).filter(Boolean)}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}