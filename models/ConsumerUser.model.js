const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    fullName: {
        type: String,
        required: true
    },
    // phone: {
    //     type: String,
    //     required: true,
    //     unique: true
    // },
    email: {
        type: String,
        unique: true,
        sparse: true,
        required: true,
    },
    password: {
        type: String,
        required: false
    },
    status: {
        type: String,
        default: 'active'
    },
    otp: {
        type: String,
    },
    otpExpires: {
        type: Date,
    },
    dateOfBirth: {
        type: String,
    },
    gender: {
        type: String,
        enum: ['Male', 'Female', 'Other'],
    },
    zipCode: {
        type: String,
    },
    location: {
        type: String,
        required: false
    },
    isOtpVerified: {
        type: Boolean,
        default: false
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    stripeCustomerId: {
        type: String,
        default: null
    },
    totalBalance: {
        type: Number,
        default: 0
    },
    totalWithdraw: {
        type: Number,
        default: 0
    },
    remainingBalance: {
        type: Number,
        default: 0
    },
    subscriptionPlan: {
        type: String,
        default: "Free",
        enum: ["Free", "Premium"]
    },
    stripeVerificationSessionId: {
        type: String,
        require: true
    },
    stripeAccountId: {
        type: String,
        default: null
    },
    faceIdEnabled: {
        type: Boolean,
        default: false
    },
    identityVerificationStatus: {
        type: String,
        default: "false"
    },
    identityVerificationMessage: {
        type: String,
        default: " "
    },
    verificationSessionId: {
        type: String,
        default: false
    },
    referralCode: {
        type: String,
        default: null
    },
    referrer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ConsumerUser',
        default: null
    },
    referralCount: {
        type: Number,
        default: 0
    }
});

module.exports = mongoose.model('ConsumerUser', userSchema);