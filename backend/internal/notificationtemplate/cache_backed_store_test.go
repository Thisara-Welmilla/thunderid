// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/thunder-id/thunderid/internal/system/cache"
)

// fakeCache is a minimal in-memory cache.CacheInterface[templateDAO] for testing the decorator. It
// embeds the interface (nil) and overrides only the three methods the decorator uses.
type fakeCache struct {
	cache.CacheInterface[templateDAO]
	m map[string]templateDAO
}

func newFakeCache() *fakeCache { return &fakeCache{m: map[string]templateDAO{}} }

func (c *fakeCache) Set(_ context.Context, key cache.CacheKey, v templateDAO) error {
	c.m[key.Key] = v
	return nil
}
func (c *fakeCache) Get(_ context.Context, key cache.CacheKey) (templateDAO, bool) {
	v, ok := c.m[key.Key]
	return v, ok
}
func (c *fakeCache) Delete(_ context.Context, key cache.CacheKey) error {
	delete(c.m, key.Key)
	return nil
}

func emailDAO(id, name string) templateDAO {
	return templateDAO{ID: id, Channel: ChannelEmail, Name: name,
		Content: TemplateContent{ContentType: ContentTypeHTML, Body: "b"}}
}

func TestCacheBackedStore_ReadThrough(t *testing.T) {
	inner := newMemStore()
	inner.templates["t1"] = emailDAO("t1", "A")
	fc := newFakeCache()
	store := newCacheBackedStore(fc, inner)
	ctx := context.Background()

	// First read is a miss → loads from inner and caches.
	got, err := store.GetTemplate(ctx, ChannelEmail, "t1")
	require.NoError(t, err)
	require.Equal(t, "A", got.Name)
	_, cached := fc.m["email:t1"]
	require.True(t, cached)

	// Remove from inner; a second read must be served from cache (hit).
	delete(inner.templates, "t1")
	got, err = store.GetTemplate(ctx, ChannelEmail, "t1")
	require.NoError(t, err)
	require.Equal(t, "A", got.Name)
}

func TestCacheBackedStore_WritesDoNotCache(t *testing.T) {
	inner := newMemStore()
	fc := newFakeCache()
	store := newCacheBackedStore(fc, inner)
	ctx := context.Background()

	// Create/Update must not populate the cache (they run inside a DB transaction).
	require.NoError(t, store.CreateTemplate(ctx, emailDAO("t1", "A")))
	require.NotContains(t, fc.m, "email:t1")

	require.NoError(t, store.UpdateTemplate(ctx, emailDAO("t1", "B")))
	require.NotContains(t, fc.m, "email:t1")
}

func TestCacheBackedStore_Invalidate(t *testing.T) {
	inner := newMemStore()
	inner.templates["t1"] = emailDAO("t1", "A")
	fc := newFakeCache()
	store := newCacheBackedStore(fc, inner)
	ctx := context.Background()

	// Populate the cache via a read.
	_, err := store.GetTemplate(ctx, ChannelEmail, "t1")
	require.NoError(t, err)
	require.Contains(t, fc.m, "email:t1")

	// invalidate() drops the entry.
	store.(cacheInvalidator).invalidate(ctx, ChannelEmail, "t1")
	require.NotContains(t, fc.m, "email:t1")
}

// TestService_UpdateInvalidatesCache verifies the after-commit path end to end: a stale cache entry is
// dropped by the service after UpdateTemplate commits, so the next read reflects the new content.
func TestService_UpdateInvalidatesCache(t *testing.T) {
	inner := newMemStore()
	fc := newFakeCache()
	store := newCacheBackedStore(fc, inner)
	svc := newNotificationTemplateService(store, inlineTransactioner{})
	ctx := context.Background()

	created, svcErr := svc.CreateTemplate(ctx, ChannelEmail, CreateTemplateRequest{
		Name: "Orig", Content: TemplateContent{Body: "b1"}})
	require.Nil(t, svcErr)

	// Warm the cache with the current content.
	_, err := store.GetTemplate(ctx, ChannelEmail, created.ID)
	require.NoError(t, err)
	require.Contains(t, fc.m, "email:"+created.ID)

	// Update through the service; the cache entry must be invalidated post-commit.
	_, svcErr = svc.UpdateTemplate(ctx, ChannelEmail, created.ID, UpdateTemplateRequest{
		Name: "Orig", Content: TemplateContent{Body: "b2"}})
	require.Nil(t, svcErr)
	require.NotContains(t, fc.m, "email:"+created.ID)

	// Next read reloads the updated content.
	got, err := store.GetTemplate(ctx, ChannelEmail, created.ID)
	require.NoError(t, err)
	require.Equal(t, "b2", got.Content.Body)
}
