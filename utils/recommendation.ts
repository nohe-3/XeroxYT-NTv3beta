import type { Video, Channel } from '../types';
import { searchVideos, getRecommendedVideos } from './api';
import { extractKeywords } from './xrai';

// --- Types ---

interface RecommendationSource {
    searchHistory: string[];
    watchHistory: Video[];
    subscribedChannels: Channel[];
    ngKeywords: string[];
    ngChannels: string[];
    hiddenVideoIds: string[];
    negativeKeywords: Map<string, number>;
    page: number;
}

// --- Helpers ---

const shuffleArray = <T,>(array: T[]): T[] => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
};

// Helper to clean up titles for better search queries
const cleanTitleForSearch = (title: string): string => {
    // Remove common noise like brackets, official, etc.
    return title.replace(/【.*?】|\[.*?\]|\(.*?\)/g, '').trim().split(' ').slice(0, 4).join(' ');
};

/**
 * XRAI: Random History-Based Recommendation Engine (v2.1)
 * 
 * Logic:
 * 1. Seeds from History/Subs.
 * 2. Search candidates.
 * 3. 1% Trending Injection (Japan popular videos).
 * 4. Strict Filtering (Keywords).
 * 5. Negative Filtering (Based on "Not Interested").
 */
export const getXraiRecommendations = async (sources: RecommendationSource): Promise<Video[]> => {
    const { 
        watchHistory, 
        subscribedChannels,
        ngKeywords,
        ngChannels,
        hiddenVideoIds,
        negativeKeywords
    } = sources;

    // --- 1. SEED SELECTION ---
    let seeds: string[] = [];
    
    if (watchHistory.length > 0) {
        // Pick 10 random videos from history
        const historySample = shuffleArray(watchHistory).slice(0, 10);
        seeds = historySample.map(v => `${cleanTitleForSearch(v.title)} related`);
    } else if (subscribedChannels.length > 0) {
        // Fallback to subscriptions if no history
        const subSample = shuffleArray(subscribedChannels).slice(0, 5);
        seeds = subSample.map(c => `${c.name} videos`);
    } else {
        // Cold start
        seeds = ["Trending Japan", "Popular Music", "Gaming", "Cooking", "Vlog"];
    }

    // --- 2. CANDIDATE GENERATION (High Volume) ---
    // Fetch results for ALL seeds concurrently
    const searchPromises = seeds.map(query => 
        searchVideos(query, '1').then(res => res.videos).catch(() => [])
    );
    
    // Also fetch trending videos for the 1% injection
    const trendingPromise = getRecommendedVideos().then(res => res.videos).catch(() => []);

    const [nestedResults, trendingVideos] = await Promise.all([
        Promise.all(searchPromises),
        trendingPromise
    ]);
    
    let candidates = nestedResults.flat();
    
    // --- 3. 1% TRENDING INJECTION ---
    // Inject ~1% trending videos (approx 1 for every 100 candidates, or just ensure a few are present)
    // To guarantee visibility, we append 2-3 trending videos to the candidate list
    if (trendingVideos.length > 0) {
        const selectedTrending = shuffleArray(trendingVideos).slice(0, 3);
        candidates.push(...selectedTrending);
    }

    // Deduplicate
    const seenIds = new Set<string>(hiddenVideoIds); // Also filter out hidden IDs immediately
    candidates = candidates.filter(v => {
        if (seenIds.has(v.id)) return false;
        seenIds.add(v.id);
        return true;
    });

    // --- 4. STRICT POSITIVE FILTERING (Relevance Check) ---
    // If we have history, only show videos that match keywords from history.
    if (watchHistory.length > 0) {
        const historyKeywords = new Set<string>();
        watchHistory.slice(0, 50).forEach(v => {
            extractKeywords(v.title).forEach(k => historyKeywords.add(k));
            extractKeywords(v.channelName).forEach(k => historyKeywords.add(k));
        });
        subscribedChannels.forEach(c => {
            extractKeywords(c.name).forEach(k => historyKeywords.add(k));
        });

        // FILTER: Candidate must have at least one overlapping keyword with history (OR be one of the injected trending videos)
        candidates = candidates.filter(candidate => {
            // Allow trending videos to bypass this check partially, or check if they are contained in the injected set
            // For simplicity, we re-check relevance but allow "Trending" keywords if cold start
            const titleKeywords = extractKeywords(candidate.title);
            const channelKeywords = extractKeywords(candidate.channelName);
            
            const isRelevant = [...titleKeywords, ...channelKeywords].some(k => historyKeywords.has(k));
            
            // Bypass strict filter for the injected trending videos (check ID presence in trending list)
            const isTrendingInjection = trendingVideos.some(tv => tv.id === candidate.id);
            
            return isRelevant || isTrendingInjection;
        });
    }

    // --- 5. NEGATIVE FILTERING (Safety & "Not Interested") ---
    candidates = candidates.filter(v => {
        const fullText = `${v.title} ${v.channelName}`.toLowerCase();
        
        // Manual NG
        if (ngKeywords.some(ng => fullText.includes(ng.toLowerCase()))) return false;
        if (ngChannels.includes(v.channelId)) return false;

        // XRAI Negative Analysis (Dynamic NG)
        // If the video contains too many keywords found in "Not Interested" set
        const vKeywords = [...extractKeywords(v.title), ...extractKeywords(v.channelName)];
        let negativeScore = 0;
        vKeywords.forEach(k => {
            if (negativeKeywords.has(k)) {
                negativeScore += (negativeKeywords.get(k) || 0);
            }
        });
        
        // Threshold: If strictly negative signal is strong (e.g., score > 2), filter out
        if (negativeScore > 2) return false;

        return true;
    });

    // --- 6. SHUFFLING ---
    return shuffleArray(candidates);
};