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
    isOtpVerified: {
        type: Boolean,
        default: false 
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    stripeCustomerId:{
        type: String,
        default: false
    }
});

module.exports = mongoose.model('User', userSchema);
