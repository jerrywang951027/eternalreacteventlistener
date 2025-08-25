# Playwright Tests for Salesforce Explorer

This directory contains end-to-end tests for the Salesforce Explorer application using Playwright.

## Test Files

- **`app.spec.js`** - General application tests (page loading, API health, etc.)
- **`salesforce-login.spec.js`** - Comprehensive Salesforce login functionality tests

## Setup

1. **Install Playwright browsers** (first time only):
   ```bash
   npm run test:install
   ```

2. **Make sure your application is configured** with proper Salesforce org settings in `server/.env`

## Running Tests

### All Tests
```bash
npm test
```

### Salesforce Login Tests Only
```bash
npm run test:salesforce
```

### Interactive Mode (with browser UI)
```bash
npm run test:headed
```

### Debug Mode (with Playwright UI)
```bash
npm run test:ui
```

### View Test Report
```bash
npm run test:report
```

## Test Coverage

### Login Page Tests
- ✅ Login page displays correctly
- ✅ Org dropdown loads and shows available organizations
- ✅ Can select default org from dropdown
- ✅ Connect button initiates OAuth flow
- ✅ Handles authentication state checks
- ✅ Shows loading states during org fetch
- ✅ Handles API errors gracefully
- ✅ Validates org selection before connection

### Authenticated User Tests
- ✅ Redirects to dashboard if already authenticated

### General App Tests
- ✅ Page loads with correct title
- ✅ API endpoints are available
- ✅ Static assets load correctly
- ✅ React app structure is intact
- ✅ No critical JavaScript errors

## Test Environment

- **Base URL**: `http://localhost:3000`
- **Backend URL**: `http://localhost:5000` (auto-started by React proxy)
- **Browsers**: Chromium, Firefox, WebKit
- **Server**: Automatically started with `npm run dev`

## Configuration

- **`playwright.config.js`** - Main Playwright configuration
- **`package.json`** - Test scripts and dependencies

## Notes

### OAuth Testing Limitations
- OAuth flow testing is limited in automated environment
- Tests verify OAuth initiation but cannot complete full Salesforce authentication
- For full OAuth testing, use headed mode and manually authenticate

### Environment Requirements
- Salesforce orgs must be configured in `server/.env`
- Valid Salesforce Connected App credentials required
- Internet connection needed for Salesforce API calls

### Debugging
- Screenshots taken on test failures
- Console logs captured for error analysis
- Trace files generated for failed tests
- Use `--headed` flag to see browser interactions
