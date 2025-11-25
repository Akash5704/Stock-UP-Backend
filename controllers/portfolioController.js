// routes/portfolio.js
const express = require('express');
const router = express.Router();
const Portfolio = require('../models/Portfolio');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');
const axios = require('axios');

const API_BASE = 'https://akash5704-stock-api.hf.space/stock?symbol=';

// Input validation helper
const validateStockInput = (symbol, quantity, price) => {
  const errors = [];
  
  if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
    errors.push('Valid symbol is required');
  }
  
  if (!quantity || quantity <= 0 || !Number.isFinite(quantity)) {
    errors.push('Valid positive quantity is required');
  }
  
  if (!price || price <= 0 || !Number.isFinite(price)) {
    errors.push('Valid positive price is required');
  }
  
  return errors;
};

// Error handling helper
const handleApiError = (error, defaultMessage) => {
  console.error(defaultMessage, error);
  
  if (error.name === 'ValidationError') {
    return {
      success: false,
      message: 'Validation error',
      error: error.message
    };
  }
  
  if (error.name === 'CastError') {
    return {
      success: false,
      message: 'Invalid data format',
      error: error.message
    };
  }
  
  return {
    success: false,
    message: defaultMessage,
    error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
  };
};

// Get current price from API
const getCurrentPrice = async (symbol) => {
  try {
    const response = await axios.get(`${API_BASE}${symbol}`);
    
    // Adjust this based on your actual API response structure
    if (response.data && response.data.price) {
      return response.data.price;
    } else if (response.data && response.data.currentPrice) {
      return response.data.currentPrice;
    } else if (response.data && response.data.data && response.data.data.price) {
      return response.data.data.price;
    } else {
      console.warn(`Price not found for ${symbol} in API response:`, response.data);
      return 100; // Fallback price
    }
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error.message);
    
    // Fallback mock prices
    const mockPrices = {
      'AAPL': 150.25,
      'GOOGL': 2750.80,
      'TSLA': 245.60,
      'MSFT': 305.15,
      'AMZN': 3400.25,
      'META': 325.75,
      'NFLX': 415.50,
      'NVDA': 225.30
    };
    return mockPrices[symbol] || 100;
  }
};

// Calculate portfolio totals
const calculatePortfolioTotals = (holdings) => {
  const totals = holdings.reduce((acc, holding) => {
    acc.totalInvested += holding.totalInvested || 0;
    acc.totalCurrentValue += holding.currentValue || 0;
    return acc;
  }, {
    totalInvested: 0,
    totalCurrentValue: 0
  });

  const totalProfitLoss = totals.totalCurrentValue - totals.totalInvested;
  const profitLossPercentage = totals.totalInvested > 0 ? 
    (totalProfitLoss / totals.totalInvested) * 100 : 0;

  return {
    totalInvested: Math.round(totals.totalInvested * 100) / 100,
    totalValue: Math.round(totals.totalCurrentValue * 100) / 100,
    totalProfitLoss: Math.round(totalProfitLoss * 100) / 100,
    profitLossPercentage: Math.round(profitLossPercentage * 100) / 100
  };
};

// Add transaction record
const addTransaction = async (userId, type, symbol, quantity, price, totalAmount, session) => {
  try {
    const transaction = new Transaction({
      userId,
      type,
      symbol: symbol.toUpperCase(),
      quantity,
      price,
      totalAmount,
      timestamp: new Date()
    });
    
    await transaction.save({ session });
    return transaction;
  } catch (error) {
    console.error('Error saving transaction:', error);
    throw error;
  }
};

