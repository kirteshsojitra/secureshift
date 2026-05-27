const mongoose = require('mongoose');

const GuardSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: String,
    email: String,
    site: String,
    role: String,
    employmentType: String,
    hourlyRate: { type: Number, default: 20 },
    notes: String,
    timeOff: [{ type: mongoose.Schema.Types.Mixed }],
    schedule: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

module.exports = mongoose.model('Guard', GuardSchema);