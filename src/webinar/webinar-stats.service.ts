import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types } from 'mongoose';
import { Attendee } from 'src/schemas/Attendee.schema';
import { Webinar } from 'src/schemas/Webinar.schema';
import { WebinarListCacheService } from './webinar-list-cache.service';

export interface WebinarStatsBuckets {
  totalRegistrations: number;
  totalParticipants: number;
  totalAttendees: number;
}

export interface WebinarStatsDelta {
  totalRegistrations: number;
  totalParticipants: number;
  totalAttendees: number;
}

type AttendeeLike = {
  isAttended?: boolean;
  timeInSession?: number;
  isDeleted?: boolean;
  webinar?: Types.ObjectId | string;
};

@Injectable()
export class WebinarStatsService {
  private readonly logger = new Logger(WebinarStatsService.name);

  constructor(
    @InjectModel(Webinar.name) private readonly webinarModel: Model<Webinar>,
    @InjectModel(Attendee.name) private readonly attendeeModel: Model<Attendee>,
    private readonly webinarListCacheService: WebinarListCacheService,
  ) {}

  buckets(attendee: AttendeeLike): WebinarStatsBuckets {
    if (attendee?.isDeleted === true) {
      return {
        totalRegistrations: 0,
        totalParticipants: 0,
        totalAttendees: 0,
      };
    }

    const isParticipant = attendee.isAttended === true;
    const isRegistration = attendee.isAttended === false;
    const isAttendee =
      isParticipant && Number(attendee.timeInSession ?? 0) > 0;

    return {
      totalRegistrations: isRegistration ? 1 : 0,
      totalParticipants: isParticipant ? 1 : 0,
      totalAttendees: isAttendee ? 1 : 0,
    };
  }

  delta(
    before: AttendeeLike | null | undefined,
    after: AttendeeLike | null | undefined,
  ): WebinarStatsDelta {
    const beforeBuckets = before ? this.buckets(before) : this.zeroBuckets();
    const afterBuckets = after ? this.buckets(after) : this.zeroBuckets();

    return {
      totalRegistrations:
        afterBuckets.totalRegistrations - beforeBuckets.totalRegistrations,
      totalParticipants:
        afterBuckets.totalParticipants - beforeBuckets.totalParticipants,
      totalAttendees: afterBuckets.totalAttendees - beforeBuckets.totalAttendees,
    };
  }

  async applyDelta(
    webinarId: Types.ObjectId | string,
    delta: WebinarStatsDelta,
    session?: ClientSession,
  ): Promise<void> {
    if (
      delta.totalRegistrations === 0 &&
      delta.totalParticipants === 0 &&
      delta.totalAttendees === 0
    ) {
      return;
    }

    const id = new Types.ObjectId(`${webinarId}`);
    const participantsInc = delta.totalParticipants;
    const attendeesInc = delta.totalAttendees;
    const unAttendedInc = participantsInc - attendeesInc;

    await this.webinarModel.updateOne(
      { _id: id },
      [
        {
          $set: {
            totalRegistrations: {
              $max: [
                0,
                {
                  $add: [
                    { $ifNull: ['$totalRegistrations', 0] },
                    delta.totalRegistrations,
                  ],
                },
              ],
            },
            totalParticipants: {
              $max: [
                0,
                {
                  $add: [
                    { $ifNull: ['$totalParticipants', 0] },
                    participantsInc,
                  ],
                },
              ],
            },
            totalAttendees: {
              $max: [
                0,
                {
                  $add: [
                    { $ifNull: ['$totalAttendees', 0] },
                    attendeesInc,
                  ],
                },
              ],
            },
            totalUnAttended: {
              $max: [
                0,
                {
                  $add: [{ $ifNull: ['$totalUnAttended', 0] }, unAttendedInc],
                },
              ],
            },
          },
        },
      ],
      { session },
    );

    await this.invalidateListCacheForWebinar(webinarId, 'applyDelta');
  }

