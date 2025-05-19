const twilio = require('twilio');
require('dotenv').config();

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const sendOtp = async (phone, otp) => {

    const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    try {
        console.log("Call sendOtp")
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

module.exports = sendOtp;
