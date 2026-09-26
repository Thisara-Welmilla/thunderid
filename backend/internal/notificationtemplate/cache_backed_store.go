// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"context"

	"github.com/thunder-id/thunderid/internal/system/cache"
	"github.com/thunder-id/thunderid/internal/system/log"
)

const cacheBackedStoreLoggerComponentName = "CacheBackedNotificationTemplateStore"

// cacheBackedStore wraps a notificationTemplateStoreInterface with an in-memory cache for single
// template reads (the hot path for the runtime provider). Only GetTemplate is cached; list and the
// name-uniqueness check always hit the inner store. Resolved output is never cached — translations and
// branding vary per locale/app and are resolved per send.
//
// Writes deliberately do NOT populate the cache: the service calls them inside a DB transaction, so
// caching there would publish uncommitted (and possibly rolled-back) rows. Instead the service calls
// invalidate() after the transaction commits, so a rollback simply leaves a reloadable miss.
type cacheBackedStore struct {
	byID  cache.CacheInterface[templateDAO]
	inner notificationTemplateStoreInterface
}

// newCacheBackedStore wraps inner with the given by-id cache.
func newCacheBackedStore(byID cache.CacheInterface[templateDAO],
	inner notificationTemplateStoreInterface) notificationTemplateStoreInterface {
	return &cacheBackedStore{byID: byID, inner: inner}
}

// cacheKey builds the by-id cache key. Templates are addressed by (channel, id); the store scopes by
// deployment, and the cache lives in a single deployment's process.
func cacheKey(channel, id string) cache.CacheKey {
	return cache.CacheKey{Key: channel + ":" + id}
}

// CreateTemplate delegates without caching (see the type doc: writes run in a transaction).
func (s *cacheBackedStore) CreateTemplate(ctx context.Context, t templateDAO) error {
	return s.inner.CreateTemplate(ctx, t)
}

// GetTemplate serves from cache on a hit, otherwise loads from the inner store and caches the result.
func (s *cacheBackedStore) GetTemplate(ctx context.Context, channel, id string) (templateDAO, error) {
	if cached, ok := s.byID.Get(ctx, cacheKey(channel, id)); ok {
		return cached, nil
	}
	dao, err := s.inner.GetTemplate(ctx, channel, id)
	if err != nil {
		return dao, err
	}
	s.set(ctx, dao)
	return dao, nil
}

// ListTemplates always delegates; the list is not cached.
func (s *cacheBackedStore) ListTemplates(ctx context.Context, channel string) ([]templateDAO, error) {
	return s.inner.ListTemplates(ctx, channel)
}

// UpdateTemplate delegates without caching; the service invalidates after commit.
func (s *cacheBackedStore) UpdateTemplate(ctx context.Context, t templateDAO) error {
	return s.inner.UpdateTemplate(ctx, t)
}

// DeleteTemplate delegates without caching; the service invalidates after commit.
func (s *cacheBackedStore) DeleteTemplate(ctx context.Context, channel, id string) error {
	return s.inner.DeleteTemplate(ctx, channel, id)
}

// IsNameExists always delegates; uniqueness must be checked against the source of truth.
func (s *cacheBackedStore) IsNameExists(ctx context.Context, channel, name, excludeID string) (bool, error) {
	return s.inner.IsNameExists(ctx, channel, name, excludeID)
}

// invalidate removes a template's cache entry. It is called by the service after a write commits, so a
// stale or rolled-back entry is never served. Implements the cacheInvalidator interface.
func (s *cacheBackedStore) invalidate(ctx context.Context, channel, id string) {
	if err := s.byID.Delete(ctx, cacheKey(channel, id)); err != nil {
		s.logger().Error(ctx, "Failed to invalidate template cache", log.String("id", id), log.Error(err))
	}
}

// set caches a template by its (channel, id), logging on failure without failing the operation.
func (s *cacheBackedStore) set(ctx context.Context, t templateDAO) {
	if t.ID == "" {
		return
	}
	if err := s.byID.Set(ctx, cacheKey(t.Channel, t.ID), t); err != nil {
		s.logger().Error(ctx, "Failed to cache template", log.String("id", t.ID), log.Error(err))
	}
}

func (s *cacheBackedStore) logger() *log.Logger {
	return log.GetLogger().With(log.String(log.LoggerKeyComponentName, cacheBackedStoreLoggerComponentName))
}
