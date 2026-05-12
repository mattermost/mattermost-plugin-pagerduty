package pagerduty

import (
	"encoding/json"
	"time"
)

type Schedule struct {
	ID               string           `json:"id"`
	Name             string           `json:"name"`
	Description      string           `json:"description"`
	TimeZone         string           `json:"time_zone"`
	Summary          string           `json:"summary"`
	ScheduleLayers   []ScheduleLayer  `json:"schedule_layers,omitempty"`
	OverrideSubcycle OverrideSubcycle `json:"override_subcycle,omitempty"`
	FinalSchedule    FinalSchedule    `json:"final_schedule,omitempty"`
}

// ScheduleLayerUser wraps a UserReference as returned by the PagerDuty API
// in the schedule_layers[].users array: [{"user": {"id": "...", ...}}]
type ScheduleLayerUser struct {
	User UserReference `json:"user"`
}

type ScheduleLayer struct {
	ID                        string              `json:"id"`
	Name                      string              `json:"name"`
	Start                     time.Time           `json:"start"`
	End                       *time.Time          `json:"end"`
	RotationVirtualStart      time.Time           `json:"rotation_virtual_start"`
	RotationTurnLengthSeconds int                 `json:"rotation_turn_length_seconds"`
	Users                     []ScheduleLayerUser `json:"users"`
}

type OverrideSubcycle struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

type FinalSchedule struct {
	Name                    string                  `json:"name"`
	RenderedScheduleEntries []RenderedScheduleEntry `json:"rendered_schedule_entries"`
}

type ScheduleEntry struct {
	User  UserReference `json:"user"`
	Start time.Time     `json:"start"`
	End   time.Time     `json:"end"`
}

type UserReference struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Summary string `json:"summary"`
}

type User struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Email          string          `json:"email"`
	Type           string          `json:"type"`
	Summary        string          `json:"summary"`
	Description    string          `json:"description"`
	Role           string          `json:"role"`
	TimeZone       string          `json:"time_zone"`
	Color          string          `json:"color"`
	AvatarURL      string          `json:"avatar_url"`
	ContactMethods []ContactMethod `json:"contact_methods,omitempty"`
}

type ContactMethod struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Summary string `json:"summary"`
	Label   string `json:"label"`
	Address string `json:"address"`
}

type OnCall struct {
	User             User              `json:"user"`
	Schedule         Schedule          `json:"schedule"`
	EscalationPolicy *EscalationPolicy `json:"escalation_policy,omitempty"`
	EscalationLevel  int               `json:"escalation_level"`
	Start            string            `json:"start"`
	End              string            `json:"end"`
}

type EscalationPolicy struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	NumLoops    int    `json:"num_loops"`
}

type ListResponse struct {
	Limit  int  `json:"limit"`
	Offset int  `json:"offset"`
	More   bool `json:"more"`
	Total  int  `json:"total"`
}

type SchedulesResponse struct {
	ListResponse
	Schedules []Schedule `json:"schedules"`
}

type OnCallsResponse struct {
	ListResponse
	OnCalls []OnCall `json:"oncalls"`
}

type ErrorResponse struct {
	Error struct {
		Message string   `json:"message"`
		Code    int      `json:"code"`
		Errors  []string `json:"errors"`
	} `json:"error"`
}

// ScheduleResponse wraps a single schedule with details
type ScheduleResponse struct {
	Schedule ScheduleDetail `json:"schedule"`
}

// ScheduleDetail extends Schedule with additional fields for single schedule response
type ScheduleDetail struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Description      string            `json:"description"`
	TimeZone         string            `json:"time_zone"`
	Summary          string            `json:"summary"`
	ScheduleLayers   []ScheduleLayer   `json:"schedule_layers,omitempty"`
	OverrideSubcycle *OverrideSubcycle `json:"override_subcycle,omitempty"`
	FinalSchedule    *FinalSchedule    `json:"final_schedule,omitempty"`
}

// RenderedScheduleEntry represents a schedule entry with user details
type RenderedScheduleEntry struct {
	User  User   `json:"user"`
	Start string `json:"start"`
	End   string `json:"end"`
}

// EscalationPolicyReference represents a reference to an escalation policy on a service
type EscalationPolicyReference struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Summary string `json:"summary,omitempty"`
}

// Service represents a PagerDuty service
type Service struct {
	ID               string                     `json:"id"`
	Name             string                     `json:"name"`
	Description      string                     `json:"description"`
	Type             string                     `json:"type"`
	Summary          string                     `json:"summary"`
	Status           string                     `json:"status"`
	EscalationPolicy *EscalationPolicyReference `json:"escalation_policy,omitempty"`
}

// ServicesResponse wraps the services list response
type ServicesResponse struct {
	ListResponse
	Services []Service `json:"services"`
}

// ServiceReference represents a reference to a service
type ServiceReference struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Summary string `json:"summary,omitempty"`
}

// AssigneeReference represents a reference to an assignee
type AssigneeReference struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

// Assignment represents an incident assignment
type Assignment struct {
	Assignee AssigneeReference `json:"assignee"`
}

// Priority represents a PagerDuty incident priority
type Priority struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Summary string `json:"summary"`
}

// Incident represents a PagerDuty incident
type Incident struct {
	ID          string           `json:"id"`
	Type        string           `json:"type"`
	Title       string           `json:"title"`
	Description string           `json:"description,omitempty"`
	Service     ServiceReference `json:"service"`
	Assignments []Assignment     `json:"assignments,omitempty"`
	Status      string           `json:"status,omitempty"`
	Urgency     string           `json:"urgency,omitempty"`
	Priority    *Priority        `json:"priority,omitempty"`
	CreatedAt   string           `json:"created_at,omitempty"`
	IncidentKey string           `json:"incident_key,omitempty"`
	HTMLURL     string           `json:"html_url,omitempty"`
}

