package infra

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

// NewRedis creates and validates a go-redis client connection.
// Retries up to 10 times with linear backoff (2s, 4s, …, 20s) to
// tolerate Redis starting slower than the backend (Docker startup order).
func NewRedis(redisURL string) (*redis.Client, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}

	rdb := redis.NewClient(opts)

	const maxRetries = 10
	for i := 0; i < maxRetries; i++ {
		if pingErr := rdb.Ping(context.Background()).Err(); pingErr == nil {
			log.Info().Int("attempt", i+1).Msg("redis connected")
			return rdb, nil
		}
		wait := time.Duration(i+1) * 2 * time.Second
		log.Warn().Int("attempt", i+1).Dur("retry_in", wait).Msg("redis not ready, retrying…")
		time.Sleep(wait)
	}

	return nil, fmt.Errorf("failed to connect to redis after %d attempts", maxRetries)
}
