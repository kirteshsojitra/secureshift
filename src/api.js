const BASE = 'http://localhost:5001/api';

// ── Patients ──────────────────────────────────────────────────────
export const fetchPatients = () => fetch(`${BASE}/patients`).then(r => r.json());
export const createPatient = (data) => fetch(`${BASE}/patients`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json());
export const updatePatient = (id, data) => fetch(`${BASE}/patients/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json());
export const deletePatient = (id) => fetch(`${BASE}/patients/${id}`, { method: 'DELETE' }).then(r => r.json());

// ── Guards ────────────────────────────────────────────────────────
export const fetchGuards = () => fetch(`${BASE}/guards`).then(r => r.json());
export const createGuard = (data) => fetch(`${BASE}/guards`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json());
export const updateGuard = (id, data) => fetch(`${BASE}/guards/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json());
export const deleteGuard = (id) => fetch(`${BASE}/guards/${id}`, { method: 'DELETE' }).then(r => r.json());

// ── Assignments ───────────────────────────────────────────────────
export const fetchAssignments = () => fetch(`${BASE}/assignments`).then(r => r.json());
export const createAssignment = (data) => fetch(`${BASE}/assignments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json());
export const deleteAssignment = (id) => fetch(`${BASE}/assignments/${id}`, { method: 'DELETE' }).then(r => r.json());