// CreateIncidentRequest represents the request to create an incident
type CreateIncidentRequest struct {
	Incident Incident `json:"incident"`
}

// CreateIncidentResponse wraps the incident creation response
type CreateIncidentResponse struct {
	Incident Incident `json:"incident"`
}

// IncidentsResponse wraps the incidents list response from PagerDuty
type IncidentsResponse struct {
	ListResponse
	Incidents []Incident `json:"incidents"`
}

// IncidentResponse wraps a single incident response
type IncidentResponse struct {
	Incident Incident `json:"incident"`
}

// UpdateIncidentRequest represents the request to update an incident
type UpdateIncidentRequest struct {
	Incident UpdateIncidentBody `json:"incident"`
}

// UpdateIncidentBody contains the fields that can be updated on an incident
type UpdateIncidentBody struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

// IncidentNote represents a note on a PagerDuty incident
type IncidentNote struct {
	ID        string        `json:"id"`
	Content   string        `json:"content"`
	CreatedAt string        `json:"created_at"`
	User      UserReference `json:"user"`
}

// IncidentNotesResponse wraps the list of notes for an incident
type IncidentNotesResponse struct {
	Notes []IncidentNote `json:"notes"`
}

// CreateIncidentNoteRequest represents the request body for creating a note
type CreateIncidentNoteRequest struct {
	Note CreateIncidentNoteBody `json:"note"`
}

// CreateIncidentNoteBody contains the note content
type CreateIncidentNoteBody struct {
	Content string `json:"content"`
}

// CreateIncidentNoteResponse wraps the note creation response
type CreateIncidentNoteResponse struct {
	Note IncidentNote `json:"note"`
}

// UserResponse wraps a single user response from PagerDuty
type UserResponse struct {
	User User `json:"user"`
}

// UsersResponse wraps the users list response from PagerDuty
type UsersResponse struct {
	ListResponse
	Users []User `json:"users"`
}

// Override represents a PagerDuty schedule override
type Override struct {
	ID    string        `json:"id,omitempty"`
	Start string        `json:"start"`
	End   string        `json:"end"`
	User  UserReference `json:"user"`
}

// CreateOverrideRequest represents the request to create a schedule override
type CreateOverrideRequest struct {
	Override Override `json:"override"`
}

// OverrideResponse wraps a single override response
type OverrideResponse struct {
	Override Override `json:"override"`
}

// --- Webhook V3 Types ---

// WebhookPayload is the top-level structure of a PagerDuty V3 webhook event.
type WebhookPayload struct {
	Event WebhookEvent `json:"event"`
}

// WebhookEvent represents a single event in a PagerDuty V3 webhook payload.
type WebhookEvent struct {
	ID           string          `json:"id"`
	EventType    string          `json:"event_type"`
	ResourceType string          `json:"resource_type"`
	OccurredAt   string          `json:"occurred_at"`
	Data         json.RawMessage `json:"data"`
}

// WebhookIncidentData is the data payload for incident-related webhook events.
type WebhookIncidentData struct {
	ID          string           `json:"id"`
	Type        string           `json:"type"`
	Self        string           `json:"self"`
	HTMLURL     string           `json:"html_url"`
	Number      int              `json:"number"`
	Status      string           `json:"status"`
	Title       string           `json:"title"`
	Urgency     string           `json:"urgency"`
	Service     ServiceReference `json:"service"`
	Assignees   []UserReference  `json:"assignees"`
	Priority    *Priority        `json:"priority"`
	CreatedAt   string           `json:"created_at"`
	Description string           `json:"description"`
}

// --- Webhook Subscription Management Types ---

// WebhookSubscriptionRequest is the request body for creating a webhook subscription.
type WebhookSubscriptionRequest struct {
	WebhookSubscription WebhookSubscriptionBody `json:"webhook_subscription"`
}

// WebhookSubscriptionBody describes the webhook subscription to create.
type WebhookSubscriptionBody struct {
	Type           string                `json:"type"`
	DeliveryMethod WebhookDeliveryMethod `json:"delivery_method"`
	Events         []string              `json:"events"`
	Filter         WebhookFilter         `json:"filter"`
	Description    string                `json:"description"`
}

// WebhookDeliveryMethod describes how to deliver webhook events.
type WebhookDeliveryMethod struct {
	Type          string          `json:"type"`
	URL           string          `json:"url"`
	CustomHeaders []WebhookHeader `json:"custom_headers,omitempty"`
	Secret        string          `json:"secret,omitempty"`
}

// WebhookFilter scopes which events are sent to the webhook.
type WebhookFilter struct {
	Type string `json:"type"`
	ID   string `json:"id,omitempty"`
}

// WebhookHeader is a custom header to include in webhook deliveries.
type WebhookHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// WebhookSubscriptionResponse wraps the response from creating a webhook subscription.
type WebhookSubscriptionResponse struct {
	WebhookSubscription WebhookSubscriptionResult `json:"webhook_subscription"`
}

// WebhookSubscriptionsListResponse wraps the list of webhook subscriptions.
type WebhookSubscriptionsListResponse struct {
	WebhookSubscriptions []WebhookSubscriptionResult `json:"webhook_subscriptions"`
}

// WebhookSubscriptionResult is the response representation of a webhook subscription.
type WebhookSubscriptionResult struct {
	ID             string                `json:"id"`
	Type           string                `json:"type"`
	DeliveryMethod WebhookDeliveryMethod `json:"delivery_method"`
	Events         []string              `json:"events"`
	Filter         WebhookFilter         `json:"filter"`
	Active         bool                  `json:"active"`
	Description    string                `json:"description"`
}
