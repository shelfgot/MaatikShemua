"""In-memory model caching for Kraken models."""
from typing import Any, Optional
from threading import Lock
import time

from app.core.logging import logger


class ModelCache:
    """Thread-safe LRU cache for loaded Kraken models."""
    
    def __init__(self, max_size: int = 5, ttl_seconds: int = 3600):
        self._cache: dict[str, tuple[Any, float]] = {}
        self._lock = Lock()
        self._max_size = max_size
        self._ttl = ttl_seconds
    
    def get(self, path: str) -> Optional[Any]:
        """Get model from cache if exists and not expired."""
        with self._lock:
            if path in self._cache:
                model, loaded_at = self._cache[path]
                if time.time() - loaded_at < self._ttl:
                    # Move to end (most recently used)
                    self._cache[path] = (model, time.time())
                    logger.debug("model_cache_hit", path=path)
                    return model
                else:
                    del self._cache[path]
                    logger.debug("model_cache_expired", path=path)
            return None
    
    def put(self, path: str, model: Any):
        """Add model to cache, evicting oldest if at capacity."""
        with self._lock:
            # Evict oldest if at capacity
            if len(self._cache) >= self._max_size and path not in self._cache:
                oldest = min(self._cache.keys(), key=lambda k: self._cache[k][1])
                del self._cache[oldest]
                logger.debug("model_cache_evicted", path=oldest)
            
            self._cache[path] = (model, time.time())
            logger.debug("model_cache_stored", path=path)
    
    def clear(self):
        """Clear all cached models."""
        with self._lock:
            self._cache.clear()
            logger.info("model_cache_cleared")
    
    def size(self) -> int:
        """Get number of cached models."""
        with self._lock:
            return len(self._cache)


# Global instance
model_cache = ModelCache()
