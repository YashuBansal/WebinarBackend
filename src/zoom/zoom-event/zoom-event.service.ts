import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  ZoomMeetingEvent,
  ZoomMeetingEventDocument,
} from '../schemas/zoom-meeting-event.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ZoomEventDto } from '../dto/zoom-event.dto';
import { ZoomMeetingEventType } from '../schemas/zoom-meeting-event.schema';
import { ZoomService } from '../zoom.service';

interface ParticipantAttendeeData {
  fullNames?: string[];
  phones?: string[];
  tags?: string[];
  locations?: string[];
  sources?: string[];
  timeInSession?: number;
  attendedWebinarCount?: number;
  registeredWebinarCount?: number;
}

export interface ParticipantDto {
  participantId?: string;
  participantUserId?: string;
  participantEmail?: string;
  participantName?: string;
  lastJoinAt?: string;
  lastLeftAt?: string;
  onlineDuration?: number; // Duration in seconds
  attendeeData?: ParticipantAttendeeData | null;
}

export interface MeetingStatusResponseDto {
  meetingId: string;
  accountId: string | null;
  meetingStartedAt: string | null;
  meetingEndedAt: string | null;
  isOngoing: boolean;
  counts: {
    online: number;
    joinedButLeft: number;
    totalUniqueParticipants: number;
    totalJoins: number;
    totalNotJoined: number;
    totalRegistrations: number;
  };
  participants: {
    online: ParticipantDto[];
    left: ParticipantDto[];
    notJoined: ParticipantDto[];
  };
}

@Injectable()
export class ZoomEventService {
  constructor(
    @InjectModel(ZoomMeetingEvent.name)
    private readonly zoomMeetingEventModel: Model<ZoomMeetingEventDocument>,
    @Inject(forwardRef(() => ZoomService))
    private readonly zoomService: ZoomService,
  ) {}

  async createMeetingEvent(meetingEvent: ZoomEventDto) {
    return this.zoomMeetingEventModel.create(meetingEvent);
  }

