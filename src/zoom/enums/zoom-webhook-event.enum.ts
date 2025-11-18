// Canonical list of Zoom webhook event names we handle
// Reference: https://developers.zoom.us/docs/api/rest/webhook-events/

export enum ZoomWebhookEvent {
  MeetingParticipantJoined = 'meeting.participant_joined',
  MeetingParticipantLeft = 'meeting.participant_left',
  MeetingStarted = 'meeting.started',
  MeetingEnded = 'meeting.ended',
  MeetingRegistrationCreated = 'meeting.registration_created',
  WebinarRegistrationCreated = 'webinar.registration_created',
  WebinarStarted = 'webinar.started',
  WebinarEnded = 'webinar.ended',
  WebinarParticipantJoined = 'webinar.participant_joined',
  WebinarParticipantLeft = 'webinar.participant_left',
  MeetingCreated = 'meeting.created',
  WebinarCreated = 'webinar.created',
}

export default ZoomWebhookEvent;


