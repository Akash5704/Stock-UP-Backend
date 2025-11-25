const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const userRoutes = require('./routes/authRoutes');
const portfolioRoutes = require('./routes/portfolioRoutes'); // <-- Import the second route file
require('dotenv').config();
const ngrok = require('ngrok');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/users', userRoutes);        // All auth-related routes
app.use('/api', portfolioRoutes);     // All portfolio-related routes (prefix them with /api)

// Connect to DB
connectDB();

// Server Start
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
});
