// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"fmt"
	"net/http"

	"github.com/thunder-id/thunderid/internal/system/cache"
	"github.com/thunder-id/thunderid/internal/system/database/provider"
	"github.com/thunder-id/thunderid/internal/system/middleware"
)

// templateByIDCacheName is the cache name for single-template reads.
const templateByIDCacheName = "NotificationTemplateByIDCache"

// Initialize wires the store, service, handler, and runtime provider for the notification template
// feature and registers its HTTP routes. The store is config-DB backed (mutable) and, when a cache
// manager is supplied, wrapped with an in-memory read cache. The returned TemplateProvider is the
// narrow runtime surface flow executors use to render ready-to-send notifications; i18nResolver
// resolves the templates' translation keys.
func Initialize(mux *http.ServeMux, i18nResolver translationResolver,
	cacheManager cache.CacheManagerInterface) (NotificationTemplateServiceInterface, TemplateProvider, error) {
	transactioner, err := provider.GetDBProvider().GetConfigDBTransactioner()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get config database transactioner: %w", err)
	}

	var store notificationTemplateStoreInterface = newNotificationTemplateStore()
	if cacheManager != nil {
		byID := cache.GetCache[templateDAO](cacheManager, templateByIDCacheName)
		store = newCacheBackedStore(byID, store)
	}

	service := newNotificationTemplateService(store, transactioner)
	handler := newNotificationTemplateHandler(service)
	registerRoutes(mux, handler)

	templateProvider := newTemplateProvider(store, i18nResolver)

	return service, templateProvider, nil
}

// registerRoutes registers the notification template management routes.
func registerRoutes(mux *http.ServeMux, handler *notificationTemplateHandler) {
	if mux == nil {
		return
	}

	collectionOpts := middleware.CORSOptions{
		AllowedMethods:   []string{"GET", "POST"},
		AllowedHeaders:   middleware.DefaultAllowedHeaders,
		AllowCredentials: true,
		MaxAge:           600,
	}
	mux.HandleFunc(middleware.WithCORS("GET /notification-templates/{channel}/templates",
		handler.HandleTemplateListRequest, collectionOpts))
	mux.HandleFunc(middleware.WithCORS("POST /notification-templates/{channel}/templates",
		handler.HandleTemplatePostRequest, collectionOpts))
	mux.HandleFunc(middleware.WithCORS("OPTIONS /notification-templates/{channel}/templates",
		func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }, collectionOpts))

	itemOpts := middleware.CORSOptions{
		AllowedMethods:   []string{"GET", "PUT", "DELETE"},
		AllowedHeaders:   middleware.DefaultAllowedHeaders,
		AllowCredentials: true,
		MaxAge:           600,
	}
	mux.HandleFunc(middleware.WithCORS("GET /notification-templates/{channel}/templates/{id}",
		handler.HandleTemplateGetRequest, itemOpts))
	mux.HandleFunc(middleware.WithCORS("PUT /notification-templates/{channel}/templates/{id}",
		handler.HandleTemplatePutRequest, itemOpts))
	mux.HandleFunc(middleware.WithCORS("DELETE /notification-templates/{channel}/templates/{id}",
		handler.HandleTemplateDeleteRequest, itemOpts))
	mux.HandleFunc(middleware.WithCORS("OPTIONS /notification-templates/{channel}/templates/{id}",
		func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }, itemOpts))
}
