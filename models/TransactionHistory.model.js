const mongoose = require('mongoose');

const TransactionHistorySchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
    },
    amount: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['earning', 'withdraw']
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('TransactionHistory', TransactionHistorySchema);