  async getMeetingStatus({
    adminId,
    zoomProjectId,
    meetingId,
    accountId,
    isWebinar,
    occurrenceId,
  }: {
    adminId: Types.ObjectId;
    zoomProjectId: Types.ObjectId;
    meetingId: string;
    accountId?: string;
    isWebinar: boolean;
    occurrenceId?: string;
  }): Promise<MeetingStatusResponseDto> {
    const query: Record<string, any> = { meetingId };
    if (accountId) {
      query.accountId = accountId;
    }
    if (occurrenceId) {
      query.occurrenceId = occurrenceId;
    }

    const AllUniqueParticipantEmails = new Set<string>();

    const [events, registrants] = await Promise.all([
      this.zoomMeetingEventModel.find(query).sort({ createdAt: 1 }).lean().exec(),
      this.zoomService.getAllMeetingRegistrantsOnly({
        adminId,
        zoomProjectId,
        meetingId,
        isWebinar,
        occurrenceId,
      }),
    ]);

    // Collect emails from participant-related events
    for (const event of events) {
      if (
        event.eventType === ZoomMeetingEventType.ParticipantJoined ||
        event.eventType === ZoomMeetingEventType.ParticipantLeft
      ) {
        const email = event.participantEmail;
        if (email) {
          AllUniqueParticipantEmails.add(email);
        }
      }
    }

    // Collect emails from registrants
    if (Array.isArray(registrants?.registrants)) {
      for (const registrant of registrants.registrants) {
        const email = registrant.email || registrant.registrant_email;
        if (email) {
          AllUniqueParticipantEmails.add(email);
        }
      }
    }

    const allUniqueParticipantEmails = Array.from(AllUniqueParticipantEmails);

    const attendeesData = await this.zoomService.fetchGroupedAttendees(adminId, allUniqueParticipantEmails);

    // Helper function to transform attendee data to ParticipantAttendeeData format
    const transformAttendeeData = (attendee: any): ParticipantAttendeeData | null => {
      if (!attendee) return null;
      return {
        fullNames: attendee.fullNames || undefined,
        phones: attendee.phones || undefined,
        tags: attendee.tags || undefined,
        locations: attendee.locations || undefined,
        sources: attendee.sources || undefined,
        timeInSession: attendee.timeInSession || undefined,
        attendedWebinarCount: attendee.attendedWebinarCount || undefined,
        registeredWebinarCount: attendee.registeredWebinarCount || undefined,
      };
    };

    // Map attendees by email (lowercase) for easy lookup
    const attendeesDataMapByEmail = new Map<string, any>();
    if (Array.isArray(attendeesData?.data)) {
      for (const attendee of attendeesData.data) {
        const email = attendee._id?.toLowerCase();
        if (email) {
          attendeesDataMapByEmail.set(email, attendee);
        }
      }
    }


    type ParticipantState = {
      participantId?: string;
      participantUserId?: string;
      participantEmail?: string;
      participantName?: string;
      joinCount: number;
      lastJoinAt?: Date;
      lastLeftAt?: Date;
      isOnline: boolean;
      sessions: Array<{ joinAt: Date; leaveAt?: Date }>; // Track all join-leave sessions
    };

    const participantState = new Map<string, ParticipantState>();


    let meetingStartedAt: Date | undefined;
    let meetingEndedAt: Date | undefined;

    for (let index = 0; index < events.length; index += 1) {
      const ev: any = events[index];
      const createdAt: Date | undefined = ev.createdAt
        ? new Date(ev.createdAt)
        : undefined;

      if (ev.eventType === ZoomMeetingEventType.MeetingStarted) {
        meetingStartedAt = createdAt ?? meetingStartedAt;
      } else if (ev.eventType === ZoomMeetingEventType.MeetingEnded) {
        meetingEndedAt = createdAt ?? meetingEndedAt;
      }

      if (
        ev.eventType !== ZoomMeetingEventType.ParticipantJoined &&
        ev.eventType !== ZoomMeetingEventType.ParticipantLeft
      ) {
        continue;
      }

      const key =
        ev.participantEmail ||
        ev.participantUserId ||
        ev.participantId ||
        ev.participantName ||
        `unknown:${index}`;
      const existing = participantState.get(key);
      const state: ParticipantState = existing ?? {
        participantId: ev.participantId,
        participantUserId: ev.participantUserId,
        participantEmail: ev.participantEmail,
        participantName: ev.participantName,
        joinCount: 0,
        isOnline: false,
        sessions: [],
      };

      // refresh known fields if available
      state.participantId = state.participantId || ev.participantId;
      state.participantUserId = state.participantUserId || ev.participantUserId;
      state.participantEmail = state.participantEmail || ev.participantEmail;
      state.participantName = state.participantName || ev.participantName;

      if (ev.eventType === ZoomMeetingEventType.ParticipantJoined) {
        if (!createdAt) {
          participantState.set(key, state);
          continue;
        }
        state.joinCount += 1;
        state.isOnline = true;
        state.lastJoinAt = createdAt;
        // Start a new session
        state.sessions.push({ joinAt: createdAt });
      } else if (ev.eventType === ZoomMeetingEventType.ParticipantLeft) {
        if (!createdAt) {
          participantState.set(key, state);
          continue;
        }
        state.isOnline = false;
        state.lastLeftAt = createdAt;
        // Close the most recent open session
        const openSession = state.sessions.find((s) => !s.leaveAt);
        if (openSession) {
          openSession.leaveAt = createdAt;
        } else if (state.sessions.length > 0) {
          // If no open session but we have sessions, add a new one with leave time
          // This handles edge cases where leave comes before join in the data
          const lastSession = state.sessions[state.sessions.length - 1];
          if (lastSession && !lastSession.leaveAt && createdAt > lastSession.joinAt) {
            lastSession.leaveAt = createdAt;
          }
        }
      }

      participantState.set(key, state);
    }

    let onlineCount = 0;
    let joinedButLeftCount = 0;
    const onlineParticipants: ParticipantDto[] = [];
    const leftParticipants: ParticipantDto[] = [];

    // Get current time or meeting end time for duration calculation
    const now = new Date();
    const endTime = meetingEndedAt || now;

    for (const state of participantState.values()) {
      const participantEmail = (state.participantEmail || '').toLowerCase();
      const attendee = participantEmail
        ? attendeesDataMapByEmail.get(participantEmail)
        : null;
      const attendeeData = transformAttendeeData(attendee);

      if (state.isOnline) {
        onlineCount += 1;
        
        // Calculate online duration: from lastJoinAt to current time (or meeting end time)
        let onlineDuration: number | undefined = undefined;
        if (state.lastJoinAt) {
          const durationMs = endTime.getTime() - state.lastJoinAt.getTime();
          // Only set duration if it's positive (join time is valid and before end time)
          if (durationMs > 0) {
            onlineDuration = Math.floor(durationMs / 1000); // Convert to seconds
          }
        }

        onlineParticipants.push({
          participantId: state.participantId,
          participantUserId: state.participantUserId,
          participantEmail: state.participantEmail,
          participantName: state.participantName,
          lastJoinAt: state.lastJoinAt
            ? state.lastJoinAt.toISOString()
            : undefined,
          onlineDuration,
          attendeeData,
        });
      } else if (state.joinCount > 0) {
        joinedButLeftCount += 1;
        
        // Close any remaining open sessions using lastLeftAt or meeting end time
        if (state.lastLeftAt) {
          for (const session of state.sessions) {
            if (session.joinAt && !session.leaveAt) {
              session.leaveAt = state.lastLeftAt;
            }
          }
        } else {
          // If no lastLeftAt but participant is offline, use meeting end or current time
          const fallbackLeaveTime = meetingEndedAt || now;
          for (const session of state.sessions) {
            if (session.joinAt && !session.leaveAt) {
              session.leaveAt = fallbackLeaveTime;
            }
          }
        }
        
        // Calculate total online duration by summing all complete sessions
        let totalOnlineDuration: number | undefined = undefined;
        if (state.sessions.length > 0) {
          let totalSeconds = 0;
          for (const session of state.sessions) {
            if (session.joinAt && session.leaveAt) {
              // Complete session: join to leave
              const durationMs = session.leaveAt.getTime() - session.joinAt.getTime();
              if (durationMs > 0) {
                totalSeconds += Math.floor(durationMs / 1000);
              }
            }
            // Skip incomplete sessions (shouldn't happen after closing above, but safe guard)
          }
          if (totalSeconds > 0) {
            totalOnlineDuration = totalSeconds;
          }
        }

        leftParticipants.push({
          participantId: state.participantId,
          participantUserId: state.participantUserId,
          participantEmail: state.participantEmail,
          participantName: state.participantName,
          lastLeftAt: state.lastLeftAt
            ? state.lastLeftAt.toISOString()
            : undefined,
          lastJoinAt: state.lastJoinAt
            ? state.lastJoinAt.toISOString()
            : undefined,
          onlineDuration: totalOnlineDuration,
          attendeeData,
        });
      }
    }

    const totalUniqueParticipants = participantState.size;
    const totalJoins = Array.from(participantState.values()).reduce(
      (sum, p) => sum + p.joinCount,
      0,
    );
    const registrantsArray = Array.isArray(registrants?.registrants)
      ? registrants?.registrants
      : [];

    const participantEmails = new Set(
      [...(onlineParticipants || []), ...(leftParticipants || [])]
        .map((p) => (p.participantEmail || '').toLowerCase())
        .filter(Boolean),
    );

    const registrantParticipants: ParticipantDto[] = registrantsArray.map(
      (r: any): ParticipantDto => {
        const email = (r.email || r.registrant_email || '').toLowerCase();
        const attendee = email ? attendeesDataMapByEmail.get(email) : null;
        const attendeeData = transformAttendeeData(attendee) || (r.attendeeData ?? null);

        return {
          participantId: r.id || r.registrant_id,
          participantUserId: r.user_id,
          participantEmail: r.email || r.registrant_email,
          participantName:
            r.name ||
            [r.first_name, r.last_name].filter(Boolean).join(' ').trim() ||
            r.email ||
            r.registrant_email,
          attendeeData,
        };
      },
    );

    const notJoined = registrantParticipants.filter((p) => {
      const email = (p.participantEmail || '').toLowerCase();
      return email && !participantEmails.has(email);
    });

    return {
      meetingId,
      accountId: accountId ?? null,
      meetingStartedAt: meetingStartedAt
        ? meetingStartedAt.toISOString()
        : null,
      meetingEndedAt: meetingEndedAt ? meetingEndedAt.toISOString() : null,
      isOngoing: !!meetingStartedAt && !meetingEndedAt,
      counts: {
        online: onlineCount,
        joinedButLeft: joinedButLeftCount,
        totalUniqueParticipants,
        totalJoins,
        totalNotJoined: notJoined.length,
        totalRegistrations: registrantParticipants.length,
      },
      participants: {
        online: onlineParticipants,
        left: leftParticipants,
        notJoined,
      },
    };
  }

  async getMeetingEventsByMeetingId(meetingId: string, occurrenceId?: string) {
    const filter: Record<string, any> = { meetingId };
    if (occurrenceId) {
      filter.occurrenceId = occurrenceId;
    }

    return this.zoomMeetingEventModel
      .find(filter)
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }
}
