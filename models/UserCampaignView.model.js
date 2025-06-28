const mongoose = require('mongoose');

const videoWatchUserSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    campaignId: {
        type: String,
        required: true
    },
});

module.exports = mongoose.model('VideoWatchUser', videoWatchUserSchema);