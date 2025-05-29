const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDB } = require('./config/connectDB');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

(async () => {
    try {
        await connectDB();

        app.use(cors());

        const stripeRoutes = require('./routes/v1/stripeRoute');
        app.use('/api/auth/stripe', stripeRoutes);

        app.use(express.json());

        app.get('/', (req, res) => {
            res.send('Welcome back to On My Way!');
        });

        const authRoutes = require('./routes/v1/authRoute');
        app.use('/api/auth', authRoutes);

        // Error handling
        app.use((err, req, res, next) => {
            console.error(err.stack);
            res.status(500).json({ error: "Internal Server Error" });
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
