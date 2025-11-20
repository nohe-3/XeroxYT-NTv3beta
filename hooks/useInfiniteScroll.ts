
import { useRef, useCallback } from 'react';

export const useInfiniteScroll = (callback: () => void, hasMore: boolean, isLoading: boolean) => {
    const observer = useRef<IntersectionObserver | null>(null);
    
    const lastElementRef = useCallback((node: HTMLDivElement | null) => {
        if (isLoading) return;
        if (observer.current) observer.current.disconnect();
        
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasMore) {
                callback();
            }
        }, {
            rootMargin: '200px', // 少し早めに読み込む
        });
        
        if (node) observer.current.observe(node);
    }, [callback, hasMore, isLoading]);
    
    return lastElementRef;
};