// Get User Portfolio
exports.getPortfolio = async (req, res) => {
  try {
    const userId = req.user._id;

    let portfolio = await Portfolio.findOne({ userId })
      .populate('userId', 'username email');

    if (!portfolio) {
      // Create empty portfolio if doesn't exist
      portfolio = new Portfolio({
        userId,
        holdings: [],
        totalValue: 0,
        totalInvested: 0,
        totalProfitLoss: 0,
        profitLossPercentage: 0
      });
      await portfolio.save();
    }

    // Update current prices for all holdings
    const updatedHoldings = await Promise.all(
      portfolio.holdings.map(async (holding) => {
        const currentPrice = await getCurrentPrice(holding.symbol);
        const currentValue = currentPrice * holding.quantity;
        const profitLoss = currentValue - holding.totalInvested;
        const profitLossPercentage = holding.totalInvested > 0 ? 
          (profitLoss / holding.totalInvested) * 100 : 0;
        
        return {
          ...holding.toObject(),
          currentPrice: Math.round(currentPrice * 100) / 100,
          currentValue: Math.round(currentValue * 100) / 100,
          profitLoss: Math.round(profitLoss * 100) / 100,
          profitLossPercentage: Math.round(profitLossPercentage * 100) / 100
        };
      })
    );

    // Update portfolio totals
    const totals = calculatePortfolioTotals(updatedHoldings);
    
    portfolio.holdings = updatedHoldings;
    portfolio.totalValue = totals.totalValue;
    portfolio.totalInvested = totals.totalInvested;
    portfolio.totalProfitLoss = totals.totalProfitLoss;
    portfolio.profitLossPercentage = totals.profitLossPercentage;
    portfolio.lastUpdated = new Date();

    await portfolio.save();

    res.json({
      success: true,
      portfolio: {
        ...portfolio.toObject(),
        holdings: updatedHoldings
      }
    });

  } catch (error) {
    console.error('Get portfolio error:', error);
    res.status(500).json(handleApiError(error, 'Error fetching portfolio'));
  }
};

// Handle stock purchase
exports.buyStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { symbol, quantity, price } = req.body;
    const userId = req.user._id;

    // Validate input
    const validationErrors = validateStockInput(symbol, quantity, price);
    if (validationErrors.length > 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    const upperSymbol = symbol.toUpperCase();
    const totalCost = quantity * price;

    // Check user balance
    const user = await User.findById(userId).session(session);
    if (user.balance < totalCost) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
        required: totalCost,
        currentBalance: user.balance
      });
    }

    // Find or create portfolio
    let portfolio = await Portfolio.findOne({ userId }).session(session);
    if (!portfolio) {
      portfolio = new Portfolio({
        userId,
        holdings: [],
        totalValue: 0,
        totalInvested: 0,
        totalProfitLoss: 0,
        profitLossPercentage: 0
      });
    }

    // Find existing holding
    const existingHoldingIndex = portfolio.holdings.findIndex(
      holding => holding.symbol === upperSymbol
    );

    if (existingHoldingIndex > -1) {
      // Update existing holding
      const existingHolding = portfolio.holdings[existingHoldingIndex];
      const newTotalQuantity = existingHolding.quantity + quantity;
      const newTotalInvested = existingHolding.totalInvested + totalCost;
      const newAveragePrice = newTotalInvested / newTotalQuantity;

      portfolio.holdings[existingHoldingIndex] = {
        ...existingHolding.toObject(),
        quantity: newTotalQuantity,
        averageBuyPrice: Math.round(newAveragePrice * 100) / 100,
        totalInvested: Math.round(newTotalInvested * 100) / 100,
        currentValue: newTotalQuantity * (await getCurrentPrice(upperSymbol))
      };
    } else {
      // Add new holding
      portfolio.holdings.push({
        symbol: upperSymbol,
        quantity,
        averageBuyPrice: price,
        totalInvested: Math.round(totalCost * 100) / 100,
        currentValue: quantity * (await getCurrentPrice(upperSymbol))
      });
    }

    // Update user balance
    user.balance -= totalCost;
    await user.save({ session });

    // Record transaction
    await addTransaction(userId, 'BUY', upperSymbol, quantity, price, totalCost, session);

    // Update portfolio totals
    const totals = calculatePortfolioTotals(portfolio.holdings);
    portfolio.totalValue = totals.totalValue;
    portfolio.totalInvested = totals.totalInvested;
    portfolio.totalProfitLoss = totals.totalProfitLoss;
    portfolio.profitLossPercentage = totals.profitLossPercentage;
    portfolio.lastUpdated = new Date();

    await portfolio.save({ session });
    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Stock purchased successfully',
      transaction: {
        symbol: upperSymbol,
        quantity,
        price,
        totalCost,
        type: 'BUY'
      },
      newBalance: Math.round(user.balance * 100) / 100
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Buy stock error:', error);
    res.status(500).json(handleApiError(error, 'Error purchasing stock'));
  } finally {
    session.endSession();
  }
};

