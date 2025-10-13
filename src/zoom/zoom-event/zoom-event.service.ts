import { Injectable } from '@nestjs/common';
import { ZoomMeetingEvent, ZoomMeetingEventDocument } from '../schemas/zoom-meeting-event.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ZoomEventDto } from '../dto/zoom-event.dto';
import { ZoomMeetingEventType } from '../schemas/zoom-meeting-event.schema';

@Injectable()
export class ZoomEventService {
  constructor(
    @InjectModel(ZoomMeetingEvent.name) private readonly zoomMeetingEventModel: Model<ZoomMeetingEventDocument>,
  ) { }


  async createMeetingEvent(meetingEvent: ZoomEventDto) {
    return this.zoomMeetingEventModel.create(meetingEvent);
  }

  async getMeetingStatus(meetingId: string, accountId?: string) {
    const query: Record<string, any> = { meetingId };
    if (accountId) {
      query.accountId = accountId;
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

    let meetingStartedAt: Date | undefined;
    let meetingEndedAt: Date | undefined;

    for (const ev of events as any[]) {
      if (ev.eventType === ZoomMeetingEventType.MeetingStarted) {
        meetingStartedAt = ev.createdAt ?? meetingStartedAt;
      } else if (ev.eventType === ZoomMeetingEventType.MeetingEnded) {
        meetingEndedAt = ev.createdAt ?? meetingEndedAt;
      }

      if (ev.eventType !== ZoomMeetingEventType.ParticipantJoined && ev.eventType !== ZoomMeetingEventType.ParticipantLeft) {
        continue;
      }

      const key = ev.participantEmail || ev.participantUserId || ev.participantId || ev.participantName || `unknown:${Math.random()}`;
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
    const totalJoins = Array.from(participantState.values()).reduce((sum, p) => sum + p.joinCount, 0);

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
      },
      participants: {
        online: onlineParticipants,
        left: leftParticipants,
      },
    };
  }

  async getMeetingEventsByMeetingId(meetingId: string) {
    return this.zoomMeetingEventModel
      .find({ meetingId })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

}
