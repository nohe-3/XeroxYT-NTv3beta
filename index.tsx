
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SubscriptionProvider } from './contexts/SubscriptionContext';
import { PlaylistProvider } from './contexts/PlaylistContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { SearchHistoryProvider } from './contexts/SearchHistoryContext';
import { HistoryProvider } from './contexts/HistoryContext';
import { PreferenceProvider } from './contexts/PreferenceContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <SubscriptionProvider>
        <PlaylistProvider>
          <NotificationProvider>
            <SearchHistoryProvider>
              <HistoryProvider>
                <PreferenceProvider>
                  <App />
                </PreferenceProvider>
              </HistoryProvider>
            </SearchHistoryProvider>
          </NotificationProvider>
        </PlaylistProvider>
      </SubscriptionProvider>
    </BrowserRouter>
  </React.StrictMode>
);
