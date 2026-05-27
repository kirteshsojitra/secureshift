const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema({
    name: { type: String, required: true },
    siteId: Number,
    room: String,
    watchLevel: String,
    status: String,
    notes: String,
    requiredShifts: [String],
}, { timestamps: true });

module.exports = mongoose.model('Patient', PatientSchema);