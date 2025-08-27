const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
dotenv.config();

const contactUS = async (req, res) => {
    try {
        const { fullName, email, message } = req.body;
        
        if (!fullName || !email || !message) {
            return res.status(400).json({ 
                success: false, 
                message: "Please provide fullName, email, and message" 
            });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        const companyEmail = process.env.COMPANY_EMAIL || process.env.EMAIL_USER;

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: companyEmail,
            subject: `New Contact Form Submission from ${fullName}`,
            html: `
                <div>
                    <h3>New Contact Form Submission</h3>
                    <p><strong>Name:</strong> ${fullName}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Message:</strong></p>
                    <p>${message}</p>
                </div>
            `
        });

        res.status(200).json({ 
            success: true, 
            message: "Your message has been sent successfully!" 
        });
    } catch (error) {
        console.error("Error sending contact form:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to send your message. Please try again later." 
        });
    }
}

module.exports = { contactUS };