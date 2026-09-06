import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import http from 'http';
import { initChatSocket } from './socket/chatSocket.js';
import chatRoutes from './routes/chatRoutes.js';


// Load env FIRST before anything else
dotenv.config();

import { connectDB } from './config/database.js';
import logger from './utils/logger.js';

const app = express();

/**
 * How many proxy hops to trust when resolving `req.ip`.
 *
 * The login rate limiter keys on `req.ip`, so this cuts both ways:
 *   - Behind a proxy with 0, every request carries the load balancer's address,
 *     so one attacker's failures lock out every user sharing it.
 *   - With no proxy and a non-zero value, Express believes X-Forwarded-For —
 *     and any client can forge that header to hand itself a fresh identity on
 *     each request, bypassing the limiter completely.
 *
 * So it is enabled only in production, where the platform's load balancer sits
 * in front and overwrites the header. Override with TRUST_PROXY_HOPS if more
 * than one proxy is in the chain.
 */
const trustProxyHops = process.env.TRUST_PROXY_HOPS
  ? Number(process.env.TRUST_PROXY_HOPS)
  : process.env.NODE_ENV === 'production'
    ? 1
    : 0;

app.set('trust proxy', trustProxyHops);

// Connect DB
connectDB();

// Middleware
app.use(helmet());
app.use(compression());
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean);
app.use(
  cors({
    origin: (origin, callback) => {
      // allow requests with no origin (like Postman, curl, mobile apps)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================
// ROUTES - Import and Use
// ============================================

// Auth Routes
import authRoutes from './routes/authRoutes.js';
app.use('/api/auth', authRoutes);

// Survey Routes
import surveyRoutes from './routes/surveyRoutes.js';
app.use('/api/surveys', surveyRoutes);

// Farm Routes
import farmerRoutes from './routes/farmerRoutes.js';
app.use('/api/farms', farmerRoutes);

// Trader Routes
import traderRoutes from './routes/traderRoutes.js';
app.use('/api/traders', traderRoutes);

// Market Routes
import marketRoutes from './routes/marketRoutes.js';
app.use('/api/market', marketRoutes);

// Admin Routes
import adminRoutes from './routes/adminRoutes.js';
app.use('/api/admin', adminRoutes);

// Analytics Routes
import analyticsRoutes from './routes/analyticsRoutes.js';
app.use('/api/analytics', analyticsRoutes);

//Chat Routes
app.use('/api/chat', chatRoutes);

// Report Routes
import reportRoutes from './routes/reportRoutes.js';
app.use('/api/reports', reportRoutes);

// ============================================
// Health Check
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date() });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Error Handler
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
initChatSocket(server);

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});