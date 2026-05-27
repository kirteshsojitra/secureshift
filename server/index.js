const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
require('dotenv').config();

const Patient = require('./models/Patient');
const Guard = require('./models/Guard');
const Assignment = require('./models/Assignment');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.json({ limit: '5mb' }));

// ── MongoDB ───────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB error:', err));

// ── Email transporter ─────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ── SEND SCHEDULE EMAIL ───────────────────────────────────────────
app.post('/api/send-schedule', async (req, res) => {
    try {
        const { to, guardName, weekLabel, html } = req.body;
        if (!to) return res.status(400).json({ error: 'No email address provided' });

        await transporter.sendMail({
            from: process.env.EMAIL_FROM || `SecureShift <${process.env.EMAIL_USER}>`,
            to,
            subject: `Your Schedule — ${weekLabel} | Southbridge Security`,
            html: `
        <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
          <div style="background:#0f172a;padding:20px 24px">
            <h2 style="color:#f1f5f9;margin:0;font-size:18px">🛡 Southbridge Security Inc.</h2>
            <p style="color:#94a3b8;margin:4px 0 0;font-size:13px">Weekly Schedule — ${weekLabel}</p>
          </div>
          <div style="padding:20px 24px;background:#f8fafc;border-bottom:1px solid #e2e8f0">
            <p style="font-size:14px;color:#374151;margin:0">Hi <strong>${guardName}</strong>,</p>
            <p style="font-size:14px;color:#374151;margin:8px 0 0">Here is your assigned schedule for the week of <strong>${weekLabel}</strong>. Please review and contact your supervisor if you have any questions.</p>
          </div>
          <div>${html}</div>
          <div style="padding:16px 24px;background:#f1f5f9;border-top:1px solid #e2e8f0">
            <p style="font-size:11px;color:#94a3b8;margin:0">
              This is an automated message from SecureShift. Please do not reply to this email.<br/>
              For questions or changes, contact your supervisor directly.
            </p>
          </div>
        </div>`,
        });

        console.log(`✅ Schedule email sent to ${to} (${guardName})`);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Email error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── PATIENTS ──────────────────────────────────────────────────────
app.get('/api/patients', async (req, res) => { try { res.json(await Patient.find()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/patients', async (req, res) => { try { res.json(await Patient.create(req.body)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/patients/:id', async (req, res) => { try { res.json(await Patient.findByIdAndUpdate(req.params.id, req.body, { new: true })); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/patients/:id', async (req, res) => { try { await Patient.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── GUARDS ────────────────────────────────────────────────────────
app.get('/api/guards', async (req, res) => { try { res.json(await Guard.find()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/guards', async (req, res) => { try { res.json(await Guard.create(req.body)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/guards/:id', async (req, res) => { try { res.json(await Guard.findByIdAndUpdate(req.params.id, req.body, { new: true })); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/guards/:id', async (req, res) => { try { await Guard.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ── ASSIGNMENTS ───────────────────────────────────────────────────
app.get('/api/assignments', async (req, res) => { try { res.json(await Assignment.find()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/assignments', async (req, res) => { try { res.json(await Assignment.create(req.body)); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/assignments/:id', async (req, res) => { try { await Assignment.findByIdAndDelete(req.params.id); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/assignments/bulk', async (req, res) => {
    try {
        const { date, assignments } = req.body;
        await Assignment.deleteMany({ date });
        res.json(await Assignment.insertMany(assignments));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));