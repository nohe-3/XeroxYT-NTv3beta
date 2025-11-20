
import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';

interface PreferenceContextType {
  preferredGenres: string[];
  preferredChannels: string[];
  addPreferredGenre: (genre: string) => void;
  removePreferredGenre: (genre: string) => void;
  addPreferredChannel: (channel: string) => void;
  removePreferredChannel: (channel: string) => void;
}

const PreferenceContext = createContext<PreferenceContextType | undefined>(undefined);

export const PreferenceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [preferredGenres, setPreferredGenres] = useState<string[]>(() => {
    try {
      const item = window.localStorage.getItem('preferredGenres');
      return item ? JSON.parse(item) : [];
    } catch (error) {
      return [];
    }
  });

  const [preferredChannels, setPreferredChannels] = useState<string[]>(() => {
    try {
      const item = window.localStorage.getItem('preferredChannels');
      return item ? JSON.parse(item) : [];
    } catch (error) {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('preferredGenres', JSON.stringify(preferredGenres));
  }, [preferredGenres]);

  useEffect(() => {
    localStorage.setItem('preferredChannels', JSON.stringify(preferredChannels));
  }, [preferredChannels]);

  const addPreferredGenre = (genre: string) => {
    if (!preferredGenres.includes(genre)) {
      setPreferredGenres(prev => [...prev, genre]);
    }
  };

  const removePreferredGenre = (genre: string) => {
    setPreferredGenres(prev => prev.filter(g => g !== genre));
  };

  const addPreferredChannel = (channel: string) => {
    if (!preferredChannels.includes(channel)) {
      setPreferredChannels(prev => [...prev, channel]);
    }
  };

  const removePreferredChannel = (channel: string) => {
    setPreferredChannels(prev => prev.filter(c => c !== channel));
  };

  return (
    <PreferenceContext.Provider value={{
      preferredGenres,
      preferredChannels,
      addPreferredGenre,
      removePreferredGenre,
      addPreferredChannel,
      removePreferredChannel
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
