
import React from 'react';
import type { Video } from '../types';
import * as ReactRouterDOM from 'react-router-dom';

const { Link } = ReactRouterDOM;

interface ShortsPlayerProps {
    video: Video;
    playerParams: string;
}

const ShortsPlayer: React.FC<ShortsPlayerProps> = ({ video, playerParams }) => {
    return (
        <div className="h-full w-full relative flex-shrink-0 bg-yt-black group">
            <iframe
                src={`https://www.youtubeeducation.com/embed/${video.id}${playerParams}`}
                title={video.title}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full pointer-events-auto"
            ></iframe>
            
            {/* Overlay Info - Appears on hover or standard behavior */}
            <div className="absolute bottom-0 left-0 right-0 p-4 text-white bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none">
                <div className="flex items-center pointer-events-auto">
                    <Link to={`/channel/${video.channelId}`} className="flex items-center flex-1">
                        <img src={video.channelAvatarUrl} alt={video.channelName} className="w-10 h-10 rounded-full border border-white/20" />
                        <span className="ml-3 font-semibold truncate drop-shadow-md">{video.channelName}</span>
                    </Link>
                    <button className="bg-white text-black font-semibold px-4 py-2 rounded-full text-sm flex-shrink-0 hover:bg-gray-200 transition-colors">
                        登録
                    </button>
                </div>
                <p className="mt-3 text-sm line-clamp-2 drop-shadow-md">{video.title}</p>
            </div>
        </div>
    );
};
export default ShortsPlayer;