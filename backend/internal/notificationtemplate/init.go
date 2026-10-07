// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package notificationtemplate

import (
	"fmt"
	"net/http"

	"github.com/thunder-id/thunderid/internal/system/cache"
	serverconst "github.com/thunder-id/thunderid/internal/system/constants"
	"github.com/thunder-id/thunderid/internal/system/database/provider"
	"github.com/thunder-id/thunderid/internal/system/middleware"
)

// Initialize wires the store, service, handler, and runtime renderer, and registers HTTP routes.
// The selected store is wrapped with a read cache for the runtime hot path.
func Initialize(mux *http.ServeMux, cacheManager cache.CacheManagerInterface,
	translation translationResolver) (NotificationTemplateServiceInterface, TemplateRendererInterface, error) {
	transactioner, err := provider.GetDBProvider().GetConfigDBTransactioner()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get config database transactioner: %w", err)
	}

	inner, err := selectStore()
	if err != nil {
		return nil, nil, err
	}

	byHandle := cache.GetCache[templateDAO](cacheManager, "NotificationTemplateByHandleCache")
	store := newCacheBackedStore(byHandle, inner)

	service := newNotificationTemplateService(store, transactioner)
	handler := newNotificationTemplateHandler(service)
	registerRoutes(mux, handler)

	templateRenderer := newTemplateRenderer(store, translation)

	return service, templateRenderer, nil
}

// selectStore builds the store for the configured mode, loading declared templates at startup.
func selectStore() (notificationTemplateStoreInterface, error) {
	switch getStoreMode() {
	case serverconst.StoreModeDeclarative:
		fileStore := newFileStore()
		if err := loadDeclarativeTemplates(fileStore); err != nil {
			return nil, err
		}
		return fileStore, nil
	case serverconst.StoreModeComposite:
		fileStore := newFileStore()
		if err := loadDeclarativeTemplates(fileStore); err != nil {
			return nil, err
		}
		return newCompositeStore(fileStore, newNotificationTemplateStore()), nil
	default:
		return newNotificationTemplateStore(), nil
	}
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
