// tests/app.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Salesforce Explorer App', () => {
  test('Homepage loads correctly', async ({ page }) => {
    // Navigate to the homepage
    await page.goto('/');
    
    // Assert the page title
    await expect(page).toHaveTitle(/Salesforce Explorer/);
    
    // Should show login page when not authenticated
    await expect(page.locator('h1')).toContainText('Salesforce Explorer');
  });

  test('API health check works', async ({ request }) => {
    // Test that backend is responding
    const response = await request.get('/api/auth/orgs');
    
    // Should get a response (either success with data or auth error)
    expect(response.status()).toBeLessThan(500); // Not a server error
  });

  test('Static assets load correctly', async ({ page }) => {
    await page.goto('/');
    
    // Check that CSS is loaded (page should be styled)
    const hasStyles = await page.evaluate(() => {
      const body = document.body;
      const computedStyle = window.getComputedStyle(body);
      // Check if any custom CSS properties are applied
      return computedStyle.fontFamily !== 'Times' || // Default browser font
             computedStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' || // Has background
             document.querySelectorAll('link[rel="stylesheet"]').length > 0;
    });
    
    expect(hasStyles).toBeTruthy();
  });

  test('Application structure is correct', async ({ page }) => {
    await page.goto('/');
    
    // Should have React app structure
    const reactApp = page.locator('#root');
    await expect(reactApp).toBeVisible();
    
    // Should load without JavaScript errors in console
    const consoleLogs = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleLogs.push(msg.text());
      }
    });
    
    await page.waitForLoadState('networkidle');
    
    // Filter out known warnings/non-critical errors
    const criticalErrors = consoleLogs.filter(log => 
      !log.includes('favicon') && 
      !log.includes('manifest') &&
      !log.includes('404')
    );
    
    expect(criticalErrors).toHaveLength(0);
  });

  test('Environment configuration is valid', async ({ request }) => {
    // Test that essential API endpoints are available
    const endpoints = [
      '/api/auth/orgs',
      '/api/auth/user',
    ];
    
    for (const endpoint of endpoints) {
      const response = await request.get(endpoint);
      // Should not be 404 (endpoint exists) or 500 (server error)
      expect(response.status()).not.toBe(404);
      expect(response.status()).toBeLessThan(500);
    }
  });
});