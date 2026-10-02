// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"context"

	"github.com/thunder-id/thunderid/internal/system/cache"
	"github.com/thunder-id/thunderid/internal/system/log"
)

// cacheBackedStore wraps a notificationTemplateStoreInterface with an in-memory cache for single
// template reads (the hot path for the runtime provider). Only GetTemplate is cached; list and the
// name-uniqueness check always hit the inner store. Resolved output is never cached — translations and
// branding vary per locale/app and are resolved per send.
//
// Writes invalidate (never re-cache) the affected entry, mirroring the idp cache-backed store: caching a
// value written inside the service's transaction could publish an uncommitted, possibly rolled-back row,
// so a rollback simply leaves a reloadable miss. Invalidation lives here in the store, not in the
// service, so cache coherence is fully owned by the decorator.
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

// CreateTemplate delegates to the inner store. Nothing is cached: reads populate the cache lazily, and
// a new id has no stale entry to clear.
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

// UpdateTemplate delegates then invalidates the cached entry (invalidate, not re-cache: the write runs
// inside the service's transaction, so caching the new value here could publish an uncommitted row).
func (s *cacheBackedStore) UpdateTemplate(ctx context.Context, t templateDAO) error {
	if err := s.inner.UpdateTemplate(ctx, t); err != nil {
		return err
	}
	s.invalidate(ctx, t.Channel, t.ID)
	return nil
}

// DeleteTemplate delegates then invalidates the cached entry.
func (s *cacheBackedStore) DeleteTemplate(ctx context.Context, channel, id string) error {
	if err := s.inner.DeleteTemplate(ctx, channel, id); err != nil {
		return err
	}
	s.invalidate(ctx, channel, id)
	return nil
}

// IsNameExists always delegates; uniqueness must be checked against the source of truth.
func (s *cacheBackedStore) IsNameExists(ctx context.Context, channel, name, excludeID string) (bool, error) {
	return s.inner.IsNameExists(ctx, channel, name, excludeID)
}

// invalidate removes a template's cache entry, logging on failure without failing the operation.
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
	return log.GetLogger().With(log.String(log.LoggerKeyComponentName, "CacheBackedNotificationTemplateStore"))
}
