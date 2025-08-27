const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { connectDB } = require('./config/connectDB');
const cron = require('node-cron');
dotenv.config();
const socketio = require('socket.io');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// const io = socketio(server, {
//     cors: {
//         origin: process.env.CLIENT_URL || 'http://localhost:3000',
//         methods: ['GET', 'POST'],
//         credentials: true
//     },
//     path: '/socket.io'
// });

const subscriptionController = require('./controllers/v1/subscriptionControllers');
const campaignController = require('./controllers/v1/campaignController');

(async () => {
    try {
        await connectDB();

        app.use(cors());

        // io.on('connection', (socket) => {
        //     console.log('New client connected:', socket.id);

        //     socket.on('join_user_room', (userId) => {
        //         socket.join(`user_${userId}`);
        //         console.log(`User ${userId} joined their room`);
        //     });

        //     socket.on('join_admin_room', () => {
        //         socket.join('admin_channel');
        //         console.log('Admin joined admin channel');
        //     });

        //     socket.on('disconnect', () => {
        //         console.log('Client disconnected:', socket.id);
        //     });
        // });

        // app.set('socketio', io);

        const stripeRoutes = require('./routes/v1/stripeRoute');
        app.use('/api/auth/stripe', stripeRoutes);

        // Middleware
        app.use(express.json());

        // Routes
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

        // Error handling
        app.use((err, req, res, next) => {
            console.error(err.stack);
            res.status(500).json({ error: "Internal Server Error" });
        });

        // Cron jobs
        cron.schedule('0 0 * * *', async () => {
            console.log('Running subscription expiry check...');
            await subscriptionController.checkAndCancelExpiredSubscriptions();
        }, {
            scheduled: true,
            timezone: 'UTC'
        });

        cron.schedule('0 0 * * *', async () => {
            console.log('💳 Running daily payment deduction...');
            await campaignController.paymentDeduct();
        }, {
            scheduled: true,
            timezone: 'UTC'
        });

        // Use server.listen instead of app.listen for Socket.IO
        server.listen(PORT, () => {
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