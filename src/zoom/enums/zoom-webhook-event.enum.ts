// Canonical list of Zoom webhook event names we handle
// Reference: https://developers.zoom.us/docs/api/rest/webhook-events/

export enum ZoomWebhookEvent {
  MeetingParticipantJoined = 'meeting.participant_joined',
  MeetingParticipantLeft = 'meeting.participant_left',
  MeetingStarted = 'meeting.started',
  MeetingEnded = 'meeting.ended',
  MeetingRegistrationCreated = 'meeting.registration_created',
}

export default ZoomWebhookEvent;