// Handle stock sale
exports.sellStock = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { symbol, quantity, price } = req.body;
    const userId = req.user._id;

    // Validate input
    const validationErrors = validateStockInput(symbol, quantity, price);
    if (validationErrors.length > 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    const upperSymbol = symbol.toUpperCase();

    // Find portfolio
    const portfolio = await Portfolio.findOne({ userId }).session(session);
    if (!portfolio) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found'
      });
    }

    // Find holding
    const holdingIndex = portfolio.holdings.findIndex(
      holding => holding.symbol === upperSymbol
    );

    if (holdingIndex === -1) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Stock not found in portfolio'
      });
    }

    const holding = portfolio.holdings[holdingIndex];

    // Check if user has enough quantity
    if (holding.quantity < quantity) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Insufficient quantity to sell',
        available: holding.quantity,
        requested: quantity
      });
    }

    const saleValue = quantity * price;
    const remainingQuantity = holding.quantity - quantity;

    // Update user balance
    const user = await User.findById(userId).session(session);
    user.balance += saleValue;
    await user.save({ session });

    // Record transaction
    await addTransaction(userId, 'SELL', upperSymbol, quantity, price, saleValue, session);

    if (remainingQuantity === 0) {
      // Remove holding if quantity becomes zero
      portfolio.holdings.splice(holdingIndex, 1);
    } else {
      // Update holding (average buy price remains the same for remaining shares)
      const remainingInvested = (holding.totalInvested / holding.quantity) * remainingQuantity;
      
      portfolio.holdings[holdingIndex] = {
        ...holding.toObject(),
        quantity: remainingQuantity,
        totalInvested: Math.round(remainingInvested * 100) / 100,
        currentValue: remainingQuantity * (await getCurrentPrice(upperSymbol))
      };
    }

    // Update portfolio totals
    const totals = calculatePortfolioTotals(portfolio.holdings);
    portfolio.totalValue = totals.totalValue;
    portfolio.totalInvested = totals.totalInvested;
    portfolio.totalProfitLoss = totals.totalProfitLoss;
    portfolio.profitLossPercentage = totals.profitLossPercentage;
    portfolio.lastUpdated = new Date();

    await portfolio.save({ session });
    await session.commitTransaction();

    res.json({
      success: true,
      message: 'Stock sold successfully',
      transaction: {
        symbol: upperSymbol,
        quantity,
        price,
        saleValue,
        type: 'SELL'
      },
      newBalance: Math.round(user.balance * 100) / 100
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Sell stock error:', error);
    res.status(500).json(handleApiError(error, 'Error selling stock'));
  } finally {
    session.endSession();
  }
};

// Get transaction history
exports.getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, type, symbol } = req.query;

    // Build filter object
    const filter = { userId };
    if (type) filter.type = type.toUpperCase();
    if (symbol) filter.symbol = symbol.toUpperCase();

    const transactions = await Transaction.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('type symbol quantity price totalAmount timestamp')
      .exec();

    const total = await Transaction.countDocuments(filter);

    res.json({
      success: true,
      transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalTransactions: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Get transaction history error:', error);
    res.status(500).json(handleApiError(error, 'Error fetching transaction history'));
  }
};

