import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import { extractKeywords } from '../utils/xrai';

interface PreferenceContextType {
  ngKeywords: string[];
  ngChannels: string[];
  hiddenVideoIds: string[]; // Session-based or persistent hidden videos
  negativeKeywords: Map<string, number>; // For XRAI filtering
  
  addNgKeyword: (keyword: string) => void;
  removeNgKeyword: (keyword: string) => void;
  
  addNgChannel: (channelId: string) => void;
  removeNgChannel: (channelId: string) => void;
  isNgChannel: (channelId: string) => boolean;

  addHiddenVideo: (videoId: string, analyzeContent?: { title: string, channelName: string }) => void;
  isvideoHidden: (videoId: string) => boolean;

  exportUserData: () => void;
  importUserData: (file: File) => Promise<void>;
}

const PreferenceContext = createContext<PreferenceContextType | undefined>(undefined);

export const PreferenceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // NG Settings
  const [ngKeywords, setNgKeywords] = useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem('ngKeywords') || '[]'); } catch { return []; }
  });
  const [ngChannels, setNgChannels] = useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem('ngChannels') || '[]'); } catch { return []; }
  });
  
  // Hidden Videos (Session + Persistence)
  const [hiddenVideoIds, setHiddenVideoIds] = useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem('hiddenVideoIds') || '[]'); } catch { return []; }
  });

  // Negative Profile for XRAI (In-memory for session mostly, or simple persistence)
  const [negativeKeywords, setNegativeKeywords] = useState<Map<string, number>>(() => {
     try {
         const raw = JSON.parse(window.localStorage.getItem('negativeKeywords') || '[]');
         return new Map(raw);
     } catch { return new Map(); }
  });

  // Persistence
  useEffect(() => { localStorage.setItem('ngKeywords', JSON.stringify(ngKeywords)); }, [ngKeywords]);
  useEffect(() => { localStorage.setItem('ngChannels', JSON.stringify(ngChannels)); }, [ngChannels]);
  useEffect(() => { localStorage.setItem('hiddenVideoIds', JSON.stringify(hiddenVideoIds)); }, [hiddenVideoIds]);
  useEffect(() => { 
      localStorage.setItem('negativeKeywords', JSON.stringify(Array.from(negativeKeywords.entries()))); 
  }, [negativeKeywords]);

  // Handlers
  const addNgKeyword = (k: string) => !ngKeywords.includes(k) && setNgKeywords(p => [...p, k]);
  const removeNgKeyword = (k: string) => setNgKeywords(p => p.filter(x => x !== k));
  const addNgChannel = (id: string) => !ngChannels.includes(id) && setNgChannels(p => [...p, id]);
  const removeNgChannel = (id: string) => setNgChannels(p => p.filter(x => x !== id));
  const isNgChannel = (id: string) => ngChannels.includes(id);

  const addHiddenVideo = (videoId: string, analyzeContent?: { title: string, channelName: string }) => {
      if (!hiddenVideoIds.includes(videoId)) {
          setHiddenVideoIds(prev => [...prev, videoId]);
      }
      
      // XRAI Negative Analysis
      if (analyzeContent) {
          const keywords = [
              ...extractKeywords(analyzeContent.title),
              ...extractKeywords(analyzeContent.channelName)
          ];
          
          setNegativeKeywords(prev => {
              const newMap = new Map<string, number>(prev);
              keywords.forEach(k => {
                  const current = newMap.get(k);
                  // Ensure current is treated as a number
                  newMap.set(k, (typeof current === 'number' ? current : 0) + 1);
              });
              return newMap;
          });
      }
  };

  const isvideoHidden = (videoId: string) => hiddenVideoIds.includes(videoId);

  // Import/Export Logic
  const exportUserData = () => {
    const data = {
      timestamp: new Date().toISOString(),
      version: '2.1',
      subscriptions: JSON.parse(localStorage.getItem('subscribedChannels') || '[]'),
      history: JSON.parse(localStorage.getItem('videoHistory') || '[]'),
      playlists: JSON.parse(localStorage.getItem('playlists') || '[]'),
      preferences: {
        ngKeywords,
        ngChannels,
        hiddenVideoIds
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xeroxyt_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importUserData = async (file: File) => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target?.result as string);
          if (!json.subscriptions || !json.history) {
            throw new Error('Invalid backup file format');
          }
          
          // Restore Data
          localStorage.setItem('subscribedChannels', JSON.stringify(json.subscriptions));
          localStorage.setItem('videoHistory', JSON.stringify(json.history));
          localStorage.setItem('playlists', JSON.stringify(json.playlists || []));
          
          if (json.preferences) {
            const p = json.preferences;
            localStorage.setItem('ngKeywords', JSON.stringify(p.ngKeywords || []));
            localStorage.setItem('ngChannels', JSON.stringify(p.ngChannels || []));
            localStorage.setItem('hiddenVideoIds', JSON.stringify(p.hiddenVideoIds || []));
          }

          // Refresh to load new data into contexts
          window.location.reload();
          resolve();
        } catch (err) {
          console.error(err);
          alert('ファイルの読み込みに失敗しました。正しいバックアップファイルを選択してください。');
          reject(err);
        }
      };
      reader.readAsText(file);
    });
  };

  return (
    <PreferenceContext.Provider value={{
      ngKeywords, ngChannels, hiddenVideoIds, negativeKeywords,
      addNgKeyword, removeNgKeyword, addNgChannel, removeNgChannel, isNgChannel,
      addHiddenVideo, isvideoHidden,
      exportUserData, importUserData
    }}>
      {children}
    </PreferenceContext.Provider>
  );
};

export const usePreference = (): PreferenceContextType => {
  const context = useContext(PreferenceContext);
  if (context === undefined) {
    throw new Error('usePreference must be used within a PreferenceProvider');
  }
  return context;
};