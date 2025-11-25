const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { userSignUp, userLogin } = require('../controllers/userController');
require('dotenv').config();
const auth = require('../middleware/authMiddleware');
const User = require('../models/User');
const router = express.Router();

// Health Check Route
router.get("/ping", (req, res) => {
  res.status(200).json({ message: "Server is alive!" });
});

router.post("/register", userSignUp);

router.post("/login", userLogin);

// Get user profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// routes/userRoutes.js - Update the profile route
router.put('/profile', auth, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      dateOfBirth,
      address
    } = req.body;

    // Build update object dynamically
    const updateData = {};
    
    if (firstName !== undefined) updateData['profile.firstName'] = firstName;
    if (lastName !== undefined) updateData['profile.lastName'] = lastName;
    if (phone !== undefined) updateData['profile.phone'] = phone;
    if (dateOfBirth !== undefined) updateData['profile.dateOfBirth'] = dateOfBirth;
    
    // Handle address updates
    if (address) {
      if (address.street !== undefined) updateData['profile.address.street'] = address.street;
      if (address.city !== undefined) updateData['profile.address.city'] = address.city;
      if (address.state !== undefined) updateData['profile.address.state'] = address.state;
      if (address.zipCode !== undefined) updateData['profile.address.zipCode'] = address.zipCode;
      if (address.country !== undefined) updateData['profile.address.country'] = address.country;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { 
        new: true,
        // This ensures we create the profile object if it doesn't exist
        upsert: false,
        setDefaultsOnInsert: true
      }
    ).select('-password');

    res.json(user);
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// // routes/authRoutes.js
// router.post('/register', validateRegistration, registerUser);
// router.post('/login', validateLogin, loginUser);
// router.post('/logout', protect, logoutUser);
// router.get('/me', protect, getCurrentUser);


module.exports = router;