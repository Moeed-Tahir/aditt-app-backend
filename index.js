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
        app.use(express.json());

        app.get('/', (req, res) => {
            res.send('Welcome back to On My Way!');
        });

        const authRoutes = require('./routes/v1/authRoute');
        const appRoutes = require('./routes/v1/appRoute');

        app.use('/api/auth', authRoutes);
        app.use('/api', appRoutes);

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
