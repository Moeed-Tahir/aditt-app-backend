const nodemailer = require('nodemailer');
const dotenv = require("dotenv");
dotenv.config();

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

const sendFlaggedIdentityEmail = async (email, name) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your Aditt Identity Review is In Progress',
        html: `
            <p>Hi ${name},</p>
            <p>Our system flagged your account during your identity verification.</p>
            <p>Your case is currently under manual review by the Aditt team.</p>
            <p>We'll get back to you as soon as possible with details, further questioning, or a decision.</p>
            <p>Thanks for your patience.</p>
            <p>— The Aditt Team</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Flagged identity email sent successfully');
    } catch (error) {
        console.error('Error sending flagged identity email:', error);
    }
};

const sendApprovedIdentityEmail = async (email, name) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'You\'re Verified — Welcome to Aditt!',
        html: `
            <p>Hi ${name},</p>
            <p>Great news — your identity has been verified successfully!</p>
            <p>You can now access all features of the Aditt app and start earning.</p>
            <p>Thanks for being part of the community.</p>
            <p>— The Aditt Team</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Approved identity email sent successfully');
    } catch (error) {
        console.error('Error sending approved identity email:', error);
    }
};

const sendRejectedIdentityEmail = async (email, name) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Identity Verification Issue on Aditt',
        html: `
            <p>Hi ${name},</p>
            <p>After reviewing your submitted documents, we're unable to verify your identity at this time.</p>
            <p>Your account has been restricted for security reasons.</p>
            <p>If you believe this is a mistake, please reply to this email for further assistance.</p>
            <p>— The Aditt Team</p>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('Rejected identity email sent successfully');
    } catch (error) {
        console.error('Error sending rejected identity email:', error);
    }
};

module.exports = {
    sendFlaggedIdentityEmail,
    sendApprovedIdentityEmail,
    sendRejectedIdentityEmail
};