  async setCounts(
    webinarId: Types.ObjectId | string,
    counts: WebinarStatsBuckets,
    session?: ClientSession,
  ): Promise<void> {
    const totalUnAttended = Math.max(
      0,
      counts.totalParticipants - counts.totalAttendees,
    );

    await this.webinarModel.updateOne(
      { _id: new Types.ObjectId(`${webinarId}`) },
      {
        $set: {
          totalRegistrations: counts.totalRegistrations,
          totalParticipants: counts.totalParticipants,
          totalAttendees: counts.totalAttendees,
          totalUnAttended,
        },
      },
      { session },
    );
  }

  async computeCountsForWebinar(
    webinarId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<WebinarStatsBuckets> {
    const id = new Types.ObjectId(`${webinarId}`);
    const pipeline: PipelineStage[] = [
      {
        $match: {
          webinar: id,
          isDeleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          totalRegistrations: {
            $sum: {
              $cond: [{ $eq: ['$isAttended', false] }, 1, 0],
            },
          },
          totalParticipants: {
            $sum: {
              $cond: [{ $eq: ['$isAttended', true] }, 1, 0],
            },
          },
          totalAttendees: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isAttended', true] },
                    { $gt: ['$timeInSession', 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ];

    const agg = this.attendeeModel.aggregate(pipeline);
    if (session) {
      agg.session(session);
    }

    const [result] = await agg.exec();
    return {
      totalRegistrations: result?.totalRegistrations ?? 0,
      totalParticipants: result?.totalParticipants ?? 0,
      totalAttendees: result?.totalAttendees ?? 0,
    };
  }

  async recomputeForWebinar(
    webinarId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<WebinarStatsBuckets> {
    const counts = await this.computeCountsForWebinar(webinarId, session);
    await this.setCounts(webinarId, counts, session);
    await this.invalidateListCacheForWebinar(webinarId, 'recomputeForWebinar');
    return counts;
  }

  async applyDeleteDeltas(
    attendees: AttendeeLike[],
    session?: ClientSession,
  ): Promise<void> {
    const deltasByWebinar = new Map<string, WebinarStatsDelta>();

    for (const attendee of attendees) {
      const webinarId = attendee?.webinar?.toString();
      if (!webinarId) {
        continue;
      }

      const removeDelta = this.delta(attendee, null);
      const existing = deltasByWebinar.get(webinarId) ?? this.zeroDelta();
      deltasByWebinar.set(webinarId, {
        totalRegistrations:
          existing.totalRegistrations + removeDelta.totalRegistrations,
        totalParticipants:
          existing.totalParticipants + removeDelta.totalParticipants,
        totalAttendees: existing.totalAttendees + removeDelta.totalAttendees,
      });
    }

    for (const [webinarId, delta] of deltasByWebinar) {
      await this.applyDelta(webinarId, delta, session);
    }
  }

  async resetAllStatsForAdmin(
    adminId: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<void> {
    await this.webinarModel.updateMany(
      { adminId: new Types.ObjectId(`${adminId}`) },
      {
        $set: {
          totalRegistrations: 0,
          totalParticipants: 0,
          totalAttendees: 0,
          totalUnAttended: 0,
        },
      },
      { session },
    );

    await this.webinarListCacheService.bumpVersion(
      `${adminId}`,
      'resetAllStatsForAdmin',
    );
  }

  private async invalidateListCacheForWebinar(
    webinarId: Types.ObjectId | string,
    trigger: string,
  ): Promise<void> {
    try {
      const webinar = await this.webinarModel
        .findById(webinarId)
        .select('adminId')
        .lean();
      if (webinar?.adminId) {
        await this.webinarListCacheService.bumpVersion(
          webinar.adminId.toString(),
          trigger,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `List cache invalidation failed for webinar ${webinarId}: ${message}`,
      );
    }
  }

  private zeroBuckets(): WebinarStatsBuckets {
    return {
      totalRegistrations: 0,
      totalParticipants: 0,
      totalAttendees: 0,
    };
  }

  private zeroDelta(): WebinarStatsDelta {
    return {
      totalRegistrations: 0,
      totalParticipants: 0,
      totalAttendees: 0,
    };
  }
}
