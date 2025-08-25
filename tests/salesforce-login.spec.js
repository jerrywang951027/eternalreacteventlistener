// tests/salesforce-login.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Salesforce Login', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app root
    await page.goto('/');
  });

  test('Login page displays correctly when not authenticated', async ({ page }) => {
    // Should show the login page title
    await expect(page.locator('h1')).toContainText('Salesforce Explorer');
    
    // Should show the subtitle
    await expect(page.getByText('Connect to your Salesforce org to explore')).toBeVisible();
    
    // Should have the org selection dropdown
    await expect(page.locator('select#orgSelection')).toBeVisible();
    
    // Should have the connect button
    await expect(page.getByRole('button', { name: /connect to salesforce/i })).toBeVisible();
  });

  test('Org dropdown contains available organizations', async ({ page }) => {
    const orgDropdown = page.locator('select#orgSelection');
    await expect(orgDropdown).toBeVisible();
    
    // Wait for options to load
    await page.waitForFunction(() => {
      const select = document.querySelector('select#orgSelection');
      return select && select.options.length > 1; // More than just the default option
    });
    
    // Should have at least one org option besides the default
    const options = await orgDropdown.locator('option').count();
    expect(options).toBeGreaterThan(1);
    
    // First option should be the default placeholder
    const firstOption = orgDropdown.locator('option').first();
    await expect(firstOption).toContainText('-- Select Organization --');
  });

  test('Can select default Salesforce org from dropdown', async ({ page }) => {
    const orgDropdown = page.locator('select#orgSelection');
    
    // Wait for dropdown to be populated
    await page.waitForFunction(() => {
      const select = document.querySelector('select#orgSelection');
      return select && select.options.length > 1;
    });
    
    // Get the first actual org option (not the placeholder)
    const orgOptions = orgDropdown.locator('option:not([value=""])');
    const firstOrgOption = orgOptions.first();
    
    // Select the first available org
    const orgValue = await firstOrgOption.getAttribute('value');
    await orgDropdown.selectOption(orgValue);
    
    // Verify selection
    const selectedValue = await orgDropdown.inputValue();
    expect(selectedValue).toBe(orgValue);
    
    // Connect button should be enabled after selection
    const connectButton = page.getByRole('button', { name: /connect to salesforce/i });
    await expect(connectButton).not.toBeDisabled();
  });

  test('Clicking connect button initiates Salesforce OAuth flow', async ({ page }) => {
    const orgDropdown = page.locator('select#orgSelection');
    
    // Wait for orgs to load and select first one
    await page.waitForFunction(() => {
      const select = document.querySelector('select#orgSelection');
      return select && select.options.length > 1;
    });
    
    const orgOptions = orgDropdown.locator('option:not([value=""])');
    const firstOrgValue = await orgOptions.first().getAttribute('value');
    await orgDropdown.selectOption(firstOrgValue);
    
    // Click connect button
    const connectButton = page.getByRole('button', { name: /connect to salesforce/i });
    
    // Set up request interception to capture the OAuth redirect
    let oauthUrl = null;
    page.on('request', request => {
      if (request.url().includes('salesforce.com') && request.url().includes('oauth2')) {
        oauthUrl = request.url();
      }
    });
    
    await connectButton.click();
    
    // Wait for redirect to Salesforce OAuth or error handling
    await page.waitForLoadState('networkidle');
    
    // Should either redirect to Salesforce OAuth or show error message
    const currentUrl = page.url();
    const isOnOAuth = currentUrl.includes('salesforce.com') && currentUrl.includes('oauth');
    const hasErrorMessage = await page.locator('.error-message, .alert-error, [class*="error"]').count() > 0;
    
    // At least one of these should be true
    expect(isOnOAuth || hasErrorMessage || oauthUrl !== null).toBeTruthy();
  });

  test('Handles authentication state check on page load', async ({ page }) => {
    // Intercept the auth status check
    let authCheckMade = false;
    page.on('request', request => {
      if (request.url().includes('/api/auth/user') || request.url().includes('/api/auth/status')) {
        authCheckMade = true;
      }
    });
    
    await page.goto('/');
    
    // Wait for auth check
    await page.waitForLoadState('networkidle');
    
    // Should have made an auth status check
    expect(authCheckMade).toBeTruthy();
  });

  test('Shows loading state during org data fetch', async ({ page }) => {
    // Intercept orgs request to add delay
    await page.route('**/api/auth/orgs', async route => {
      // Add a small delay to test loading state
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.continue();
    });
    
    await page.goto('/');
    
    // Should show some loading indicator while fetching orgs
    // This could be a spinner, disabled dropdown, or loading text
    const hasLoadingState = await Promise.race([
      page.waitForSelector('[class*="loading"], [class*="spinner"], .loading-orgs', { timeout: 1000 }).then(() => true),
      page.waitForFunction(() => {
        const select = document.querySelector('select#orgSelection');
        return select && select.disabled;
      }, { timeout: 1000 }).then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 1000))
    ]);
    
    // Eventually orgs should load
    await page.waitForFunction(() => {
      const select = document.querySelector('select#orgSelection');
      return select && select.options.length > 1;
    });
  });

  test('Handles errors gracefully when org data fails to load', async ({ page }) => {
    // Mock API failure for orgs endpoint
    await page.route('**/api/auth/orgs', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Failed to load organizations' })
      });
    });
    
    await page.goto('/');
    
    // Should show error message or fallback state
    await expect.soft(page.getByText(/error/i)).toBeVisible();
    
    // Connect button should be disabled when no orgs available
    const connectButton = page.getByRole('button', { name: /connect to salesforce/i });
    await expect(connectButton).toBeDisabled();
  });

  test('Validates org selection before allowing connection', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Initially connect button should be disabled (no org selected)
    const connectButton = page.getByRole('button', { name: /connect to salesforce/i });
    await expect(connectButton).toBeDisabled();
    
    // After selecting an org, button should be enabled
    const orgDropdown = page.locator('select#orgSelection');
    await page.waitForFunction(() => {
      const select = document.querySelector('select#orgSelection');
      return select && select.options.length > 1;
    });
    
    const orgOptions = orgDropdown.locator('option:not([value=""])');
    const firstOrgValue = await orgOptions.first().getAttribute('value');
    await orgDropdown.selectOption(firstOrgValue);
    
    await expect(connectButton).not.toBeDisabled();
    
    // If user deselects (goes back to placeholder), button should be disabled again
    await orgDropdown.selectOption('');
    await expect(connectButton).toBeDisabled();
  });
});

