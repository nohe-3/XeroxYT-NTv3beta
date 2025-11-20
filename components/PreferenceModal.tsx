
import React, { useState } from 'react';
import { CloseIcon, TrashIcon } from './icons/Icons';
import { usePreference } from '../contexts/PreferenceContext';

interface PreferenceModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const PreferenceModal: React.FC<PreferenceModalProps> = ({ isOpen, onClose }) => {
    const { preferredGenres, preferredChannels, addPreferredGenre, removePreferredGenre, addPreferredChannel, removePreferredChannel } = usePreference();
    const [genreInput, setGenreInput] = useState('');
    const [channelInput, setChannelInput] = useState('');

    if (!isOpen) return null;

    const handleAddGenre = (e: React.FormEvent) => {
        e.preventDefault();
        if (genreInput.trim()) {
            addPreferredGenre(genreInput.trim());
            setGenreInput('');
        }
    };

    const handleAddChannel = (e: React.FormEvent) => {
        e.preventDefault();
        if (channelInput.trim()) {
            addPreferredChannel(channelInput.trim());
            setChannelInput('');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onClose}>
            <div className="bg-yt-white dark:bg-yt-light-black w-full max-w-md rounded-xl shadow-xl p-6 m-4" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-black dark:text-white">おすすめの精度を上げる</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-yt-spec-light-10 dark:hover:bg-yt-spec-10">
                        <CloseIcon />
                    </button>
                </div>

                <div className="space-y-6">
                    {/* Genres */}
                    <div>
                        <h3 className="text-sm font-semibold text-yt-light-gray mb-2">好きなジャンル・キーワード</h3>
                        <form onSubmit={handleAddGenre} className="flex gap-2 mb-3">
                            <input
                                type="text"
                                value={genreInput}
                                onChange={(e) => setGenreInput(e.target.value)}
                                placeholder="例: ゲーム, 料理, 猫"
                                className="flex-1 bg-yt-light dark:bg-yt-black border border-yt-spec-light-20 dark:border-yt-spec-20 rounded-lg px-3 py-2 text-black dark:text-white focus:border-yt-blue outline-none"
                            />
                            <button type="submit" className="bg-yt-blue text-white px-4 py-2 rounded-lg font-medium hover:opacity-90">追加</button>
                        </form>
                        <div className="flex flex-wrap gap-2">
                            {preferredGenres.map((genre, idx) => (
                                <span key={idx} className="inline-flex items-center bg-yt-spec-light-10 dark:bg-yt-spec-10 px-3 py-1 rounded-full text-sm text-black dark:text-white">
                                    {genre}
                                    <button onClick={() => removePreferredGenre(genre)} className="ml-2 text-yt-light-gray hover:text-yt-red">
                                        <CloseIcon />
                                    </button>
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Channels */}
                    <div>
                        <h3 className="text-sm font-semibold text-yt-light-gray mb-2">よく見るチャンネル名</h3>
                        <form onSubmit={handleAddChannel} className="flex gap-2 mb-3">
                            <input
                                type="text"
                                value={channelInput}
                                onChange={(e) => setChannelInput(e.target.value)}
                                placeholder="例: HIKAKIN"
                                className="flex-1 bg-yt-light dark:bg-yt-black border border-yt-spec-light-20 dark:border-yt-spec-20 rounded-lg px-3 py-2 text-black dark:text-white focus:border-yt-blue outline-none"
                            />
                            <button type="submit" className="bg-yt-blue text-white px-4 py-2 rounded-lg font-medium hover:opacity-90">追加</button>
                        </form>
                        <div className="flex flex-wrap gap-2">
                            {preferredChannels.map((channel, idx) => (
                                <span key={idx} className="inline-flex items-center bg-yt-spec-light-10 dark:bg-yt-spec-10 px-3 py-1 rounded-full text-sm text-black dark:text-white">
                                    {channel}
                                    <button onClick={() => removePreferredChannel(channel)} className="ml-2 text-yt-light-gray hover:text-yt-red">
                                        <CloseIcon />
                                    </button>
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="bg-yt-spec-light-10 dark:bg-yt-spec-10 p-4 rounded-lg text-sm text-yt-light-gray">
                        <p>ここで設定した情報は、ホーム画面のおすすめ動画や、検索結果の精度向上に使用されます。深い分析アルゴリズムにより、あなたの好みに合った動画が表示されやすくなります。</p>
                    </div>
                </div>
                
                <div className="mt-6 flex justify-end">
                    <button onClick={onClose} className="text-yt-blue font-semibold px-4 py-2 hover:bg-yt-blue/10 rounded-full">
                        完了
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PreferenceModal;
