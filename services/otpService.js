const twilio = require('twilio');
require('dotenv').config();
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

exports.sendOTPViaMessage = async (phone, otp) => {
    console.log("Phone is Called");

    const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    console.log("Formatted Phone:", formattedPhone, phone);

    try {
        const message = await client.messages.create({
            body: `Your verification code is: ${otp}`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: formattedPhone
        });
        return message.sid;
    } catch (error) {
        throw new Error('Failed to send OTP: ' + error.message);
    }
};

// Generate 6-digit OTP
exports.generateOTP = () => crypto.randomInt(1000, 9999).toString();

// Send OTP via Email
exports.sendOTPViaEmail = async (email, otp) => {
    const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD
        }
    });

    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your Login OTP',
        html: `
      <div>
        <h3>Login Verification</h3>
        <p>Your OTP is: <strong>${otp}</strong></p>
        <p>Valid for 5 minutes</p>
      </div>
    `
    });
};