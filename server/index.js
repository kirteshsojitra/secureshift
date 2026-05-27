const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const Patient = require('./models/Patient');
const Guard = require('./models/Guard');
const Assignment = require('./models/Assignment');

const app = express();

// ── CORS — allow all origins ──────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.json());

// ── MongoDB ───────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB error:', err));

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── PATIENTS ──────────────────────────────────────────────────────
app.get('/api/patients', async (req, res) => {
    try {
        const patients = await Patient.find();
        res.json(patients);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/patients', async (req, res) => {
    try {
        const patient = await Patient.create(req.body);
        res.json(patient);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/patients/:id', async (req, res) => {
    try {
        const patient = await Patient.findByIdAndUpdate(
            req.params.id, req.body, { new: true }
        );
        res.json(patient);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/patients/:id', async (req, res) => {
    try {
        await Patient.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GUARDS ────────────────────────────────────────────────────────
app.get('/api/guards', async (req, res) => {
    try {
        const guards = await Guard.find();
        res.json(guards);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/guards', async (req, res) => {
    try {
        const guard = await Guard.create(req.body);
        res.json(guard);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/guards/:id', async (req, res) => {
    try {
        const guard = await Guard.findByIdAndUpdate(
            req.params.id, req.body, { new: true }
        );
        res.json(guard);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/guards/:id', async (req, res) => {
    try {
        await Guard.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── ASSIGNMENTS ───────────────────────────────────────────────────
app.get('/api/assignments', async (req, res) => {
    try {
        const assigns = await Assignment.find();
        res.json(assigns);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/assignments', async (req, res) => {
    try {
        const assign = await Assignment.create(req.body);
        res.json(assign);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/assignments/:id', async (req, res) => {
    try {
        await Assignment.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/assignments/bulk', async (req, res) => {
    try {
        const { date, assignments } = req.body;
        await Assignment.deleteMany({ date });
        const saved = await Assignment.insertMany(assignments);
        res.json(saved);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Start server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;
app.listen(PORT, () =>
    console.log(`🚀 Server running on http://localhost:${PORT}`)
);