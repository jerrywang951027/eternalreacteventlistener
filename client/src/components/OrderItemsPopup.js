import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './OrderItemsPopup.css';

const OrderItemsPopup = ({ orderId, position, onClose, onMouseEnter, onMouseLeave }) => {
  const [orderItems, setOrderItems] = useState([]);
  const [groupedItems, setGroupedItems] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (orderId) {
      fetchOrderItems();
    }
  }, [orderId]);

  // Handle escape key to close popup
  useEffect(() => {
    const handleEscapeKey = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [onClose]);

  const fetchOrderItems = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await axios.get(`/api/orders/${orderId}/items`, {
        withCredentials: true
      });

      if (response.data.success) {
        const items = response.data.orderItems;
        setOrderItems(items);
        const grouped = groupItemsByParentChild(items);
        setGroupedItems(grouped);
      } else {
        setError(response.data.message || 'Failed to fetch order items');
      }
    } catch (error) {
      console.error('Error fetching order items:', error);
      setError(error.response?.data?.message || 'Failed to load order items');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    if (amount === null || amount === undefined) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const formatQuantity = (quantity) => {
    if (quantity === null || quantity === undefined) return '0';
    return quantity.toString();
  };

  // Group items by parent-child relationship using correct field mapping
  const groupItemsByParentChild = (items) => {
    const parentItems = items.filter(item => !item.parentItemId);
    const childItems = items.filter(item => item.parentItemId);
    
    // Create a map of parent items with their children
    // Parent's assetReferenceId matches child's parentItemId
    const grouped = parentItems.map(parent => {
      const children = childItems.filter(child => child.parentItemId === parent.assetReferenceId);
      return {
        ...parent,
        children: children
      };
    });
    
    // Add standalone items (items with no parent and no children)
    const standaloneItems = items.filter(item => 
      !item.parentItemId && 
      !childItems.some(child => child.parentItemId === item.assetReferenceId)
    );
    
    return [...grouped, ...standaloneItems.map(item => ({ ...item, children: [] }))];
  };

  const toggleGroupExpansion = (parentId) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(parentId)) {
        newSet.delete(parentId);
      } else {
        newSet.add(parentId);
      }
      return newSet;
    });
  };

  // Calculate popup position to stay within viewport
  const getPopupStyle = () => {
    const popupWidth = 400;
    const popupHeight = Math.min(orderItems.length * 120 + 100, 500); // Estimate height
    
    let left = position.x - popupWidth / 2;
    let top = position.y - popupHeight - 10; // Show above by default
    
    // Adjust horizontal position if popup would go off-screen
    if (left < 10) left = 10;
    if (left + popupWidth > window.innerWidth - 10) {
      left = window.innerWidth - popupWidth - 10;
    }
    
    // Adjust vertical position if popup would go off-screen
    if (top < 10) {
      top = position.y + 10; // Show below instead
    }
    
    return {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      width: `${popupWidth}px`,
      zIndex: 10000
    };
  };

  return (
    <div className="order-items-popup-overlay">
      <div 
        className="order-items-popup" 
        style={getPopupStyle()}
        onMouseEnter={(e) => {
          // Ensure this event doesn't get cancelled by child elements
          if (onMouseEnter) onMouseEnter(e);
        }}
        onMouseLeave={(e) => {
          // Only trigger if we're actually leaving the popup entirely
          if (!e.currentTarget.contains(e.relatedTarget)) {
            if (onMouseLeave) onMouseLeave(e);
          }
        }}
      >
        <div className="popup-header">
          <h4>📦 Order Items</h4>
          <button 
            className="popup-close-btn" 
            onClick={onClose}
            title="Close popup"
          >
            ✕
          </button>
        </div>

        <div className="popup-content">
          {loading && (
            <div className="popup-loading">
              <span className="loading-spinner">🔄</span>
              <span>Loading order items...</span>
            </div>
          )}

          {error && (
            <div className="popup-error">
              <span>⚠️ {error}</span>
            </div>
          )}

          {!loading && !error && orderItems.length === 0 && (
            <div className="popup-no-items">
              <span>📭 No order items found</span>
            </div>
          )}

          {!loading && !error && orderItems.length > 0 && (
            <div className="order-items-list">
              {groupedItems.map((group, index) => (
                <div key={group.id} className="order-item-group">
                  {/* Parent Item or Standalone Item */}
                  <div 
                    className={`order-item-card ${group.children.length > 0 ? 'parent-item' : ''}`}
                    onMouseEnter={(e) => {
                      // Don't propagate mouse events from item cards
                      e.stopPropagation();
                    }}
                    onMouseLeave={(e) => {
                      // Don't propagate mouse events from item cards
                      e.stopPropagation();
                    }}
                  >
                    <div className="item-header">
                      {group.children.length > 0 && (
                        <button
                          className={`accordion-toggle ${expandedGroups.has(group.id) ? 'expanded' : 'collapsed'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            toggleGroupExpansion(group.id);
                          }}
                          title={expandedGroups.has(group.id) ? 'Collapse children' : 'Expand children'}
                        >
                          {expandedGroups.has(group.id) ? '▼' : '▶'}
                        </button>
                      )}
                      <div className="product-name" title={group.productName}>
                        {group.productName}
                        {group.children.length > 0 && (
                          <span className="children-count">({group.children.length} items)</span>
                        )}
                      </div>
                      <div className="item-quantity">
                        Qty: {formatQuantity(group.quantity)}
                      </div>
                    </div>
                    
                    <div className="item-pricing">
                      <div className="pricing-row">
                        <span className="pricing-label">One-time:</span>
                        <span className="pricing-value one-time">
                          {formatCurrency(group.oneTimeCharge)}
                        </span>
                      </div>
                      <div className="pricing-row">
                        <span className="pricing-label">Recurring:</span>
                        <span className="pricing-value recurring">
                          {formatCurrency(group.recurringCharge)}
                        </span>
                      </div>
                    </div>

                    {group.description && (
                      <div className="item-description" title={group.description}>
                        {group.description}
                      </div>
                    )}
                  </div>

                                        {/* Child Items */}
                      {group.children.length > 0 && expandedGroups.has(group.id) && (
                        <div className="child-items">
                          {group.children.map((child) => (
                            <div 
                              key={child.id} 
                              className="order-item-card child-item"
                              onMouseEnter={(e) => {
                                // Don't propagate mouse events from child item cards
                                e.stopPropagation();
                              }}
                              onMouseLeave={(e) => {
                                // Don't propagate mouse events from child item cards
                                e.stopPropagation();
                              }}
                            >
                          <div className="item-header">
                            <div className="product-name" title={child.productName}>
                              {child.productName}
                            </div>
                            <div className="item-quantity">
                              Qty: {formatQuantity(child.quantity)}
                            </div>
                          </div>
                          
                          <div className="item-pricing">
                            <div className="pricing-row">
                              <span className="pricing-label">One-time:</span>
                              <span className="pricing-value one-time">
                                {formatCurrency(child.oneTimeCharge)}
                              </span>
                            </div>
                            <div className="pricing-row">
                              <span className="pricing-label">Recurring:</span>
                              <span className="pricing-value recurring">
                                {formatCurrency(child.recurringCharge)}
                              </span>
                            </div>
                          </div>

                          {child.description && (
                            <div className="item-description" title={child.description}>
                              {child.description}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading && !error && orderItems.length > 0 && (
          <div className="popup-footer">
            <small>
              Total items: {orderItems.length}
              {groupedItems.some(g => g.children.length > 0) && 
                ` (${groupedItems.filter(g => g.children.length > 0).length} groups)`
              }
            </small>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderItemsPopup;
