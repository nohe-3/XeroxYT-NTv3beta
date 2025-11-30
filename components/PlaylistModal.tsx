
import React, { useState } from 'react';
import { usePlaylist } from '../contexts/PlaylistContext';
import type { Video } from '../types';
import { CloseIcon, AddToPlaylistIcon } from './icons/Icons';

interface PlaylistModalProps {
    isOpen: boolean;
    onClose: () => void;
    video: Video;
}

const PlaylistModal: React.FC<PlaylistModalProps> = ({ isOpen, onClose, video }) => {
    const { playlists, createPlaylist, addVideoToPlaylist, removeVideoFromPlaylist, getPlaylistsContainingVideo } = usePlaylist();
    const [newPlaylistName, setNewPlaylistName] = useState('');
    const [showNewPlaylistInput, setShowNewPlaylistInput] = useState(false);

    if (!isOpen) return null;
    
    const playlistsWithVideo = getPlaylistsContainingVideo(video.id);

    const handlePlaylistToggle = (playlistId: string, isChecked: boolean) => {
        if (isChecked) {
            addVideoToPlaylist(playlistId, video.id);
        } else {
            removeVideoFromPlaylist(playlistId, video.id);
        }
    };
    
    const handleCreatePlaylist = () => {
        if (newPlaylistName.trim()) {
            // FIX: createPlaylist expects an array of video IDs. Wrapped video.id in an array.
            createPlaylist(newPlaylistName.trim(), [video.id]);
            setNewPlaylistName('');
            setShowNewPlaylistInput(false);
        }
    };

    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 animate-fade-in"
            onClick={onClose}
        >
            <div 
                className="bg-yt-white dark:bg-yt-light-black w-full max-w-sm rounded-xl shadow-xl p-4 flex flex-col border border-yt-spec-light-20 dark:border-yt-spec-20 animate-scale-in"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-black dark:text-white">再生リストに保存...</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-yt-spec-light-10 dark:hover:bg-yt-spec-20">
                        <CloseIcon />
                    </button>
                </div>
                
                <div className="max-h-60 overflow-y-auto mb-4 border-y border-yt-spec-light-20 dark:border-yt-spec-20">
                    {playlists.length > 0 ? (
                        playlists.map(playlist => (
                            <label key={playlist.id} className="flex items-center p-3 hover:bg-yt-spec-light-10 dark:hover:bg-yt-spec-10 cursor-pointer">
                                <input 
                                    type="checkbox"
                                    className="w-6 h-6 accent-yt-blue bg-transparent border-yt-light-gray rounded"
                                    checked={playlistsWithVideo.includes(playlist.id)}
                                    onChange={e => handlePlaylistToggle(playlist.id, e.target.checked)}
                                />
                                <span className="ml-4 text-black dark:text-white text-base">{playlist.name}</span>
                            </label>
                        ))
                    ) : (
                        <p className="text-yt-light-gray text-center p-4">作成された再生リストはありません。</p>
                    )}
                </div>
                
                <div className="pt-2">
                    {showNewPlaylistInput ? (
                        <div>
                            <input
                                type="text"
                                value={newPlaylistName}
                                onChange={(e) => setNewPlaylistName(e.target.value)}
                                placeholder="新しい再生リストのタイトル"
                                className="w-full bg-transparent border-b-2 border-yt-gray focus:border-yt-blue dark:focus:border-yt-blue outline-none px-1 py-1 mb-3 text-black dark:text-white"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleCreatePlaylist()}
                            />
                            <div className="text-right">
                                <button
                                    onClick={handleCreatePlaylist}
                                    className="text-yt-blue font-semibold px-4 py-2 rounded-full hover:bg-yt-blue/20 disabled:text-yt-light-gray disabled:hover:bg-transparent"
                                    disabled={!newPlaylistName.trim()}
                                >
                                    作成
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button 
                            onClick={() => setShowNewPlaylistInput(true)} 
                            className="flex items-center p-3 rounded-md hover:bg-yt-spec-light-10 dark:hover:bg-yt-spec-10 w-full"
                        >
                            <AddToPlaylistIcon />
                            <span className="ml-4 text-black dark:text-white font-semibold">新しい再生リストを作成</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PlaylistModal;