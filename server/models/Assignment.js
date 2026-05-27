const mongoose = require('mongoose');

const AssignmentSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient' },
    shift: String,
    staff: String,
    date: String,   // "YYYY-MM-DD"
}, { timestamps: true });

module.exports = mongoose.model('Assignment', AssignmentSchema);