// Get portfolio analytics
exports.getPortfolioAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;
    const portfolio = await Portfolio.findOne({ userId });
    
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found'
      });
    }

    // Calculate holdings distribution
    const holdingsDistribution = portfolio.holdings.map(holding => ({
      symbol: holding.symbol,
      value: holding.currentValue,
      percentage: portfolio.totalValue > 0 ? 
        (holding.currentValue / portfolio.totalValue) * 100 : 0,
      quantity: holding.quantity
    }));

    // Top performers
    const topPerformers = portfolio.holdings
      .filter(holding => holding.profitLossPercentage !== undefined)
      .sort((a, b) => b.profitLossPercentage - a.profitLossPercentage)
      .slice(0, 5)
      .map(holding => ({
        symbol: holding.symbol,
        profitLossPercentage: Math.round(holding.profitLossPercentage * 100) / 100,
        profitLoss: Math.round(holding.profitLoss * 100) / 100,
        currentValue: Math.round(holding.currentValue * 100) / 100
      }));

    // Worst performers
    const worstPerformers = portfolio.holdings
      .filter(holding => holding.profitLossPercentage !== undefined)
      .sort((a, b) => a.profitLossPercentage - b.profitLossPercentage)
      .slice(0, 5)
      .map(holding => ({
        symbol: holding.symbol,
        profitLossPercentage: Math.round(holding.profitLossPercentage * 100) / 100,
        profitLoss: Math.round(holding.profitLoss * 100) / 100,
        currentValue: Math.round(holding.currentValue * 100) / 100
      }));

    // Largest holdings
    const largestHoldings = portfolio.holdings
      .sort((a, b) => b.currentValue - a.currentValue)
      .slice(0, 5)
      .map(holding => ({
        symbol: holding.symbol,
        currentValue: Math.round(holding.currentValue * 100) / 100,
        percentage: portfolio.totalValue > 0 ? 
          (holding.currentValue / portfolio.totalValue) * 100 : 0
      }));

    res.json({
      success: true,
      analytics: {
        holdingsDistribution,
        topPerformers,
        worstPerformers,
        largestHoldings,
        totalHoldings: portfolio.holdings.length,
        lastUpdated: portfolio.lastUpdated || portfolio.updatedAt
      }
    });
    
  } catch (error) {
    console.error('Get portfolio analytics error:', error);
    res.status(500).json(handleApiError(error, 'Error fetching portfolio analytics'));
  }
};

// Get holding details for a specific stock
exports.getHoldingDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const { symbol } = req.params;

    const portfolio = await Portfolio.findOne({ userId });
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio not found'
      });
    }

    const holding = portfolio.holdings.find(
      h => h.symbol === symbol.toUpperCase()
    );

    if (!holding) {
      return res.status(404).json({
        success: false,
        message: 'Holding not found'
      });
    }

    // Get current price
    const currentPrice = await getCurrentPrice(symbol);
    const currentValue = currentPrice * holding.quantity;
    const profitLoss = currentValue - holding.totalInvested;
    const profitLossPercentage = (profitLoss / holding.totalInvested) * 100;

    // Get transaction history for this symbol
    const transactions = await Transaction.find({
      userId,
      symbol: symbol.toUpperCase()
    })
    .sort({ timestamp: -1 })
    .limit(50)
    .select('type quantity price totalAmount timestamp');

    res.json({
      success: true,
      holding: {
        ...holding.toObject(),
        currentPrice: Math.round(currentPrice * 100) / 100,
        currentValue: Math.round(currentValue * 100) / 100,
        profitLoss: Math.round(profitLoss * 100) / 100,
        profitLossPercentage: Math.round(profitLossPercentage * 100) / 100
      },
      transactions
    });

  } catch (error) {
    console.error('Get holding details error:', error);
    res.status(500).json(handleApiError(error, 'Error fetching holding details'));
  }
};

// Get user balance
exports.getUserBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('balance');
    res.json({
      success: true,
      balance: user.balance
    });
  } catch (error) {
    console.error('Get user balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user balance'
    });
  }
};

// Add money to user account
exports.addMoney = async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid positive amount is required'
      });
    }

    const user = await User.findById(req.user._id);
    user.balance += amount;
    await user.save();

    res.json({
      success: true,
      message: `Successfully added $${amount} to your account`,
      newBalance: user.balance
    });
  } catch (error) {
    console.error('Add money error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding money to account'
    });
  }
};

// Withdraw money from user account
exports.withdrawMoney = async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid positive amount is required'
      });
    }

    const user = await User.findById(req.user._id);
    
    // Check if user has sufficient balance
    if (user.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance for withdrawal',
        currentBalance: user.balance,
        requestedAmount: amount
      });
    }

    // Deduct the amount from balance
    user.balance -= amount;
    await user.save();

    res.json({
      success: true,
      message: `Successfully withdrawn $${amount} from your account`,
      newBalance: user.balance
    });
  } catch (error) {
    console.error('Withdraw money error:', error);
    res.status(500).json({
      success: false,
      message: 'Error withdrawing money from account'
    });
  }
};

module.exports = exports;