const jsforce = require('jsforce');

class PlatformEventsModule {
  constructor(io, platformEventSubscriptions) {
    this.io = io;
    this.platformEventSubscriptions = platformEventSubscriptions;
    this.isSubscriptionInProgress = false;
    this.globalSalesforceConnection = null;
  }

  /**
   * Set the global Salesforce connection
   */
  setGlobalConnection(connection) {
    this.globalSalesforceConnection = connection;
  }

  /**
   * Get the global Salesforce connection
   */
  getGlobalConnection() {
    return this.globalSalesforceConnection;
  }

  /**
   * Create or get Salesforce connection
   */
  createConnection(req) {
    let conn = this.globalSalesforceConnection;
    if (!conn) {
      conn = new jsforce.Connection({
        oauth2: req.session.oauth2,
        accessToken: req.session.salesforce.accessToken,
        instanceUrl: req.session.salesforce.instanceUrl
      });
    }
    return conn;
  }

  /**
   * Fetch all available platform events
   */
  async fetchPlatformEvents(req, res) {
    try {
      const conn = this.createConnection(req);

      // Query for Platform Event definitions
      const result = await conn.sobject('EntityDefinition').find({
        QualifiedApiName: { $like: '%__e' },
        IsCustomizable: true
      }, 'QualifiedApiName, Label, DeveloperName');

      res.json({
        success: true,
        platformEvents: result || []
      });
    } catch (error) {
      console.error('Error fetching platform events:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch platform events: ' + error.message 
      });
    }
  }

  /**
   * Async function to properly cleanup subscriptions
   */
  async cleanupSubscriptions() {
    console.log(`🧹 [PLATFORM_EVENTS] Starting cleanup of ${this.platformEventSubscriptions.size} existing subscriptions...`);
    const existingEventNames = Array.from(this.platformEventSubscriptions.keys());
    console.log(`🧹 [PLATFORM_EVENTS] Existing subscriptions:`, existingEventNames);
    
    const cleanupPromises = [];
    this.platformEventSubscriptions.forEach((subscription, eventName) => {
      const cleanupPromise = new Promise((resolve) => {
        try {
          subscription.cancel();
          console.log(`✅ [PLATFORM_EVENTS] Cancelled existing subscription for ${eventName}`);
          resolve();
        } catch (error) {
          console.error(`❌ [PLATFORM_EVENTS] Error cancelling subscription for ${eventName}:`, error);
          resolve(); // Don't block other cleanups
        }
      });
      cleanupPromises.push(cleanupPromise);
    });
    
    // Wait for all cancellations to complete
    await Promise.all(cleanupPromises);
    
    // Give Salesforce a moment to process the cancellations
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    this.platformEventSubscriptions.clear();
    this.globalSalesforceConnection = null; // Reset connection
    console.log(`🧹 [PLATFORM_EVENTS] Cleanup complete. Active subscriptions: ${this.platformEventSubscriptions.size}`);
  }

  /**
   * Subscribe to platform events
   */
  async subscribeToPlatformEvents(req, res) {
    // Prevent concurrent subscription requests
    if (this.isSubscriptionInProgress) {
      console.warn('⚠️ [PLATFORM_EVENTS] Subscription request rejected - another subscription is in progress');
      return res.status(429).json({ 
        success: false, 
        message: 'Another subscription is in progress. Please wait.' 
      });
    }

    try {
      this.isSubscriptionInProgress = true;
      
      const { selectedEvents } = req.body;
      
      if (!selectedEvents || !Array.isArray(selectedEvents) || selectedEvents.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Please specify which events to subscribe to' 
        });
      }

      // Deduplicate selected events to prevent multiple subscriptions to the same event
      const uniqueSelectedEvents = [...new Set(selectedEvents)];
      if (uniqueSelectedEvents.length !== selectedEvents.length) {
        console.warn(`⚠️ [PLATFORM_EVENTS] Duplicate events detected in selection. Original: ${selectedEvents.length}, Unique: ${uniqueSelectedEvents.length}`);
      }
      console.log(`📋 [PLATFORM_EVENTS] Processing subscription request for events:`, uniqueSelectedEvents);

      // Clean up existing subscriptions first
      await this.cleanupSubscriptions();

      // Create or reuse Salesforce connection
      if (!this.globalSalesforceConnection) {
        this.globalSalesforceConnection = new jsforce.Connection({
          oauth2: req.session.oauth2,
          accessToken: req.session.salesforce.accessToken,
          instanceUrl: req.session.salesforce.instanceUrl
        });
        console.log('🔗 [PLATFORM_EVENTS] Created new Salesforce connection');
      } else {
        console.log('🔗 [PLATFORM_EVENTS] Reusing existing Salesforce connection');
      }
      
      const conn = this.globalSalesforceConnection;

      // Get selected platform events details
      const platformEventsResult = await conn.sobject('EntityDefinition').find({
        QualifiedApiName: { $in: uniqueSelectedEvents },
        IsCustomizable: true
      }, 'QualifiedApiName, Label');

      const platformEvents = platformEventsResult || [];
      const subscriptions = [];

      console.log(`📋 [PLATFORM_EVENTS] Subscribing to ${uniqueSelectedEvents.length} unique selected events:`, uniqueSelectedEvents);

      // Subscribe to each selected platform event
      for (const event of platformEvents) {
        const eventName = event.QualifiedApiName;
        const channel = `/event/${eventName}`;
        
        // Double-check that we don't already have a subscription for this event
        if (this.platformEventSubscriptions.has(eventName)) {
          console.warn(`⚠️ [PLATFORM_EVENTS] Subscription already exists for ${eventName}, skipping...`);
          continue;
        }
        
        try {
          const subscription = conn.streaming.topic(channel).subscribe((message) => {
            const timestamp = new Date().toISOString();
            const subscriptionId = `${eventName}-${Math.random().toString(36).substr(2, 6)}`;
            
            console.log(`📨 [PLATFORM_EVENTS] [${subscriptionId}] Received platform event: ${eventName} at ${timestamp}`);
            console.log(`📡 [PLATFORM_EVENTS] Active subscriptions: ${this.platformEventSubscriptions.size}`);
            console.log(`📡 [PLATFORM_EVENTS] Broadcasting to ${this.io.engine.clientsCount} connected WebSocket clients`);
            
            // Emit to all connected clients
            const eventData = {
              eventName,
              eventLabel: event.Label,
              message,
              timestamp,
              subscriptionId // Add for debugging
            };
            
            this.io.emit('platformEvent', eventData);
            console.log(`✅ [PLATFORM_EVENTS] Event broadcasted: ${eventName} at ${timestamp} with ID ${subscriptionId}`);
            
            // Log all active subscriptions for this event type
            const sameEventSubs = Array.from(this.platformEventSubscriptions.keys()).filter(key => key === eventName);
            if (sameEventSubs.length > 1) {
              console.warn(`⚠️ [PLATFORM_EVENTS] WARNING: Multiple subscriptions detected for ${eventName}:`, sameEventSubs.length);
            }
          });

          subscriptions.push({
            eventName,
            eventLabel: event.Label,
            channel,
            subscription
          });

          // Store subscription for cleanup later
          this.platformEventSubscriptions.set(eventName, subscription);
          console.log(`🎯 Successfully subscribed to ${eventName} on channel ${channel}`);
        } catch (subError) {
          console.error(`❌ Error subscribing to ${eventName}:`, subError);
        }
      }

      console.log(`🎉 [PLATFORM_EVENTS] Subscription complete!`);
      console.log(`📊 [PLATFORM_EVENTS] Final state - Active subscriptions: ${this.platformEventSubscriptions.size}`);
      console.log(`📊 [PLATFORM_EVENTS] Subscriptions created in this request: ${subscriptions.length}`);
      console.log(`📊 [PLATFORM_EVENTS] Active subscription events:`, Array.from(this.platformEventSubscriptions.keys()));

      // Verify subscription count matches expected
      if (this.platformEventSubscriptions.size !== subscriptions.length) {
        console.warn(`⚠️ [PLATFORM_EVENTS] WARNING: Subscription count mismatch! Expected: ${subscriptions.length}, Actual: ${this.platformEventSubscriptions.size}`);
      }

      res.json({
        success: true,
        message: `Successfully subscribed to ${subscriptions.length} selected platform events`,
        originalSelectedCount: selectedEvents.length,
        uniqueSelectedCount: uniqueSelectedEvents.length,
        subscribedCount: subscriptions.length,
        activeSubscriptionsCount: this.platformEventSubscriptions.size,
        subscriptions: subscriptions.map(s => ({
          eventName: s.eventName,
          eventLabel: s.eventLabel,
          channel: s.channel
        }))
      });

    } catch (error) {
      console.error('❌ [PLATFORM_EVENTS] Error subscribing to platform events:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to subscribe to platform events: ' + error.message 
      });
    } finally {
      this.isSubscriptionInProgress = false;
      console.log('🔓 [PLATFORM_EVENTS] Subscription lock released');
    }
  }

  /**
   * Manual cleanup endpoint
   */
  async manualCleanup(req, res) {
    try {
      console.log('🧹 [PLATFORM_EVENTS] Manual cleanup requested');
      await this.cleanupSubscriptions();
      res.json({ 
        success: true, 
        message: 'Cleanup completed',
        activeSubscriptions: this.platformEventSubscriptions.size
      });
    } catch (error) {
      console.error('❌ [PLATFORM_EVENTS] Error during manual cleanup:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Cleanup failed: ' + error.message 
      });
    }
  }

  /**
   * Get subscription status
   */
  getSubscriptionStatus(req, res) {
    try {
      const activeSubscriptions = Array.from(this.platformEventSubscriptions.keys());
      res.json({
        success: true,
        activeSubscriptionsCount: this.platformEventSubscriptions.size,
        activeSubscriptions,
        isSubscriptionInProgress: this.isSubscriptionInProgress,
        hasGlobalConnection: !!this.globalSalesforceConnection
      });
    } catch (error) {
      console.error('❌ [PLATFORM_EVENTS] Error getting subscription status:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to get subscription status: ' + error.message 
      });
    }
  }
}

module.exports = PlatformEventsModule;