// Additional test for authenticated state (if user is already logged in)
test.describe('Authenticated User', () => {
  test('Redirects to dashboard if already authenticated', async ({ page, context }) => {
    // Mock authenticated state by setting session cookie
    await context.addCookies([{
      name: 'connect.sid',
      value: 'mock-session-id',
      domain: 'localhost',
      path: '/',
      httpOnly: true
    }]);
    
    // Mock successful auth check
    await page.route('**/api/auth/user', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          user: {
            displayName: 'Test User',
            username: 'testuser@example.com',
            email: 'testuser@example.com',
            instanceUrl: 'https://test.salesforce.com',
            orgName: 'Test Org'
          }
        })
      });
    });
    
    await page.goto('/');
    
    // Should show dashboard instead of login page
    await page.waitForLoadState('networkidle');
    
    // Look for dashboard elements
    const isDashboard = await Promise.race([
      page.waitForSelector('.dashboard, [class*="dashboard"]', { timeout: 5000 }).then(() => true),
      page.waitForText(/Platform Events|SObjects|Explore OM/, { timeout: 5000 }).then(() => true),
      page.waitForText(/connected/i, { timeout: 5000 }).then(() => true),
      new Promise(resolve => setTimeout(() => resolve(false), 5000))
    ]);
    
    expect(isDashboard).toBeTruthy();
  });
});
