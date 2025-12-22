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
  }) {
    const query: Record<string, any> = { meetingId };
    if (accountId) {
      query.accountId = accountId;
    }
    if (occurrenceId) {
      query.occurrenceId = occurrenceId;
    }

    const events = await this.zoomMeetingEventModel
      .find(query)
      .sort({ createdAt: 1 })
      .lean()
      .exec();

    type ParticipantState = {
      participantId?: string;
      participantUserId?: string;
      participantEmail?: string;
      participantName?: string;
      joinCount: number;
      lastJoinAt?: Date;
      lastLeftAt?: Date;
      isOnline: boolean;
    };

    const participantState = new Map<string, ParticipantState>();

    const registrants = await this.zoomService.getAllMeetingRegistrants(
      {
        adminId,
        zoomProjectId,
        meetingId,
        isWebinar,
        occurrenceId,
      }
    );

    let meetingStartedAt: Date | undefined;
    let meetingEndedAt: Date | undefined;

    for (const ev of events as any[]) {
      if (ev.eventType === ZoomMeetingEventType.MeetingStarted) {
        meetingStartedAt = ev.createdAt ?? meetingStartedAt;
      } else if (ev.eventType === ZoomMeetingEventType.MeetingEnded) {
        meetingEndedAt = ev.createdAt ?? meetingEndedAt;
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
        `unknown:${Math.random()}`;
      const existing = participantState.get(key);
      const state: ParticipantState = existing ?? {
        participantId: ev.participantId,
        participantUserId: ev.participantUserId,
        participantEmail: ev.participantEmail,
        participantName: ev.participantName,
        joinCount: 0,
        isOnline: false,
      };

      // refresh known fields if available
      state.participantId = state.participantId || ev.participantId;
      state.participantUserId = state.participantUserId || ev.participantUserId;
      state.participantEmail = state.participantEmail || ev.participantEmail;
      state.participantName = state.participantName || ev.participantName;

      if (ev.eventType === ZoomMeetingEventType.ParticipantJoined) {
        state.joinCount += 1;
        state.isOnline = true;
        state.lastJoinAt = ev.createdAt;
      } else if (ev.eventType === ZoomMeetingEventType.ParticipantLeft) {
        state.isOnline = false;
        state.lastLeftAt = ev.createdAt;
      }

      participantState.set(key, state);
    }

    let onlineCount = 0;
    let joinedButLeftCount = 0;
    const onlineParticipants: any[] = [];
    const leftParticipants: any[] = [];

    for (const state of participantState.values()) {
      if (state.isOnline) {
        onlineCount += 1;
        onlineParticipants.push({
          participantId: state.participantId,
          participantUserId: state.participantUserId,
          participantEmail: state.participantEmail,
          participantName: state.participantName,
          lastJoinAt: state.lastJoinAt,
        });
      } else if (state.joinCount > 0) {
        joinedButLeftCount += 1;
        leftParticipants.push({
          participantId: state.participantId,
          participantUserId: state.participantUserId,
          participantEmail: state.participantEmail,
          participantName: state.participantName,
          lastLeftAt: state.lastLeftAt,
          lastJoinAt: state.lastJoinAt,
        });
      }
    }

    const totalUniqueParticipants = participantState.size;
    const totalJoins = Array.from(participantState.values()).reduce(
      (sum, p) => sum + p.joinCount,
      0,
    );
    const registrantsArray = Array.isArray(registrants?.registrants) ? registrants?.registrants : [];

    const participantEmails = new Set([
      ...(onlineParticipants || []).map((p: any) => (p.participantEmail || '').toLowerCase()).filter(Boolean),
      ...(leftParticipants || []).map((p: any) => (p.participantEmail || '').toLowerCase()).filter(Boolean),
    ])
    const notJoined = registrantsArray.filter((r: any) => {
      const email = (r.email || r.registrant_email || '').toLowerCase()
      return email && !participantEmails.has(email)
    })

    return {
      meetingId,
      accountId: accountId ?? null,
      meetingStartedAt: meetingStartedAt ?? null,
      meetingEndedAt: meetingEndedAt ?? null,
      isOngoing: !!meetingStartedAt && !meetingEndedAt,
      counts: {
        online: onlineCount,
        joinedButLeft: joinedButLeftCount,
        totalUniqueParticipants,
        totalJoins,
        totalNotJoined: notJoined.length,
        totalRegistrations: registrantsArray.length,
      },
      participants: {
        online: onlineParticipants,
        left: leftParticipants,
        notJoined,
      },
    };
  }

  async getMeetingEventsByMeetingId(
    meetingId: string,
    occurrenceId?: string,
  ) {
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
