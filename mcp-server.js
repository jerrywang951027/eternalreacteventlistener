// mcp-server.js
const { createMcpServer } = require('@playwright/mcp');
const { chromium } = require('playwright');

async function main() {
    // Launch a browser instance
    const browser = await chromium.launch({ headless: false }); // Set to true for headless mode
    const context = await browser.newContext();
    const page = await context.newPage();

    // Create MCP server
    const server = await createMcpServer({
        name: 'playwright-mcp',
        version: '0.1.0',
        capabilities: {
            browser: {
                launch: async (options) => {
                    // Handle browser launch via MCP
                    return { success: true, browserId: browser.browserType().name() };
                },
                navigate: async (url) => {
                    await page.goto(url);
                    return { success: true, currentUrl: page.url() };
                },
                click: async (selector) => {
                    await page.click(selector);
                    return { success: true };
                },
                // Add more actions like fill, screenshot, etc.
            }
        }
    });

    // Listen on a port for Cursor to connect
    await server.listen(8080);
    console.log('Playwright MCP server running on http://localhost:8080');

    // Graceful shutdown
    process.on('SIGINT', async () => {
        await browser.close();
        await server.close();
        process.exit(0);
    });
}

main().catch(console.error);