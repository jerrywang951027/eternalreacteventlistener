import React from 'react';
import './UserInfoPopup.css';

const UserInfoPopup = ({ user, visible, position }) => {
  if (!visible || !user) return null;

  const formatOrgUrl = (instanceUrl) => {
    if (!instanceUrl) return 'N/A';
    try {
      const url = new URL(instanceUrl);
      return url.hostname;
    } catch {
      return instanceUrl;
    }
  };

  return (
    <div 
      className="user-info-popup" 
      style={{
        top: position.y - 10,
        right: position.x,
        position: 'absolute',
        zIndex: 10000
      }}
    >
      <div className="user-info-content">
        <div className="user-info-header">
          <div className="user-avatar">🤖</div>
          <div className="user-title">User Information</div>
        </div>
        
        <div className="user-info-details">
          <div className="user-info-item">
            <span className="label">Name:</span>
            <span className="value">{user.displayName || 'N/A'}</span>
          </div>
          
          <div className="user-info-item">
            <span className="label">Username:</span>
            <span className="value">{user.username || 'N/A'}</span>
          </div>
          
          <div className="user-info-item">
            <span className="label">Email:</span>
            <span className="value">{user.email || 'N/A'}</span>
          </div>
          
          <div className="user-info-item">
            <span className="label">Org URL:</span>
            <span className="value">{formatOrgUrl(user.instanceUrl)}</span>
          </div>
          
          {user.orgName && (
            <div className="user-info-item">
              <span className="label">Org Name:</span>
              <span className="value">{user.orgName}</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Arrow pointing to logout button */}
      <div className="popup-arrow"></div>
    </div>
  );
};

export default UserInfoPopup;
