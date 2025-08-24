import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import PlatformEventsTab from './PlatformEventsTab';
import SObjectsTab from './SObjectsTab';
import OMTab from './OMTab';
import './Dashboard.css';

const Dashboard = ({ user, onLogout }) => {
  const [activeTab, setActiveTab] = useState('platform-events');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  const socketRef = useRef(null);

  // Initialize socket connection (shared across tabs)
  useEffect(() => {
    console.log('🔄 Initializing WebSocket connection...');
    
    // Prevent multiple connections
    if (socketRef.current) {
      console.log('⚠️ Socket already exists, cleaning up first...');
      socketRef.current.disconnect();
      socketRef.current.removeAllListeners();
    }
    
    // Use environment-appropriate URL
    const socketUrl = process.env.NODE_ENV === 'production' ? window.location.origin : 'http://localhost:5000';
    
    socketRef.current = io(socketUrl, {
      withCredentials: true,
      transports: ['websocket', 'polling'] // Fallback for production
    });

    console.log('🔌 WebSocket connection created');

    socketRef.current.on('connect', () => {
      console.log('✅ Connected to server at:', socketUrl);
      setConnectionStatus('connected');
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('❌ Disconnected from server. Reason:', reason);
      setConnectionStatus('disconnected');
    });

    socketRef.current.on('connect_error', (error) => {
      console.error('🚫 Connection error:', error);
      setConnectionStatus('disconnected');
    });

    console.log('🎧 Event listeners registered');

    // Cleanup on unmount
    return () => {
      console.log('🧹 Cleaning up WebSocket connection...');
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout', {}, {
        withCredentials: true
      });
      onLogout();
    } catch (error) {
      console.error('Logout error:', error);
      onLogout(); // Logout anyway
    }
  };

  // Tab navigation
  const tabs = [
    { id: 'platform-events', label: 'Explore Platform Events', icon: '📨' },
    { id: 'sobjects', label: 'Explore SObjects', icon: '🗃️' },
    { id: 'om', label: 'Explore OM', icon: '⚙️' }
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'platform-events':
        return (
          <PlatformEventsTab 
            socketRef={socketRef}
            connectionStatus={connectionStatus}
          />
        );
      case 'sobjects':
        return <SObjectsTab />;
      case 'om':
        return <OMTab />;
      default:
        return <div>Tab not found</div>;
    }
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>🔗 Salesforce Explorer</h1>
          <div className="header-info">
            <span className={`connection-status ${connectionStatus}`}>
              {connectionStatus === 'connected' ? '🟢' : '🔴'} {connectionStatus}
            </span>
            <span className="org-info">
              📊 {user.orgType} ({user.organizationId})
            </span>
            <button onClick={handleLogout} className="logout-btn">
              🚪 Logout
            </button>
          </div>
        </div>
      </header>

      <div className="tabs-container">
        <div className="tabs-nav">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{tab.label}</span>
            </button>
          ))}
        </div>
        
        <div className="tab-content-container">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;