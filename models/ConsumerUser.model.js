const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true,
        unique: true
    },
    email: { 
        type: String,
        unique: true,
        sparse: true 
    },
    otp: {
        type: String,
        required: true,
    },
    otpExpires: {
        type: Date,
    },
    dateOfBirth: {
        type: Date,
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
        required:false
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
        default: false
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
        enum:["Free","Premium"]
    },
});

module.exports = mongoose.model('ConsumerUser', userSchema);