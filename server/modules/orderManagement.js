const jsforce = require('jsforce');

class OrderManagementModule {
  constructor() {
    // No more global connection storage
  }

  /**
   * Create Salesforce connection from session
   */
  createConnection(req) {
    return new jsforce.Connection({
      oauth2: req.session.oauth2,
      accessToken: req.session.salesforce.accessToken,
      instanceUrl: req.session.salesforce.instanceUrl
    });
  }

  /**
   * Search for orders by account name or order number
   */
  async searchOrders(req, res) {
    try {
      const { query } = req.query;
      
      if (!query || query.trim().length === 0) {
        return res.json({ success: true, orders: [] });
      }

      const conn = this.createConnection(req);

      const searchPattern = query.trim();
      
      // Search for orders by account name or order number
      // Using SOQL to search Order object
      const soqlQuery = `
        SELECT Id, OrderNumber, vlocity_cmt__OrderStatus__c, SubType__c, Account.Name, EffectiveDate, 
               TotalAmount, CreatedDate
        FROM Order 
        WHERE (Account.Name LIKE '%${searchPattern}%' OR OrderNumber LIKE '%${searchPattern}%')
        ORDER BY CreatedDate DESC
        LIMIT 50
      `;

      const result = await conn.query(soqlQuery);
      
      const orders = result.records.map(order => ({
        id: order.Id,
        orderNumber: order.OrderNumber,
        status: order.vlocity_cmt__OrderStatus__c,
        orderSubtype: order.SubType__c,
        accountName: order.Account ? order.Account.Name : 'N/A',
        effectiveDate: order.EffectiveDate,
        totalAmount: order.TotalAmount,
        createdDate: order.CreatedDate
      }));

      res.json({
        success: true,
        orders
      });
    } catch (error) {
      console.error('❌ [ORDER_MGMT] Error searching orders:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to search orders: ' + error.message 
      });
    }
  }

  /**
   * Get order items for a specific order
   */
  async getOrderItems(req, res) {
    try {
      const { orderId } = req.params;

      const conn = this.createConnection(req);

      // Query for order items with product details, pricing information, and parent relationship
      const soqlQuery = `
        SELECT Id, OrderId, Product2Id, Product2.Name, Quantity, 
               vlocity_cmt__OneTimeCharge__c, vlocity_cmt__RecurringCharge__c,
               UnitPrice, TotalPrice, Description, vlocity_cmt__ParentItemId__c,
               vlocity_cmt__AssetReferenceId__c
        FROM OrderItem 
        WHERE OrderId = '${orderId}'
        ORDER BY vlocity_cmt__ParentItemId__c NULLS FIRST, Product2.Name ASC
      `;

      const result = await conn.query(soqlQuery);
      
      const orderItems = result.records.map(item => ({
        id: item.Id,
        orderId: item.OrderId,
        productId: item.Product2Id,
        productName: item.Product2?.Name || 'N/A',
        quantity: item.Quantity || 0,
        oneTimeCharge: item.vlocity_cmt__OneTimeCharge__c || 0,
        recurringCharge: item.vlocity_cmt__RecurringCharge__c || 0,
        unitPrice: item.UnitPrice || 0,
        totalPrice: item.TotalPrice || 0,
        description: item.Description || '',
        parentItemId: item.vlocity_cmt__ParentItemId__c || null,
        assetReferenceId: item.vlocity_cmt__AssetReferenceId__c || null // Asset reference ID for parent matching
      }));

      res.json({
        success: true,
        orderItems,
        orderId,
        totalItems: orderItems.length
      });
    } catch (error) {
      console.error('❌ [ORDER_MGMT] Error fetching order items:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch order items: ' + error.message 
      });
    }
  }

  /**
   * Activate an order by updating associated orchestration items
   */
  async activateOrder(req, res) {
    try {
      const { orderId } = req.params;

      const conn = this.createConnection(req);

      // First, verify the order is in "In Progress" status
      const orderCheck = await conn.query(`
        SELECT Id, vlocity_cmt__OrderStatus__c FROM Order WHERE Id = '${orderId}' AND vlocity_cmt__OrderStatus__c = 'In Progress'
      `);

      if (orderCheck.records.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Order not found or not in In Progress status' 
        });
      }

      // Query for associated orchestration items with "Running" or "Fatally Failed" status
      // Note: This assumes there's an OrchestrationItem object related to Order
      // The actual object name may vary based on your Salesforce setup
      let orchestrationQuery;
      try {
        orchestrationQuery = await conn.query(`
          SELECT Id, vlocity_cmt__State__c FROM vlocity_cmt__OrchestrationItem__c 
          WHERE vlocity_cmt__FulfilmentRequestLineId__r.vlocity_cmt__FulfilmentRequestID__r.vlocity_cmt__OrderId__c = '${orderId}' 
          AND (vlocity_cmt__State__c = 'Running' OR vlocity_cmt__State__c = 'Fatally Failed')
        `);
      } catch (orchError) {
        // If OrchestrationItem__c doesn't exist, try OrderItem or other related objects
        console.log('⚠️ [ORDER_MGMT] vlocity_cmt__OrchestrationItem__c not found, trying alternative objects...');
        try {
          orchestrationQuery = await conn.query(`
            SELECT Id, Status FROM OrderItem 
            WHERE OrderId = '${orderId}' AND (Status = 'Running' OR Status = 'Fatally Failed')
          `);
        } catch (altError) {
          return res.status(400).json({ 
            success: false, 
            message: 'No orchestration items object found. Please check object configuration.' 
          });
        }
      }

      if (orchestrationQuery.records.length === 0) {
        return res.json({ 
          success: true, 
          message: 'No running or failed orchestration items found to update',
          updatedCount: 0
        });
      }

      // Update all running and fatally failed orchestration items to "Completed"
      const itemsToUpdate = orchestrationQuery.records.map(item => ({
        Id: item.Id,
        vlocity_cmt__State__c: 'Completed' // or Status: 'Completed' depending on field name
      }));

      // Try with Vlocity orchestration object first
      let updateResult;
      try {
        updateResult = await conn.sobject('vlocity_cmt__OrchestrationItem__c').update(itemsToUpdate);
      } catch (updateError) {
        // If Vlocity object fails, try with standard OrderItem
        console.log('⚠️ [ORDER_MGMT] Failed to update vlocity_cmt__OrchestrationItem__c, trying OrderItem fallback...');
        const standardItemsToUpdate = orchestrationQuery.records.map(item => ({
          Id: item.Id,
          Status: 'Completed'
        }));
        updateResult = await conn.sobject('OrderItem').update(standardItemsToUpdate);
      }

      // Count successful updates
      const successfulUpdates = Array.isArray(updateResult) 
        ? updateResult.filter(r => r.success).length
        : (updateResult.success ? 1 : 0);

      console.log(`✅ [ORDER_MGMT] Successfully updated ${successfulUpdates} orchestration items to Completed for order ${orderId}`);

      res.json({
        success: true,
        message: `Successfully updated ${successfulUpdates} orchestration items to Completed`,
        updatedCount: successfulUpdates,
        totalItems: orchestrationQuery.records.length
      });

    } catch (error) {
      console.error(`❌ [ORDER_MGMT] Error activating order ${req.params.orderId}:`, error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to activate order: ' + error.message 
      });
    }
  }

  /**
   * Get orchestration status for an order
   * If there are incomplete orchestration items, automatically update "Running" and "Fatally Failed" items to "Completed"
   */
  async getOrchestrationStatus(req, res) {
    try {
      const { orderId } = req.params;

      const conn = this.createConnection(req);

      // Query orchestration items for the order
      let orchestrationQuery;
      let fieldName = 'vlocity_cmt__State__c';
      let isVlocityObject = true;
      
      try {
        orchestrationQuery = await conn.query(`
          SELECT Id, vlocity_cmt__State__c FROM vlocity_cmt__OrchestrationItem__c 
          WHERE vlocity_cmt__FulfilmentRequestLineId__r.vlocity_cmt__FulfilmentRequestID__r.vlocity_cmt__OrderId__c = '${orderId}'
        `);
      } catch (orchError) {
        console.log('⚠️ [ORDER_MGMT] vlocity_cmt__OrchestrationItem__c not found for status check, trying OrderItem fallback...');
        isVlocityObject = false;
        try {
          orchestrationQuery = await conn.query(`
            SELECT Id, Status FROM OrderItem 
            WHERE OrderId = '${orderId}'
          `);
          fieldName = 'Status';
        } catch (altError) {
          return res.status(400).json({ 
            success: false, 
            message: 'No orchestration items object found' 
          });
        }
      }

      const items = orchestrationQuery.records.map(item => ({
        id: item.Id,
        status: item[fieldName]
      }));

      const completedCount = items.filter(item => (item.status === 'Completed')||(item.status === 'Skipped')).length;
      const allCompleted = items.length > 0 && completedCount === items.length;

      // If there are still incomplete orchestration items, update "In Progress" items to "Completed"
      if (!allCompleted && items.length > 0) {
        console.log(`🔄 [ORDER_MGMT] Found ${items.length - completedCount} incomplete orchestration items for order ${orderId}. Checking for "Running" and "Fatally Failed" items to update...`);
        
        const itemsToComplete = items.filter(item => item.status === 'Running' || item.status === 'Fatally Failed');
        
        if (itemsToComplete.length > 0) {
          console.log(`⚡ [ORDER_MGMT] Updating ${itemsToComplete.length} "Running" and "Fatally Failed" orchestration items to "Completed" for order ${orderId}`);
          
          try {
            const itemsToUpdate = itemsToComplete.map(item => ({
              Id: item.id,
              [fieldName]: 'Completed'
            }));

            let updateResult;
            if (isVlocityObject) {
              updateResult = await conn.sobject('vlocity_cmt__OrchestrationItem__c').update(itemsToUpdate);
            } else {
              updateResult = await conn.sobject('OrderItem').update(itemsToUpdate);
            }

            // Count successful updates
            const successfulUpdates = Array.isArray(updateResult) 
              ? updateResult.filter(r => r.success).length
              : (updateResult.success ? 1 : 0);

            console.log(`✅ [ORDER_MGMT] Successfully updated ${successfulUpdates} orchestration items from "Running/Fatally Failed" to "Completed"`);

            // Update the items array to reflect the changes
            items.forEach(item => {
              if (item.status === 'Running' || item.status === 'Fatally Failed') {
                item.status = 'Completed';
              }
            });

            // Recalculate completion status
            const newCompletedCount = items.filter(item => item.status === 'Completed').length;
            const newAllCompleted = items.length > 0 && newCompletedCount === items.length;

            res.json({
              success: true,
              items,
              totalItems: items.length,
              completedCount: newCompletedCount,
              allCompleted: newAllCompleted,
              updatedItems: successfulUpdates,
              autoUpdated: true,
              message: `Automatically updated ${successfulUpdates} "Running/Fatally Failed" items to "Completed"`
            });

          } catch (updateError) {
            console.error(`❌ [ORDER_MGMT] Failed to update "Running/Fatally Failed" orchestration items:`, updateError);
            
            // Still return the original status if update failed
            res.json({
              success: true,
              items,
              totalItems: items.length,
              completedCount,
              allCompleted,
              updateError: updateError.message,
              autoUpdated: false
            });
          }
        } else {
          console.log(`ℹ️ [ORDER_MGMT] No "Running" or "Fatally Failed" orchestration items found to update for order ${orderId}`);
          
          res.json({
            success: true,
            items,
            totalItems: items.length,
            completedCount,
            allCompleted,
            autoUpdated: false,
            message: 'No "Running" or "Fatally Failed" items found to update'
          });
        }
      } else {
        // All items are already completed or no items exist
        res.json({
          success: true,
          items,
          totalItems: items.length,
          completedCount,
          allCompleted,
          autoUpdated: false,
          message: allCompleted ? 'All orchestration items are already completed' : 'No orchestration items found'
        });
      }

    } catch (error) {
      console.error(`❌ [ORDER_MGMT] Error checking orchestration status for order ${req.params.orderId}:`, error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to check orchestration status: ' + error.message 
      });
    }
  }
}

module.exports = OrderManagementModule;
