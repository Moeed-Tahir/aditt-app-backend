const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDB } = require('./config/connectDB');
const cron = require('node-cron');
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const subscriptionController = require('./controllers/v1/subscriptionControllers');

(async () => {
    try {
        await connectDB();

        app.use(cors());
        app.use(express.json());

        // Routes
        const stripeRoutes = require('./routes/v1/stripeRoute');
        app.use('/api/auth/stripe', stripeRoutes);

        app.get('/', (req, res) => {
            res.send('Welcome back to On My Way!');
        });

        const authRoutes = require('./routes/v1/authRoute');
        app.use('/api/auth', authRoutes);

        const campaignRoutes = require('./routes/v1/campaignRoute');
        app.use('/api', campaignRoutes);

        const contactRoutes = require('./routes/v1/contactRoute');
        app.use('/api', contactRoutes);

        const subscriptionRoutes = require('./routes/v1/subscriptionRoute');
        app.use('/api', subscriptionRoutes);

        app.use((err, req, res, next) => {
            console.error(err.stack);
            res.status(500).json({ error: "Internal Server Error" });
        });

        cron.schedule('0 0 * * *', async () => {
            console.log('Running subscription expiry check...');
            await subscriptionController.checkAndCancelExpiredSubscriptions();
        }, {
            scheduled: true,
            timezone: 'UTC'
        });

        app.listen(PORT, () => {
            console.log(`
      =============================================
       Server successfully started!
       Port: ${PORT}
       Environment: ${process.env.NODE_ENV || 'development'}
       Timestamp: ${new Date().toISOString()}
      =============================================
      `);
        });

    } catch (error) {
        console.error("Server startup failed:", error);
        process.exit(1);
    }
})();