const mongoose = require('mongoose');

const userCampaignViewSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    campaignId: {
        type: String,
        required: true
    },
});

module.exports = mongoose.model('UserCampaignView', userCampaignViewSchema);