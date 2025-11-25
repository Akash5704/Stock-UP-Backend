// routes/PortfolioRoutes.js
const express = require('express');
const router = express.Router();
const portfolioController = require('../controllers/portfolioController');
const auth = require('../middleware/authMiddleware');

// Portfolio Management Routes
router.get('/portfolio', auth, portfolioController.getPortfolio);
router.post('/portfolio/buy', auth, portfolioController.buyStock);
router.post('/portfolio/sell', auth, portfolioController.sellStock);

// Transaction History Routes
router.get('/portfolio/transactions', auth, portfolioController.getTransactionHistory);

// Analytics & Insights Routes
router.get('/portfolio/analytics', auth, portfolioController.getPortfolioAnalytics);
router.get('/portfolio/holding/:symbol', auth, portfolioController.getHoldingDetails);

// User Account Management Routes
router.get('/portfolio/balance', auth, portfolioController.getUserBalance);
router.post('/portfolio/add-money', auth, portfolioController.addMoney);

// In your backend portfolio routes file
router.post('/portfolio/withdraw', auth, portfolioController.withdrawMoney);

module.exports = router;