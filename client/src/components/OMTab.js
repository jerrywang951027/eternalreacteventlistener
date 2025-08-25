import React, { useState, useEffect } from 'react';
import OrderItemsPopup from './OrderItemsPopup';

const OMTab = ({
  // State props
  searchQuery,
  searchResults,
  activatingOrders,
  pollingOrders,
  refreshingOrders,
  orchestrationStatus,
  loading,
  error,
  // Function props
  searchOrders,
  activateOrder,
  clearOMState
}) => {
  const [searchInput, setSearchInput] = useState(searchQuery || '');
  
  // Order items popup state - simplified approach
  const [showOrderItemsPopup, setShowOrderItemsPopup] = useState(false);
  const [hoveredOrderId, setHoveredOrderId] = useState(null);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const [hideTimeout, setHideTimeout] = useState(null);

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchInput.trim() !== searchQuery) {
        searchOrders(searchInput);
      }
    }, 500); // Longer delay for server queries

    return () => clearTimeout(timeoutId);
  }, [searchInput, searchQuery, searchOrders]);

  // Update local input when prop changes (for tab switching)
  useEffect(() => {
    setSearchInput(searchQuery || '');
  }, [searchQuery]);

  const handleActivate = (orderId) => {
    activateOrder(orderId);
  };

  // Order items popup handlers
  const showPopup = (event, orderId) => {
    // Clear any hide timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      setHideTimeout(null);
    }

    // Set position
    const rect = event.target.getBoundingClientRect();
    setPopupPosition({
      x: rect.left + rect.width / 2,
      y: rect.top
    });

    // Show popup immediately
    setHoveredOrderId(orderId);
    setShowOrderItemsPopup(true);
    

  };

  const scheduleHide = () => {
    // Clear any existing timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }

    // Schedule hide after delay
    const timeout = setTimeout(() => {
      setShowOrderItemsPopup(false);
      setHoveredOrderId(null);
      setHideTimeout(null);
    }, 300); // Reasonable delay

    setHideTimeout(timeout);
  };

  const cancelHide = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      setHideTimeout(null);
    }
  };

  const handlePopupClose = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      setHideTimeout(null);
    }
    setShowOrderItemsPopup(false);
    setHoveredOrderId(null);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
      }
    };
  }, [hideTimeout]);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch (error) {
      return 'N/A';
    }
  };

  const formatAmount = (amount) => {
    if (amount == null) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getStatusBadgeClass = (status) => {
    switch (status?.toLowerCase()) {
      case 'in progress':
        return 'status-in-progress';
      case 'activated':
        return 'status-activated';
      case 'completed':
        return 'status-completed';
      case 'draft':
        return 'status-draft';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-default';
    }
  };

  const getOrchestrationProgress = (orderId) => {
    const status = orchestrationStatus[orderId];
    if (!status) return null;
    
    return {
      completedCount: status.completedCount,
      totalCount: status.totalItems,
      allCompleted: status.allCompleted,
      percentage: status.totalItems > 0 ? (status.completedCount / status.totalItems * 100) : 0
    };
  };

  const renderOrchestrationStatus = (orderId) => {
    const progress = getOrchestrationProgress(orderId);
    const isPolling = pollingOrders.has(orderId);
    
    if (!progress && !isPolling) return null;

    if (isPolling && !progress) {
      return (
        <div className="orchestration-status polling">
          <div className="polling-indicator">
            <span className="spinner">⏳</span>
            <span>Checking orchestration status...</span>
          </div>
        </div>
      );
    }

    if (progress) {
      return (
        <div className="orchestration-status">
          <div className="orchestration-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <div className="progress-text">
              {progress.completedCount}/{progress.totalCount} orchestration items completed
              {isPolling && <span className="polling-dot"> ● </span>}
            </div>
          </div>
          {progress.allCompleted && (
            <div className="completion-badge">
              ✅ All orchestration items completed
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="tab-content">
      <div className="dashboard-content om-content">
        <div className="om-layout">
          {/* Left Panel - Search */}
          <div className="om-left-panel">
            <div className="search-section">
              <h3>🔍 Search Orders</h3>
              
              <div className="search-input-container">
                <input
                  type="text"
                  placeholder="Search by account name or order number..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="order-search-input"
                />
                {searchInput && (
                  <button
                    onClick={() => {
                      setSearchInput('');
                      clearOMState();
                    }}
                    className="clear-search-btn"
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="search-info">
                <p>💡 <strong>Search Tips:</strong></p>
                <ul>
                  <li>Enter account name (e.g., "Acme Corp")</li>
                  <li>Enter order number (e.g., "00000123")</li>
                  <li>Partial matches are supported</li>
                </ul>
              </div>

              {/* Loading and Error States */}
              {loading && (
                <div className="loading-message">
                  🔄 Searching orders...
                </div>
              )}

              {error && (
                <div className="error-message">
                  ⚠️ {error}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Results */}
          <div className="om-right-panel">
            {searchResults.length === 0 && !loading ? (
              <div className="no-results-placeholder">
                <div className="placeholder-content">
                  <h3>⚙️ Order Management</h3>
                  {searchInput ? (
                    <div>
                      <p>No orders found for: "{searchInput}"</p>
                      <p className="help-text">
                        Try searching with a different account name or order number.
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p>Search for orders by account name or order number</p>
                      <p className="help-text">
                        Enter search criteria in the left panel to find orders.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="orders-results">
                <div className="results-header">
                  <h3>📋 Order Results ({searchResults.length})</h3>
                  {searchResults.length > 0 && (
                    <div className="results-summary">
                      Found {searchResults.length} order(s) for "{searchQuery}"
                    </div>
                  )}
                </div>

                <div className="orders-container">
                  {searchResults.map((order, index) => (
                    <div key={order.id} className={`order-card ${refreshingOrders.has(order.id) ? 'refreshing' : ''}`}>
                      <div className="order-header">
                        <div className="order-info">
                          <div className="account-name">
                            <strong>{order.accountName}</strong>
                          </div>
                          <div className="order-meta">
                                            <span
                  className="order-number hoverable-order-number"
                  onMouseEnter={(e) => showPopup(e, order.id)}
                  onMouseLeave={scheduleHide}
                  title="Hover to see order items"
                >
                  #{order.orderNumber}
                </span>
                            <span className={`order-status ${getStatusBadgeClass(order.status)}`}>
                              {order.status}
                            </span>
                            {refreshingOrders.has(order.id) && (
                              <span className="refresh-indicator">
                                🔄 Updating...
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="order-actions">
                          {order.status === 'In Progress' && (
                            <button
                              onClick={() => handleActivate(order.id)}
                              disabled={activatingOrders.has(order.id)}
                              className="activate-btn"
                              title="Activate order by completing running orchestration items"
                            >
                              {activatingOrders.has(order.id) ? (
                                <>⏳ Activating...</>
                              ) : (
                                <>🚀 Activate</>
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="order-details">
                        <div className="order-field">
                          <label>Order Subtype:</label>
                          <span>{order.orderSubtype || 'N/A'}</span>
                        </div>
                        <div className="order-field">
                          <label>Total Amount:</label>
                          <span>{formatAmount(order.totalAmount)}</span>
                        </div>
                        <div className="order-field">
                          <label>Effective Date:</label>
                          <span>{formatDate(order.effectiveDate)}</span>
                        </div>
                        <div className="order-field">
                          <label>Created Date:</label>
                          <span>{formatDate(order.createdDate)}</span>
                        </div>
                      </div>

                      {/* Orchestration Status */}
                      {renderOrchestrationStatus(order.id)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Order Items Popup */}
      {showOrderItemsPopup && hoveredOrderId && (
        <OrderItemsPopup
          orderId={hoveredOrderId}
          position={popupPosition}
          onClose={handlePopupClose}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        />
      )}
    </div>
  );
};

export default OMTab;